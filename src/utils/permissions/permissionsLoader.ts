import { readFileSync } from '../fileRead.js'
import { safeParseJSON } from '../json.js'
import { logError } from '../log.js'
import {
  type EditableSettingSource,
  getEnabledSettingSources,
  type SettingSource,
} from '../settings/constants.js'
import {
  getSettingsFilePathForSource,
  getSettingsForSource,
  updateSettingsForSource,
} from '../settings/settings.js'
import type { SettingsJson } from '../settings/types.js'
import type {
  PermissionBehavior,
  PermissionRule,
  PermissionRuleSource,
  PermissionRuleValue,
} from 'src/types/permissions.js'
import { permissionRuleValueToString,permissionRuleValueFromString } from './permissionRuleParser.js'
import { safeResolvePath } from '../file.js'
const SUPPORTED_RULE_BEHAVIORS = [
  'allow',
  'deny',
  'ask',
] as const satisfies PermissionBehavior[]



/**
 * Adds rules to the project permissions file
 * @param ruleValues The rule values to add
 * @returns Promise resolving to a boolean indicating success
 */
export function addPermissionRulesToSettings(//增加规则
  {
    ruleValues,
    ruleBehavior,
  }: {
    ruleValues: PermissionRuleValue[]
    ruleBehavior: PermissionBehavior
  },
  source: EditableSettingSource,
): boolean {
  if (ruleValues.length < 1) {
    // No rules to add
    return true
  }

  const ruleStrings = ruleValues.map(permissionRuleValueToString)//转成字符串
  // First try the normal settings loader which validates the schema
  // If validation fails, fall back to lenient loading to preserve existing rules
  // even if some fields (like hooks) have validation errors
  const settingsData =
    getSettingsForSource(source) ||//先读缓存
    getSettingsForSourceLenient_FOR_EDITING_ONLY_NOT_FOR_READING(source) ||//再根据源从配置文件里读取
    getEmptyPermissionSettingsJson()//兜底给个空的权限允许上下文

  try {
    // Ensure permissions object exists
    const existingPermissions = settingsData.permissions || {}//从设置里拿到已有的权限
    
    const existingRules = existingPermissions[ruleBehavior] || []//拿到现有的规则 根据行为ask deny allow

    // 过滤重复项 - 通过往返操作对现有条目进行规范化 // 解析 → 序列化，以使旧名称与其标准形式相匹配。
    const existingRulesSet = new Set(
      existingRules.map(raw =>
        permissionRuleValueToString(permissionRuleValueFromString(raw)),
      ),
    )
    const newRules = ruleStrings.filter(rule => !existingRulesSet.has(rule))

    // If no new rules to add, return success
    if (newRules.length === 0) {
      return true
    }

    // Keep a copy of the original settings data to preserve unrecognized keys
    const updatedSettingsData = {//增加条目
      ...settingsData,
      permissions: {
        ...existingPermissions,//展开
        [ruleBehavior]: [...existingRules, ...newRules],//这里增加 直接覆盖
      },
    }
    const result = updateSettingsForSource(source, updatedSettingsData)

    if (result.error) {
      throw result.error
    }

    return true
  } catch (error) {
    logError(error)
    return false
  }
}

/**
 * Lenient version of getSettingsForSource that doesn't fail on ANY validation errors.
 * Simply parses the JSON and returns it as-is without schema validation.
 *
 * Used when loading settings to append new rules (avoids losing existing rules
 * due to validation failures in unrelated fields like hooks).
 *
 * FOR EDITING ONLY - do not use this for reading settings for execution.
 */
function getSettingsForSourceLenient_FOR_EDITING_ONLY_NOT_FOR_READING(//读取设置 然后解析成json返回对象
  source: SettingSource,
): SettingsJson | null {
  const filePath = getSettingsFilePathForSource(source)
  if (!filePath) {
    return null
  }

  try {
    const { resolvedPath } = safeResolvePath(filePath)
    const content = readFileSync(resolvedPath)
    if (content.trim() === '') {
      return {}
    }

    const data = safeParseJSON(content, false)
    // Return raw parsed JSON without validation to preserve all existing settings
    // This is safe because we're only using this for reading/appending, not for execution
    return data && typeof data === 'object' ? (data as SettingsJson) : null
  } catch {
    return null
  }
}
function getEmptyPermissionSettingsJson(): SettingsJson {
  return {
    permissions: {},
  }
}