import { BetaContentBlockParam,BetaImageBlockParam,BetaToolResultBlockParam,BetaRequestDocumentBlock } from '@anthropic-ai/sdk/resources/beta.mjs'
import {
  type ApiRetryStatusEvent,
  type AssistantMessage,
  type Message,
  type UserMessage,
  type StreamEvent,
  type SystemAPIErrorMessage,
} from 'src/package/message'
import { getModelMaxOutputTokens } from 'src/context.js'
import type { SystemPrompt } from 'src/prompt'
import type { ThinkingConfig } from "src/utils/effort.js"
import { toolMatchesName, type Tools } from 'src/Tool'
import { normalizeMessagesForAPI } from 'src/utils/api.js'
import { API_MAX_MEDIA_PER_REQUEST } from 'src/constants/ApiLimits.js'
import { ToolPermissionContext } from 'src/Tool'
import { createAssistantAPIErrorMessage,ensureToolResultPairing } from 'src/utils/messages.js'
import { type EffortValue } from 'src/utils/effort'
import { withStreamingVCR } from '../vcr.js'

export type Options = {
  maxOutputTokensOverride?: number
  getToolPermissionContext: () => Promise<ToolPermissionContext>
  model: string
  isNonInteractiveSession: boolean
  toolChoice?: 'auto' | 'none' | undefined
  fallbackModel?: string
  onStreamingFallback?: () => void
  hasAppendSystemPrompt: boolean
  enablePromptCaching?: boolean
  skipCacheWrite?: boolean
  temperatureOverride?: number
  effortValue?: EffortValue
  advisorModel?: string
  addNotification?: (notif: Notification) => void

}

type QueryModelArgs = {
  messages: Message[]
  systemPrompt: SystemPrompt
  thinkingConfig: ThinkingConfig
  tools: Tools
  signal: AbortSignal
  options: Options
}

/**
 * Thin orchestration layer:
 * - keep a stable API for the rest of the app
 * - apply minimal provider-agnostic preprocessing once
 * - dispatch to the concrete provider implementation
 *
 * Provider-specific streaming, retries, thinking, fallback, and error
 * semantics should live under ./openai or future provider directories.
 */
export async function* queryModelWithStreaming({
  messages,
  systemPrompt,
  thinkingConfig,
  tools,
  signal,
  options,
}: QueryModelArgs): AsyncGenerator<
  StreamEvent | AssistantMessage | SystemAPIErrorMessage | ApiRetryStatusEvent,
  void
> {
  const filteredTools = tools.filter(tool => !toolMatchesName(tool, 'ToolSearch'))
  let messagesForAPI = normalizeMessagesForAPI(messages, filteredTools)
  const provider = (process.env.Provider ?? 'OPENAI').toLowerCase()
  // Repair tool_use/tool_result pairing mismatches that can occur when resuming
  // remote/teleport sessions. Inserts synthetic error tool_results for orphaned
  // tool_uses and strips orphaned tool_results referencing non-existent tool_uses.
  messagesForAPI = ensureToolResultPairing(messagesForAPI)
  // Strip excess media items before making the API call.
  // The API rejects requests with >100 media items but returns a confusing error.
  // Rather than erroring (which is hard to recover from in Cowork/CCD), we
  // silently drop the oldest media items to stay within the limit.
  messagesForAPI = stripExcessMediaItems(
    messagesForAPI,
    API_MAX_MEDIA_PER_REQUEST,
  )

  switch (provider) {
    case 'openai': {
      const { queryModelOpenAI } = await import('./openai/index.js')
      yield* withStreamingVCR(messagesForAPI,
        async function* () {
        yield* queryModelOpenAI(
          messages,
          systemPrompt,
          thinkingConfig,
          tools,
          signal,
          options
        )
      })
      return
    }
    case 'anthropic': {
      const { queryModelAnthropic } = await import('./anthropic/index.js')
      yield* withStreamingVCR(messagesForAPI, async function* () {
        yield* queryModelAnthropic(
          messages,
          systemPrompt,
          thinkingConfig,
          tools,
          signal,
          options,
        )
      })
      return
    }
    default:
      yield createAssistantAPIErrorMessage({
        content: `Unsupported API provider: ${provider}`,
        apiError: 'api_error',
        error: 'unknown',
      })
      return
  }
}


export function getMaxOutputTokensForModel(model: string): number {
  const maxOutputTokens = getModelMaxOutputTokens(model)
  return maxOutputTokens.default
}
function isMedia(
  block: BetaContentBlockParam,
): block is BetaImageBlockParam | BetaRequestDocumentBlock {
  return block.type === 'image' || block.type === 'document'
}

function isToolResult(
  block: BetaContentBlockParam,
): block is BetaToolResultBlockParam {
  return block.type === 'tool_result'
}

/**
 * Ensures messages contain at most `limit` media items (images + documents).
 * Strips oldest media first to preserve the most recent.
 */
export function stripExcessMediaItems(
  messages: (UserMessage | AssistantMessage)[],
  limit: number,
): (UserMessage | AssistantMessage)[] {
  let toRemove = 0
  for (const msg of messages) {
    if (!Array.isArray(msg.message!.content)) continue
    for (const block of msg.message!.content) {
      if (isMedia(block)) toRemove++//如果是媒体文件就计
      if (isToolResult(block) && Array.isArray(block.content)) {
        for (const nested of block.content) {
          if (isMedia(nested as BetaContentBlockParam)) toRemove++
        }
      }
    }
  }
  toRemove -= limit
  if (toRemove <= 0) return messages

  return messages.map(msg => {
    if (toRemove <= 0) return msg
    const content = msg.message!.content
    if (!Array.isArray(content)) return msg

    const before = toRemove
    const stripped = content
      .map(block => {
        if (
          toRemove <= 0 ||
          !isToolResult(block) ||
          !Array.isArray(block.content)
        )
          return block
        const filtered = block.content.filter(n => {
          if (toRemove > 0 && isMedia(n as BetaContentBlockParam)) {
            toRemove--
            return false
          }
          return true
        })
        return filtered.length === block.content.length
          ? block
          : { ...block, content: filtered }
      })
      .filter(block => {
        if (toRemove > 0 && isMedia(block)) {
          toRemove--
          return false
        }
        return true
      })

    return before === toRemove
      ? msg
      : {
          ...msg,
          message: { ...msg.message, content: stripped },
        }
  }) as (UserMessage | AssistantMessage)[]
}
