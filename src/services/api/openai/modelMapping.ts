const OPENAI_MODELS = new Set([
  'gpt-5.4-nano',
  'gpt-5.4-mini',
  'gpt-5.4',
  'gpt-5.3-codex',
  'gpt-5.3-chat-latest',
  'gpt-5.2',
  'gpt-5.2-codex',
  'gpt-5.2-pro',
  'gpt-5.2-chat-latest',
  'gpt-5.1',
  'gpt-5.1-chat-latest',
  'gpt-5.1-codex-max',
  'gpt-5.1-codex-mini',
  'gpt-5.1-codex',
  'gpt-5',
  'gpt-5-mini',
  'gpt-5-nano',
  'gpt-5-pro',
  'gpt-5-codex',
  'gpt-5-chat-latest',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'gpt-4o',
  'gpt-4o-mini',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
])

const OPENAI_PREFIX_MODELS_TO_KEEP = new Set([
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
])

export function resolveOpenAIModel(model: string): string {
  const override = process.env.MODEL?.trim()
  if (override) return normalizeOpenAIModelName(override)

  return normalizeOpenAIModelName(model)
}

export function normalizeOpenAIModelName(model: string): string {
  const cleanModel = stripAnsiSuffix(model).trim()
  if (OPENAI_MODELS.has(cleanModel)) return cleanModel
  if (OPENAI_PREFIX_MODELS_TO_KEEP.has(cleanModel)) return cleanModel

  if (cleanModel.startsWith('openai/')) {
    const withoutProvider = cleanModel.slice('openai/'.length)
    if (OPENAI_MODELS.has(withoutProvider)) return withoutProvider
  }

  return cleanModel
}

export function isKnownOpenAIModel(model: string): boolean {
  return OPENAI_MODELS.has(normalizeOpenAIModelName(model))
}

function stripAnsiSuffix(model: string): string {
  return model.replace(/\[1m\]$/, '')
}
