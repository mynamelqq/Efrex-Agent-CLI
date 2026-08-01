import { feature } from 'bun:bundle'
import { createAttachmentMessage, createCompactBoundaryMessage } from 'src/utils/messages'
import type { UUID } from 'crypto'
import { getCompactUserSummaryMessage } from './prmpt'
import { APIUserAbortError } from '@anthropic-ai/sdk'
import { getTranscriptPath } from 'src/utils/sessionStorage'
import { getCompactPrompt,asSystemPrompt } from 'src/prompt'
import { normalizeMessagesForAPI } from 'src/utils/api'
import { getRetryDelay } from '../api/withRetry'
import { sleep } from 'src/utils/sleep'
import type { QuerySource } from './querySource'
import { getMessagesAfterCompactBoundary } from 'src/utils/messages'
import { queryModelWithStreaming } from '../api/efrex'
import { roughTokenCountEstimationForMessages } from '../tokenEstimation'
import type { Tool, ToolUseContext } from '../../Tool.js'
import { tokenCountWithEstimation,tokenCountFromLastAPIResponse } from 'src/utils/tokens'
import { COMPACT_MAX_OUTPUT_TOKENS } from 'src/context'
import { createUserMessage,getAssistantMessageText } from 'src/utils/messages'
import { getPromptTooLongTokenGap, PROMPT_TOO_LONG_ERROR_MESSAGE,startsWithApiErrorPrefix } from '../api/errors'
import { getMaxOutputTokensForModel } from '../api/efrex'
import { FileReadTool } from 'src/tools/FileReadTool/FileReadTool.js'
import {
  FILE_READ_TOOL_NAME,
  FILE_UNCHANGED_STUB,
} from 'src/tools/FileReadTool/prompt.js'
import type { AgentId } from '../../types/ids.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  Message,
  HookResultMessage,
  PartialCompactDirection,
  StreamEvent,
  SystemAPIErrorMessage,
  SystemCompactBoundaryMessage,
  SystemMessage,
  UserMessage,
} from 'src/package/message'

import { logForDebugging } from '../../utils/debug.js'
import { cacheToObject } from '../../utils/fileStateCache.js'
import { logError } from '../../utils/log.js'
import { getTokenUsage } from 'src/utils/tokens'
import { expandPath } from '../../utils/path.js'
import { roughTokenCountEstimation } from '../tokenEstimation'
import { groupMessagesByApiRound } from './grouping'
import { MEMORY_TYPE_VALUES } from 'src/utils/memory/types'
import { getMemoryPath } from 'src/utils/config'
import { Attachment, generateFileAttachment } from 'src/utils/attachments'
import { CacheSafeParams } from './autoCompact'

export const POST_COMPACT_MAX_FILES_TO_RESTORE = 5//最多恢复的文件
export const POST_COMPACT_TOKEN_BUDGET = 50_000//压缩预算
export const POST_COMPACT_MAX_TOKENS_PER_FILE = 5_000//每一个文件的预算
// Skills can be large (verify=18.7KB, claude-api=20.1KB). Previously re-injected
// unbounded on every compact → 5-10K tok/compact. Per-skill truncation beats
// dropping — instructions at the top of a skill file are usually the critical
// part. Budget sized to hold ~5 skills at the per-skill cap.
export const POST_COMPACT_MAX_TOKENS_PER_SKILL = 5_000
export const POST_COMPACT_SKILLS_TOKEN_BUDGET = 25_000
const MAX_COMPACT_STREAMING_RETRIES = 2

export const ERROR_MESSAGE_NOT_ENOUGH_MESSAGES =
  'Not enough messages to compact.'
const MAX_PTL_RETRIES = 3
const PTL_RETRY_MARKER = '[earlier conversation truncated for compaction retry]'//post

export const ERROR_MESSAGE_PROMPT_TOO_LONG =
  'Conversation too long. Press esc twice to go up a few messages and try again.'
export const ERROR_MESSAGE_USER_ABORT = 'API Error: Request was aborted.'
export const ERROR_MESSAGE_INCOMPLETE_RESPONSE =
  'Compaction interrupted · This may be due to network issues — please try again.'

export interface CompactionResult {
  boundaryMarker: SystemMessage//标记边界
  summaryMessages: UserMessage[]
  attachments: AttachmentMessage[]
  messagesToKeep?: Message[]
  userDisplayMessage?: string
  preCompactTokenCount?: number
  postCompactTokenCount?: number
  truePostCompactTokenCount?: number
  compactionUsage?: ReturnType<typeof getTokenUsage>
}

