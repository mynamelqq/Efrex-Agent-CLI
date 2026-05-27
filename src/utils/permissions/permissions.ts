
import { APIUserAbortError } from '@anthropic-ai/sdk'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import type { Tool, ToolPermissionContext, ToolUseContext } from '../../Tool.js'
import type { AssistantMessage } from 'src/package/message.js'
import { logForDebugging } from '../debug.js'
import { AbortError, toError } from '../errors.js'
import { DONT_ASK_REJECT_MESSAGE,AUTO_REJECT_MESSAGE } from '../messages.js'
import { logError } from '../log.js'
import {
  getSettingSourceDisplayNameLowercase,
  SETTING_SOURCES,
} from '../settings/constants.js'
import { plural } from '../stringUtils.js'
import { permissionModeTitle } from './PermissionMode'
import type {
  PermissionAskDecision,
  PermissionDecision,
  PermissionDecisionReason,
  PermissionDenyDecision,
  PermissionResult,
PermissionBehavior,
  PermissionRule,
    PermissionUpdate,
  PermissionUpdateDestination,
  PermissionRuleSource,
  PermissionRuleValue,
} from 'src/types/permissions.js'
import {

  applyPermissionUpdates,
  persistPermissionUpdates,
} from './PermissionUpdate.js'

import {
  permissionRuleValueFromString,
  permissionRuleValueToString,
} from './permissionRuleParser.js'

const PERMISSION_RULE_SOURCES = [
  ...SETTING_SOURCES,
  'cliArg',
  'command',
  'session',
] as const satisfies readonly PermissionRuleSource[]
export function permissionRuleSourceDisplayString(//用于给用户展示
  source: PermissionRuleSource,
): string {
  return getSettingSourceDisplayNameLowercase(source)
}

export function getAllowRules(
  context: ToolPermissionContext,
): PermissionRule[] {
  return PERMISSION_RULE_SOURCES.flatMap(source =>
    (context.alwaysAllowRules[source] || []).map(ruleString => ({
      source,
      ruleBehavior: 'allow',
      ruleValue: permissionRuleValueFromString(ruleString),
    })),
  )
}

/**
 * Check if the entire tool is listed in the always allow rules
 * For example, this finds "Bash" but not "Bash(prefix:*)" for BashTool
 */
export function toolAlwaysAllowedRule(
  context: ToolPermissionContext,
  tool: Pick<Tool, 'name'>,
): PermissionRule | null {
  return (
    getAllowRules(context).find(rule => toolMatchesRule(tool, rule)) || null
  )
}
/**
 * Applies a single permission update to the context and returns the updated context
 * @param context The current permission context
 * @param update The permission update to apply
 * @returns The updated permission context
 */
