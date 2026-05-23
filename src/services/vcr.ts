import { getEfrexConfigHomeDir } from "src/utils/envUtils"
import { getEffectiveContextWindowSize } from "./compact/autoCompact"
import type {
  BetaContentBlock,
  BetaUsage,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { createHash, randomUUID, type UUID } from 'crypto'
import { mkdir, readFile, writeFile } from 'fs/promises'
import isPlainObject from 'lodash/isPlainObject.js'
import mapValues from 'lodash/mapValues.js'
import { dirname, join } from 'path'
import type {
  AssistantMessage,
  Message,
  StreamEvent,
  SystemAPIErrorMessage,
  UserMessage,
} from 'src/package/message.js'
import { getCwd } from '../utils/cwd.js'
import { env } from '../utils/env.js'
import { getClaudeConfigHomeDir, isEnvTruthy } from '../utils/envUtils.js'
import { getErrnoCode } from '../utils/errors.js'
import { normalizeMessagesForAPI } from "src/utils/api"
import { logForDebugging } from "src/utils/debug"
function shouldUseVCR(): boolean {
  if (process.env.NODE_ENV === 'test') {
    return true
  }
  return true;

  return false
}

/**
通用的fixture管理辅助工具 * 负责对任何数据类型的fixture进行缓存、读取和写入操作
 */
async function withFixture<T>(
  input: unknown,
  fixtureName: string,
  f: () => Promise<T>,
): Promise<T> {
  if (!shouldUseVCR()) {
    return await f()
  }

  // Create hash of input for fixture filename
  const hash = createHash('sha1')
    .update(JSON.stringify(input))
    .digest('hex')
    .slice(0, 12)
  const filename = join(
    process.env.TEST_FIXTURES_ROOT ?? getCwd(),
    `fixtures/${fixtureName}-${hash}.json`,
  )

  // Fetch cached fixture
  try {
    const cached = JSON.parse(
      await readFile(filename, { encoding: 'utf8' }),
    ) as T
    return cached
  } catch (e: unknown) {
    const code = getErrnoCode(e)
    if (code !== 'ENOENT') {
      throw e
    }
  }

  if ((env.isCI || process.env.CI) && !isEnvTruthy(process.env.VCR_RECORD)) {
    throw new Error(
      `Fixture missing: ${filename}. Re-run tests with VCR_RECORD=1, then commit the result.`,
    )
  }

  // Create & write new fixture
  const result = await f()

  await mkdir(dirname(filename), { recursive: true })
  await writeFile(filename, JSON.stringify(result, null, 2), {
    encoding: 'utf8',
  })

  return result
}



function mapMessages(
  messages: (UserMessage | AssistantMessage)['message']['content'][],
  f: (s: unknown) => unknown,
): (UserMessage | AssistantMessage)['message']['content'][] {
  return messages.map(_ => {
    if (typeof _ === 'string') {
      return f(_)
    }
    return _!.map(_ => {
      switch (_.type) {
        case 'tool_result':
          if (typeof _.content === 'string') {
            return { ..._, content: f(_.content) }
          }
          if (Array.isArray(_.content)) {
            return {
              ..._,
              content: _.content.map(_ => {
                switch (_.type) {
                  case 'text':
                    return { ..._, text: f(_.text) }
                  case 'image':
                    return _
                  default:
                    return undefined
                }
              }),
            }
          }
          return _
        case 'text':
          return { ..._, text: f(_.text) }
        case 'tool_use':
          return {
            ..._,
            input: mapValuesDeep(_.input as Record<string, unknown>, f),
          }
        case 'image':
          return _
        default:
          return undefined
      }
    })
  }) as (UserMessage | AssistantMessage)['message']['content'][]
}
function mapValuesDeep(
  obj: {
    [x: string]: unknown
  },
  f: (val: unknown, key: string, obj: Record<string, unknown>) => unknown,
): Record<string, unknown> {
  return mapValues(obj, (val, key) => {
    if (Array.isArray(val)) {
      return val.map(_ => mapValuesDeep(_, f))
    }
    if (isPlainObject(val)) {
      return mapValuesDeep(val as Record<string, unknown>, f)
    }
    return f(val, key, obj)
  })
}
function mapAssistantMessage(
  message: AssistantMessage,
  f: (s: unknown) => unknown,
  index: number,
  uuid?: UUID,
): AssistantMessage {
  return {
    // Use provided UUID if given (hydrate path uses randomUUID for globally unique IDs),
    // otherwise fall back to deterministic index-based UUID (dehydrate/fixture path).
    // sessionStorage.ts deduplicates messages by UUID, so without unique UUIDs across
    // VCR calls, resumed sessions would treat different responses as duplicates.
    uuid: uuid ?? (`UUID-${index}` as unknown as UUID),
    requestId: 'REQUEST_ID',
    timestamp: message.timestamp,
    message: {
      ...message.message,
      content: typeof message.message.content === 'string'
        ? f(message.message.content)
        : (message.message.content as BetaContentBlock[])
            .map(_ => {
              switch (_.type) {
                case 'text':
                  return {
                    ..._,
                    text: f(_.text) as string,
                    citations: _.citations || [],
                  } // Ensure citations
                case 'tool_use':
                  return {
                    ..._,
                    input: mapValuesDeep(_.input as Record<string, unknown>, f),
                  }
                default:
                  return _ // Handle other block types unchanged
              }
            })
            .filter(Boolean) as any,
    },
    type: 'assistant',
  }
}
function mapMessage(
  message: AssistantMessage | SystemAPIErrorMessage | StreamEvent,
  f: (s: unknown) => unknown,
  index: number,
  uuid?: UUID,
): AssistantMessage | SystemAPIErrorMessage | StreamEvent {
  if (message.type === 'assistant') {
    return mapAssistantMessage(message as AssistantMessage, f, index, uuid)
  } else {
    return message
  }
}
function dehydrateValue(s: unknown): unknown {
  if (typeof s !== 'string') {
    return s
  }
  const cwd = getCwd()
  const configHome = getClaudeConfigHomeDir()
  let s1 = s
    .replace(/num_files="\d+"/g, 'num_files="[NUM]"')
    .replace(/duration_ms="\d+"/g, 'duration_ms="[DURATION]"')
    .replace(/cost_usd="\d+"/g, 'cost_usd="[COST]"')
    // Note: We intentionally don't replace all forward slashes with path.sep here.
    // That would corrupt XML-like tags (e.g., </system-reminder> -> <\system-reminder>).
    // The [CONFIG_HOME] and [CWD] replacements below handle path normalization.
    .replaceAll(configHome, '[CONFIG_HOME]')
    .replaceAll(cwd, '[CWD]')
    .replace(/Available commands:.+/, 'Available commands: [COMMANDS]')
  // On Windows, paths may appear in multiple forms:
  // 1. Forward-slash variants (Git, some Node APIs)
  // 2. JSON-escaped variants (backslashes doubled in serialized JSON within messages)
  if (process.platform === 'win32') {
    const cwdFwd = cwd.replaceAll('\\', '/')
    const configHomeFwd = configHome.replaceAll('\\', '/')
    // jsonStringify escapes \ to \\ - match paths embedded in JSON strings
    const cwdJsonEscaped = JSON.stringify(cwd).slice(1, -1)
    const configHomeJsonEscaped = JSON.stringify(configHome).slice(1, -1)
    s1 = s1
      .replaceAll(cwdJsonEscaped, '[CWD]')
      .replaceAll(configHomeJsonEscaped, '[CONFIG_HOME]')
      .replaceAll(cwdFwd, '[CWD]')
      .replaceAll(configHomeFwd, '[CONFIG_HOME]')
  }
  // Normalize backslash path separators after placeholders so VCR fixture
  // hashes match across platforms (e.g., [CWD]\foo\bar -> [CWD]/foo/bar)
  // Handle both single backslashes and JSON-escaped double backslashes (\\)
  s1 = s1
    .replace(/\[CWD\][^\s"'<>]*/g, match =>
      match.replaceAll('\\\\', '/').replaceAll('\\', '/'),
    )
    .replace(/\[CONFIG_HOME\][^\s"'<>]*/g, match =>
      match.replaceAll('\\\\', '/').replaceAll('\\', '/'),
    )
  if (s1.includes('Files modified by user:')) {
    return 'Files modified by user: [FILES]'
  }
  return s1
}
export async function* withStreamingVCR(
  messages: Message[],
  f: () => AsyncGenerator<
    StreamEvent | AssistantMessage | SystemAPIErrorMessage,
    void
  >,
): AsyncGenerator<
  StreamEvent | AssistantMessage | SystemAPIErrorMessage,
  void
> {
  if (!shouldUseVCR()) {
    return yield* f()
  }

  // Compute and yield messages
  const buffer: (StreamEvent | AssistantMessage | SystemAPIErrorMessage)[] = []

  // Record messages (or fetch from cache)
  const cachedBuffer = await withVCR(messages, async () => {
    for await (const message of f()) {
      buffer.push(message)
    }
    return buffer
  })

  if (cachedBuffer.length > 0) {
    yield* cachedBuffer
    return
  }

  yield* buffer
}

function hydrateValue(s: unknown): unknown {
  if (typeof s !== 'string') {
    return s
  }
  return s
    .replaceAll('[NUM]', '1')
    .replaceAll('[DURATION]', '100')
    .replaceAll('[CONFIG_HOME]', getEfrexConfigHomeDir())
    .replaceAll('[CWD]', getCwd())
}

export async function withVCR(
  messages: Message[],
  f: () => Promise<(AssistantMessage | StreamEvent | SystemAPIErrorMessage)[]>,
): Promise<(AssistantMessage | StreamEvent | SystemAPIErrorMessage)[]> {
  if (!shouldUseVCR()) {
    return await f()
  }
  const messagesForAPI = normalizeMessagesForAPI(
    messages.filter(_ => {
      if (_.type !== 'user') {
        return true
      }
      if (_.isMeta) {
        return false
      }
      return true
    }),
  )

  const dehydratedInput = mapMessages(
    messagesForAPI.map(_ => _.message.content),
    dehydrateValue,
  )

  const filename = join(
    process.env.TEST_FIXTURES_ROOT ?? getCwd(),
    `fixtures/${dehydratedInput.map(_ => createHash('sha1').update(JSON.stringify(_)).digest('hex').slice(0, 6)).join('-')}.json`,
  )//content内容全部做hash处理然后保存json文件

  // Fetch cached fixture
  try {
    const cached =JSON.parse(
      await readFile(filename, { encoding: 'utf8' }),
    ) as { output: (AssistantMessage | StreamEvent)[] }
    // cached.output.forEach(addCachedCostToTotalSessionCost)
    return cached.output.map((message, index) =>
      mapMessage(message, hydrateValue, index, randomUUID()),
    )
  } catch (e: unknown) {
    const code = getErrnoCode(e)
    if (code !== 'ENOENT') {
      throw e
    }
  }

  if (env.isCI && !isEnvTruthy(process.env.VCR_RECORD)) {
    throw new Error(
      `Anthropic API fixture missing: ${filename}. Re-run tests with VCR_RECORD=1, then commit the result. Input messages:\n${JSON.stringify(dehydratedInput, null, 2)}`,
    )
  }

  // Create & write new fixture
  const results = await f()
//   if (env.isCI && !isEnvTruthy(process.env.VCR_RECORD)) {
//     return results
//   }

  await mkdir(dirname(filename), { recursive: true })
  await writeFile(
    filename,
    JSON.stringify(
      {
        input: dehydratedInput,
        output: results.map((message, index) =>
          mapMessage(message, dehydrateValue, index),
        ),
      },
      null,
      2,
    ),
    { encoding: 'utf8' },
  )
  return results
}