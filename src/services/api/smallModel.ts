import OpenAI from 'openai'
import { SystemPrompt,asSystemPrompt} from 'src/prompt'
import { randomUUID } from 'node:crypto'
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions'
import type { AssistantMessage } from "../../package/message"
import {
  getAnthropicApiKey,
  getAnthropicBaseURL,
  getAnthropicModel,
  getRequestTimeoutMs,
  getSettingsEnvValue,
} from 'src/utils/anthropicConfig.js'

export type SmallJSONOutputFormat =
  | { type: 'json_object' }
  | {
      type: 'json_schema'
      json_schema: {
        name: string
        description?: string
        schema: Record<string, unknown>
        strict?: boolean
      }
    }

export type SmallModelOptions = {
  model?: string
  apiKey?: string
  baseURL?: string
  timeoutMs?: number
  enablePromptCaching?: boolean
  querySource:string
}

let client: OpenAI | null = null
let loadedOptions: Required<Pick<SmallModelOptions, 'model' | 'timeoutMs'>> &
  Pick<SmallModelOptions, 'apiKey' | 'baseURL'> = {
    model: 'kimi-k2.6',
    timeoutMs: 120_000,
  }


export function getSmallFastModel(): string {
  return loadedOptions.model
}

function createAssistantMessage(content: string): AssistantMessage {
  return {
    type: 'assistant',
    message: {
      role: 'assistant',
      content,
      refusal: null,
    },
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
  }
}

async function loadSettings(options: SmallModelOptions): Promise<void> {
  loadedOptions = {
    apiKey: options.apiKey ?? getAnthropicApiKey(),
    baseURL: options.baseURL ?? getAnthropicBaseURL(),
    model:
      options.model ??
      process.env.OPENAI_SMALL_MODEL ??
      getSettingsEnvValue('OPENAI_SMALL_MODEL') ??
      getAnthropicModel(),
    timeoutMs: options.timeoutMs ?? getRequestTimeoutMs(),
  }

  client = new OpenAI({
    apiKey: loadedOptions.apiKey,
    baseURL: loadedOptions.baseURL,
    maxRetries: 0,
    timeout: loadedOptions.timeoutMs,
  })
}

async function ensureClient(options: SmallModelOptions): Promise<OpenAI> {
  if (!client) {
    await loadSettings(options)
  }
  return client!
}

export async function querySmallModel({
  systemPrompt = asSystemPrompt([]),
  userPrompt,
  outputFormat,
  signal,
  options,
}: {
  systemPrompt?: SystemPrompt
  userPrompt: string
  outputFormat?: SmallJSONOutputFormat
  signal: AbortSignal
  options: SmallModelOptions
}): Promise<AssistantMessage> {
  const openai = await ensureClient(options)
  const messages: ChatCompletionMessageParam[] = [
    ...systemPrompt.map(text => ({ role: 'system' as const, content: text })),
    { role: 'user', content: userPrompt },
  ]

  const result = await openai.chat.completions.create(
    {
      model: getSmallFastModel(),
      messages,
      stream: false,
      tools: [],
      ...(outputFormat ? { response_format: outputFormat } : {}),
    },
    { signal },
  )

  const message = result.choices[0]?.message as ChatCompletionAssistantMessageParam | undefined
  return createAssistantMessage(typeof message?.content === 'string' ? message.content : '')
}
