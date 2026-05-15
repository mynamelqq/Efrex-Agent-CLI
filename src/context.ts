
import { feature } from 'bun:bundle'
import memoize from 'lodash/memoize.js'
import { getIsGit } from './utils/git.js'
import { isEnvTruthy } from './utils/envUtils.js'
import { execFileNoThrow } from './utils/execFileNoThrow.js'
// import { getBranch, getDefaultBranch, getIsGit, gitExe } from './utils/git.js'
// import { shouldIncludeGitInstructions } from './utils/gitSettings.js'
import { logError } from './utils/log.js'
import { getLocalISODate } from './constants/common'
// Default max output tokens
const MAX_OUTPUT_TOKENS_DEFAULT = 32_000
const MAX_OUTPUT_TOKENS_UPPER_LIMIT = 64_000
/**
 * This context is prepended to each conversation, and cached for the duration of the conversation.
 */
export const getUserContext = memoize(
  async (): Promise<{
    [k: string]: string
  }> => {
    const startTime = Date.now()

    // const claudeMd = shouldDisableClaudeMd
    //   ? null
    //   : getClaudeMds(filterInjectedMemoryFiles(await getMemoryFiles()))
    // // Cache for the auto-mode classifier (yoloClassifier.ts reads this
    // // instead of importing claudemd.ts directly, which would create a
    // // cycle through permissions/filesystem → permissions → yoloClassifier).


    return {
    //   ...(claudeMd && { claudeMd }),
      currentDate: `Today's date is ${getLocalISODate()}.`,
    }
  },
)

// /**
//  * This context is prepended to each conversation, and cached for the duration of the conversation.
//  */
// export const getSystemContext = memoize(
//   async (): Promise<{
//     [k: string]: string
//   }> => {
//     const startTime = Date.now()

//     // Skip git status in CCR (unnecessary overhead on resume) or when git instructions are disabled
//     const gitStatus =
//       isEnvTruthy(process.env.CLAUDE_CODE_REMOTE) ||
//       !shouldIncludeGitInstructions()
//         ? null
//         : await getGitStatus()

//     return {
//       ...(gitStatus && { gitStatus }),
//     }
//   },
// )
// export const getGitStatus = memoize(async (): Promise<string | null> => {
//   if (process.env.NODE_ENV === 'test') {
//     return null
//   }
//   const startTime = Date.now()
//   const isGitStart = Date.now()
//   const isGit = await getIsGit()//该目录有没有git
//   if (!isGit) {
//     return null
//   }

//   try {
//     const gitCmdsStart = Date.now()//, mainBranch, status, log, userName
//     const [branch] = await Promise.all([
//       // getBranch(),
//       getDefaultBranch(),
//       // execFileNoThrow(gitExe(), ['--no-optional-locks', 'status', '--short'], {
//       //   preserveOutputOnError: false,
//       // }).then(({ stdout }) => stdout.trim()),
//       // execFileNoThrow(
//       //   gitExe(),
//       //   ['--no-optional-locks', 'log', '--oneline', '-n', '5'],
//       //   {
//       //     preserveOutputOnError: false,
//       //   },
//       // ).then(({ stdout }) => stdout.trim()),
//       // execFileNoThrow(gitExe(), ['config', 'user.name'], {
//       //   preserveOutputOnError: false,
//       // }).then(({ stdout }) => stdout.trim()),
//     ])


//     // // Check if status exceeds character limit
//     // const truncatedStatus =
//     //   status.length > MAX_STATUS_CHARS
//     //     ? status.substring(0, MAX_STATUS_CHARS) +
//     //       '\n... (truncated because it exceeds 2k characters. If you need more information, run "git status" using BashTool)'
//     //     : status


//     return [
//       `This is the git status at the start of the conversation. Note that this status is a snapshot in time, and will not update during the conversation.`,
//       `Current branch: ${branch}`,
//       `Main branch (you will usually use this for PRs): ${mainBranch}`,
//       ...(userName ? [`Git user: ${userName}`] : []),
//       `Status:\n${truncatedStatus || '(clean)'}`,
//       `Recent commits:\n${log}`,
//     ].join('\n\n')
//   } catch (error) {
//     logError(error)
//     return null
//   }
// })


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
  // Claude-style defaults, but not as large as GPT-5.
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
  // larger completions than the Claude defaults.
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
  } else if (m.includes('claude-3-opus')) {
    defaultTokens = 4_096
    upperLimit = 4_096
  } else if (m.includes('claude-3-sonnet')) {
    defaultTokens = 8_192
    upperLimit = 8_192
  } else if (m.includes('claude-3-haiku')) {
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

function normalizeModelName(model: string): string {
  return model.toLowerCase().replace(/\[1m\]$/, '')
}

function modelMatchesFamily(model: string, family: string): boolean {
  const escapedFamily = family.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[./-])${escapedFamily}([./-]|$)`, 'i').test(model)
}

