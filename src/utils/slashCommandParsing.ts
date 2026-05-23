

/**
 * Centralized utilities for parsing slash commands
 */

export type ParsedSlashCommand = {
  commandName: string
  args: string
}

/**
 * Parses a slash command input string into its component parts
 *
 * @param input - The raw input string (should start with '/')
 * @returns Parsed command name, args, and MCP flag, or null if invalid
 *
 * @example
 * parseSlashCommand('/search foo bar')
 * // => { commandName: 'search', args: 'foo bar', isMcp: false }
 *
 * @example
 * parseSlashCommand('/mcp:tool (MCP) arg1 arg2')
 * // => { commandName: 'mcp:tool (MCP)', args: 'arg1 arg2', isMcp: true }
 */
export function parseSlashCommand(input: string): ParsedSlashCommand | null {
  const trimmedInput = input.trim()

  // Check if input starts with '/'
  if (!trimmedInput.startsWith('/')) {
    return null
  }

  // Remove the leading '/' and split by spaces
  const withoutSlash = trimmedInput.slice(1)
  const words = withoutSlash.split(' ')

  if (!words[0]) {
    return null
  }

  let commandName = words[0]
  let isMcp = false
  let argsStartIndex = 1

  // Extract arguments (everything after command name)
  const args = words.slice(argsStartIndex).join(' ')

  return {
    commandName,
    args,
  }
}