
import { feature } from 'bun:bundle'
import memoize from 'lodash/memoize.js'
import { isEnvTruthy } from './utils/envUtils.js'
import { MemoryType } from './utils/memory/types.js'
import { getBranch, getDefaultBranch, getIsGit, gitExe } from './utils/git.js'
import { getMemoryFiles } from './utils/efrexmd.js'
import { execFileNoThrow } from './utils/execFileNoThrow.js'
// import { getBranch, getDefaultBranch, getIsGit, gitExe } from './utils/git.js'
// import { shouldIncludeGitInstructions } from './utils/gitSettings.js'
import { logError } from './utils/log.js'
import { getLocalISODate } from './constants/common'
import { setCachedEfrexMdContent } from './bootstrap/state.js'
import { logForDebugging } from './utils/debug.js'
// Default max output tokens
const MAX_OUTPUT_TOKENS_DEFAULT = 32_000
// Maximum output tokens for compact operations
export const COMPACT_MAX_OUTPUT_TOKENS = 20_000
const MAX_OUTPUT_TOKENS_UPPER_LIMIT = 64_000
/**
 * This context is prepended to each conversation, and cached for the duration of the conversation.
 */
export const getUserContext = memoize(
  async (): Promise<{
    [k: string]: string
  }> => {
    const startTime = Date.now()

      // Efrex_CODE_DISABLE_Efrex_MDS: hard off, always.
    // --bare: skip auto-discovery (cwd walk), BUT honor explicit --add-dir.
    // --bare means "skip what I didn't ask for", not "ignore what I asked for".
    const shouldDisableEfrexMd =isEnvTruthy(process.env.DISABLE_Efrex_MDS)
    // Await the async I/O (readFile/readdir directory walk) so the event
    // loop yields naturally at the first fs.readFile.
    const EfrexMd = shouldDisableEfrexMd
      ? null:getEfrexMds(await getMemoryFiles())//读取并拼装 Efrex / Efrex 的“记忆文件（Memory Files）”，最终生成一个系统 Prompt
    setCachedEfrexMdContent(EfrexMd || null)
    return {
      ...(EfrexMd && { EfrexMd }),
      currentDate: `Today's date is ${getLocalISODate()}.`,
    }
  },
)
const MEMORY_INSTRUCTION_PROMPT =
  'Codebase and user instructions are shown below. Be sure to adhere to these instructions. IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.'
// Recommended max character count for a memory file
export const MAX_MEMORY_CHARACTER_COUNT = 40000
export type MemoryFileInfo = {
  path: string
  type: MemoryType
  content: string
  parent?: string // Path of the file that included this one
  globs?: string[] // Glob patterns for file paths this rule applies to
  // True when auto-injection transformed `content` (stripped HTML comments,
  // stripped frontmatter, truncated MEMORY.md) such that it no longer matches
  // the bytes on disk. When set, `rawContent` holds the unmodified disk bytes
  // so callers can cache a `isPartialView` readFileState entry — presence in
  // cache provides dedup + change detection, but Edit/Write still require an
  // explicit Read before proceeding.
  contentDiffersFromDisk?: boolean
  rawContent?: string
}

const MAX_STATUS_CHARS = 1800
/**
 * This context is prepended to each conversation, and cached for the duration of the conversation.
 */
export const getSystemContext = memoize(
  async (): Promise<{
    [k: string]: string
  }> => {
    const startTime = Date.now()

    // Skip git status in CCR (unnecessary overhead on resume) or when git instructions are disabled
    const gitStatus =
      isEnvTruthy(process.env.Efrex_CODE_REMOTE)
        ? null
        : await getGitStatus()
    logForDebugging("gitStatus:"+gitStatus!)
    return {
      ...(gitStatus && { gitStatus }),
    }
  },
)
export const getGitStatus = memoize(async (): Promise<string | null> => {
  const startTime = Date.now()
  const isGitStart = Date.now()
  const isGit = await getIsGit()//该目录有没有git 没有的话直接退出 
  if (!isGit) {
    return null
  }
  try {
    const gitCmdsStart = Date.now()//, mainBranch, status, log, userName
     const [branch, mainBranch, status, log, userName] = await Promise.all([
      getBranch(),
      getDefaultBranch(),
      execFileNoThrow(gitExe(), ['--no-optional-locks', 'status', '--short'], {
        preserveOutputOnError: false,
      }).then(({ stdout }) => stdout.trim()),
      execFileNoThrow(
        gitExe(),
        ['--no-optional-locks', 'log', '--oneline', '-n', '5'],
        {
          preserveOutputOnError: false,
        },
      ).then(({ stdout }) => stdout.trim()),
      execFileNoThrow(gitExe(), ['config', 'user.name'], {
        preserveOutputOnError: false,
      }).then(({ stdout }) => stdout.trim()),
    ])


    // Check if status exceeds character limit
    const truncatedStatus =
      status.length > MAX_STATUS_CHARS
        ? status.substring(0, MAX_STATUS_CHARS) +
          '\n... (truncated because it exceeds 2k characters. If you need more information, run "git status" using BashTool)'
        : status


    return [
      `This is the git status at the start of the conversation. Note that this status is a snapshot in time, and will not update during the conversation.`,
      `Current branch: ${branch}`,
      `Main branch (you will usually use this for PRs): ${mainBranch}`,
      ...(userName ? [`Git user: ${userName}`] : []),
      `Status:\n${truncatedStatus || '(clean)'}`,
      `Recent commits:\n${log}`,
    ].join('\n\n')
  } catch (error) {
    logError(error)
    return null
  }
})