/**
 * 诊断上下文从 autoCompactIfNeeded 传递到compactConversation。
 * 让 tengu_compact 事件消除同链循环 (H2) 的歧义
 * 无需连接的跨代理 (H1/H5) 和手动与自动 (H3) 压缩。
 */
export type RecompactionInfo = {
  isRecompactionInChain: boolean
  turnsSincePreviousCompact: number
  previousCompactTurnId?: string
  autoCompactThreshold: number
  querySource?: QuerySource
}

/**
 * 通过总结旧消息来创建对话的紧凑版本
 * 并保存最近的对话历史记录。
 */
export async function compactConversation(
  messages: Message[],
  context: ToolUseContext,
  suppressFollowUpQuestions: boolean,
  customInstructions?: string,
  isAutoCompact: boolean = false,
  recompactionInfo?: RecompactionInfo,
): Promise<CompactionResult> {
  try {
    if (messages.length === 0) {
      throw new Error(ERROR_MESSAGE_NOT_ENOUGH_MESSAGES)
    }

    const preCompactTokenCount = tokenCountWithEstimation(messages)

    const appState = context.getAppState()

    context.setStreamMode?.('requesting')
    context.setResponseLength?.(() => 0)
    context.onCompactProgress?.({ type: 'compact_start' })

    const compactPrompt = getCompactPrompt(customInstructions)
    const summaryRequest = createUserMessage({//创建用户消息提示词
      content: compactPrompt,
    })

    let messagesToSummarize = messages
    let summaryResponse: AssistantMessage
    let summary: string | null
    let ptlAttempts = 0
    for (;;) {
      summaryResponse = await streamCompactSummary({
        messages: messagesToSummarize,
        summaryRequest,
        appState,
        context,
        preCompactTokenCount,
      })
      summary = getAssistantMessageText(summaryResponse)
      if (!summary?.startsWith(PROMPT_TOO_LONG_ERROR_MESSAGE)) break

      // CC-1180：紧凑请求本身提示太长。截断
      // 最旧的 API 轮组并重试，而不是让用户陷入困境。
      ptlAttempts++
      const truncated =
        ptlAttempts <= MAX_PTL_RETRIES
          ? truncateHeadForPTLRetry(messagesToSummarize, summaryResponse)
          : null
      if (!truncated) {
        throw new Error(ERROR_MESSAGE_PROMPT_TOO_LONG)
      }
      messagesToSummarize = truncated
      // The forked-agent path reads from cacheSafeParams.forkContextMessages,
      // not the messages param — thread the truncated set through both paths.

    }

    if (!summary) {
      throw new Error(
        `Failed to generate conversation summary - response did not contain valid text content`,
      )
    } else if (startsWithApiErrorPrefix(summary)) {
      throw new Error(summary)
    }

    // 清除前存储当前文件状态
    let preCompactReadFileState = cacheToObject(context.readFileState)

    // Clear the cache
    context.readFileState.clear()

    // Intentionally NOT resetting sentSkillNames: re-injecting the full
    // skill_listing (~4K tokens) post-compact is pure cache_creation with
    // marginal benefit. The model still has SkillTool in its schema and
    // invoked_skills attachment (below) preserves used-skill content. Ants
    // with EXPERIMENTAL_SKILL_SEARCH already skip re-injection via the
    // early-return in getSkillListingAttachments.

    // Run async attachment generation in parallel
    const [fileAttachments] = await Promise.all([
      createPostCompactFileAttachments(
        preCompactReadFileState,
        context,
        POST_COMPACT_MAX_FILES_TO_RESTORE,
      ),
    ])
    // Release the readFileState snapshot — it can hold 25+ MB of file content
    preCompactReadFileState =
      undefined as unknown as typeof preCompactReadFileState
    const postCompactFileAttachments: AttachmentMessage[] = [
      // ...fileAttachments,
    ]
    // Create the compact boundary marker and summary messages before the
    // event so we can compute the true resulting-context size.
    const boundaryMarker = createCompactBoundaryMessage(//加入压缩边界消息
      isAutoCompact ? 'auto' : 'manual',
      preCompactTokenCount ?? 0,
      messages.at(-1)?.uuid,
    )

    const transcriptPath = getTranscriptPath()
    const summaryMessages: UserMessage[] = [
      createUserMessage({
        content: getCompactUserSummaryMessage(
          summary,
          suppressFollowUpQuestions,
          transcriptPath,
        ),
        isCompactSummary: true,
        isVisibleInTranscriptOnly: true,
      }),
    ]

    // Previously "postCompactTokenCount" — renamed because this is the
    // compact API call's total usage (input_tokens ≈ preCompactTokenCount),
    // NOT the size of the resulting context. Kept for event-field continuity.
    const compactionCallTotalTokens = tokenCountFromLastAPIResponse([
      summaryResponse,
    ])

    // Message-payload estimate of the resulting context. The next iteration's
    // shouldAutoCompact will see this PLUS ~20-40K for system prompt + tools +
    // userContext (via API usage.input_tokens). So `willRetriggerNextTurn: true`
    // is a strong signal; `false` may still retrigger when this is close to threshold.
    const truePostCompactTokenCount = roughTokenCountEstimationForMessages([
      boundaryMarker,
      ...summaryMessages,
      ...postCompactFileAttachments,
    ] as Parameters<typeof roughTokenCountEstimationForMessages>[0])

    // Extract compaction API usage metrics
    const compactionUsage = getTokenUsage(summaryResponse)
    // Release the full API response — it holds content blocks + usage metadata
    summaryResponse = undefined as unknown as typeof summaryResponse

    // markPostCompaction()

    // Re-append session metadata (custom title, tag) so it stays within
    // the 16KB tail window that readLiteMetadata reads for --resume display.
    // Without this, enough post-compaction messages push the metadata entry
    // out of the window, causing --resume to show the auto-generated title
    // instead of the user-set session name.
    // reAppendSessionMetadata()



    const combinedUserDisplayMessage = [
      // userDisplayMessage,
    ]
      .filter(Boolean)
      .join('\n')

    return {
      boundaryMarker,
      summaryMessages,
      attachments: postCompactFileAttachments,
      userDisplayMessage: combinedUserDisplayMessage || undefined,
      preCompactTokenCount,
      postCompactTokenCount: compactionCallTotalTokens,
      truePostCompactTokenCount,
      compactionUsage,
    }
  } catch (error) {

    throw error
  } finally {
    context.setStreamMode?.('requesting')
    context.setResponseLength?.(() => 0)
    context.onCompactProgress?.({ type: 'compact_end' })

  }
}
/**
 * Build the base post-compact messages array from a CompactionResult.
 * This ensures consistent ordering across all compaction paths.
 * Order: boundaryMarker, summaryMessages, messagesToKeep, attachments, hookResults
 */
