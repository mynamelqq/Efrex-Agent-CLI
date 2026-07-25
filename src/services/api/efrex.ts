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
import { asSystemPrompt, type SystemPrompt } from 'src/prompt'
import type { ThinkingConfig } from "src/utils/effort.js"
import { toolMatchesName, type Tools } from 'src/Tool'
import { normalizeMessagesForAPI } from 'src/utils/api.js'
import { API_MAX_MEDIA_PER_REQUEST } from 'src/constants/ApiLimits.js'
import { ToolPermissionContext } from 'src/Tool'
import {
  createAssistantAPIErrorMessage,
  ensureToolResultPairing,
  normalizeContentFromAPI,
} from 'src/utils/messages.js'
import { type EffortValue } from 'src/utils/effort'
import { withStreamingVCR } from '../vcr.js'
import { isClaudeAISubscriber } from 'src/utils/auth.js'
import { getAttributionHeader, getCLISyspromptPrefix } from 'src/constants/system.js'
import { computeFingerprintFromMessages } from 'src/utils/fingerprint.js'
import OpenAI, {
  APIConnectionTimeoutError,
  APIUserAbortError,
} from 'openai'
import { getSessionId } from 'src/bootstrap/state.js'
import { getOauthConfig } from 'src/constants/oauth.js'
import { getClaudeAIOAuthTokens } from 'src/cli/auth.js'
import {
  checkAndRefreshOAuthTokenIfNeeded,
} from 'src/utils/auth.js'
import { isOAuthTokenExpired } from 'src/services/oauth/client.js'
import { getUserAgent } from 'src/utils/http.js'
import { randomUUID } from 'crypto'
import { toolToAPISchema } from 'src/utils/api.js'
import { messagesToOpenAI } from './openai/convertMessages.js'
import { toolsToOpenAI, toolChoiceToOpenAI } from './openai/convertTools.js'
import { adaptOpenAIStream } from './openai/streamAdapter.js'
import { resolveOpenAIModel } from './openai/modelMapping.js'
import {
  buildOpenAIRequestBody,
  isOpenAIThinkingEnabled,
  resolveOpenAIMaxTokens,
} from './openai/requestBody.js'
import { getInitialEffortSetting } from 'src/utils/effort.js'
import { withRetry } from 'src/utils/withRetry.js'
import { getAssistantMessageFromError } from './errors.js'

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
  if(!isClaudeAISubscriber()) {
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
    // Compute fingerprint from first user message for attribution.
  // Must run BEFORE injecting synthetic messages (e.g. deferred tool names)
  // so the fingerprint reflects the actual user input.
  const fingerprint = computeFingerprintFromMessages(messagesForAPI)

  // filter(Boolean) works by converting each element to a boolean - empty strings become false and are filtered out.
  systemPrompt = asSystemPrompt(
    [
      getAttributionHeader(fingerprint),
      getCLISyspromptPrefix({
        isNonInteractive: options.isNonInteractiveSession,
        hasAppendSystemPrompt: options.hasAppendSystemPrompt,
      }),
      ...systemPrompt,
    ].filter(Boolean),
  )
  // const effort = resolveAppliedEffort(options.model, options.effortValue)

  try {
    await checkAndRefreshOAuthTokenIfNeeded()
    const oauthTokens = getClaudeAIOAuthTokens()
    const accessToken = oauthTokens?.accessToken
    if (!accessToken) {
      throw new Error('OAuth session expired. Please run /login.')
    }
    if (
      oauthTokens.refreshToken &&
      oauthTokens.expiresAt != null &&
      isOAuthTokenExpired(oauthTokens.expiresAt)
    ) {
      throw new Error(
        'OAuth token expired and could not be refreshed. Please run /login.',
      )
    }

    const apiKeyResponse = await fetch(getOauthConfig().API_KEY_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!apiKeyResponse.ok) {
      if (apiKeyResponse.status === 401 || apiKeyResponse.status === 403) {
        throw new Error(
          'OAuth session expired or is no longer valid. Please run /login.',
        )
      }
      throw new Error(
        `Failed to obtain Efrex proxy API key: ${apiKeyResponse.status}`,
      )
    }
    const body = (await apiKeyResponse.json()) as { raw_key?: string }
    if (!body.raw_key) throw new Error('Efrex proxy did not return an API key')

    const efrexClient = new OpenAI({
      apiKey: body.raw_key,
      baseURL: getOauthConfig().OPENAI_PROXY_URL,
      maxRetries: 0,
      timeout: parseInt(process.env.API_TIMEOUT_MS || String(600 * 1000), 10),
      dangerouslyAllowBrowser: true,
      defaultHeaders: {
        'x-app': 'cli',
        'User-Agent': getUserAgent(),
        'X-Efrex-Code-Session-Id': getSessionId(),
      },
    })

    // Efrex is an independent OpenAI-compatible service. Keep this request
    // path local instead of reusing queryModelOpenAI, whose retry/fallback
    // semantics are intended for the default OpenAI provider.
    const openaiModel = resolveOpenAIModel(options.model)
    const openaiMessages = messagesToOpenAI(messagesForAPI, systemPrompt)
    const toolSchemas = await Promise.all(
      filteredTools.map(tool =>
        toolToAPISchema(tool, {
          tools: filteredTools,
          model: options.model,
        }),
      ),
    )
    const openaiTools = toolsToOpenAI(toolSchemas)
    try {
    yield* withStreamingVCR(messagesForAPI, async function* () {
      let startedAt = Date.now()
      const generator = withRetry(
        async () => efrexClient,
        async (client, _attempt, retryContext) => {
          startedAt = Date.now()
          const requestBody = buildOpenAIRequestBody({
            model: openaiModel,
            messages: openaiMessages,
            tools: openaiTools,
            toolChoice: toolChoiceToOpenAI(options.toolChoice),
            enableThinking: isOpenAIThinkingEnabled(openaiModel),
            maxTokens: resolveOpenAIMaxTokens(
              getMaxOutputTokensForModel(openaiModel),
              retryContext.maxTokensOverride ??
                options.maxOutputTokensOverride,
            ),
            temperatureOverride: options.temperatureOverride,
            effortLevel: getInitialEffortSetting(),
          })
          return client.chat.completions.create(requestBody, { signal })
        },
        {
          model: options.model,
          fallbackModel: options.fallbackModel,
          thinkingConfig,
          signal,
        },
      )

      let stream: Awaited<
        ReturnType<OpenAI['chat']['completions']['create']>
      >
      while (true) {
        const next = await generator.next()
        if (next.done) {
          stream = next.value
          break
        }
        yield next.value
      }

      const adaptedStream = adaptOpenAIStream(stream, openaiModel)
      let partialMessage: any
      const contentBlocks: Record<number, any> = {}
      let usage = {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      }
      let stopReason: string | null = null
      let ttftMs = 0
      let assistantMessageEmitted = false

      const emitAssistantMessage = function* (): Generator<
        AssistantMessage,
        void
      > {
        if (!partialMessage) return
        const allBlocks = Object.keys(contentBlocks)
          .sort((a, b) => Number(a) - Number(b))
          .map(key => contentBlocks[Number(key)])
          .filter(Boolean)
        if (allBlocks.length === 0) return
        yield {
          type: 'assistant',
          uuid: randomUUID(),
          timestamp: new Date().toISOString(),
          message: {
            ...partialMessage,
            content: normalizeContentFromAPI(allBlocks, filteredTools),
            usage,
            stop_reason: stopReason,
            stop_sequence: null,
          },
        }
        assistantMessageEmitted = true
        partialMessage = undefined
      }

      for await (const event of adaptedStream) {
        switch (event.type) {
          case 'message_start':
            partialMessage = (event as any).message
            ttftMs = Date.now() - startedAt
            usage = { ...usage, ...((event as any).message?.usage ?? {}) }
            break
          case 'content_block_start': {
            const index = (event as any).index
            const block = (event as any).content_block
            contentBlocks[index] =
              block?.type === 'tool_use'
                ? { ...block, input: '' }
                : block?.type === 'text'
                  ? { ...block, text: '' }
                  : block?.type === 'thinking'
                    ? { ...block, thinking: '', signature: '' }
                    : { ...block }
            break
          }
          case 'content_block_delta': {
            const index = (event as any).index
            const delta = (event as any).delta
            const block = contentBlocks[index]
            if (!block || !delta) break
            if (delta.type === 'text_delta') block.text = (block.text || '') + delta.text
            if (delta.type === 'input_json_delta') block.input = (block.input || '') + delta.partial_json
            if (delta.type === 'thinking_delta') block.thinking = (block.thinking || '') + delta.thinking
            if (delta.type === 'signature_delta') block.signature = delta.signature
            break
          }
          case 'message_delta':
            usage = { ...usage, ...((event as any).usage ?? {}) }
            stopReason = (event as any).delta?.stop_reason ?? stopReason
            break
          case 'message_stop':
            yield* emitAssistantMessage()
            break
        }
        yield {
          type: 'stream_event',
          event,
          ...(event.type === 'message_start' ? { ttftMs } : undefined),
        } as StreamEvent
      }

      // Some OpenAI-compatible servers omit the final message_stop event.
      yield* emitAssistantMessage()
      if (!assistantMessageEmitted && !stopReason) {
        throw new Error('Stream ended without receiving any events')
      }
    })
  } catch (streamingError) {
    if (streamingError instanceof APIUserAbortError) {
      // Check if the abort signal was triggered by the user (ESC key)
      // If the signal is aborted, it's a user-initiated abort
      // If not, it's likely a timeout from the SDK
      if (signal.aborted) {
        throw streamingError
      } else {
        // Throw a more specific error for timeout
        throw new APIConnectionTimeoutError({ message: 'Request timed out' })
      }
    }
    // The proxy may expose the OpenAI endpoint but fail only when streaming.
    // Switch the same request to non-streaming mode so callers still get one
    // complete assistant message. This fallback has its own withRetry loop.
    const fallbackMessage = yield* executeNonStreamingRequest({
        client: efrexClient,
        model: openaiModel,
        messages: openaiMessages,
        tools: openaiTools,
        toolChoice: toolChoiceToOpenAI(options.toolChoice),
        enableThinking: isOpenAIThinkingEnabled(openaiModel),
        maxTokens: options.maxOutputTokensOverride,
        temperatureOverride: options.temperatureOverride,
        thinkingConfig,
        signal,
        sourceRequestBody: buildOpenAIRequestBody({
          model: openaiModel,
          messages: openaiMessages,
          tools: openaiTools,
          toolChoice: toolChoiceToOpenAI(options.toolChoice),
          enableThinking: isOpenAIThinkingEnabled(openaiModel),
          maxTokens: resolveOpenAIMaxTokens(
            getMaxOutputTokensForModel(openaiModel),
            options.maxOutputTokensOverride,
          ),
          temperatureOverride: options.temperatureOverride,
          effortLevel: getInitialEffortSetting(),
        }),
    })
    yield fallbackMessage
  }
    } catch (error) {
      if (error instanceof APIUserAbortError) throw error
      yield getAssistantMessageFromError(error, options.model, {
        messages,
        messagesForAPI,
      })
    }

  return
}
/**
 * OpenAI-compatible non-streaming fallback for the Efrex proxy.
 * The fallback has its own withRetry loop, just like the streaming request.
 */