function getOpenAICompatibleMaxOutputTokens(model: string): {
  default: number
  upperLimit: number
} | undefined {
  const m = normalizeModelName(model)

  // OpenAI's GPT-5 family currently uses 128k output ceilings across the
  // variants we support here. Keep the default aligned with the ceiling so the
  // OpenAI-compatible path does not under-request tokens by default.
  if (m.includes('gpt-5')) {
    return { default: 128_000, upperLimit: 128_000 }
  }

  // GPT-4.1 / 4o / GPT-OSS models are still substantially larger than the
  // Efrex-style defaults, but not as large as GPT-5.
  if (m.includes('gpt-4.1')) {
    return { default: 32_768, upperLimit: 32_768 }
  }
  if (m.includes('gpt-4o')) {
    return { default: 16_384, upperLimit: 16_384 }
  }
  if (m.includes('gpt-oss')) {
    return { default: 32_768, upperLimit: 32_768 }
  }

  // Reasoning-style OpenAI models from the o3/o4 family typically allow much
  // larger completions than the Efrex defaults.
  if (m === 'o3' || m.startsWith('o3-') || m.includes('/o3-')) {
    return { default: 100_000, upperLimit: 100_000 }
  }
  if (m === 'o4-mini' || m.startsWith('o4-mini-') || m.includes('/o4-mini-')) {
    return { default: 100_000, upperLimit: 100_000 }
  }

  return undefined
}

function getChineseCompatibleMaxOutputTokens(model: string): {
  default: number
  upperLimit: number
} | undefined {
  const m = normalizeModelName(model)

  // DeepSeek's v4/pro variants support very large completions; keep a larger
  // ceiling there and a more conservative default for the rest of the family.
  if (m.includes('deepseek-v4-pro')) {
    return { default: 64_000, upperLimit: 128_000 }
  }
  if (m.includes('deepseek')) {
    return { default: 32_000, upperLimit: 64_000 }
  }

  if (modelMatchesFamily(m, 'qwen')) {
    return { default: 32_000, upperLimit: 64_000 }
  }
  if (modelMatchesFamily(m, 'glm')) {
    return { default: 32_000, upperLimit: 64_000 }
  }
  if (modelMatchesFamily(m, 'doubao')) {
    return { default: 32_000, upperLimit: 64_000 }
  }
  if (modelMatchesFamily(m, 'moonshot') || modelMatchesFamily(m, 'kimi')) {
    return { default: 32_000, upperLimit: 64_000 }
  }
  if (modelMatchesFamily(m, 'hunyuan')) {
    return { default: 32_000, upperLimit: 64_000 }
  }
  if (
    modelMatchesFamily(m, 'ernie') ||
    modelMatchesFamily(m, 'spark') ||
    modelMatchesFamily(m, 'baichuan') ||
    modelMatchesFamily(m, 'minimax') ||
    modelMatchesFamily(m, 'yi') ||
    modelMatchesFamily(m, 'step')
  ) {
    return { default: 16_384, upperLimit: 32_768 }
  }

  return undefined
}



function normalizeModelName(model: string): string {
  return model.toLowerCase().replace(/\[1m\]$/, '')
}

