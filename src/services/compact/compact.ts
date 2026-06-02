import { feature } from 'bun:bundle'
import { createCompactBoundaryMessage } from 'src/utils/messages'
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
import { PROMPT_TOO_LONG_ERROR_MESSAGE,startsWithApiErrorPrefix } from '../api/errors'
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


export const POST_COMPACT_MAX_FILES_TO_RESTORE = 5


export const ERROR_MESSAGE_NOT_ENOUGH_MESSAGES =
  'Not enough messages to compact.'
const MAX_PTL_RETRIES = 3
const PTL_RETRY_MARKER = '[earlier conversation truncated for compaction retry]'

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
 * Diagnosis context passed from autoCompactIfNeeded into compactConversation.
 * Lets the tengu_compact event disambiguate same-chain loops (H2) from
 * cross-agent (H1/H5) and manual-vs-auto (H3) compactions without joins.
 */
export type RecompactionInfo = {
  isRecompactionInChain: boolean
  turnsSincePreviousCompact: number
  previousCompactTurnId?: string
  autoCompactThreshold: number
  querySource?: QuerySource
}

/**
 * Creates a compact version of a conversation by summarizing older messages
 * and preserving recent conversation history.
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

      // // CC-1180: compact request itself hit prompt-too-long. Truncate the
      // // oldest API-round groups and retry rather than leaving the user stuck.
      // ptlAttempts++
      // const truncated =
      //   ptlAttempts <= MAX_PTL_RETRIES
      //     ? truncateHeadForPTLRetry(messagesToSummarize, summaryResponse)
      //     : null
      // if (!truncated) {
      //   throw new Error(ERROR_MESSAGE_PROMPT_TOO_LONG)
      // }
      // messagesToSummarize = truncated
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

    // Store the current file state before clearing
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
    // const [fileAttachments] = await Promise.all([
    //   createPostCompactFileAttachments(
    //     preCompactReadFileState,
    //     context,
    //     POST_COMPACT_MAX_FILES_TO_RESTORE,
    //   ),
    // ])
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

