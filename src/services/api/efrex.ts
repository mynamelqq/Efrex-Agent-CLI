import {
  type AssistantMessage,
  type Message,
  type StreamEvent,
  type SystemAPIErrorMessage,
} from 'src/package/message'
import { getModelMaxOutputTokens } from 'src/context.js'
import type { SystemPrompt } from 'src/prompt'
import type { ThinkingConfig } from 'src/queryEngine'
import { toolMatchesName, type Tools } from 'src/Tool'
import { normalizeMessagesForAPI } from 'src/utils/api.js'
import { createAssistantAPIErrorMessage } from 'src/utils/messages.js'
import { type EffortValue } from 'src/utils/effort'
import { getAPIProvider } from 'src/utils/model/provider.js'

export type Options = {
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
  StreamEvent | AssistantMessage | SystemAPIErrorMessage,
  void
> {
  void thinkingConfig

  const filteredTools = tools.filter(tool => !toolMatchesName(tool, 'ToolSearch'))
  const messagesForAPI = normalizeMessagesForAPI(messages, filteredTools)
  const provider = getAPIProvider()

  switch (provider) {
    case 'openai': {
      const { queryModelOpenAI } = await import('./openai/index.js')
      yield* queryModelOpenAI(
        messagesForAPI,
        systemPrompt,
        tools,
        signal,
        options,
      )
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