export function applyPermissionUpdate(
  context: ToolPermissionContext,
  update: PermissionUpdate,
): ToolPermissionContext {
  switch (update.type) {
    case 'setMode':
      logForDebugging(
        `Applying permission update: Setting mode to '${update.mode}'`,
      )
      return {
        ...context,
        mode: update.mode,
      }

    case 'addRules': {
      const ruleStrings = update.rules.map(rule =>
        permissionRuleValueToString(rule),
      )
      logForDebugging(
        `Applying permission update: Adding ${update.rules.length} ${update.behavior} rule(s) to destination '${update.destination}': ${JSON.stringify(ruleStrings)}`,
      )

      // Determine which collection to update based on behavior
      const ruleKind =
        update.behavior === 'allow'
          ? 'alwaysAllowRules'
          : update.behavior === 'deny'
            ? 'alwaysDenyRules'
            : 'alwaysAskRules'

      return {
        ...context,
        [ruleKind]: {
          ...context[ruleKind],
          [update.destination]: [
            ...(context[ruleKind][update.destination] || []),
            ...ruleStrings,
          ],
        },
      }
    }

    case 'replaceRules': {
      const ruleStrings = update.rules.map(rule =>
        permissionRuleValueToString(rule),
      )
      logForDebugging(
        `Replacing all ${update.behavior} rules for destination '${update.destination}' with ${update.rules.length} rule(s): ${JSON.stringify(ruleStrings)}`,
      )

      // Determine which collection to update based on behavior
      const ruleKind =
        update.behavior === 'allow'
          ? 'alwaysAllowRules'
          : update.behavior === 'deny'
            ? 'alwaysDenyRules'
            : 'alwaysAskRules'

      return {
        ...context,
        [ruleKind]: {
          ...context[ruleKind],
          [update.destination]: ruleStrings, // Replace all rules for this source
        },
      }
    }

    case 'addDirectories': {
      logForDebugging(
        `Applying permission update: Adding ${update.directories.length} director${update.directories.length === 1 ? 'y' : 'ies'} with destination '${update.destination}': ${JSON.stringify(update.directories)}`,
      )

      return {
        ...context,
      }
    }

    case 'removeRules': {
      const ruleStrings = update.rules.map(rule =>
        permissionRuleValueToString(rule),
      )
      logForDebugging(
        `Applying permission update: Removing ${update.rules.length} ${update.behavior} rule(s) from source '${update.destination}': ${JSON.stringify(ruleStrings)}`,
      )

      // Determine which collection to update based on behavior
      const ruleKind =
        update.behavior === 'allow'
          ? 'alwaysAllowRules'
          : update.behavior === 'deny'
            ? 'alwaysDenyRules'
            : 'alwaysAskRules'

      // Filter out the rules to be removed
      const existingRules = context[ruleKind][update.destination] || []
      const rulesToRemove = new Set(ruleStrings)
      const filteredRules = existingRules.filter(
        rule => !rulesToRemove.has(rule),
      )

      return {
        ...context,
        [ruleKind]: {
          ...context[ruleKind],
          [update.destination]: filteredRules,
        },
      }
    }

    case 'removeDirectories': {

      return {
        ...context,
        
      }
    }

    default:
      return context
  }
}
/**
 * Creates a permission request message that explain the permission request
 */
export function createPermissionRequestMessage(
  toolName: string,
  decisionReason?: PermissionDecisionReason,
): string {
  // Handle different decision reason types
  if (decisionReason) {
    switch (decisionReason.type) {
      case 'hook': {
        const hookMessage = decisionReason.reason
          ? `Hook '${decisionReason.hookName}' blocked this action: ${decisionReason.reason}`
          : `Hook '${decisionReason.hookName}' requires approval for this ${toolName} command`
        return hookMessage
      }
      case 'rule': {
        const ruleString = permissionRuleValueToString(
          decisionReason.rule.ruleValue,
        )
        const sourceString = permissionRuleSourceDisplayString(
          decisionReason.rule.source,
        )
        return `Permission rule '${ruleString}' from ${sourceString} requires approval for this ${toolName} command`
      }
      case 'permissionPromptTool':
        return `Tool '${decisionReason.permissionPromptToolName}' requires approval for this ${toolName} command`
      case 'sandboxOverride':
        return 'Run outside of the sandbox'
      case 'workingDir':
        return decisionReason.reason
      case 'safetyCheck':
      case 'other':
        return decisionReason.reason
      case 'mode': {
        const modeTitle = permissionModeTitle(decisionReason.mode)
        return `Current permission mode (${modeTitle}) requires approval for this ${toolName} command`
      }
      case 'asyncAgent':
        return decisionReason.reason
    }
  }

  // Default message without listing allowed commands
  const message = `Efrex requested permissions to use ${toolName}, but you haven't granted it yet.`

  return message
}
/**
 * Check if the entire tool matches a rule
 * For example, this matches "Bash" but not "Bash(prefix:*)" for BashTool
 * This also matches MCP tools with a server name, e.g. the rule "mcp__server1"
 */
function toolMatchesRule(
  tool: Pick<Tool, 'name'>,
  rule: PermissionRule,
): boolean {
  // Rule must not have content to match the entire tool
  if (rule.ruleValue.ruleContent !== undefined) {
    return false
  }
  const nameForRuleMatch = tool.name
  // Direct tool name match
  if (rule.ruleValue.toolName === nameForRuleMatch) {
    return true
  }
  return false
}
export function getDenyRules(context: ToolPermissionContext): PermissionRule[] {//获取拒绝规则
  return PERMISSION_RULE_SOURCES.flatMap(source =>
    (context.alwaysDenyRules[source] || []).map(ruleString => ({//找到多个源的规则合并在一起
      source,
      ruleBehavior: 'deny',
      ruleValue: permissionRuleValueFromString(ruleString),
    })),
  )
}
/**
 * Check if the tool is listed in the always deny rules
 */
