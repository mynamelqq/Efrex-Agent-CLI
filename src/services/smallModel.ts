import OpenAI from 'openai'
import fs from 'node:fs/promises'
import path from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions'
import type { AssistantMessage } from '../types/message'

export type SystemPrompt = readonly string[]

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

type Settings = {
  env?: {
    AUTH_TOKEN?: string
    ANTHROPIC_BASE_URL?: string
    ANTHROPIC_MODEL?: string
    OPENAI_SMALL_MODEL?: string
    REQUEST_TIMEOUT_MS?: string
    [key: string]: string | undefined
  }
}

let client: OpenAI | null = null
let loadedOptions: Required<Pick<SmallModelOptions, 'model' | 'timeoutMs'>> &
  Pick<SmallModelOptions, 'apiKey' | 'baseURL'> = {
    model: 'kimi-k2.6',
    timeoutMs: 120_000,
  }

export function asSystemPrompt(prompt: readonly string[] | string): SystemPrompt {
  return typeof prompt === 'string' ? [prompt] : prompt
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
  let settings: Settings = {}
  try {
    const settingsPath = path.join(homedir(), '.efrex', 'setting.json')
    settings = JSON.parse(await fs.readFile(settingsPath, 'utf-8')) as Settings
  } catch {
    settings = {}
  }

  const configuredTimeout = Number(settings.env?.REQUEST_TIMEOUT_MS)
  loadedOptions = {
    apiKey: options.apiKey ?? settings.env?.AUTH_TOKEN ?? process.env.OPENAI_API_KEY,
    baseURL: options.baseURL ?? settings.env?.ANTHROPIC_BASE_URL,
    model:
      options.model ??
      settings.env?.OPENAI_SMALL_MODEL ??
      settings.env?.ANTHROPIC_MODEL ??
      'kimi-k2.6',
    timeoutMs:
      options.timeoutMs ??
      (Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 120_000),
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
