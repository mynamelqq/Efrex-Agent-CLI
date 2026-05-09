

export type SystemPrompt = readonly string[] & {
  readonly __brand: 'SystemPrompt'
}
export const FILE_UNCHANGED_STUB =
  'File unchanged since last read. The content from the earlier Read tool_result in this conversation is still current — refer to that instead of re-reading.'

export function asSystemPrompt(value: readonly string[]): SystemPrompt {
  return value as SystemPrompt
}