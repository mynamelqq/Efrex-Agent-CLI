import mergeWith from 'lodash/mergeWith.js'
import { readFileSync } from 'fs'
import { join, resolve } from 'path'
import { SAFE_ENV_VARS } from 'src/constants/env.js'
import { getOriginalCwd } from 'src/bootstrap/state.js'
import { logForDebugging } from '../debug.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import { getErrnoCode } from '../errors.js'
import { safeParseJSON } from '../json.js'
import { logError } from '../log.js'
import {
  getCachedParsedFile,
  getCachedSettingsForSource,
  getPluginSettingsBase,
  getSessionSettingsCache,
  resetSettingsCache,
  setCachedParsedFile,
  setCachedSettingsForSource,
  setSessionSettingsCache,
} from './settingsCache.js'
import { type SettingsJson, SettingsSchema } from './types.js'
import {
  filterInvalidPermissionRules,
  formatZodError,
  type SettingsWithErrors,
  type ValidationError,
} from './validation.js'

/**
 * All possible sources where settings can come from.
 * Order matters - later sources override earlier ones.
 */
export const SETTING_SOURCES = ['userSettings', 'projectSettings'] as const

const TRUSTED_SETTING_SOURCES = ['userSettings'] as const

export type SettingSource = (typeof SETTING_SOURCES)[number]

export function getSettingSourceName(source: SettingSource): string {
  switch (source) {
    case 'userSettings':
      return 'user'
    case 'projectSettings':
      return 'project'
  }
}

function getUserSettingsFilePath(): string {
  return 'settings.json'
}

/**
 * Apply env vars from trusted sources directly, then apply only allowlisted
 * env vars from the fully merged settings view.
 */
export function applySafeConfigEnvironmentVariables(): void {
  for (const source of TRUSTED_SETTING_SOURCES) {
    const env = getSettingsForSource(source)?.env
    if (env) {
      Object.assign(process.env, env)
    }
  }

  const mergedEnv = getSettings_DEPRECATED().env
  if (!mergedEnv) return

  for (const [key, value] of Object.entries(mergedEnv)) {
    if (SAFE_ENV_VARS.has(key.toUpperCase())) {
      process.env[key] = value
    }
  }
}

function handleFileSystemError(error: unknown, path: string): void {
  const code = getErrnoCode(error)
  if (code === 'ENOENT') {
    logForDebugging(`Settings file not found: ${path}`)
    return
  }
  logError(error)
}

export function getSettingsRootPathForSource(source: SettingSource): string {
  switch (source) {
    case 'userSettings':
      return resolve(getClaudeConfigHomeDir())
    case 'projectSettings':
      return resolve(getOriginalCwd())
  }
}

export function getRelativeSettingsFilePathForSource(
  source: 'projectSettings' | 'localSettings',
): string {
  switch (source) {
    case 'projectSettings':
      return join('.claude', 'settings.json')
    case 'localSettings':
      return join('.claude', 'settings.local.json')
  }
}

export function getSettingsFilePathForSource(
  source: SettingSource,
): string | undefined {
  switch (source) {
    case 'userSettings':
      return join(
        getSettingsRootPathForSource(source),
        getUserSettingsFilePath(),
      )
    case 'projectSettings':
      return join(
        getSettingsRootPathForSource(source),
        getRelativeSettingsFilePathForSource(source),
      )
  }
}

/**
 * Parses a settings file into a structured format.
 */
export function parseSettingsFile(path: string): {
  settings: SettingsJson | null
  errors: ValidationError[]
} {
  const cached = getCachedParsedFile(path)
  if (cached) {
    return {
      settings: cached.settings ? structuredClone(cached.settings) : null,
      errors: cached.errors,
    }
  }

  const result = parseSettingsFileUncached(path)
  setCachedParsedFile(path, result)

  return {
    settings: result.settings ? structuredClone(result.settings) : null,
    errors: result.errors,
  }
}