export function getDenyRuleForTool(
  context: ToolPermissionContext,
  tool: Pick<Tool, 'name'>,
): PermissionRule | null {
  return getDenyRules(context).find(rule => toolMatchesRule(tool, rule)) || null
  //找到拒绝规则后过滤出当前工具
}
export function getAskRules(context: ToolPermissionContext): PermissionRule[] {
  return PERMISSION_RULE_SOURCES.flatMap(source =>
    (context.alwaysAskRules[source] || []).map(ruleString => ({
      source,
      ruleBehavior: 'ask',
      ruleValue: permissionRuleValueFromString(ruleString),
    })),
  )
}
/**
 * Check if the tool is listed in the always ask rules
 */
export function getAskRuleForTool(
  context: ToolPermissionContext,
  tool: Pick<Tool, 'name'>,
): PermissionRule | null {
  return getAskRules(context).find(rule => toolMatchesRule(tool, rule)) || null
}


export const hasPermissionsToUseTool: CanUseToolFn = async (
  tool,
  input,
  context,
  assistantMessage,
  toolUseID,
): Promise<PermissionDecision> => {
  const result = await hasPermissionsToUseToolInner(tool, input, context)

  // Reset consecutive denials on any allowed tool use in auto mode.
  // This ensures that a successful tool use (even one auto-allowed by rules)
  // breaks the consecutive denial streak.
  if (result.behavior === 'allow') {
    return result
  }

  // Apply dontAsk mode transformation: convert 'ask' to 'deny'
  // This is done at the end so it can't be bypassed by early returns
  if (result.behavior === 'ask') {
    const appState = context.getAppState()

    if (appState.toolPermissionContext.mode === 'dontAsk') {//如果权限模式是不问
      return {
        behavior: 'deny',
        decisionReason: {
          type: 'mode',
          mode: 'dontAsk',
        },
        message: DONT_ASK_REJECT_MESSAGE(tool.name),
      }
    }
    if (
      result.decisionReason?.type === 'safetyCheck' &&
      !result.decisionReason.classifierApprovable
    ) {
      if (appState.toolPermissionContext.shouldAvoidPermissionPrompts) {
        return {
          behavior: 'deny',
          message: result.message,
          decisionReason: {
            type: 'asyncAgent',
            reason:
              'Safety check requires interactive approval and permission prompts are not available in this context',
          },
        }
      }
      return result
    }
    if (result.behavior === 'ask' ) {
      try {
        const parsedInput = tool.inputSchema.parse(input)
        const acceptEditsResult = await tool.checkPermissions(parsedInput, {
          ...context,
          getAppState: () => {
            const state = context.getAppState()
            return {
              ...state,
              toolPermissionContext: {
                ...state.toolPermissionContext,
                mode: 'acceptEdits' as const,
              },
            }
          },
        })
        if (acceptEditsResult.behavior === 'allow') {
          return {
            behavior: 'allow',
            updatedInput: acceptEditsResult.updatedInput ?? input,
            decisionReason: {
              type: 'mode',
              mode: 'auto',
            },
          }
        }
      } catch (e) {
        if (e instanceof AbortError || e instanceof APIUserAbortError) {
          throw e
        }
        // If the acceptEdits check fails, fall through to the classifier
      }
    }

  }

  return result
}