async function* executeNonStreamingRequest(params: {
  client: OpenAI
  model: string
  messages: any[]
  tools: any[]
  toolChoice: any
  enableThinking: boolean
  maxTokens?: number
  temperatureOverride?: number
  thinkingConfig: ThinkingConfig
  signal: AbortSignal
  sourceRequestBody: any
}): AsyncGenerator<SystemAPIErrorMessage, AssistantMessage> {
  const generator = withRetry(
    async () => params.client,
    async (client, _attempt, retryContext) => {
      const body = {
        ...params.sourceRequestBody,
        stream: false,
        stream_options: undefined,
        ...(retryContext.maxTokensOverride || params.maxTokens
          ? {
              max_completion_tokens:
                retryContext.maxTokensOverride ?? params.maxTokens,
            }
          : {}),
      } as any
      return client.chat.completions.create(body, { signal: params.signal })
    },
    {
      model: params.model,
      thinkingConfig: params.thinkingConfig,
      signal: params.signal,
    },
  )

  let next = await generator.next()
  while (!next.done) {
    yield next.value
    next = await generator.next()
  }

  const response = next.value as any
  const choice = response?.choices?.[0]
  const message = choice?.message ?? {}
  const contentBlocks: any[] = []
  if (typeof message.content === 'string' && message.content.length > 0) {
    contentBlocks.push({ type: 'text', text: message.content })
  }
  if (typeof message.reasoning_content === 'string') {
    contentBlocks.unshift({
      type: 'thinking',
      thinking: message.reasoning_content,
      signature: '',
    })
  }
  for (const toolCall of message.tool_calls ?? []) {
    contentBlocks.push({
      type: 'tool_use',
      id: toolCall.id ?? randomUUID(),
      name: toolCall.function?.name ?? '',
      input: toolCall.function?.arguments ?? '{}',
    })
  }

  const usage = response?.usage ?? {}
  const stopReason =
    choice?.finish_reason === 'length'
      ? 'max_tokens'
      : choice?.finish_reason === 'tool_calls'
        ? 'tool_use'
        : 'end_turn'
  return {
    type: 'assistant',
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    requestId: response?.id,
    message: {
      id: response?.id ?? `msg_${randomUUID().replace(/-/g, '')}`,
      type: 'message',
      role: 'assistant',
      model: params.model,
      content: normalizeContentFromAPI(contentBlocks, params.tools),
      usage: {
        input_tokens: usage.prompt_tokens ?? 0,
        output_tokens: usage.completion_tokens ?? 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens:
          usage.prompt_tokens_details?.cached_tokens ?? 0,
      },
      stop_reason: stopReason,
      stop_sequence: null,
    },
  } as AssistantMessage
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
