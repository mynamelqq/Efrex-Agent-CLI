import type { SystemPrompt } from 'src/prompt.js'
import type {
  ApiRetryStatusEvent,
  Message,
  StreamEvent,
  SystemAPIErrorMessage,
  AssistantMessage,
  UserMessage,
} from 'src/package/message.js'
import type OpenAI from 'openai'
import type { Tools } from '../../../Tool.js'
import type { Options } from '../efrex.js'
import type { ThinkingConfig } from 'src/utils/effort.js'
import { getOpenAIClient } from './client.js'
import { normalizeMessagesForAPI, toolToAPISchema } from '../../../utils/api.js'
import { logForDebugging } from '../../../utils/debug.js'
import { messagesToOpenAI } from './convertMessages.js'
import { toolsToOpenAI, toolChoiceToOpenAI } from './convertTools.js'
import { adaptOpenAIStream } from './streamAdapter.js'
import { resolveOpenAIModel } from './modelMapping.js'
import {
  isOpenAIThinkingEnabled,
  resolveOpenAIMaxTokens,
  buildOpenAIRequestBody,
} from './requestBody.js'

export {
  isOpenAIThinkingEnabled,
  resolveOpenAIMaxTokens,
  buildOpenAIRequestBody,
  resolveOpenAIModel,
}

import { randomUUID } from 'crypto'
import {
  createAssistantAPIErrorMessage,
  normalizeContentFromAPI,
  type SDKAssistantMessageError,
} from '../../../utils/messages.js'
import { getInitialEffortSetting } from 'src/utils/effort.js'
import { withRetry } from 'src/utils/withRetry.js'

const deferredToolNames = new Set<string>()

function getModelMaxOutputTokens(_model: string): { upperLimit: number } {
  return { upperLimit: 32_000 }
}

function calculateUSDCost(_model: string, _usage: unknown): number {
  return 0
}

function addToTotalSessionCost(
  _costUSD: number,
  _usage: unknown,
  _model: string,
): void {}

function recordLLMObservation(_trace: unknown, _observation: unknown): void {}

function convertMessagesToLangfuse(messages: unknown): unknown {
  return messages
}

function convertOutputToLangfuse(messages: unknown): unknown {
  return messages
}

function convertToolsToLangfuse(tools: unknown): unknown {
  return tools
}

function prependDeferredToolListIfNeeded<
  T extends AssistantMessage | UserMessage,
>(messages: T[], _tools: Tools, _deferredToolNames: Set<string>): T[] {
  return messages
}

function toApiRetryStatusEvent(
  message: SystemAPIErrorMessage,
): ApiRetryStatusEvent | null {
  if (
    message.subtype !== 'api_error' ||
    typeof message.retryInMs !== 'number' ||
    typeof message.retryAttempt !== 'number' ||
    typeof message.maxRetries !== 'number'
  ) {
    return null
  }

  return {
    type: 'api_retry_status',
    retryInMs: message.retryInMs,
    retryAttempt: message.retryAttempt,
    maxRetries: message.maxRetries,
    uuid: message.uuid,
    timestamp: message.timestamp,
  }
}

function isOpenAIConvertibleMessage(
  msg: Message,
): msg is AssistantMessage | UserMessage {
  return msg.type === 'assistant' || msg.type === 'user'
}

/**
从累积的流式状态中组装最终的助手消息（以及可选的最大令牌数错误信息）。
将这段逻辑抽离出来，避免message_stop事件处理器与循环结束后的安全兜底逻辑之间出现代码重复。

 */