export function buildPostCompactMessages(result: CompactionResult): Message[] {
  return ([result.boundaryMarker] as Message[]).concat(
    result.summaryMessages,
    result.messagesToKeep ?? [],
    result.attachments,
  )
}
async function streamCompactSummary({
  messages,
  summaryRequest,
  appState,
  context,
  preCompactTokenCount,
}: {
  messages: Message[]
  summaryRequest: UserMessage
  appState: Awaited<ReturnType<ToolUseContext['getAppState']>>
  context: ToolUseContext
  preCompactTokenCount: number
}): Promise<AssistantMessage> {
  try {
    const maxAttempts = 1

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Reset state for retry
      let hasStartedStreaming = false
      let response: AssistantMessage | undefined
      context.setResponseLength?.(() => 0)
      const tools: Tool[] = [FileReadTool]

      const streamingGen = queryModelWithStreaming({
        messages: normalizeMessagesForAPI(
            [//判断消息的message.subtype === 'compact_boundary'
              ...getMessagesAfterCompactBoundary(messages),
              summaryRequest,
            ],
          context.options.tools,
        ),
        systemPrompt: asSystemPrompt([
          'You are a helpful AI assistant tasked with summarizing conversations.',
        ]),
        thinkingConfig: { type: 'disabled' as const },
        tools,
        signal: context.abortController.signal,
        options: {
          async getToolPermissionContext() {
            const appState = context.getAppState()
            return appState.toolPermissionContext
          },
          model: context.options.mainLoopModel,
          toolChoice: undefined,
          mcpTools:[],
          isNonInteractiveSession: context.options.isNonInteractiveSession,
          hasAppendSystemPrompt: !!context.options.appendSystemPrompt,
          maxOutputTokensOverride: Math.min(
            COMPACT_MAX_OUTPUT_TOKENS,
            getMaxOutputTokensForModel(context.options.mainLoopModel),
          ),
          effortValue: appState.effortValue,

        },
      })
      const streamIter = streamingGen[Symbol.asyncIterator]()
      let next = await streamIter.next()

      while (!next.done) {
        const event = next.value as
          | StreamEvent
          | AssistantMessage
          | SystemAPIErrorMessage
        const streamEvent = event as {
          type: string
          event: {
            type: string
            content_block: { type: string }
            delta: { type: string; text: string }
          }
        }

        if (
          !hasStartedStreaming &&
          streamEvent.type === 'stream_event' &&
          streamEvent.event.type === 'content_block_start' &&
          streamEvent.event.content_block.type === 'text'
        ) {
          hasStartedStreaming = true
          context.setStreamMode?.('responding')
        }

        if (
          streamEvent.type === 'stream_event' &&
          streamEvent.event.type === 'content_block_delta' &&
          streamEvent.event.delta.type === 'text_delta'
        ) {
          const charactersStreamed = streamEvent.event.delta.text.length
          context.setResponseLength?.(length => length + charactersStreamed)
        }

        if (event.type === 'assistant') {
          response = event as AssistantMessage
        }

        next = await streamIter.next()
      }

      if (response) {
        return response
      }

      if (attempt < maxAttempts) {

        await sleep(getRetryDelay(attempt), context.abortController.signal, {
          abortError: () => new APIUserAbortError(),
        })
        continue
      }

      logForDebugging(
        `Compact streaming failed after ${attempt} attempts. hasStartedStreaming=${hasStartedStreaming}`,
        { level: 'error' },
      )

      throw new Error(ERROR_MESSAGE_INCOMPLETE_RESPONSE)
    }

    // This should never be reached due to the throw above, but TypeScript needs it
    throw new Error(ERROR_MESSAGE_INCOMPLETE_RESPONSE)
  } finally {
   
  }
}

