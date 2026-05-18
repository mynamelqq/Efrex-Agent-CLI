import mergeWith from 'lodash/mergeWith.js'
import { readFileSync } from 'fs'
import { join, resolve } from 'path'
import { markInternalWrite } from './internalWrites.js'
import { SAFE_ENV_VARS } from 'src/constants/env.js'
import { EditableSettingSource } from './constants.js'
import { getOriginalCwd } from 'src/bootstrap/state.js'
import {writeFileSyncAndFlush_DEPRECATED}from "src/utils/file.js"
import { logForDebugging } from '../debug.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import { dirname } from 'path'
import { isENOENT } from '../errors.js'
import { mkdirSync } from 'fs'
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
export const SETTING_SOURCES = ['userSettings', 'projectSettings','localSettings'] as const

const TRUSTED_SETTING_SOURCES = ['userSettings'] as const

export type SettingSource = (typeof SETTING_SOURCES)[number]

export function getSettingSourceName(source: SettingSource): string {
  switch (source) {
    case 'userSettings':
      return 'user'
    case 'projectSettings':
      return 'project'
    case 'localSettings':
      return 'local'
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

export function getSettingsRootPathForSource(source: SettingSource): string {//目录
  switch (source) {
    case 'userSettings':
      return resolve(getClaudeConfigHomeDir())//.efrex
    case 'localSettings':
    case 'projectSettings':
      return resolve(getOriginalCwd())//用户项目目录
  }
}

export function getRelativeSettingsFilePathForSource(//相对路径
  source: 'projectSettings' | 'localSettings',
): string {
  switch (source) {
    case 'projectSettings':
      return join('.efrex', 'settings.json')
    case 'localSettings':
      return join('.efrex', 'settings.local.json')
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

/**
 * Merges `settings` into the existing settings for `source` using lodash mergeWith.
 *
 * To delete a key from a record field (e.g. enabledPlugins, extraKnownMarketplaces),
 * set it to `undefined` — do NOT use `delete`. mergeWith only detects deletion when
 * the key is present with an explicit `undefined` value.
 */
export function updateSettingsForSource(//更新配置
  source: EditableSettingSource,
  settings: SettingsJson,
): { error: Error | null } {
  if (
    (source as unknown) === 'policySettings' ||
    (source as unknown) === 'flagSettings'
  ) {
    return { error: null }
  }

  // Create the folder if needed
  const filePath = getSettingsFilePathForSource(source)
  if (!filePath) {
    return { error: null }
  }

  try {
    mkdirSync(dirname(filePath))//保底措施
    // Try to get existing settings with validation. Bypass the per-source
    // cache — mergeWith below mutates its target (including nested refs),
    // and mutating the cached object would leak unpersisted state if the
    // write fails before resetSettingsCache().
    let existingSettings = getSettingsForSourceUncached(source)//看看有没有缓存

    // If validation failed, check if file exists with a JSON syntax error
    if (!existingSettings) {//如果没有缓存先读配置
      let content: string | null = null
      try {
        content = readFileSync(filePath,'utf-8')
      } catch (e) {
        if (!isENOENT(e)) {
          throw e
        }
        // File doesn't exist — fall through to merge with empty settings
      }
      if (content !== null) {
        const rawData = safeParseJSON(content)
        if (rawData === null) {
          // JSON syntax error - return validation error instead of overwriting
          // safeParseJSON will already log the error, so we'll just return the error here
          return {
            error: new Error(
              `Invalid JSON syntax in settings file at ${filePath}`,
            ),
          }
        }
        if (rawData && typeof rawData === 'object') {
          existingSettings = rawData as SettingsJson
          logForDebugging(
            `Using raw settings from ${filePath} due to validation failure`,
          )
        }
      }
    }

    const updatedSettings = mergeWith(//这是一个自定义的深度合并函数，基于 lodash 的 mergeWith，用于合并两个配置对象
      existingSettings || {},
      settings,
      (
        _objValue: unknown,
        srcValue: unknown,
        key: string | number | symbol,
        object: Record<string | number | symbol, unknown>,
      ) => {
        // Handle undefined as deletion
        if (srcValue === undefined && object && typeof key === 'string') {// 如果 srcValue === undefined，删除目标对象的该字段
          delete object[key]
          return undefined
        }
        // For arrays, always replace with the provided array
        // This puts the responsibility on the caller to compute the desired final state
        if (Array.isArray(srcValue)) {//数组会直接覆盖，而不是尝试合并
          return srcValue
        }
        // For non-arrays, let lodash handle the default merge behavior
        return undefined// 让 lodash 处理普通对象的合并
      },
    )

    // Mark this as an internal write before writing the file
    markInternalWrite(filePath)//这是一个防止写操作循环触发的机制，用于标记某个文件即将被内部代码写入
  //因为更改配置文件容易出现重复写
    writeFileSyncAndFlush_DEPRECATED(
      filePath,
      JSON.stringify(updatedSettings, null, 2) + '\n',
    )

    // Invalidate the session cache since settings have been updated
    resetSettingsCache()

    if (source === 'localSettings') {
      // Okay to add to gitignore async without awaiting
      // void addFileGlobRuleToGitignore(
      //   getRelativeSettingsFilePathForSource('localSettings'),
      //   getOriginalCwd(),
      // )
    }
  } catch (e) {
    const error = new Error(
      `Failed to read raw settings from ${filePath}: ${e}`,
    )
    logError(error)
    return { error }
  }

  return { error: null }
}