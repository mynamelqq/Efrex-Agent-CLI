import memoize from 'lodash/memoize.js'
import { join } from 'path'
import { getPlatform } from 'src/utils/platform'

/**
 * Get the path to the managed settings directory based on the current platform.
 */
export const getManagedFilePath = memoize(function (): string {
  switch (getPlatform()) {
    case 'macos':
      return '/Library/Application Support/EfrexCode'
    case 'windows':
      return 'C:\\Program Files\\ClaudeCode'
    default:
      return '/etc/efrex-code'
  }
})

/**
 * Get the path to the managed-settings.d/ drop-in directory.
 * managed-settings.json is merged first (base), then files in this directory
 * are merged alphabetically on top (drop-ins override base, later files win).
 */
export const getManagedSettingsDropInDir = memoize(function (): string {
  return join(getManagedFilePath(), 'managed-settings.d')
})
