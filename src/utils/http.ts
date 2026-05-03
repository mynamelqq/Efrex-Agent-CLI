
const DEFAULT_VERSION = '0.0.1'

function getEnvValue(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

export function getChatUICliUserAgent(): string {
  return (
    getEnvValue('CHATUI_CLI_USER_AGENT') ?? `ChatUI-Cli/${DEFAULT_VERSION}`
  )
}

export function getChatUIWebFetchUserAgent(): string {
  const customUserAgent = getEnvValue('CHATUI_WEBFETCH_USER_AGENT')
  if (customUserAgent) {
    return customUserAgent
  }

  return `${getChatUICliUserAgent()} WebFetch`
}
