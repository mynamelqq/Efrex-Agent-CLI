import { randomUUID } from 'crypto'
import type { ChatCompletionChunk } from 'openai/resources/chat/completions/completions.mjs'
import type { OpenAIStreamEvent } from './types.js'

export async function* adaptOpenAIStream(
  stream: AsyncIterable<ChatCompletionChunk>,
  model: string,
): AsyncGenerator<OpenAIStreamEvent, void> {
  const messageId = `msg_${randomUUID().replace(/-/g, '').slice(0, 24)}`
  const toolBlocks = new Map<
    number,
    { contentIndex: number; id: string; name: string; arguments: string }
  >()
  const openBlockIndices = new Set<number>()

  let started = false
  let currentContentIndex = -1
  let thinkingBlockOpen = false
  let textBlockOpen = false
  let inputTokens = 0
  let outputTokens = 0
  let cachedReadTokens = 0
  let pendingFinishReason: string | null = null
  let pendingHasToolCalls = false

  for await (const chunk of stream) {
    const choice = chunk.choices?.[0]
    const delta = choice?.delta

    if (chunk.usage) {
      inputTokens = chunk.usage.prompt_tokens ?? inputTokens
      outputTokens = chunk.usage.completion_tokens ?? outputTokens
      const details = chunk.usage.prompt_tokens_details
      cachedReadTokens = details?.cached_tokens ?? cachedReadTokens
    }

    if (!started) {
      started = true
      yield {
        type: 'message_start',//message_start
        message: {
          id: messageId,
          type: 'message',
          role: 'assistant',
          content: [],
          model,
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: inputTokens,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: cachedReadTokens,
          },
        },
      }
    }

    if (!delta) continue

    const reasoningContent = (delta as { reasoning_content?: string | null })
      .reasoning_content
    if (reasoningContent != null) {
      if (!thinkingBlockOpen) {
        currentContentIndex++
        thinkingBlockOpen = true
        openBlockIndices.add(currentContentIndex)
        yield {
          type: 'content_block_start',
          index: currentContentIndex,
          content_block: { type: 'thinking', thinking: '', signature: '' },//内容块
        }
      }

      if (reasoningContent !== '') {
        yield {
          type: 'content_block_delta',
          index: currentContentIndex,
          delta: { type: 'thinking_delta', thinking: reasoningContent },
        }
      }
    }

    if (delta.content != null && delta.content !== '') {
      if (!textBlockOpen) {
        if (thinkingBlockOpen) {
          yield { type: 'content_block_stop', index: currentContentIndex }//思考块启动和结束
          openBlockIndices.delete(currentContentIndex)
          thinkingBlockOpen = false
        }
        currentContentIndex++
        textBlockOpen = true
        openBlockIndices.add(currentContentIndex)
        yield {
          type: 'content_block_start',
          index: currentContentIndex,
          content_block: { type: 'text', text: '' },
        }
      }

      yield {
        type: 'content_block_delta',
        index: currentContentIndex,
        delta: { type: 'text_delta', text: delta.content },
      }
    }

    if (delta.tool_calls) {//有工具调用
      for (const tc of delta.tool_calls) {
        const tcIndex = tc.index
        if (!toolBlocks.has(tcIndex)) {
          if (thinkingBlockOpen) {
            yield { type: 'content_block_stop', index: currentContentIndex }
            openBlockIndices.delete(currentContentIndex)
            thinkingBlockOpen = false
          }
          if (textBlockOpen) {
            yield { type: 'content_block_stop', index: currentContentIndex }
            openBlockIndices.delete(currentContentIndex)
            textBlockOpen = false
          }

          currentContentIndex++
          const toolId =
            tc.id || `toolu_${randomUUID().replace(/-/g, '').slice(0, 24)}`
          const toolName = tc.function?.name || ''
          toolBlocks.set(tcIndex, {
            contentIndex: currentContentIndex,
            id: toolId,
            name: toolName,
            arguments: '',
          })
          openBlockIndices.add(currentContentIndex)
          yield {
            type: 'content_block_start',
            index: currentContentIndex,
            content_block: {
              type: 'tool_use',
              id: toolId,
              name: toolName,
              input: {},
            },
          }
        }

        const argFragment = tc.function?.arguments
        if (argFragment) {
          toolBlocks.get(tcIndex)!.arguments += argFragment
          yield {
            type: 'content_block_delta',
            index: toolBlocks.get(tcIndex)!.contentIndex,
            delta: { type: 'input_json_delta', partial_json: argFragment },
          }
        }
      }
    }

    if (choice?.finish_reason) {
      if (thinkingBlockOpen || textBlockOpen) {
        yield { type: 'content_block_stop', index: currentContentIndex }
        openBlockIndices.delete(currentContentIndex)
        thinkingBlockOpen = false
        textBlockOpen = false
      }

      for (const [, block] of toolBlocks) {
        if (openBlockIndices.has(block.contentIndex)) {
          yield { type: 'content_block_stop', index: block.contentIndex }
          openBlockIndices.delete(block.contentIndex)
        }
      }

      pendingFinishReason = choice.finish_reason
      pendingHasToolCalls = toolBlocks.size > 0
    }
  }

  for (const idx of openBlockIndices) {
    yield { type: 'content_block_stop', index: idx }
  }

  if (pendingFinishReason !== null) {
    yield {
      type: 'message_delta',
      delta: {
        stop_reason:
          pendingFinishReason === 'length'
            ? 'max_tokens'
            : pendingHasToolCalls
              ? 'tool_use'
              : mapFinishReason(pendingFinishReason),
        stop_sequence: null,
      },
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_read_input_tokens: cachedReadTokens,
        cache_creation_input_tokens: 0,
      },
    }

    yield { type: 'message_stop' }
  }
}

function mapFinishReason(reason: string): string {
  switch (reason) {
    case 'stop':
      return 'end_turn'
    case 'tool_calls':
      return 'tool_use'
    case 'length':
      return 'max_tokens'
    default:
      return 'end_turn'
  }
}
