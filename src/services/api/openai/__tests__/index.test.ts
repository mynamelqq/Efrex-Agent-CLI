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

    assert.equal(resolveOpenAIModel('gpt-4o'), 'gpt-4o')
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
      effortLevel: undefined,
    })

    assert.deepEqual(body, {
      model: 'gpt-5.4-mini',
      messages: [{ role: 'user', content: 'hello' }],
      max_completion_tokens: 4096,
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
      temperature: 0,
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
      effortLevel: undefined,
    })

    assert.equal(body.temperature, 0)
    assert.equal(body.thinking, undefined)
    assert.equal(body.enable_thinking, undefined)
    assert.equal(body.chat_template_kwargs, undefined)
  })

  test('resolves max tokens from OPENAI_MAX_TOKENS before the fallback default', () => {
    process.env.OPENAI_MAX_TOKENS = '12345'

    assert.equal(resolveOpenAIMaxTokens(64_000), 12_345)
    assert.equal(resolveOpenAIMaxTokens(64_000, 2048), 2048)
  })

})

function makeUserMessage(content: string): Message {
  return {
    type: 'user',
    uuid: '123e4567-e89b-12d3-a456-426614174000',
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
    getToolPermissionContext: async () => ({
      mode: 'default',
      alwaysAllowRules: {},
      additionalDirectories: [],
      disallowedTools: [],
    } as any),
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