function parseSettingsFileUncached(path: string): {
  settings: SettingsJson | null
  errors: ValidationError[]
} {
  try {
    const content = readFileSync(path, 'utf-8')

    if (content.trim() === '') {
      return { settings: {}, errors: [] }
    }

    const data = safeParseJSON(content, false)
    if (data === null) {
      return {
        settings: null,
        errors: [
          {
            file: path,
            path: '',
            message: 'Invalid or malformed JSON',
          },
        ],
      }
    }

    const ruleWarnings = filterInvalidPermissionRules(data, path)
    const result = SettingsSchema().safeParse(data)

    if (!result.success) {
      return {
        settings: null,
        errors: [...ruleWarnings, ...formatZodError(result.error, path)],
      }
    }

    return { settings: result.data, errors: ruleWarnings }
  } catch (error) {
    handleFileSystemError(error, path)
    return { settings: null, errors: [] }
  }
}

export function getSettingsForSource(
  source: SettingSource,
): SettingsJson | null {
  const cached = getCachedSettingsForSource(source)
  if (cached !== undefined) return cached

  const result = getSettingsForSourceUncached(source)
  setCachedSettingsForSource(source, result)
  return result
}

function getSettingsForSourceUncached(
  source: SettingSource,
): SettingsJson | null {
  const settingsFilePath = getSettingsFilePathForSource(source)
  const { settings } = settingsFilePath
    ? parseSettingsFile(settingsFilePath)
    : { settings: null }

  return settings
}

function mergeArrays<T>(targetArray: T[], sourceArray: T[]): T[] {
  return Array.from(new Set([...targetArray, ...sourceArray]))
}

export function settingsMergeCustomizer(
  objValue: unknown,
  srcValue: unknown,
): unknown {
  if (Array.isArray(objValue) && Array.isArray(srcValue)) {
    return mergeArrays(objValue, srcValue)
  }
  return undefined
}

let isLoadingSettings = false

function loadSettingsFromDisk(): SettingsWithErrors {
  if (isLoadingSettings) {
    return { settings: {}, errors: [] }
  }

  isLoadingSettings = true
  try {
    let mergedSettings: SettingsJson = {}
    const pluginSettings = getPluginSettingsBase()
    if (pluginSettings) {
      mergedSettings = mergeWith(
        mergedSettings,
        pluginSettings,
        settingsMergeCustomizer,
      ) as SettingsJson
    }

    const allErrors: ValidationError[] = []
    const seenErrors = new Set<string>()

    for (const source of SETTING_SOURCES) {
      const { settings, errors } = parseSettingsFile(
        getSettingsFilePathForSource(source)!,
      )

      for (const error of errors) {
        const errorKey = `${error.file}:${error.path}:${error.message}`
        if (!seenErrors.has(errorKey)) {
          seenErrors.add(errorKey)
          allErrors.push(error)
        }
      }

      if (settings) {
        mergedSettings = mergeWith(
          mergedSettings,
          settings,
          settingsMergeCustomizer,
        ) as SettingsJson
      }
    }

    return { settings: mergedSettings, errors: allErrors }
  } finally {
    isLoadingSettings = false
  }
}

export function getSettingsWithErrors(): SettingsWithErrors {
  const cached = getSessionSettingsCache()
  if (cached !== null) {
    return cached
  }

  const result = loadSettingsFromDisk()
  setSessionSettingsCache(result)
  return result
}

export function getInitialSettings(): SettingsJson {
  return getSettingsWithErrors().settings || {}
}

/**
 * @deprecated Use getInitialSettings() instead.
 */
export const getSettings_DEPRECATED = getInitialSettings

export type SettingsWithSources = {
  effective: SettingsJson
  sources: Array<{ source: SettingSource; settings: SettingsJson }>
}

export function getSettingsWithSources(): SettingsWithSources {
  resetSettingsCache()

  const sources: SettingsWithSources['sources'] = []
  for (const source of SETTING_SOURCES) {
    const settings = getSettingsForSource(source)
    if (settings && Object.keys(settings).length > 0) {
      sources.push({ source, settings })
    }
  }

  return {
    effective: getInitialSettings(),
    sources,
  }
}

export function rawSettingsContainsKey(key: string): boolean {
  for (const source of SETTING_SOURCES) {
    const filePath = getSettingsFilePathForSource(source)
    if (!filePath) continue

    try {
      const content = readFileSync(filePath, 'utf-8')
      if (!content.trim()) continue

      const rawData = safeParseJSON(content, false)
      if (rawData && typeof rawData === 'object' && key in rawData) {
        return true
      }
    } catch (error) {
      handleFileSystemError(error, filePath)
    }
  }

  return false
}
