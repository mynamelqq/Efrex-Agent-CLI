
import { Tool } from "src/Tool"
import type z from 'zod/v4'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import type { AnyObject,  ToolUseContext } from '../../Tool.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  ProgressMessage,
} from 'src/package/message.js'
import type { PermissionDecision } from '../../types/permissions.js'
import { createAttachmentMessage } from "src/utils/messages.js"
import { logForDebugging } from '../../utils/debug.js'

import { logError } from '../../utils/log.js'
import {
  type PermissionDecisionReason,
  type PermissionResult,
} from 'src/types/permissions.js'

import type {  MessageUpdateLazy } from './toolExecution.js'

/**
 * Resolve a PreToolUse hook's permission result into a final PermissionDecision.
 *
 * Encapsulates the invariant that hook 'allow' does NOT bypass settings.json
 * deny/ask rules — checkRuleBasedPermissions still applies (inc-4788 analog).
 * Also handles the requiresUserInteraction/requireCanUseTool guards and the
 * 'ask' forceDecision passthrough.
 *
 * Shared by toolExecution.ts (main query loop) and REPLTool/toolWrappers.ts
 * (REPL inner calls) so the permission semantics stay in lockstep.
 */
export async function resolveHookPermissionDecision(
  hookPermissionResult: PermissionResult | undefined,
  tool: Tool,
  input: Record<string, unknown>,
  toolUseContext: ToolUseContext,
  canUseTool: CanUseToolFn,
  assistantMessage: AssistantMessage,
  toolUseID: string,
): Promise<{
  decision: PermissionDecision
  input: Record<string, unknown>
}> {
  const requiresInteraction = false
  const requireCanUseTool = true//toolUseContext.requireCanUseTool

  if (hookPermissionResult?.behavior === 'allow') {
    const hookInput = hookPermissionResult.updatedInput ?? input

    // Hook provided updatedInput for an interactive tool — the hook IS the
    // user interaction (e.g. headless wrapper that collected AskUserQuestion
    // answers). Treat as non-interactive for the rule-check path.
    const interactionSatisfied =
      requiresInteraction && hookPermissionResult.updatedInput !== undefined

    if ((requiresInteraction && !interactionSatisfied) || requireCanUseTool) {
      return {
        decision: await canUseTool(
          tool,
          hookInput,
          toolUseContext,
          assistantMessage,
          toolUseID,
        ),
        input: hookInput,
      }
    }

    // // Hook allow skips the interactive prompt, but deny/ask rules still apply.
    // const ruleCheck = await checkRuleBasedPermissions(
    //   tool,
    //   hookInput,
    //   toolUseContext,
    // )
    // if (ruleCheck === null) {
    //   return { decision: hookPermissionResult, input: hookInput }
    // }
    // if (ruleCheck.behavior === 'deny') {
    //   return { decision: ruleCheck, input: hookInput }
    // }
    return {
      decision: await canUseTool(
        tool,
        hookInput,
        toolUseContext,
        assistantMessage,
        toolUseID,
      ),
      input: hookInput,
    }
  }

  if (hookPermissionResult?.behavior === 'deny') {
    return { decision: hookPermissionResult, input }
  }

  // No hook decision or 'ask' — normal permission flow, possibly with
  // forceDecision so the dialog shows the hook's ask message.
  const forceDecision =
    hookPermissionResult?.behavior === 'ask' ? hookPermissionResult : undefined
  const askInput =
    hookPermissionResult?.behavior === 'ask' &&
    hookPermissionResult.updatedInput
      ? hookPermissionResult.updatedInput
      : input
  return {
    decision: await canUseTool(
      tool,
      askInput,
      toolUseContext,
      assistantMessage,
      toolUseID,
      forceDecision,
    ),
    input: askInput,
  }
}
