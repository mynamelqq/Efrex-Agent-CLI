
import type { SettingsJson } from './types.js'
import type { SettingSource } from './settings.js'
import type { SettingsWithErrors, ValidationError } from './validation'

let sessionSettingsCache: SettingsWithErrors | null = null

export function getSessionSettingsCache(): SettingsWithErrors | null {
  return sessionSettingsCache
}

export function setSessionSettingsCache(value: SettingsWithErrors): void {
  sessionSettingsCache = value
}

/**
每个源的缓存用于 getSettingsForSource 方法。该缓存会与合并后的 sessionSettingsCache
一同失效——相同的 resetSettingsCache() 触发条件（设置写入、--add-dir、插件初始化、钩子刷新）。
 */
const perSourceCache = new Map<SettingSource, SettingsJson | null>()

export function getCachedSettingsForSource(
  source: SettingSource,
): SettingsJson | null | undefined {
  // undefined = cache miss; null = cached "no settings for this source"
  return perSourceCache.has(source) ? perSourceCache.get(source) : undefined
}

export function setCachedSettingsForSource(
  source: SettingSource,
  value: SettingsJson | null,
): void {
  perSourceCache.set(source, value)
}

/**
 * Path-keyed cache for parseSettingsFile. Both getSettingsForSource and
 * loadSettingsFromDisk call parseSettingsFile on the same paths during
 * startup — this dedupes the disk read + zod parse.
 */
type ParsedSettings = {
  settings: SettingsJson | null
  errors: ValidationError[]
}
const parseFileCache = new Map<string, ParsedSettings>()

export function getCachedParsedFile(path: string): ParsedSettings | undefined {
  return parseFileCache.get(path)
}

export function setCachedParsedFile(path: string, value: ParsedSettings): void {
  parseFileCache.set(path, value)
}

export function resetSettingsCache(): void {
  sessionSettingsCache = null
  perSourceCache.clear()
  parseFileCache.clear()
}

/**
 * Plugin settings base layer for the settings cascade.
 * pluginLoader writes here after loading plugins;
 * loadSettingsFromDisk reads it as the lowest-priority base.
 */
let pluginSettingsBase: Record<string, unknown> | undefined

export function getPluginSettingsBase(): Record<string, unknown> | undefined {
  return pluginSettingsBase
}

export function setPluginSettingsBase(
  settings: Record<string, unknown> | undefined,
): void {
  pluginSettingsBase = settings
}

export function clearPluginSettingsBase(): void {
  pluginSettingsBase = undefined
}
