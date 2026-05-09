import { getInitialSettings } from 'src/utils/settings/settings.js'

type SettingsEnv = Record<string, string | undefined> | undefined

function getSettingsEnv(): SettingsEnv {
  return getInitialSettings().env as SettingsEnv
}

function firstDefined(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (value !== undefined && value !== '') {
      return value
    }
  }
  return undefined
}

export function getAnthropicApiKey(): string | undefined {
  const env = getSettingsEnv()
  return firstDefined(
    process.env.ANTHROPIC_AUTH_TOKEN,
    process.env.OPENAI_API_KEY,
    env?.ANTHROPIC_AUTH_TOKEN,
    env?.AUTH_TOKEN,
  )
}

export function getSettingsEnvValue(key: string): string | undefined {
  return getSettingsEnv()?.[key]
}

export function getAnthropicBaseURL(): string | undefined {
  const env = getSettingsEnv()
  return firstDefined(process.env.ANTHROPIC_BASE_URL, env?.ANTHROPIC_BASE_URL)
}

export function getAnthropicModel(defaultModel = 'kimi-k2.6'): string {
  const env = getSettingsEnv()
  return (
    firstDefined(process.env.ANTHROPIC_MODEL, env?.ANTHROPIC_MODEL) ??
    defaultModel
  )
}

export function getRequestTimeoutMs(defaultTimeoutMs = 120_000): number {
  const env = getSettingsEnv()
  const configured = Number(
    firstDefined(process.env.REQUEST_TIMEOUT_MS, env?.REQUEST_TIMEOUT_MS),
  )
  return Number.isFinite(configured) && configured > 0
    ? configured
    : defaultTimeoutMs
}

export function getEffortLevel(defaultEffort = 'medium'): string {
  return getInitialSettings().effortLevel ?? defaultEffort
}