/**
 * 从消息中删除最旧的 API 轮组，直到覆盖 tokenGap。
 * 当间隙无法解析时，会回落到丢弃 20% 的组（有些
 * 顶点/基岩错误格式）。当没有任何东西可以被删除时返回 null
 * 不留下空的摘要集。
 *
 * 这是 CC-1180 最后的逃生舱口——当紧凑型请求
 * 本身点击提示时间太长，否则用户会被卡住。丢弃
 * 最旧的上下文是有损的，但可以解锁它们。反应式紧凑路径
 * (compactMessages.ts) 具有从尾部剥离的适当重试循环；
 * 这个助手是主动/手动路径的愚蠢但安全的后备方案
 * 在 bfdb472f 的统一中没有迁移。
 */
export function truncateHeadForPTLRetry(//删除最后的一组
  messages: Message[],
  ptlResponse: AssistantMessage,
): Message[] | null {
  // 在分组之前从之前的重试中删除我们自己的合成标记。
  // 否则它会变成自己的组 0 并且 20% 的后备会停止
  // （仅删除标记，重新添加它，重试 2+ 时进度为零）。
  const input =
    messages[0]?.type === 'user' &&
    messages[0]?.isMeta &&
    messages[0]?.message?.content === PTL_RETRY_MARKER
      ? messages.slice(1)
      : messages

  const groups = groupMessagesByApiRound(input)
  if (groups.length < 2) return null

  const tokenGap = getPromptTooLongTokenGap(ptlResponse)
  let dropCount: number
  if (tokenGap !== undefined) {
    let acc = 0
    dropCount = 0
    for (const g of groups) {
      acc += roughTokenCountEstimationForMessages(
        g as Parameters<typeof roughTokenCountEstimationForMessages>[0],
      )
      dropCount++
      if (acc >= tokenGap) break
    }
  } else {
    dropCount = Math.max(1, Math.floor(groups.length * 0.2))
  }

  // 至少保留一组，以便有东西可以总结。
  dropCount = Math.min(dropCount, groups.length - 1)
  if (dropCount < 1) return null

  const sliced = groups.slice(dropCount).flat()
  // groupMessagesByApiRound puts the preamble in group 0 and starts every
  // subsequent group with an assistant message. Dropping group 0 leaves an
  // assistant-first sequence which the API rejects (first message must be
  // role=user). Prepend a synthetic user marker — ensureToolResultPairing
  // already handles any orphaned tool_results this creates.
  if (sliced[0]?.type === 'assistant') {
    return [
      createUserMessage({ content: PTL_RETRY_MARKER, isMeta: true }),//插入一条PTL message告知 反复压缩时有消息被压缩了
      ...sliced,
    ]
  }
  return sliced
}


