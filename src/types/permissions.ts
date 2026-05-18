




import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
/**
 * The value of a permission rule - specifies which tool and optional content
 */
export type PermissionRuleValue = {
  toolName: string
  ruleContent?: string
}
export type PermissionBehavior = 'allow' | 'deny' | 'ask'
/**
 * Where a permission rule originated from.
 * Includes all SettingSource values plus additional rule-specific sources.
 */
export type PermissionRuleSource =
  | 'userSettings'
  | 'projectSettings'
  | 'localSettings'
  | 'cliArg'
  | 'command'
  | 'session'
/**
 * Mapping of permission rules by their source
 */
export type ToolPermissionRulesBySource = {
  [T in PermissionRuleSource]?: string[]
}
export const EXTERNAL_PERMISSION_MODES = [
  'acceptEdits',
  'bypassPermissions',
  'default',
  'dontAsk',
  'plan',
] as const
// Runtime validation set: modes that are user-addressable (settings.json
// defaultMode, --permission-mode CLI flag, conversation recovery).
// 'auto' is always available — when TRANSCRIPT_CLASSIFIER is off, the
// classifier is unavailable and auto mode falls back to prompting.
export const INTERNAL_PERMISSION_MODES = [
  ...EXTERNAL_PERMISSION_MODES,
  'auto' as const,
] as const satisfies readonly PermissionMode[]

export const PERMISSION_MODES = INTERNAL_PERMISSION_MODES
export type ExternalPermissionMode = (typeof EXTERNAL_PERMISSION_MODES)[number]
export type InternalPermissionMode = ExternalPermissionMode | 'auto' | 'bubble'
export type PermissionMode = InternalPermissionMode
export type PermissionRule = {
  source: PermissionRuleSource
  ruleBehavior: PermissionBehavior
  ruleValue: PermissionRuleValue
}
/**
 * Explanation of why a permission decision was made
 */
export type PermissionDecisionReason =
  | {
      type: 'rule'
      rule: PermissionRule
    }
  | {
      type: 'mode'
      mode: PermissionMode
    }
  | {
      type: 'subcommandResults'
      reasons: Map<string, PermissionResult>
    }
  | {
      type: 'permissionPromptTool'
      permissionPromptToolName: string
      toolResult: unknown
    }
  | {
      type: 'hook'
      hookName: string
      hookSource?: string
      reason?: string
    }
  | {
      type: 'asyncAgent'
      reason: string
    }
  | {
      type: 'sandboxOverride'
      reason: 'excludedCommand' | 'dangerouslyDisableSandbox'
    }
  | {
      type: 'classifier'
      classifier: string
      reason: string
    }
  | {
      type: 'workingDir'
      reason: string
    }
  | {
      type: 'safetyCheck'
      reason: string
      // When true, auto mode lets the classifier evaluate this instead of
      // forcing a prompt. True for sensitive-file paths (.claude/, .git/,
      // shell configs) — the classifier can see context and decide. False
      // for Windows path bypass attempts and cross-machine bridge messages.
      classifierApprovable: boolean
    }
  | {
      type: 'other'
      reason: string
    }
/**
 * Result when permission is granted
 */
export type PermissionAllowDecision<
  Input extends { [key: string]: unknown } = { [key: string]: unknown },
> = {
  behavior: 'allow'
  updatedInput?: Input
  userModified?: boolean
  decisionReason?: PermissionDecisionReason
  toolUseID?: string
  acceptFeedback?: string
  contentBlocks?: ContentBlockParam[]
}
/**
 * Where a permission update should be persisted
 */
export type PermissionUpdateDestination =
  | 'userSettings'
  | 'projectSettings'
  | 'localSettings'
  | 'session'
  | 'cliArg'
/**
 * A permission decision - allow, ask, or deny
 */
export type PermissionDecision<
  Input extends { [key: string]: unknown } = { [key: string]: unknown },
> =
  | PermissionAllowDecision<Input>
  | PermissionAskDecision<Input>
  | PermissionDenyDecision
/**
 * Metadata for a pending classifier check that will run asynchronously.
 * Used to enable non-blocking allow classifier evaluation.
 */
export type PendingClassifierCheck = {
  command: string
  cwd: string
  descriptions: string[]
}
/**
 * Permission result with additional passthrough option
 */
export type PermissionResult<
  Input extends { [key: string]: unknown } = { [key: string]: unknown },
> =
  | PermissionDecision<Input>
  | {
      behavior: 'passthrough'
      message: string
      decisionReason?: PermissionDecision<Input>['decisionReason']
      suggestions?: PermissionUpdate[]
      blockedPath?: string
      /**
       * If set, an allow classifier check should be run asynchronously.
       * The classifier may auto-approve the permission before the user responds.
       */
      pendingClassifierCheck?: PendingClassifierCheck
    }
    
/**
 * Result when permission is denied
 */
export type PermissionDenyDecision = {
  behavior: 'deny'
  message: string
  decisionReason: PermissionDecisionReason
  toolUseID?: string
}
/**
 * Update operations for permission configuration
 */
export type PermissionUpdate =
  | {
      type: 'addRules'
      destination: PermissionUpdateDestination
      rules: PermissionRuleValue[]
      behavior: PermissionBehavior
    }
  | {
      type: 'replaceRules'
      destination: PermissionUpdateDestination
      rules: PermissionRuleValue[]
      behavior: PermissionBehavior
    }
  | {
      type: 'removeRules'
      destination: PermissionUpdateDestination
      rules: PermissionRuleValue[]
      behavior: PermissionBehavior
    }
  | {
      type: 'setMode'
      destination: PermissionUpdateDestination
      mode: ExternalPermissionMode
    }
  | {
      type: 'addDirectories'
      destination: PermissionUpdateDestination
      directories: string[]
    }
  | {
      type: 'removeDirectories'
      destination: PermissionUpdateDestination
      directories: string[]
    }

/**
 * Result when user should be prompted
 */
export type PermissionAskDecision<
  Input extends { [key: string]: unknown } = { [key: string]: unknown },
> = {
  behavior: 'ask'
  message: string
  updatedInput?: Input
  decisionReason?: PermissionDecisionReason
  suggestions?: PermissionUpdate[]
  blockedPath?: string
  metadata?: PermissionMetadata
  /**
   * If true, this ask decision was triggered by a bashCommandIsSafe_DEPRECATED security check
   * for patterns that splitCommand_DEPRECATED could misparse (e.g. line continuations, shell-quote
   * transformations). Used by bashToolHasPermission to block early before splitCommand_DEPRECATED
   * transforms the command. Not set for simple newline compound commands.
   */
  isBashSecurityCheckForMisparsing?: boolean
  /**
   * If set, an allow classifier check should be run asynchronously.
   * The classifier may auto-approve the permission before the user responds.
   */
  pendingClassifierCheck?: PendingClassifierCheck
  /**
   * Optional content blocks (e.g., images) to include alongside the rejection
   * message in the tool result. Used when users paste images as feedback.
   */
  contentBlocks?: ContentBlockParam[]
}
/**
 * Metadata attached to permission decisions
 */
export type PermissionMetadata =
  | { command: PermissionCommandMetadata }
  | undefined
/**
 * Minimal command shape for permission metadata.
 * This is intentionally a subset of the full Command type to avoid import cycles.
 * Only includes properties needed by permission-related components.
 */
export type PermissionCommandMetadata = {
  name: string
  description?: string
  // Allow additional properties for forward compatibility
  [key: string]: unknown
}