function assembleFinalAssistantOutputs(params: {
  partialMessage: any
  contentBlocks: Record<number, any>
  tools: Tools
  usage: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens: number
    cache_read_input_tokens: number
  }
  stopReason: string | null
  maxTokens: number
}): (AssistantMessage | SystemAPIErrorMessage)[] {
  const {
    partialMessage,
    contentBlocks,
    tools,
    usage,
    stopReason,
    maxTokens,
  } = params
  const outputs: (AssistantMessage | SystemAPIErrorMessage)[] = []

  const allBlocks = Object.keys(contentBlocks)
    .sort((a, b) => Number(a) - Number(b))
    .map(k => contentBlocks[Number(k)])
    .filter(Boolean)

  if (allBlocks.length > 0) {
    outputs.push({
      message: {
        ...partialMessage,
        content: normalizeContentFromAPI(
          allBlocks,
          tools,
        ),
        usage,
        stop_reason: stopReason,
        stop_sequence: null,
      },
      requestId: undefined,
      type: 'assistant',
      uuid: randomUUID(),
      timestamp: new Date().toISOString(),
    } as AssistantMessage)
  }

  if (stopReason === 'max_tokens') {
    outputs.push(
      createAssistantAPIErrorMessage({
        content:
          `Output truncated: response exceeded the ${maxTokens} token limit. ` +
          `Set OPENAI_MAX_TOKENS or CLAUDE_CODE_MAX_OUTPUT_TOKENS to override.`,
        apiError: 'max_output_tokens',
        error: 'max_output_tokens',
      }),
    )
  }

  return outputs
}

/**
 * OpenAI-compatible query path. Converts Anthropic-format messages/tools to
 * OpenAI format, calls the OpenAI-compatible endpoint, and converts the
 * SSE stream back to Anthropic BetaRawMessageStreamEvent for consumption
 * by the existing query pipeline.
 */
export async function* queryModelOpenAI(
  messages: Message[],
  systemPrompt: SystemPrompt,
  thinkingConfig: ThinkingConfig,
  tools: Tools,
  signal: AbortSignal,
  options: Options,
): AsyncGenerator<
  StreamEvent | AssistantMessage | SystemAPIErrorMessage | ApiRetryStatusEvent,
  void