/**
 * 为最近访问的文件创建附件消息，以便在压缩后恢复它们。
 * 这可以防止模型必须重新读取最近访问过的文件。
 * 使用 FileReadTool 重新读取文件以获取经过适当验证的新内容。
 * 文件是根据新近度选择的，但受到文件计数和令牌预算限制的限制。
 *
 * 已作为 Read 工具结果出现的文件将被跳过 protectedMessages —
 * 重新注入模型已经可以在保留的尾部看到的相同内容
 * 纯粹是废物（最多 25K tok/compact）。镜像保留的差异
 * getDeferredToolsDeltaAttachment 在相同调用站点使用的模式。
 *
 * @param readFileState 当前文件状态跟踪最近读取的文件
 * @param toolUseContext 该工具使用上下文来调用 FileReadTool
 * @param maxFiles 要恢复的最大文件数（默认值：5）
 * @param preservedMessages 消息保持后压缩；此处的读取结果被跳过
 * @returns 符合令牌预算的最近访问的文件的附件消息数组
 */
export async function createPostCompactFileAttachments(
  readFileState: Record<string, { content: string; timestamp: number }>,
  toolUseContext: ToolUseContext,
  maxFiles: number,
  preservedMessages: Message[] = [],
): Promise<AttachmentMessage[]> {
  const preservedReadPaths = collectReadToolFilePaths(preservedMessages)//收集读取文件工具读取过的文件路径
  const recentFiles = Object.entries(readFileState)
    .map(([filename, state]) => ({ filename, ...state }))
    .filter(
      file =>
        !shouldExcludeFromPostCompactRestore(
          file.filename,
        ) && !preservedReadPaths.has(expandPath(file.filename)),
    )
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, maxFiles)

  const results = await Promise.all(
    recentFiles.map(async file => {
      const attachment = await generateFileAttachment(
        file.filename,
        {
          ...toolUseContext,
          fileReadingLimits: {
            maxTokens: POST_COMPACT_MAX_TOKENS_PER_FILE,
          },
        },
        'tengu_post_compact_file_restore_success',
        'tengu_post_compact_file_restore_error',
        'compact',
      )
      return attachment ? createAttachmentMessage(attachment) : null
    }),
  )

  let usedTokens = 0
  return results.filter((result): result is AttachmentMessage<Attachment> => {
    if (result === null) {
      return false
    }
    const attachmentTokens = roughTokenCountEstimation(JSON.stringify(result))
    if (usedTokens + attachmentTokens <= POST_COMPACT_TOKEN_BUDGET) {
      usedTokens += attachmentTokens
      return true
    }
    return false
  })
}
/**
 * Scan messages for Read tool_use blocks and collect their file_path inputs
 * (normalized via expandPath). Used to dedup post-compact file restoration
 * against what's already visible in the preserved tail.
 *
 * Skips Reads whose tool_result is a dedup stub — the stub points at an
 * earlier full Read that may have been compacted away, so we want
 * createPostCompactFileAttachments to re-inject the real content.
 */
function collectReadToolFilePaths(messages: Message[]): Set<string> {
  const stubIds = new Set<string>()
  for (const message of messages) {
    if (message.type !== 'user' || !Array.isArray(message.message!.content)) {
      continue
    }
    for (const block of message.message!.content) {
      if (
        block.type === 'tool_result' &&
        typeof block.content === 'string' &&
        block.content.startsWith(FILE_UNCHANGED_STUB)
      ) {
        stubIds.add(block.tool_use_id)
      }
    }
  }

  const paths = new Set<string>()
  for (const message of messages) {
    if (
      message.type !== 'assistant' ||
      !Array.isArray(message.message!.content)
    ) {
      continue
    }
    for (const block of message.message!.content) {
      if (
        block.type !== 'tool_use' ||
        block.name !== FILE_READ_TOOL_NAME ||
        stubIds.has(block.id)
      ) {
        continue
      }
      const input = block.input
      if (
        input &&
        typeof input === 'object' &&
        'file_path' in input &&
        typeof input.file_path === 'string'
      ) {
        paths.add(expandPath(input.file_path))
      }
    }
  }
  return paths
}


function shouldExcludeFromPostCompactRestore(//是否需要排除一些关键的文件，
  filename: string,
): boolean {
  const normalizedFilename = expandPath(filename)
  // Exclude plan files
  // try {
  //   const planFilePath = expandPath(getPlanFilePath(agentId))
  //   if (normalizedFilename === planFilePath) {
  //     return true
  //   }
  // } catch {
  //   // If we can't get plan file path, continue with other checks
  // }

  // Exclude all types of claude.md files
  // TODO: Refactor to use isMemoryFilePath() from claudemd.ts for consistency
  // and to also match child directory memory files (.claude/rules/*.md, etc.)
  try {
    const normalizedMemoryPaths = new Set(
      MEMORY_TYPE_VALUES.map(type => expandPath(getMemoryPath(type))),
    )

    if (normalizedMemoryPaths.has(normalizedFilename)) {
      return true
    }
  } catch {
    // If we can't get memory paths, continue
  }

  return false
}
