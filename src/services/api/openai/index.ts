import type { SystemPrompt }from "src/prompt.js"
import type {
  Message,
  StreamEvent,
  SystemAPIErrorMessage,
  AssistantMessage,
  UserMessage,
} from 'src/package/message.js'
import type { Tools } from '../../../Tool.js'
import type { Options } from '../efrex.js'
import { getOpenAIClient } from './client.js'
import { normalizeMessagesForAPI, toolToAPISchema } from '../../../utils/api.js'
import { logForDebugging } from '../../../utils/debug.js'
import type { OpenAIToolSchema } from './types.js'
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
  tools: Tools,
  signal: AbortSignal,
  options: Options,
): AsyncGenerator<
  StreamEvent | AssistantMessage | SystemAPIErrorMessage,
  void
> {
  try {
    // 1. Resolve model name
    // const openaiModel = resolveOpenAIModel(options.model)
    const openaiModel=resolveOpenAIModel('kimi-k2.5')
    // 2. Normalize messages using shared preprocessing
    const messagesForAPI = normalizeMessagesForAPI(messages, tools)

    let filteredTools = tools

    // 6. Build tool schemas with deferLoading flag
    const toolSchemas = await Promise.all(
      filteredTools.map(tool =>
        toolToAPISchema(tool, {
          // getToolPermissionContext: options.getToolPermissionContext,
          tools,
          // agents: options.agents,
          model: options.model,
          deferLoading:  deferredToolNames.has(tool.name),
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

    // 10. Compute max_tokens — required by most OpenAI-compatible endpoints.
    //     Without this the server uses a tiny default, and when
    //     thinking is enabled the thinking phase consumes the entire budget
    //     leaving no tokens for the final response.
    //
    //     Use upperLimit (not the slot-cap default) because the Anthropic path's
    //     slot-reservation cap (CAPPED_DEFAULT_MAX_TOKENS=8k) is paired with an
    //     auto-retry at 64k in query.ts. The OpenAI path has no such retry, so
    //     using the capped 8k default would silently truncate responses in
    //     multi-turn conversations where thinking consumes most of the budget.
    //
    //     Override priority:
    //     1. options.maxOutputTokensOverride (programmatic)
    //     2. OPENAI_MAX_TOKENS env var (OpenAI-specific, useful for local models
    //        with small context windows, e.g. RTX 3060 12GB running 65536-token models)
    //     3. CLAUDE_CODE_MAX_OUTPUT_TOKENS env var (generic override)
    //     4. upperLimit default (64000)
    const { upperLimit } = getModelMaxOutputTokens(openaiModel)
    const maxTokens = upperLimit;

    // 11. Get client
    const client = getOpenAIClient({
      maxRetries: 0,
      // fetchOverride: options.fetchOverride as unknown as typeof fetch,
      // source: options.querySource,
    })

    logForDebugging(
      `[OpenAI] Calling model=${openaiModel}, messages=${openaiMessages}, tools=${openaiTools.length}, thinking=${enableThinking}`,
    )

    // 12. Call OpenAI API with streaming
    const requestBody = buildOpenAIRequestBody({
      model: openaiModel,
      messages: openaiMessages,
      tools: openaiTools,
      toolChoice: openaiToolChoice,
      enableThinking,
      maxTokens,
      temperatureOverride: options.temperatureOverride,
    })
    const stream = await client.chat.completions.create(requestBody, { signal })

    // 将 OpenAI 的流数据转换为 Anthropic 的事件，然后将其处理为 // // 附加消息 + 流事件（与 Anthropic 的路径行为相匹配）
    const adaptedStream = adaptOpenAIStream(stream, openaiModel)

    //积累内容块和使用次数，与 claude.ts 中的 Anthropic 路径相同
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
    const start = Date.now()

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
            contentBlocks[idx] = { ...cb, input: '' }//展开内容块 
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
          // Block accumulation is complete; assembly happens at message_stop.
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
          // Assemble ONE AssistantMessage with ALL content blocks, matching the
          // Anthropic SDK path. Real usage (input + output tokens) is available
          // here and injected so tokenCountWithEstimation() can read it.
          if (partialMessage) {
            for (const output of assembleFinalAssistantOutputs({
              partialMessage,
              contentBlocks,
              tools,
              usage,
              stopReason,
              maxTokens,
            })) {
              if (output.type === 'assistant') {
                collectedMessages.push(output)
              }
              yield output
            }
            // Reset partialMessage so the post-loop safety fallback does not
            // yield a second identical AssistantMessage.
            partialMessage = null
          }
          // Track cost and token usage
          if (usage.input_tokens + usage.output_tokens > 0) {
            const costUSD = calculateUSDCost(openaiModel, usage as any)
            addToTotalSessionCost(costUSD, usage as any, options.model)
          }
          break
        }
      }

      // Also yield as StreamEvent for real-time display (matching Anthropic path)
      yield {
        type: 'stream_event',
        event,
        ...(event.type === 'message_start' ? { ttftMs } : undefined),
      } as StreamEvent
    }

  

    // Safety: if stream ended without message_stop, assemble and yield whatever we have
    if (partialMessage) {
      for (const output of assembleFinalAssistantOutputs({//组装剩余的
        partialMessage,
        contentBlocks,
        tools,
        usage,
        stopReason,
        maxTokens,
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