> {
  try {
    // 1. Resolve model name
    const openaiModel = resolveOpenAIModel(options.model)
    // 2. Normalize messages using shared preprocessing
    const messagesForAPI = normalizeMessagesForAPI(messages, tools)

    // 6. Build tool schemas with deferLoading flag
    const toolSchemas = await Promise.all(
      tools.map(tool =>

        toolToAPISchema(tool, {
          // getToolPermissionContext: options.getToolPermissionContext,
          tools,
          // agents: options.agents,
          model: options.model,
          deferLoading: deferredToolNames.has(tool.name),
        }),
      ),
    )

    // 8. Convert messages and tools to OpenAI format
    const enableThinking = isOpenAIThinkingEnabled(openaiModel)
    const openAIConvertibleMessages = messagesForAPI.filter(
      isOpenAIConvertibleMessage,
    )
    const messagesWithDeferredToolList = prependDeferredToolListIfNeeded(
      openAIConvertibleMessages,
      tools,
      deferredToolNames,
    )
    const openaiMessages = messagesToOpenAI(
      messagesWithDeferredToolList,
      systemPrompt,
    )

    const openaiTools = toolsToOpenAI(toolSchemas)
    const openaiToolChoice = toolChoiceToOpenAI(options.toolChoice)
    let attemptNumber = 0
    let start = Date.now()

    const attemptStartTimes: number[] = []
    const newMessages: AssistantMessage[] = []
    let isAdvisorInProgress = false
    const contentBlocks: Record<number, any> = {}
    const collectedMessages: AssistantMessage[] = []
    let partialMessage: any
    let stopReason: string | null = null
    let usage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    }
    let ttftMs = 0
    const { upperLimit } = getModelMaxOutputTokens(openaiModel)
    const resolvedMaxTokens = resolveOpenAIMaxTokens(
      upperLimit,
      options.maxOutputTokensOverride,
    )
    let activeMaxTokens = resolvedMaxTokens

    const generator = withRetry(
      () => {

        return getOpenAIClient({
          maxRetries: 0,
          // fetchOverride: options.fetchOverride as unknown as typeof fetch,
          // source: options.querySource,
        })
      },
      async (openai, attempt, context) => {
        const maxTokens = context.maxTokensOverride ?? resolvedMaxTokens
        activeMaxTokens = maxTokens

        attemptNumber = attempt
        start = Date.now()
        attemptStartTimes.push(start)

        const requestBody = buildOpenAIRequestBody({
          model: openaiModel,
          messages: openaiMessages,
          tools: openaiTools,
          toolChoice: openaiToolChoice,
          enableThinking,
          maxTokens,
          temperatureOverride: options.temperatureOverride,
          effortLevel: getInitialEffortSetting(),
        })

        return openai.chat.completions.create(requestBody, { signal })
      },
      {
        model: options.model,
        fallbackModel: options.fallbackModel,
        thinkingConfig,
        signal,
      },
    )

    let stream: Awaited<ReturnType<OpenAI['chat']['completions']['create']>>
    while (true) {
      const next = await generator.next()
      if (next.done) {
        stream = next.value
        break
      }
      const retryStatusEvent = toApiRetryStatusEvent(next.value)
      if (retryStatusEvent) {
        yield retryStatusEvent
        continue
      }
      yield next.value
    }

    // reset state
    newMessages.length = 0
    ttftMs = 0
    partialMessage = undefined
    stopReason = null
    isAdvisorInProgress = false

    const adaptedStream = adaptOpenAIStream(stream, openaiModel)

    for await (const event of adaptedStream) {
      switch (event.type) {
        case 'message_start': {
          partialMessage = (event as any).message
          ttftMs = Date.now() - start
          if ((event as any).message?.usage) {
            usage = {
              ...usage,
              ...(event as any).message.usage,
            }
          }
          break
        }
        case 'content_block_start': {
          const idx = (event as any).index
          const cb = (event as any).content_block
          if (cb.type === 'tool_use') {
            contentBlocks[idx] = { ...cb, input: '' }
          } else if (cb.type === 'text') {
            contentBlocks[idx] = { ...cb, text: '' }
          } else if (cb.type === 'thinking') {
            contentBlocks[idx] = { ...cb, thinking: '', signature: '' }
          } else {
            contentBlocks[idx] = { ...cb }
          }
          break
        }
        case 'content_block_delta': {
          const idx = (event as any).index
          const delta = (event as any).delta
          const block = contentBlocks[idx]
          if (!block) break
          if (delta.type === 'text_delta') {
            block.text = (block.text || '') + delta.text
          } else if (delta.type === 'input_json_delta') {
            block.input = (block.input || '') + delta.partial_json
          } else if (delta.type === 'thinking_delta') {
            block.thinking = (block.thinking || '') + delta.thinking
          } else if (delta.type === 'signature_delta') {
            block.signature = delta.signature
          }
          break
        }
        case 'content_block_stop': {
          break
        }
        case 'message_delta': {
          const deltaUsage = (event as any).usage
          if (deltaUsage) {
            usage = { ...usage, ...deltaUsage }
          }
          if ((event as any).delta?.stop_reason != null) {
            stopReason = (event as any).delta.stop_reason
          }
          break
        }
        case 'message_stop': {
          if (partialMessage) {
            for (const output of assembleFinalAssistantOutputs({
              partialMessage,
              contentBlocks,
              tools,
              usage,
              stopReason,
              maxTokens: activeMaxTokens,
            })) {
              if (output.type === 'assistant') {
                collectedMessages.push(output)
              }
              yield output
            }
            partialMessage = null
          }
          if (usage.input_tokens + usage.output_tokens > 0) {
            const costUSD = calculateUSDCost(openaiModel, usage as any)
            addToTotalSessionCost(costUSD, usage as any, options.model)
          }
          break
        }
      }

      yield {
        type: 'stream_event',
        event,
        ...(event.type === 'message_start' ? { ttftMs } : undefined),
      } as StreamEvent
    }

    if (partialMessage) {
      for (const output of assembleFinalAssistantOutputs({
        partialMessage,
        contentBlocks,
        tools,
        usage,
        stopReason,
        maxTokens: activeMaxTokens,
      })) {
        yield output
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logForDebugging(`[OpenAI] Error: ${errorMessage}`, { level: 'error' })
    yield createAssistantAPIErrorMessage({
      content: `API Error: ${errorMessage}`,
      apiError: 'api_error',
      error: (error instanceof Error
        ? error
        : new Error(String(error))) as unknown as SDKAssistantMessageError,
    })
  }
}
