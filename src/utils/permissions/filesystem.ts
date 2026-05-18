
import { randomBytes } from 'crypto'
import ignore from 'ignore'
import memoize from 'lodash/memoize.js'
import { homedir, tmpdir } from 'os'
import { join, normalize, posix, sep } from 'path'

import type { z } from 'zod/v4'
import { getOriginalCwd, getSessionId } from '../../bootstrap/state.js'
import type { AnyObject, Tool, ToolPermissionContext } from '../../Tool.js'
import { getCwd } from '../cwd.js'
import { getClaudeConfigHomeDir } from '../envUtils.js'
import {
  containsPathTraversal,
  expandPath,

} from '../path.js'
import { getPlatform } from '../platform.js'
import { getProjectDir } from '../sessionStorage.js'
import { SETTING_SOURCES } from '../settings/constants.js'
import {
  getSettingsFilePathForSource,
  getSettingsRootPathForSource,
} from '../settings/settings.js'
import { getToolResultPath } from '../toolResultStorage.js'
import { windowsPathToPosixPath } from '../windowsPaths.js'
import type {
  PermissionDecision,
  PermissionResult,PermissionUpdate
} from 'src/types/permissions.js'
import { createReadRuleSuggestion } from './PermissionUpdate.js'




/**
 * Permission result for read permission for the specified tool & tool input
 */
export function checkReadPermissionForTool(
  tool: Tool,
  input: { [key: string]: unknown },
  toolPermissionContext: ToolPermissionContext,
): PermissionDecision {
  if (typeof tool.getPath !== 'function') {
    return {
      behavior: 'ask',
      message: `Claude requested permissions to use ${tool.name}, but you haven't granted it yet.`,
    }
  }
  const path = tool.getPath(input)//一般是glob、grep、file工具

  // Get paths to check (includes both original and resolved symlinks).
  // Computed once here and threaded through checkWritePermissionForTool →
  // checkPathSafetyForAutoEdit → pathInAllowedWorkingPath to avoid redundant
  // existsSync/lstatSync/realpathSync syscalls on the same path (previously
  // 6× = 30 syscalls per Read permission check).
  const pathsToCheck = getPathsForPermissionCheck(path)

  // 1. Defense-in-depth: Block UNC paths early (before other checks)
  // This catches paths starting with \\ or // that could access network resources
  // This may catch some UNC patterns not detected by containsVulnerableUncPath
  for (const pathToCheck of pathsToCheck) {
    if (pathToCheck.startsWith('\\\\') || pathToCheck.startsWith('//')) {
      return {
        behavior: 'ask',
        message: `Claude requested permissions to read from ${path}, which appears to be a UNC path that could access network resources.`,
        decisionReason: {
          type: 'other',
          reason: 'UNC path detected (defense-in-depth check)',
        },
      }
    }
  }

  // 2. Check for suspicious Windows path patterns (defense in depth)
  for (const pathToCheck of pathsToCheck) {
    if (hasSuspiciousWindowsPathPattern(pathToCheck)) {
      return {
        behavior: 'ask',
        message: `Claude requested permissions to read from ${path}, which contains a suspicious Windows path pattern that requires manual approval.`,
        decisionReason: {
          type: 'other',
          reason:
            'Path contains suspicious Windows-specific patterns (alternate data streams, short names, long path prefixes, or three or more consecutive dots) that require manual verification',
        },
      }
    }
  }

  // 3. Check for READ-SPECIFIC deny rules first - check both the original path and resolved symlink path
  // SECURITY: This must come before any allow checks (including "edit access implies read access")
  // to prevent bypassing explicit read deny rules
  for (const pathToCheck of pathsToCheck) {
    const denyRule = matchingRuleForInput(
      pathToCheck,
      toolPermissionContext,
      'read',
      'deny',
    )
    if (denyRule) {
      return {
        behavior: 'deny',
        message: `Permission to read ${path} has been denied.`,
        decisionReason: {
          type: 'rule',
          rule: denyRule,
        },
      }
    }
  }

  // 4. Check for READ-SPECIFIC ask rules - check both the original path and resolved symlink path
  // SECURITY: This must come before implicit allow checks to ensure explicit ask rules are honored
  for (const pathToCheck of pathsToCheck) {
    const askRule = matchingRuleForInput(
      pathToCheck,
      toolPermissionContext,
      'read',
      'ask',
    )
    if (askRule) {
      return {
        behavior: 'ask',
        message: `Claude requested permissions to read from ${path}, but you haven't granted it yet.`,
        decisionReason: {
          type: 'rule',
          rule: askRule,
        },
      }
    }
  }

  // 5. Edit access implies read access (but only if no read-specific deny/ask rules exist)
  // We check this after read-specific rules so that explicit read restrictions take precedence
  const editResult = checkWritePermissionForTool(
    tool,
    input,
    toolPermissionContext,
    pathsToCheck,
  )
  if (editResult.behavior === 'allow') {
    return editResult
  }

  // 6. Allow reads in working directories
  const isInWorkingDir = pathInAllowedWorkingPath(
    path,
    toolPermissionContext,
    pathsToCheck,
  )
  if (isInWorkingDir) {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: {
        type: 'mode',
        mode: 'default',
      },
    }
  }

  // 7. Allow reads from internal harness paths (session-memory, plans, tool-results)
  const absolutePath = expandPath(path)
  const internalReadResult = checkReadableInternalPath(absolutePath, input)
  if (internalReadResult.behavior !== 'passthrough') {
    return internalReadResult
  }

  // 8. Check for allow rules
  const allowRule = matchingRuleForInput(
    path,
    toolPermissionContext,
    'read',
    'allow',
  )
  if (allowRule) {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: {
        type: 'rule',
        rule: allowRule,
      },
    }
  }

  // 12. Default to asking for permission
  // At this point, isInWorkingDir is false (from step #6), so path is outside working directories
  return {
    behavior: 'ask',
    message: `Claude requested permissions to read from ${path}, but you haven't granted it yet.`,
    suggestions: generateSuggestions(
      path,
      'read',
      toolPermissionContext,
      pathsToCheck,
    ),
    decisionReason: {
      type: 'workingDir',
      reason: 'Path is outside allowed working directories',
    },
  }
}