async function hasPermissionsToUseToolInner(
  tool: Tool,
  input: { [key: string]: unknown },
  context: ToolUseContext,
): Promise<PermissionDecision> {
  if (context.abortController.signal.aborted) {
    throw new AbortError()
  }

  let appState = context.getAppState()

  // 1. Check if the tool is denied
  // 1a. Entire tool is denied 先检查有没有之前拒绝过的先例
  const denyRule = getDenyRuleForTool(appState.toolPermissionContext, tool)
  if (denyRule) {
    return {
      behavior: 'deny',
      decisionReason: {
        type: 'rule',
        rule: denyRule,
      },
      message: `Permission to use ${tool.name} has been denied.`,
    }
  }

  // 1b. Check if the entire tool should always ask for permission之前决策询问过的命令
  const askRule = getAskRuleForTool(appState.toolPermissionContext, tool)
  if (askRule) {
    return {
        behavior: 'ask',
        decisionReason: {
        type: 'rule',
        rule: askRule,
        },
        message: createPermissionRequestMessage(tool.name),
    }
  }
  // 1c. Ask the tool implementation for a permission result
  // Overridden unless tool input schema is not valid 执行工具的checkPermission方法
  let toolPermissionResult: PermissionResult = {
    behavior: 'passthrough',
    message: createPermissionRequestMessage(tool.name),
  }
  try {//一般走这个
    const parsedInput = tool.inputSchema.parse(input)
    toolPermissionResult = await tool.checkPermissions(parsedInput, context)//每个工具参数不同，认证逻辑不同，需要分别归类然后检查是否命中权限
  } catch (e) {
    // Rethrow abort errors so they propagate properly
    if (e instanceof AbortError || e instanceof APIUserAbortError) {
      throw e
    }
    logError(e)
  }

  // 1d. Tool implementation denied permission
  if (toolPermissionResult?.behavior === 'deny') {//如果查询访问权限不对，直接拒绝
    return toolPermissionResult
  }


  // 1f. Content-specific ask rules from tool.checkPermissions take precedence
  // over bypassPermissions mode. When a user explicitly configures a
  // content-specific ask rule (e.g. Bash(npm publish:*)), the tool's
  // checkPermissions returns {behavior:'ask', decisionReason:{type:'rule',
  // rule:{ruleBehavior:'ask'}}}. This must be respected even in bypass mode,
  // just as deny rules are respected at step 1d.
  if (
    toolPermissionResult?.behavior === 'ask' &&
    toolPermissionResult.decisionReason?.type === 'rule' &&
    toolPermissionResult.decisionReason.rule.ruleBehavior === 'ask'
  ) {
    return toolPermissionResult
  }

  // 1g. Safety checks (e.g. .git/, .claude/, .vscode/, shell configs) are
  // bypass-immune — they must prompt even in bypassPermissions mode.
  // checkPathSafetyForAutoEdit returns {type:'safetyCheck'} for these paths.
  if (
    toolPermissionResult?.behavior === 'ask' &&
    toolPermissionResult.decisionReason?.type === 'safetyCheck'
  ) {
    return toolPermissionResult
  }

//   // 2a. Check if mode allows the tool to run
//   // IMPORTANT: Call getAppState() to get the latest value
  appState = context.getAppState()
//   // Check if permissions should be bypassed:
//   // - Direct bypassPermissions mode
//   // - Plan mode when the user originally started with bypass mode (isBypassPermissionsModeAvailable)
  const shouldBypassPermissions =
    appState.toolPermissionContext.mode === 'bypassPermissions' ||
    (appState.toolPermissionContext.mode === 'plan' &&
      appState.toolPermissionContext.isBypassPermissionsModeAvailable)
  if (shouldBypassPermissions) {
    return {//bypassPermissions到这里直接允许,plan和isBypassPermissionsModeAvailable
      behavior: 'allow',
      updatedInput: getUpdatedInputOrFallback(toolPermissionResult, input),
      decisionReason: {
        type: 'mode',
        mode: appState.toolPermissionContext.mode,
      },
    }
  }

  // 2b. Entire tool is allowed
  const alwaysAllowedRule = toolAlwaysAllowedRule(
    appState.toolPermissionContext,
    tool,
  )
  if (alwaysAllowedRule) {
    return {
      behavior: 'allow',
      updatedInput: getUpdatedInputOrFallback(toolPermissionResult, input),
      decisionReason: {
        type: 'rule',
        rule: alwaysAllowedRule,
      },
    }
  }

  // 3. Convert "passthrough" to "ask"转换passthrough为ask行为
  const result: PermissionDecision =
    toolPermissionResult.behavior === 'passthrough'
      ? {
          ...toolPermissionResult,
          behavior: 'ask' as const,
          message: createPermissionRequestMessage(
            tool.name,
            toolPermissionResult.decisionReason,
          ),
        }
      : toolPermissionResult

  return result
}
/**
 * Extract updatedInput from a permission result, falling back to the original input.
 * Handles the case where some PermissionResult variants don't have updatedInput.
 */
