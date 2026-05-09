import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import type { ChatCompletionChunk } from 'openai/resources/chat/completions/completions.mjs'
import type { Message } from 'src/package/message.js'
import type { Options } from '../../efrex.js'
import { setOpenAIClientForTesting } from '../client.js'
import {
  buildOpenAIRequestBody,
  isOpenAIThinkingEnabled,
  queryModelOpenAI,
  resolveOpenAIMaxTokens,
  resolveOpenAIModel,
} from '../index.js'

describe('services/api/openai/index', () => {
  afterEach(() => {
    delete process.env.OPENAI_ENABLE_THINKING
    delete process.env.OPENAI_MAX_TOKENS
    delete process.env.OPENAI_MODEL
    setOpenAIClientForTesting(null)
  })

  test('resolves OpenAI model names from the index export', () => {
    assert.equal(resolveOpenAIModel('gpt-5.4-nano'), 'gpt-5.4-nano')
    assert.equal(resolveOpenAIModel('openai/gpt-5.4-mini'), 'gpt-5.4-mini')
    assert.equal(resolveOpenAIModel('openai/gpt-oss-120b'), 'openai/gpt-oss-120b')
    assert.equal(resolveOpenAIModel('gpt-5.4'), 'gpt-5.4')
  })

  test('OPENAI_MODEL overrides the selected model', () => {
    process.env.OPENAI_MODEL = 'gpt-5.4-mini'

    assert.equal(resolveOpenAIModel('gpt-4o'), 'gpt-5.4-mini')
  })

  test('builds a streaming OpenAI chat completion request body', () => {
    const body = buildOpenAIRequestBody({
      model: 'gpt-5.4-mini',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'bash',
            description: 'Run shell',
            parameters: { type: 'object', properties: {} },
          },
        },
      ],
      toolChoice: 'auto',
      enableThinking: false,
      maxTokens: 4096,
      temperatureOverride: 0.2,
    })

    assert.deepEqual(body, {
      model: 'gpt-5.4-mini',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 4096,
      tools: [
        {
          type: 'function',
          function: {
            name: 'bash',
            description: 'Run shell',
            parameters: { type: 'object', properties: {} },
          },
        },
      ],
      tool_choice: 'auto',
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.2,
    })
  })

  test('adds thinking fields only when OpenAI thinking mode is enabled', () => {
    process.env.OPENAI_ENABLE_THINKING = '1'

    assert.equal(isOpenAIThinkingEnabled('gpt-5.4'), true)

    const body = buildOpenAIRequestBody({
      model: 'gpt-5.4',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [],
      toolChoice: undefined,
      enableThinking: true,
      maxTokens: 8192,
      temperatureOverride: 0.7,
    })

    assert.equal(body.temperature, undefined)
    assert.deepEqual(body.thinking, { type: 'enabled' })
    assert.equal(body.enable_thinking, true)
    assert.deepEqual(body.chat_template_kwargs, { thinking: true })
  })

  test('resolves max tokens from OPENAI_MAX_TOKENS before the fallback default', () => {
    process.env.OPENAI_MAX_TOKENS = '12345'

    assert.equal(resolveOpenAIMaxTokens(64_000), 12_345)
    assert.equal(resolveOpenAIMaxTokens(64_000, 2048), 2048)
  })

  test('queryModelOpenAI sends a request through OpenAI client and assembles streamed output', async () => {
    const calls: Array<{ body: any; options: any }> = []
    const signal = new AbortController().signal

    setOpenAIClientForTesting({
      chat: {
        completions: {
          create: async (body: any, options: any) => {
            calls.push({ body, options })
            return mockStream([
              makeChunk({
                choices: [
                  {
                    index: 0,
                    delta: { content: 'Hello' },
                    finish_reason: null,
                  },
                ],
              }),
              makeChunk({
                choices: [
                  {
                    index: 0,
                    delta: { content: ' from OpenAI' },
                    finish_reason: null,
                  },
                ],
              }),
              makeChunk({
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
                usage: {
                  prompt_tokens: 12,
                  completion_tokens: 7,
                  total_tokens: 19,
                },
              }),
            ])
          },
        },
      },
    } as any)

    const outputs = await collect(
      queryModelOpenAI(
        [makeUserMessage('Say hello')],
        ['System prompt'],
        [],
        signal,
        makeOptions({ model: 'openai/gpt-5.4-mini' }),
      ),
    )

    assert.equal(calls.length, 1)
    assert.equal(calls[0].body.model, 'gpt-5.4-mini')
    assert.equal(calls[0].body.stream, true)
    assert.equal(calls[0].body.max_tokens, 64_000)
    assert.deepEqual(calls[0].body.stream_options, { include_usage: true })
    assert.deepEqual(calls[0].body.messages, [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'Say hello' },
    ])
    assert.deepEqual(calls[0].options, { signal })

    const assistant = outputs.find(output => output.type === 'assistant') as any
    assert.ok(assistant)
    assert.equal(assistant.message.model, 'gpt-5.4-mini')
    assert.equal(assistant.message.stop_reason, 'end_turn')
    assert.deepEqual(assistant.message.usage, {
      input_tokens: 12,
      output_tokens: 7,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    })
    assert.deepEqual(assistant.message.content, [
      { type: 'text', text: 'Hello from OpenAI' },
    ])

    assert.ok(outputs.some(output => output.type === 'stream_event'))
  })
})

function makeUserMessage(content: string): Message {
  return {
    type: 'user',
    uuid: 'user-1',
    message: {
      role: 'user',
      content,
    },
  } as Message
}

function makeOptions(overrides: Partial<Options> = {}): Options {
  return {
    model: 'gpt-5.4',
    isNonInteractiveSession: false,
    hasAppendSystemPrompt: false,
    ...overrides,
  }
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const item of iterable) out.push(item)
  return out
}

function mockStream(
  chunks: ChatCompletionChunk[],
): AsyncIterable<ChatCompletionChunk> {
  return {
    [Symbol.asyncIterator]() {
      let index = 0
      return {
        async next() {
          if (index >= chunks.length) return { done: true, value: undefined }
          return { done: false, value: chunks[index++] }
        },
      }
    },
  }
}

function makeChunk(
  overrides: Partial<ChatCompletionChunk> & Record<string, unknown> = {},
): ChatCompletionChunk {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'gpt-5.4-mini',
    choices: [],
    ...overrides,
  } as ChatCompletionChunk
}