/**
 * Permission result for write permission for the specified tool & tool input.
 *
 * @param precomputedPathsToCheck - Optional cached result of
 *   `getPathsForPermissionCheck(tool.getPath(input))`. Callers MUST derive this
 *   from the same `tool` and `input` in the same synchronous frame — `path` is
 *   re-derived internally for error messages and internal-path checks, so a
 *   stale value would silently check deny rules for the wrong path.
 */
export function checkWritePermissionForTool<Input extends AnyObject>(
  tool: Tool<Input>,
  input: z.infer<Input>,
  toolPermissionContext: ToolPermissionContext,
  precomputedPathsToCheck?: readonly string[],
): PermissionDecision {
  if (typeof tool.getPath !== 'function') {
    return {
      behavior: 'ask',
      message: `Claude requested permissions to use ${tool.name}, but you haven't granted it yet.`,
    }
  }
  const path = tool.getPath(input)

  // 1. Check for deny rules - check both the original path and resolved symlink path
  const pathsToCheck =
    precomputedPathsToCheck ?? getPathsForPermissionCheck(path)
  for (const pathToCheck of pathsToCheck) {
    const denyRule = matchingRuleForInput(
      pathToCheck,
      toolPermissionContext,
      'edit',
      'deny',
    )
    if (denyRule) {
      return {
        behavior: 'deny',
        message: `Permission to edit ${path} has been denied.`,
        decisionReason: {
          type: 'rule',
          rule: denyRule,
        },
      }
    }
  }

  // 1.5. Allow writes to internal editable paths (plan files, scratchpad)
  // This MUST come before isDangerousFilePathToAutoEdit check since .claude is a dangerous directory
  const absolutePathForEdit = expandPath(path)
  const internalEditResult = checkEditableInternalPath(
    absolutePathForEdit,
    input,
  )
  if (internalEditResult.behavior !== 'passthrough') {
    return internalEditResult
  }

  // 1.6. Check for .claude/** allow rules BEFORE safety checks
  // This allows session-level permissions to bypass the safety blocks for .claude/
  // We only allow this for session-level rules to prevent users from accidentally
  // permanently granting broad access to their .claude/ folder.
  //
  // matchingRuleForInput returns the first match across all sources. If the user
  // also has a broader Edit(.claude) rule in userSettings (e.g. from sandbox
  // write-allow conversion), that rule would be found first and its source check
  // below would fail. Scope the search to session-only rules so the dialog's
  // "allow Claude to edit its own settings for this session" option actually works.
  const claudeFolderAllowRule = matchingRuleForInput(
    path,
    {
      ...toolPermissionContext,
      alwaysAllowRules: {
        session: toolPermissionContext.alwaysAllowRules.session ?? [],
      },
    },
    'edit',
    'allow',
  )
  if (claudeFolderAllowRule) {
    // Check if this rule is scoped under .claude/ (project or global).
    // Accepts both the broad patterns ('/.claude/**', '~/.claude/**') and
    // narrowed ones like '/.claude/skills/my-skill/**' so users can grant
    // session access to a single skill without also exposing settings.json
    // or hooks/. The rule already matched the path via matchingRuleForInput;
    // this is an additional scope check. Reject '..' to prevent a rule like
    // '/.claude/../**' from leaking this bypass outside .claude/.
    const ruleContent = claudeFolderAllowRule.ruleValue.ruleContent
    if (
      ruleContent &&
      (ruleContent.startsWith(CLAUDE_FOLDER_PERMISSION_PATTERN.slice(0, -2)) ||
        ruleContent.startsWith(
          GLOBAL_CLAUDE_FOLDER_PERMISSION_PATTERN.slice(0, -2),
        )) &&
      !ruleContent.includes('..') &&
      ruleContent.endsWith('/**')
    ) {
      return {
        behavior: 'allow',
        updatedInput: input,
        decisionReason: {
          type: 'rule',
          rule: claudeFolderAllowRule,
        },
      }
    }
  }

  // 1.7. Check comprehensive safety validations (Windows patterns, Claude config, dangerous files)
  // This MUST come before checking allow rules to prevent users from accidentally granting
  // permission to edit protected files
  const safetyCheck = checkPathSafetyForAutoEdit(path, pathsToCheck)
  if (!safetyCheck.safe) {
    // SDK suggestion: if under .claude/skills/{name}/, emit the narrowed
    // session-scoped addRules that step 1.6 will honor on the next call.
    // Everything else (.claude/settings.json, .git/, .vscode/, .idea/) falls
    // back to generateSuggestions — its setMode suggestion doesn't bypass
    // this check, but preserving it avoids a surprising empty array.
    const skillScope = getClaudeSkillScope(path)
    const safetySuggestions: PermissionUpdate[] = skillScope
      ? [
          {
            type: 'addRules',
            rules: [
              {
                toolName: FILE_EDIT_TOOL_NAME,
                ruleContent: skillScope.pattern,
              },
            ],
            behavior: 'allow',
            destination: 'session',
          },
        ]
      : generateSuggestions(path, 'write', toolPermissionContext, pathsToCheck)
    const failedCheck = safetyCheck as {
      safe: false
      message: string
      classifierApprovable: boolean
    }
    return {
      behavior: 'ask',
      message: failedCheck.message,
      suggestions: safetySuggestions,
      decisionReason: {
        type: 'safetyCheck',
        reason: failedCheck.message,
        classifierApprovable: failedCheck.classifierApprovable,
      },
    }
  }

  // 2. Check for ask rules - check both the original path and resolved symlink path
  for (const pathToCheck of pathsToCheck) {
    const askRule = matchingRuleForInput(
      pathToCheck,
      toolPermissionContext,
      'edit',
      'ask',
    )
    if (askRule) {
      return {
        behavior: 'ask',
        message: `Claude requested permissions to write to ${path}, but you haven't granted it yet.`,
        decisionReason: {
          type: 'rule',
          rule: askRule,
        },
      }
    }
  }

  // 3. If in acceptEdits or sandboxBashMode mode, allow all writes in original cwd
  const isInWorkingDir = pathInAllowedWorkingPath(
    path,
    toolPermissionContext,
    pathsToCheck,
  )
  if (toolPermissionContext.mode === 'acceptEdits' && isInWorkingDir) {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: {
        type: 'mode',
        mode: toolPermissionContext.mode,
      },
    }
  }

  // 4. Check for allow rules
  const allowRule = matchingRuleForInput(
    path,
    toolPermissionContext,
    'edit',
    'allow',
  )
  if (allowRule) {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: {
        type: 'rule',
        rule: allowRule,
      },
    }
  }

  // 5. Default to asking for permission
  return {
    behavior: 'ask',
    message: `Claude requested permissions to write to ${path}, but you haven't granted it yet.`,
    suggestions: generateSuggestions(
      path,
      'write',
      toolPermissionContext,
      pathsToCheck,
    ),
    decisionReason: !isInWorkingDir
      ? {
          type: 'workingDir',
          reason: 'Path is outside allowed working directories',
        }
      : undefined,
  }
}

