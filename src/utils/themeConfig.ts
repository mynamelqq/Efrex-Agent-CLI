import { setThemeConfigCallbacks, THEME_SETTINGS } from '@anthropic/ink'
import type { ThemeSetting } from '@anthropic/ink'
import { getGlobalConfig, saveGlobalConfig } from './config.js'

const DEFAULT_THEME_SETTING: ThemeSetting = 'dark'

export function isThemeSetting(value: string): value is ThemeSetting {
  return (THEME_SETTINGS as readonly string[]).includes(value)
}

/** The persisted theme preference. May be 'auto'. */
export function getThemeSetting(): ThemeSetting {
  const stored = getGlobalConfig().theme
  return stored && isThemeSetting(stored) ? stored : DEFAULT_THEME_SETTING
}

export function saveThemeSetting(setting: ThemeSetting): void {
  saveGlobalConfig(current =>
    current.theme === setting ? current : { ...current, theme: setting },
  )
}

/**
 * Lets the ink layer read/write the theme through the app's global config.
 * Must run before <ThemeProvider> mounts so it seeds from the saved value.
 */
export function initThemeConfig(): void {
  setThemeConfigCallbacks({
    loadTheme: getThemeSetting,
    saveTheme: saveThemeSetting,
  })
}
