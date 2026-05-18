
/**
 * All possible sources where settings can come from
 * Order matters - later sources override earlier ones
 */
export const SETTING_SOURCES = [
  // User settings (global)
  'userSettings',

  // Project settings (shared per-directory)
  'projectSettings',

  // Local settings (gitignored)
  'localSettings',

] as const

export type SettingSource = (typeof SETTING_SOURCES)[number]

export function getSettingSourceName(source: SettingSource): string {
  switch (source) {
    case 'userSettings':
      return 'user'
    case 'projectSettings':
      return 'project'
    case 'localSettings':
      return 'project, gitignored'
  }
}

/**
 * Get short display name for a setting source (capitalized, for context/skills UI)
 * @param source The setting source or 'plugin'/'built-in'
 * @returns Short capitalized display name like 'User', 'Project', 'Plugin'
 */
export function getSourceDisplayName(
  source: SettingSource | 'plugin' | 'built-in',
): string |undefined {
  switch (source) {
    case 'userSettings':
      return 'User'
    case 'projectSettings':
      return 'Project'
    case 'localSettings':
      return 'Local'
    case 'built-in':
      return 'Built-in'
  }
}

/**
 * Get display name for a setting or permission rule source (lowercase, for inline use)
 * @param source The setting source or permission rule source
 * @returns Display name for the source in lowercase
 */
export function getSettingSourceDisplayNameLowercase(
  source: SettingSource | 'cliArg' | 'command' | 'session',
): string {
  switch (source) {
    case 'userSettings':
      return 'user settings'
    case 'projectSettings':
      return 'shared project settings'
    case 'localSettings':
      return 'project local settings'
    case 'cliArg':
      return 'CLI argument'
    case 'command':
      return 'command configuration'
    case 'session':
      return 'current session'
  }
}

/**
 * Get display name for a setting or permission rule source (capitalized, for UI labels)
 * @param source The setting source or permission rule source
 * @returns Display name for the source with first letter capitalized
 */
export function getSettingSourceDisplayNameCapitalized(
  source: SettingSource | 'cliArg' | 'command' | 'session',
): string {
  switch (source) {
    case 'userSettings':
      return 'User settings'
    case 'projectSettings':
      return 'Shared project settings'
    case 'localSettings':
      return 'Project local settings'
    case 'cliArg':
      return 'CLI argument'
    case 'command':
      return 'Command configuration'
    case 'session':
      return 'Current session'
  }
}
/**
 * Parse the --setting-sources CLI flag into SettingSource array
 * @param flag Comma-separated string like "user,project,local"
 * @returns Array of SettingSource values
 */
export function parseSettingSourcesFlag(flag: string): SettingSource[] {
  if (flag === '') return []

  const names = flag.split(',').map(s => s.trim())
  const result: SettingSource[] = []

  for (const name of names) {
    switch (name) {
      case 'user':
        result.push('userSettings')
        break
      case 'project':
        result.push('projectSettings')
        break
      case 'local':
        result.push('localSettings')
        break
      default:
        throw new Error(
          `Invalid setting source: ${name}. Valid options are: user, project, local`,
        )
    }
  }

  return result
}



/**
 * Editable setting sources (excludes policySettings and flagSettings which are read-only)
 */
export type EditableSettingSource = 
  SettingSource

/**
 * List of sources where permission rules can be saved, in display order.
 * Used by permission-rule and hook-save UIs to present source options.
 */
export const SOURCES = [
  'localSettings',
  'projectSettings',
  'userSettings',
] as const satisfies readonly EditableSettingSource[]

/**
 * The JSON Schema URL for Claude Code settings
 * You can edit the contents at https://github.com/SchemaStore/schemastore/blob/master/src/schemas/json/claude-code-settings.json
 */
export const CLAUDE_CODE_SETTINGS_SCHEMA_URL =
  'https://json.schemastore.org/claude-code-settings.json'