function getUpdatedInputOrFallback(
  permissionResult: PermissionResult,
  fallback: Record<string, unknown>,
): Record<string, unknown> {
  return (
    ('updatedInput' in permissionResult
      ? permissionResult.updatedInput
      : undefined) ?? fallback
  )
}
// Used to break circular dependency where a Tool calls this function
export function getRuleByContentsForToolName(
  context: ToolPermissionContext,
  toolName: string,
  behavior: PermissionBehavior,
): Map<string, PermissionRule> {
  const ruleByContents = new Map<string, PermissionRule>()
  let rules: PermissionRule[] = []
  switch (behavior) {
    case 'allow':
      rules = getAllowRules(context)
      break
    case 'deny':
      rules = getDenyRules(context)
      break
    case 'ask':
      rules = getAskRules(context)
      break
  }
  for (const rule of rules) {
    if (
      rule.ruleValue.toolName === toolName &&
      rule.ruleValue.ruleContent !== undefined &&
      rule.ruleBehavior === behavior
    ) {
      ruleByContents.set(rule.ruleValue.ruleContent, rule)
    }
  }
  return ruleByContents
}
/**
 * 从磁盘同步权限规则（用于设置更改的替换操作）
 */
export function syncPermissionRulesFromDisk(
  toolPermissionContext: ToolPermissionContext,
  rules: PermissionRule[],
): ToolPermissionContext {
  let context = toolPermissionContext
    const sourcesToClear: PermissionUpdateDestination[] = [
      'userSettings',
      'projectSettings',
      'localSettings',
      'cliArg',
      'session',
    ]
    const behaviors: PermissionBehavior[] = ['allow', 'deny', 'ask']

    for (const source of sourcesToClear) {
      for (const behavior of behaviors) {
        context = applyPermissionUpdate(context, {
          type: 'replaceRules',
          rules: [],
          behavior,
          destination: source,
        })
      }
    }

  // Clear all disk-based source:behavior combos before applying new rules.
  // Without this, removing a rule from settings (e.g. deleting a deny entry)
  // would leave the old rule in the context because convertRulesToUpdates
  // only generates replaceRules for source:behavior pairs that have rules —
  // an empty group produces no update, so stale rules persist.
  const diskSources: PermissionUpdateDestination[] = [
    'userSettings',
    'projectSettings',
    'localSettings',
  ]
  for (const diskSource of diskSources) {
    for (const behavior of ['allow', 'deny', 'ask'] as PermissionBehavior[]) {
      context = applyPermissionUpdate(context, {
        type: 'replaceRules',
        rules: [],
        behavior,
        destination: diskSource,
      })
    }
  }

  const updates = convertRulesToUpdates(rules, 'replaceRules')
  return applyPermissionUpdates(context, updates)
}
/**
 * Helper to convert PermissionRule array to PermissionUpdate array
 */
function convertRulesToUpdates(
  rules: PermissionRule[],
  updateType: 'addRules' | 'replaceRules',
): PermissionUpdate[] {
  // Group rules by source and behavior
  const grouped = new Map<string, PermissionRuleValue[]>()

  for (const rule of rules) {
    const key = `${rule.source}:${rule.ruleBehavior}`
    if (!grouped.has(key)) {
      grouped.set(key, [])
    }
    grouped.get(key)!.push(rule.ruleValue)
  }

  // Convert to PermissionUpdate array
  const updates: PermissionUpdate[] = []
  for (const [key, ruleValues] of grouped) {
    const [source, behavior] = key.split(':')
    updates.push({
      type: updateType,
      rules: ruleValues,
      behavior: behavior as PermissionBehavior,
      destination: source as PermissionUpdateDestination,
    })
  }

  return updates
}