function modelMatchesFamily(model: string, family: string): boolean {
  const escapedFamily = family.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[./-])${escapedFamily}([./-]|$)`, 'i').test(model)
}
export const MODEL_CONTEXT_WINDOW_DEFAULT = 500_000

export function getContextWindowForModel(
  model: string,
  betas?: string[],
): number {
  const m = normalizeModelName(model)

  // ── OpenAI ────────────────────────────────────────────────────────
  if (m.includes('gpt-5')) return 400_000
  if (m.includes('gpt-4.1')) return 1_000_000
  if (m.includes('gpt-4o')) return 128_000
  if (m.includes('gpt-4-turbo')) return 128_000
  if (m.includes('gpt-4')) return 32_000   // GPT-4 base: 8K-32K
  // o-series reasoning models
  if (m.startsWith('o3') || m.startsWith('o4')) return 200_000

  // ── Anthropic Efrex ──────────────────────────────────────────────
  // Efrex 4 family (opus-4 / sonnet-4 / haiku-4) → API 1M
  if (
    m.includes('opus-4') ||
    m.includes('sonnet-4') ||
    m.includes('haiku-4')
  ) return 1_000_000
  // Efrex 3.7 Sonnet → 200K
  if (m.includes('3-7-sonnet')) return 200_000
  // Efrex 3.5 → 200K
  if (m.includes('3-5-sonnet') || m.includes('3-5-haiku')) return 200_000
  // Efrex 3 (opus / sonnet / haiku) → 100K
  if (m.includes('Efrex-3')) return 100_000

  // ── Google Gemini ─────────────────────────────────────────────────
  if (m.includes('gemini')) return 2_000_000

  // ── Meta Llama ────────────────────────────────────────────────────
  if (m.includes('llama-4') || m.includes('llama4')) return 10_000_000
  if (m.includes('llama')) return 128_000

  // ── DeepSeek ──────────────────────────────────────────────────────
  if (m.includes('deepseek')) return 1_000_000

  // ── Chinese model families ───────────────────────────────────────
  if (modelMatchesFamily(m, 'qwen')) return 1_000_000
  if (modelMatchesFamily(m, 'glm')) return 128_000
  if (modelMatchesFamily(m, 'doubao')) return 128_000
  if (modelMatchesFamily(m, 'moonshot') || modelMatchesFamily(m, 'kimi')) return 128_000
  if (modelMatchesFamily(m, 'hunyuan')) return 256_000
  if (
    modelMatchesFamily(m, 'ernie') ||
    modelMatchesFamily(m, 'spark') ||
    modelMatchesFamily(m, 'baichuan') ||
    modelMatchesFamily(m, 'minimax') ||
    modelMatchesFamily(m, 'yi') ||
    modelMatchesFamily(m, 'step')
  ) return 128_000

  return MODEL_CONTEXT_WINDOW_DEFAULT
}
/**
 * Returns the model's default and upper limit for max output tokens.
 */
export function getModelMaxOutputTokens(model: string): {
  default: number
  upperLimit: number
} {
  let defaultTokens: number
  let upperLimit: number
  const thirdPartyMaxTokens =
    getOpenAICompatibleMaxOutputTokens(model) ??
    getChineseCompatibleMaxOutputTokens(model)
  if (thirdPartyMaxTokens) {
    return thirdPartyMaxTokens
  }

  const m = normalizeModelName(model)
  if (m.includes('opus-4-7')) {
    defaultTokens = 64_000
    upperLimit = 128_000
  } else if (m.includes('opus-4-6')) {
    defaultTokens = 64_000
    upperLimit = 128_000
  } else if (m.includes('sonnet-4-6')) {
    defaultTokens = 32_000
    upperLimit = 128_000
  } else if (
    m.includes('opus-4-5') ||
    m.includes('sonnet-4') ||
    m.includes('haiku-4')
  ) {
    defaultTokens = 32_000
    upperLimit = 64_000
  } else if (m.includes('opus-4-1') || m.includes('opus-4')) {
    defaultTokens = 32_000
    upperLimit = 32_000
  } else if (m.includes('Efrex-3-opus')) {
    defaultTokens = 4_096
    upperLimit = 4_096
  } else if (m.includes('Efrex-3-sonnet')) {
    defaultTokens = 8_192
    upperLimit = 8_192
  } else if (m.includes('Efrex-3-haiku')) {
    defaultTokens = 4_096
    upperLimit = 4_096
  } else if (m.includes('3-5-sonnet') || m.includes('3-5-haiku')) {
    defaultTokens = 8_192
    upperLimit = 8_192
  } else if (m.includes('3-7-sonnet')) {
    defaultTokens = 32_000
    upperLimit = 64_000
  } else {
    defaultTokens = MAX_OUTPUT_TOKENS_DEFAULT
    upperLimit = MAX_OUTPUT_TOKENS_UPPER_LIMIT
  }

  return { default: defaultTokens, upperLimit }
}
export const getEfrexMds = (
  memoryFiles: MemoryFileInfo[],
  filter?: (type: MemoryType) => boolean,
): string => {
  const memories: string[] = []
  for (const file of memoryFiles) {
    if (filter && !filter(file.type)) continue
    if (file.content) {
      const description =
        file.type === 'Project'
          ? ' (project instructions, checked into the codebase)'
          : file.type === 'Local'
            ? " (user's private project instructions, not checked in)"
            : feature('TEAMMEM') && file.type === 'TeamMem'
              ? ' (shared team memory, synced across the organization)'
              : file.type === 'AutoMem'
                ? " (user's auto-memory, persists across conversations)"
                : " (user's private global instructions for all projects)"

      const content = file.content.trim()
      if (feature('TEAMMEM') && file.type === 'TeamMem') {
        memories.push(
          `Contents of ${file.path}${description}:\n\n<team-memory-content source="shared">\n${content}\n</team-memory-content>`,
        )
      } else {
        memories.push(`Contents of ${file.path}${description}:\n\n${content}`)
      }
    }
  }

  if (memories.length === 0) {
    return ''
  }

  return `${MEMORY_INSTRUCTION_PROMPT}\n\n${memories.join('\n\n')}`
}