function hasSuspiciousWindowsPathPattern(path: string): boolean {
  // Check for NTFS Alternate Data Streams
  // Look for ':' after position 2 to skip drive letters (e.g., C:\)
  // Examples: file.txt::$DATA, .bashrc:hidden, settings.json:stream
  // Note: ADS colon syntax is only interpreted by the Windows kernel. On WSL,
  // DrvFs mounts route file operations through the Windows kernel, so colon
  // syntax is still interpreted as ADS separators. On Linux/macOS (non-WSL),
  // even when NTFS is mounted, ADS is accessed via xattrs (ntfs-3g) not colon
  // syntax, and colons are valid filename characters.
  if (getPlatform() === 'windows' || getPlatform() === 'wsl') {
    const colonIndex = path.indexOf(':', 2)
    if (colonIndex !== -1) {
      return true
    }
  }

  // Check for 8.3 short names
  // Look for '~' followed by a digit
  // Examples: GIT~1, CLAUDE~1, SETTIN~1.JSON, BASHRC~1
  if (/~\d/.test(path)) {
    return true
  }

  // Check for long path prefixes (both backslash and forward slash variants)
  // Examples: \\?\C:\Users\..., \\.\C:\..., //?/C:/..., //./C:/...
  if (
    path.startsWith('\\\\?\\') ||
    path.startsWith('\\\\.\\') ||
    path.startsWith('//?/') ||
    path.startsWith('//./')
  ) {
    return true
  }

  // Check for trailing dots and spaces that Windows strips during path resolution
  // Examples: .git., .claude , .bashrc..., settings.json.
  // This can bypass string matching if ".git" is blocked but ".git." is used
  if (/[.\s]+$/.test(path)) {
    return true
  }

  // Check for DOS device names that Windows treats as special devices
  // Examples: .git.CON, settings.json.PRN, .bashrc.AUX
  // Device names: CON, PRN, AUX, NUL, COM1-9, LPT1-9
  if (/\.(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(path)) {
    return true
  }

  // Check for three or more consecutive dots (...) when used as a path component
  // This pattern can be used to bypass security checks or create confusion
  // Examples: .../file.txt, path/.../file
  // Only block when dots are preceded AND followed by path separators (/ or \)
  // This allows legitimate uses like Next.js catch-all routes [...]name]
  if (/(^|\/|\\)\.{3,}(\/|\\|$)/.test(path)) {
    return true
  }

  return false
}
