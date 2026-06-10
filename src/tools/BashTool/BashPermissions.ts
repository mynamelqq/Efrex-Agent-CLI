import type { z } from 'zod/v4'
import type { ToolUseContext } from 'src/Tool.js'

import { tryParseShellCommand } from 'src/utils/bash/shellQuote.js'
import { splitCommand_DEPRECATED as splitCommand } from 'src/tools/BashTool/commandSemantics'
import {
    createPermissionRequestMessage,

} from 'src/utils/permissions/permissions.js'
import { parseCommandRaw } from "../../utils/bash/parser"
import { PermissionResult } from 'src/types/permissions'
import { BashTool } from './BashTool'
import { Redirect, SimpleCommand } from 'src/utils/bash/ast'
import { SAFE_ENV_VARS } from 'src/constants/env'
import { BASH_TOOL_NAME } from './toolName'
/**
 * Strips full-line comments from a command.
 * This handles cases where Claude adds comments in bash commands, e.g.:
 *   "# Check the logs directory\nls /home/user/logs"
 * Should be stripped to: "ls /home/user/logs"
 *
 * Only strips full-line comments (lines where the entire line is a comment),
 * not inline comments that appear after a command on the same line.
 */
function stripCommentLines(command: string): string {
  const lines = command.split('\n')
  const nonCommentLines = lines.filter(line => {
    const trimmed = line.trim()
    // Keep lines that are not empty and don't start with #
    return trimmed !== '' && !trimmed.startsWith('#')
  })

  // If all lines were comments/empty, return original
  if (nonCommentLines.length === 0) {
    return command
  }

  return nonCommentLines.join('\n')
}
export function stripSafeWrappers(command: string): string {
  // SECURITY: Use [ \t]+ not \s+ — \s matches \n/\r which are command
  // separators in bash. Matching across a newline would strip the wrapper from
  // one line and leave a different command on the next line for bash to execute.
  //
  // SECURITY: `(?:--[ \t]+)?` consumes the wrapper's own `--` so
  // `nohup -- rm -- -/../foo` strips to `rm -- -/../foo` (not `-- rm ...`
  // which would skip path validation with `--` as an unknown baseCmd).
  const SAFE_WRAPPER_PATTERNS = [
    // timeout: enumerate GNU long flags — no-value (--foreground,
    // --preserve-status, --verbose), value-taking in both =fused and
    // space-separated forms (--kill-after=5, --kill-after 5, --signal=TERM,
    // --signal TERM). Short: -v (no-arg), -k/-s with separate or fused value.
    // SECURITY: flag VALUES use allowlist [A-Za-z0-9_.+-] (signals are
    // TERM/KILL/9, durations are 5/5s/10.5). Previously [^ \t]+ matched
    // $ ( ) ` | ; & — `timeout -k$(id) 10 ls` stripped to `ls`, matched
    // Bash(ls:*), while bash expanded $(id) during word splitting BEFORE
    // timeout ran. Contrast ENV_VAR_PATTERN below which already allowlists.
    /^timeout[ \t]+(?:(?:--(?:foreground|preserve-status|verbose)|--(?:kill-after|signal)=[A-Za-z0-9_.+-]+|--(?:kill-after|signal)[ \t]+[A-Za-z0-9_.+-]+|-v|-[ks][ \t]+[A-Za-z0-9_.+-]+|-[ks][A-Za-z0-9_.+-]+)[ \t]+)*(?:--[ \t]+)?\d+(?:\.\d+)?[smhd]?[ \t]+/,
    /^time[ \t]+(?:--[ \t]+)?/,
    // SECURITY: keep in sync with checkSemantics wrapper-strip (ast.ts
    // ~:1990-2080) AND stripWrappersFromArgv (pathValidation.ts ~:1260).
    // Previously this pattern REQUIRED `-n N`; checkSemantics already handled
    // bare `nice` and legacy `-N`. Asymmetry meant checkSemantics exposed the
    // wrapped command to semantic checks but deny-rule matching and the cd+git
    // gate saw the wrapper name. `nice rm -rf /` with Bash(rm:*) deny became
    // ask instead of deny; `cd evil && nice git status` skipped the bare-repo
    // RCE gate. PR #21503 fixed stripWrappersFromArgv; this was missed.
    // Now matches: `nice cmd`, `nice -n N cmd`, `nice -N cmd` (all forms
    // checkSemantics strips).
    /^nice(?:[ \t]+-n[ \t]+-?\d+|[ \t]+-\d+)?[ \t]+(?:--[ \t]+)?/,
    // stdbuf: fused short flags only (-o0, -eL). checkSemantics handles more
    // (space-separated, long --output=MODE), but we fail-closed on those
    // above so not over-stripping here is safe. Main need: `stdbuf -o0 cmd`.
    /^stdbuf(?:[ \t]+-[ioe][LN0-9]+)+[ \t]+(?:--[ \t]+)?/,
    /^nohup[ \t]+(?:--[ \t]+)?/,
  ] as const

  // Pattern for environment variables:
  // ^([A-Za-z_][A-Za-z0-9_]*)  - Variable name (standard identifier)
  // =                           - Equals sign
  // ([A-Za-z0-9_./:-]+)         - Value: alphanumeric + safe punctuation only
  // [ \t]+                      - Required HORIZONTAL whitespace after value
  //
  // SECURITY: Only matches unquoted values with safe characters (no $(), `, $var, ;|&).
  //
  // SECURITY: Trailing whitespace MUST be [ \t]+ (horizontal only), NOT \s+.
  // \s matches \n/\r. If reconstructCommand emits an unquoted newline between
  // `TZ=UTC` and `echo`, \s+ would match across it and strip `TZ=UTC<NL>`,
  // leaving `echo curl evil.com` to match Bash(echo:*). But bash treats the
  // newline as a command separator. Defense-in-depth with needsQuoting fix.
  const ENV_VAR_PATTERN = /^([A-Za-z_][A-Za-z0-9_]*)=([A-Za-z0-9_./:-]+)[ \t]+/

  let stripped = command
  let previousStripped = ''

  // Phase 1: Strip leading env vars and comments only.
  // In bash, env var assignments before a command (VAR=val cmd) are genuine
  // shell-level assignments. These are safe to strip for permission matching.
  while (stripped !== previousStripped) {
    previousStripped = stripped
    stripped = stripCommentLines(stripped)

    const envVarMatch = stripped.match(ENV_VAR_PATTERN)
    if (envVarMatch) {
      const varName = envVarMatch[1]!
      const isAntOnlySafe =false
      if (SAFE_ENV_VARS.has(varName) || isAntOnlySafe) {
        stripped = stripped.replace(ENV_VAR_PATTERN, '')
      }
    }
  }

  // Phase 2: Strip wrapper commands and comments only. Do NOT strip env vars.
  // Wrapper commands (timeout, time, nice, nohup) use execvp to run their
  // arguments, so VAR=val after a wrapper is treated as the COMMAND to execute,
  // not as an env var assignment. Stripping env vars here would create a
  // mismatch between what the parser sees and what actually executes.
  // (HackerOne #3543050)
  previousStripped = ''
  while (stripped !== previousStripped) {
    previousStripped = stripped
    stripped = stripCommentLines(stripped)

    for (const pattern of SAFE_WRAPPER_PATTERNS) {
      stripped = stripped.replace(pattern, '')
    }
  }

  return stripped.trim()
}
/**
 * The main implementation to check if we need to ask for user permission to call BashTool with a given input
 */
export async function bashToolHasPermission(
  input: z.infer<typeof BashTool.inputSchema>,
  context: ToolUseContext,
  // getCommandSubcommandPrefixFn = getCommandSubcommandPrefix,
): Promise<PermissionResult> {
  let appState = context.getAppState()

  // 0. AST-based security parse. This replaces both tryParseShellCommand
  // (the shell-quote pre-check) and the bashCommandIsSafe misparsing gate.
  // tree-sitter produces either a clean SimpleCommand[] (quotes resolved,
  // no hidden substitutions) or 'too-complex' — which is exactly the signal
  // we need to decide whether splitCommand's output can be trusted.
  //
  // When tree-sitter WASM is unavailable OR the injection check is disabled
  // via env var, we fall back to the old path (legacy gate at ~1370 runs).
  // GrowthBook killswitch for shadow mode — when off, skip the native parse
  // entirely. Computed once; feature() must stay inline in the ternary below.
  // Parse once here; the resulting AST feeds both parseForSecurityFromAst
  // and bashToolCheckCommandOperatorPermissions.
  let astRoot =  await parseCommandRaw(input.command)
  let astResult: { kind: 'parse-unavailable' }
  let astSubcommands: string[] | null = null
  let astRedirects: Redirect[] | undefined
  let astCommands: SimpleCommand[] | undefined
  let shadowLegacySubs: string[] | undefined

 const toolPermissionContext = context.getAppState().toolPermissionContext
  const command = input.command.trim()
  const decisionReason = {
      type: 'other' as const,
      reason: `mode`,
 }
  if(toolPermissionContext.mode=="acceptEdits")
  {
    return {
      behavior: 'ask',
      decisionReason,
      message: createPermissionRequestMessage(
        BASH_TOOL_NAME,
        decisionReason,
      ),
      // No suggestions - don't recommend persisting invalid syntax
    }
  }

  // Empty command check
  if (!command) {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: {
        type: 'other',
        reason: 'Empty command is safe',
      },
    }
  }
 return {
    behavior: 'passthrough',
    message: createPermissionRequestMessage(
      BASH_TOOL_NAME,
      decisionReason,
    ),
    decisionReason,
    // suggestions: pendingSuggestions,
  }

  // if (astResult.kind === 'too-complex') {
  //   // Parse succeeded but found structure we can't statically analyze
  //   // (command substitution, expansion, control flow, parser differential).
  //   // Respect exact-match deny/ask/allow, then prefix/wildcard deny. Only
  //   // fall through to ask if no deny matched — don't downgrade deny to ask.
  //   const earlyExit = checkEarlyExitDeny(input, appState.toolPermissionContext)
  //   if (earlyExit !== null) return earlyExit
  //   const decisionReason: PermissionDecisionReason = {
  //     type: 'other' as const,
  //     reason: astResult.reason,
  //   }

  //   return {
  //     behavior: 'ask',
  //     decisionReason,
  //     message: createPermissionRequestMessage(BashTool.name, decisionReason),
  //     suggestions: [],
  //     ...(feature('BASH_CLASSIFIER')
  //       ? {
  //           pendingClassifierCheck: buildPendingClassifierCheck(
  //             input.command,
  //             appState.toolPermissionContext,
  //           ),
  //         }
  //       : {}),
  //   }
  // }

  // if (astResult.kind === 'simple') {
  //   // Clean parse: check semantic-level concerns (zsh builtins, eval, etc.)
  //   // that tokenize fine but are dangerous by name.
  //   const sem = checkSemantics(astResult.commands)
  //   if (!sem.ok) {
  //     // Same deny-rule enforcement as the too-complex path: a user with
  //     // `Bash(eval:*)` deny expects `eval "rm"` blocked, not downgraded.
  //     const earlyExit = checkSemanticsDeny(
  //       input,
  //       appState.toolPermissionContext,
  //       astResult.commands,
  //     )
  //     if (earlyExit !== null) return earlyExit
  //     const decisionReason: PermissionDecisionReason = {
  //       type: 'other' as const,
  //       reason: (sem as { ok: false; reason: string }).reason,
  //     }
  //     return {
  //       behavior: 'ask',
  //       decisionReason,
  //       message: createPermissionRequestMessage(BashTool.name, decisionReason),
  //       suggestions: [],
  //     }
  //   }
  //   // Stash the tokenized subcommands for use below. Downstream code (rule
  //   // matching, path extraction, cd detection) still operates on strings, so
  //   // we pass the original source span for each SimpleCommand. Downstream
  //   // processing (stripSafeWrappers, parseCommandArguments) re-tokenizes
  //   // these spans — that re-tokenization has known bugs (stripCommentLines
  //   // mishandles newlines inside quotes), but checkSemantics already caught
  //   // any argv element containing a newline, so those bugs can't bite here.
  //   // Migrating downstream to operate on argv directly is a later commit.
  //   astSubcommands = astResult.commands.map(c => c.text)
  //   astRedirects = astResult.commands.flatMap(c => c.redirects)
  //   astCommands = astResult.commands
  // }

  // Legacy shell-quote pre-check. Only reached on 'parse-unavailable'
  // (tree-sitter not loaded OR TREE_SITTER_BASH feature gated off). Falls
  // through to the full legacy path below.
  // if (astResult.kind === 'parse-unavailable') {
  //   logForDebugging(
  //     'bashToolHasPermission: tree-sitter unavailable, using legacy shell-quote path',
  //   )
  //   const parseResult = tryParseShellCommand(input.command)
  //   if (!parseResult.success) {
  //     const decisionReason = {
  //       type: 'other' as const,
  //       reason: `Command contains malformed syntax that cannot be parsed: ${(parseResult as { success: false; error: string }).error}`,
  //     }
  //     return {
  //       behavior: 'ask',
  //       decisionReason,
  //       message: createPermissionRequestMessage(BashTool.name, decisionReason),
  //     }
  //   }
  // }



  // // Check exact match first
  // const exactMatchResult = bashToolCheckExactMatchPermission(
  //   input,
  //   appState.toolPermissionContext,
  // )

  // // Exact command was denied
  // if (exactMatchResult.behavior === 'deny') {
  //   return exactMatchResult
  // }


  // // Check for non-subcommand Bash operators like `>`, `|`, etc.
  // // This must happen before dangerous path checks so that piped commands
  // // are handled by the operator logic (which generates "multiple operations" messages)
  // const commandOperatorResult = await checkCommandOperatorPermissions(
  //   input,
  //   (i: z.infer<typeof BashTool.inputSchema>) =>
  //     bashToolHasPermission(i, context, getCommandSubcommandPrefixFn),
  //   { isNormalizedCdCommand, isNormalizedGitCommand },
  //   astRoot,
  // )
  // if (commandOperatorResult.behavior !== 'passthrough') {
  //   // SECURITY FIX: When pipe segment processing returns 'allow', we must still validate
  //   // the ORIGINAL command. The pipe segment processing strips redirections before
  //   // checking each segment, so commands like:
  //   //   echo 'x' | xargs printf '%s' >> /tmp/file
  //   // would have both segments allowed (echo and xargs printf) but the >> redirection
  //   // would bypass validation. We must check:
  //   // 1. Path constraints for output redirections
  //   // 2. Command safety for dangerous patterns (backticks, etc.) in redirect targets
  //   if (commandOperatorResult.behavior === 'allow') {
  //     // Check for dangerous patterns (backticks, $(), etc.) in the original command
  //     // This catches cases like: echo x | xargs echo > `pwd`/evil.txt
  //     // where the backtick is in the redirect target (stripped from segments)
  //     // Gate on AST: when astSubcommands is non-null, tree-sitter already
  //     // validated structure (backticks/$() in redirect targets would have
  //     // returned too-complex). Matches gating at ~1481, ~1706, ~1755.
  //     // Avoids FP: `find -exec {} \; | grep x` tripping on backslash-;.
  //     // bashCommandIsSafe runs the full legacy regex battery (~20 patterns) —
  //     // only call it when we'll actually use the result.
  //     const safetyResult =
  //       astSubcommands === null
  //         ? await bashCommandIsSafeAsync(input.command)
  //         : null
  //     if (
  //       safetyResult !== null &&
  //       safetyResult.behavior !== 'passthrough' &&
  //       safetyResult.behavior !== 'allow'
  //     ) {
  //       // Attach pending classifier check - may auto-approve before user responds
  //       appState = context.getAppState()
  //       return {
  //         behavior: 'ask',
  //         message: createPermissionRequestMessage(BashTool.name, {
  //           type: 'other',
  //           reason:
  //             safetyResult.message ??
  //             'Command contains patterns that require approval',
  //         }),
  //         decisionReason: {
  //           type: 'other',
  //           reason:
  //             safetyResult.message ??
  //             'Command contains patterns that require approval',
  //         },
  //         ...(feature('BASH_CLASSIFIER')
  //           ? {
  //               pendingClassifierCheck: buildPendingClassifierCheck(
  //                 input.command,
  //                 appState.toolPermissionContext,
  //               ),
  //             }
  //           : {}),
  //       }
  //     }

  //     appState = context.getAppState()
  //     // SECURITY: Compute compoundCommandHasCd from the full command, NOT
  //     // hardcode false. The pipe-handling path previously passed `false` here,
  //     // disabling the cd+redirect check at pathValidation.ts:821. Appending
  //     // `| echo done` to `cd .claude && echo x > settings.json` routed through
  //     // this path with compoundCommandHasCd=false, letting the redirect write
  //     // to .claude/settings.json without the cd+redirect block firing.
  //     const pathResult = checkPathConstraints(
  //       input,
  //       getCwd(),
  //       appState.toolPermissionContext,
  //       commandHasAnyCd(input.command),
  //       astRedirects,
  //       astCommands,
  //     )
  //     if (pathResult.behavior !== 'passthrough') {
  //       return pathResult
  //     }
  //   }

  //   // When pipe segments return 'ask' (individual segments not allowed by rules),
  //   // attach pending classifier check - may auto-approve before user responds.
  //   if (commandOperatorResult.behavior === 'ask') {
  //     appState = context.getAppState()
  //     return {
  //       ...commandOperatorResult,
  //       ...(feature('BASH_CLASSIFIER')
  //         ? {
  //             pendingClassifierCheck: buildPendingClassifierCheck(
  //               input.command,
  //               appState.toolPermissionContext,
  //             ),
  //           }
  //         : {}),
  //     }
  //   }

  //   return commandOperatorResult
  // }

  // // SECURITY: Legacy misparsing gate. Only runs when the tree-sitter module
  // // is not loaded. Timeout/abort is fail-closed via too-complex (returned
  // // early above), not routed here. When the AST parse succeeded,
  // // astSubcommands is non-null and we've already validated structure; this
  // // block is skipped entirely. The AST's 'too-complex' result subsumes
  // // everything isBashSecurityCheckForMisparsing covered — both answer the
  // // same question: "can splitCommand be trusted on this input?"
  // if (
  //   astSubcommands === null &&
  //   !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_COMMAND_INJECTION_CHECK)
  // ) {
  //   const originalCommandSafetyResult = await bashCommandIsSafeAsync(
  //     input.command,
  //   )
  //   if (
  //     originalCommandSafetyResult.behavior === 'ask' &&
  //     originalCommandSafetyResult.isBashSecurityCheckForMisparsing
  //   ) {
  //     // Compound commands with safe heredoc patterns ($(cat <<'EOF'...EOF))
  //     // trigger the $() check on the unsplit command. Strip the safe heredocs
  //     // and re-check the remainder — if other misparsing patterns exist
  //     // (e.g. backslash-escaped operators), they must still block.
  //     const remainder = stripSafeHeredocSubstitutions(input.command)
  //     const remainderResult =
  //       remainder !== null ? await bashCommandIsSafeAsync(remainder) : null
  //     if (
  //       remainder === null ||
  //       (remainderResult?.behavior === 'ask' &&
  //         remainderResult.isBashSecurityCheckForMisparsing)
  //     ) {
  //       // Allow if the exact command has an explicit allow permission — the user
  //       // made a conscious choice to permit this specific command.
  //       appState = context.getAppState()
  //       const exactMatchResult = bashToolCheckExactMatchPermission(
  //         input,
  //         appState.toolPermissionContext,
  //       )
  //       if (exactMatchResult.behavior === 'allow') {
  //         return exactMatchResult
  //       }
  //       // Attach pending classifier check - may auto-approve before user responds
  //       const decisionReason: PermissionDecisionReason = {
  //         type: 'other' as const,
  //         reason: originalCommandSafetyResult.message,
  //       }
  //       return {
  //         behavior: 'ask',
  //         message: createPermissionRequestMessage(
  //           BashTool.name,
  //           decisionReason,
  //         ),
  //         decisionReason,
  //         suggestions: [], // Don't suggest saving a potentially dangerous command
  //         ...(feature('BASH_CLASSIFIER')
  //           ? {
  //               pendingClassifierCheck: buildPendingClassifierCheck(
  //                 input.command,
  //                 appState.toolPermissionContext,
  //               ),
  //             }
  //           : {}),
  //       }
  //     }
  //   }
  // }

  // // Split into subcommands. Prefer the AST-extracted spans; fall back to
  // // splitCommand only when tree-sitter was unavailable. The cd-cwd filter
  // // strips the `cd ${cwd}` prefix that models like to prepend.
  // const cwd = getCwd()
  // const cwdMingw =
  //   getPlatform() === 'windows' ? windowsPathToPosixPath(cwd) : cwd
  // const rawSubcommands =
  //   astSubcommands ?? shadowLegacySubs ?? splitCommand(input.command)
  // const { subcommands, astCommandsByIdx } = filterCdCwdSubcommands(
  //   rawSubcommands,
  //   astCommands,
  //   cwd,
  //   cwdMingw,
  // )

  // // CC-643: Cap subcommand fanout. Only the legacy splitCommand path can
  // // explode — the AST path returns a bounded list (astSubcommands !== null)
  // // or short-circuits to 'too-complex' for structures it can't represent.
  // if (
  //   astSubcommands === null &&
  //   subcommands.length > MAX_SUBCOMMANDS_FOR_SECURITY_CHECK
  // ) {
  //   logForDebugging(
  //     `bashPermissions: ${subcommands.length} subcommands exceeds cap (${MAX_SUBCOMMANDS_FOR_SECURITY_CHECK}) — returning ask`,
  //     { level: 'debug' },
  //   )
  //   const decisionReason = {
  //     type: 'other' as const,
  //     reason: `Command splits into ${subcommands.length} subcommands, too many to safety-check individually`,
  //   }
  //   return {
  //     behavior: 'ask',
  //     message: createPermissionRequestMessage(BashTool.name, decisionReason),
  //     decisionReason,
  //   }
  // }

  // // Ask if there are multiple `cd` commands
  // const cdCommands = subcommands.filter(subCommand =>
  //   isNormalizedCdCommand(subCommand),
  // )
  // if (cdCommands.length > 1) {
  //   const decisionReason = {
  //     type: 'other' as const,
  //     reason:
  //       'Multiple directory changes in one command require approval for clarity',
  //   }
  //   return {
  //     behavior: 'ask',
  //     decisionReason,
  //     message: createPermissionRequestMessage(BashTool.name, decisionReason),
  //   }
  // }

  // // Track if compound command contains cd for security validation
  // // This prevents bypassing path checks via: cd .claude/ && mv test.txt settings.json
  // const compoundCommandHasCd = cdCommands.length > 0

  // // SECURITY: Block compound commands that have both cd AND git
  // // This prevents sandbox escape via: cd /malicious/dir && git status
  // // where the malicious directory contains a bare git repo with core.fsmonitor.
  // // This check must happen HERE (before subcommand-level permission checks)
  // // because bashToolCheckPermission checks each subcommand independently via
  // // BashTool.isReadOnly(), which would re-derive compoundCommandHasCd=false
  // // from just "git status" alone, bypassing the readOnlyValidation.ts check.
  // if (compoundCommandHasCd) {
  //   const hasGitCommand = subcommands.some(cmd =>
  //     isNormalizedGitCommand(cmd.trim()),
  //   )
  //   if (hasGitCommand) {
  //     const decisionReason = {
  //       type: 'other' as const,
  //       reason:
  //         'Compound commands with cd and git require approval to prevent bare repository attacks',
  //     }
  //     return {
  //       behavior: 'ask',
  //       decisionReason,
  //       message: createPermissionRequestMessage(BashTool.name, decisionReason),
  //     }
  //   }
  // }

  // appState = context.getAppState() // re-compute the latest in case the user hit shift+tab

  // // SECURITY FIX: Check Bash deny/ask rules BEFORE path constraints
  // // This ensures that explicit deny rules like Bash(ls:*) take precedence over
  // // path constraint checks that return 'ask' for paths outside the project.
  // // Without this ordering, absolute paths outside the project (e.g., ls /home)
  // // would bypass deny rules because checkPathConstraints would return 'ask' first.
  // //
  // // Note: bashToolCheckPermission calls checkPathConstraints internally, which handles
  // // output redirection validation on each subcommand. However, since splitCommand strips
  // // redirections before we get here, we MUST validate output redirections on the ORIGINAL
  // // command AFTER checking deny rules but BEFORE returning results.
  // const subcommandPermissionDecisions = subcommands.map((command, i) =>
  //   bashToolCheckPermission(
  //     { command },
  //     appState.toolPermissionContext,
  //     compoundCommandHasCd,
  //     astCommandsByIdx[i],
  //   ),
  // )

  // // Deny if any subcommands are denied
  // const deniedSubresult = subcommandPermissionDecisions.find(
  //   _ => _.behavior === 'deny',
  // )
  // if (deniedSubresult !== undefined) {
  //   return {
  //     behavior: 'deny',
  //     message: `Permission to use ${BashTool.name} with command ${input.command} has been denied.`,
  //     decisionReason: {
  //       type: 'subcommandResults',
  //       reasons: new Map(
  //         subcommandPermissionDecisions.map((result, i) => [
  //           subcommands[i]!,
  //           result,
  //         ]),
  //       ),
  //     },
  //   }
  // }

  // // Validate output redirections on the ORIGINAL command (before splitCommand stripped them)
  // // This must happen AFTER checking deny rules but BEFORE returning results.
  // // Output redirections like "> /etc/passwd" are stripped by splitCommand, so the per-subcommand
  // // checkPathConstraints calls won't see them. We validate them here on the original input.
  // // SECURITY: When AST data is available, pass AST-derived redirects so
  // // checkPathConstraints uses them directly instead of re-parsing with
  // // shell-quote (which has a known single-quote backslash misparsing bug
  // // that can silently hide redirect operators).
  // const pathResult = checkPathConstraints(
  //   input,
  //   getCwd(),
  //   appState.toolPermissionContext,
  //   compoundCommandHasCd,
  //   astRedirects,
  //   astCommands,
  // )
  // if (pathResult.behavior === 'deny') {
  //   return pathResult
  // }

  // const askSubresult = subcommandPermissionDecisions.find(
  //   _ => _.behavior === 'ask',
  // )
  // const nonAllowCount = count(
  //   subcommandPermissionDecisions,
  //   _ => _.behavior !== 'allow',
  // )

  // // SECURITY (GH#28784): Only short-circuit on a path-constraint 'ask' when no
  // // subcommand independently produced an 'ask'. checkPathConstraints re-runs the
  // // path-command loop on the full input, so `cd <outside-project> && python3 foo.py`
  // // produces an ask with ONLY a Read(<dir>/**) suggestion — the UI renders it as
  // // "Yes, allow reading from <dir>/" and picking that option silently approves
  // // python3. When a subcommand has its own ask (e.g. the cd subcommand's own
  // // path-constraint ask), fall through: either the askSubresult short-circuit
  // // below fires (single non-allow subcommand) or the merge flow collects Bash
  // // rule suggestions for every non-allow subcommand. The per-subcommand
  // // checkPathConstraints call inside bashToolCheckPermission already captures
  // // the Read rule for the cd target in that path.
  // //
  // // When no subcommand asked (all allow, or all passthrough like `printf > file`),
  // // pathResult IS the only ask — return it so redirection checks surface.
  // if (pathResult.behavior === 'ask' && askSubresult === undefined) {
  //   return pathResult
  // }

  // // Ask if any subcommands require approval (e.g., ls/cd outside boundaries).
  // // Only short-circuit when exactly ONE subcommand needs approval — if multiple
  // // do (e.g. cd-outside-project ask + python3 passthrough), fall through to the
  // // merge flow so the prompt surfaces Bash rule suggestions for all of them
  // // instead of only the first ask's Read rule (GH#28784).
  // if (askSubresult !== undefined && nonAllowCount === 1) {
  //   return {
  //     ...askSubresult,
  //     ...(feature('BASH_CLASSIFIER')
  //       ? {
  //           pendingClassifierCheck: buildPendingClassifierCheck(
  //             input.command,
  //             appState.toolPermissionContext,
  //           ),
  //         }
  //       : {}),
  //   }
  // }

  // // Allow if exact command was allowed
  // if (exactMatchResult.behavior === 'allow') {
  //   return exactMatchResult
  // }

  // // If all subcommands are allowed via exact or prefix match, allow the
  // // command — but only if no command injection is possible. When the AST
  // // parse succeeded, each subcommand is already known-safe (no hidden
  // // substitutions, no structural tricks); the per-subcommand re-check is
  // // redundant. When on the legacy path, re-run bashCommandIsSafeAsync per sub.
  // let hasPossibleCommandInjection = false
  // if (
  //   astSubcommands === null &&
  //   !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_COMMAND_INJECTION_CHECK)
  // ) {
  //   // CC-643: Batch divergence telemetry into a single logEvent. The per-sub
  //   // logEvent was the hot-path syscall driver (each call → /proc/self/stat
  //   // via process.memoryUsage()). Aggregate count preserves the signal.
  //   let divergenceCount = 0
  //   const onDivergence = () => {
  //     divergenceCount++
  //   }
  //   const results = await Promise.all(
  //     subcommands.map(c => bashCommandIsSafeAsync(c, onDivergence)),
  //   )
  //   hasPossibleCommandInjection = results.some(
  //     r => r.behavior !== 'passthrough',
  //   )

  // }
  // if (
  //   subcommandPermissionDecisions.every(_ => _.behavior === 'allow') &&
  //   !hasPossibleCommandInjection
  // ) {
  //   return {
  //     behavior: 'allow',
  //     updatedInput: input,
  //     decisionReason: {
  //       type: 'subcommandResults',
  //       reasons: new Map(
  //         subcommandPermissionDecisions.map((result, i) => [
  //           subcommands[i]!,
  //           result,
  //         ]),
  //       ),
  //     },
  //   }
  // }

  // // Query Haiku for command prefixes
  // // Skip the Haiku call — the UI computes the prefix locally and
  // // lets the user edit it. Still call when a custom fn is injected (tests).
  // let commandSubcommandPrefix: Awaited<
  //   ReturnType<typeof getCommandSubcommandPrefixFn>
  // > = null
  // if (getCommandSubcommandPrefixFn !== getCommandSubcommandPrefix) {
  //   commandSubcommandPrefix = await getCommandSubcommandPrefixFn(
  //     input.command,
  //     context.abortController.signal,
  //     context.options.isNonInteractiveSession,
  //   )
  //   if (context.abortController.signal.aborted) {
  //     throw new AbortError()
  //   }
  // }

  // // If there is only one command, no need to process subcommands
  // appState = context.getAppState() // re-compute the latest in case the user hit shift+tab
  // if (subcommands.length === 1) {
  //   const result = await checkCommandAndSuggestRules(
  //     { command: subcommands[0]! },
  //     appState.toolPermissionContext,
  //     commandSubcommandPrefix,
  //     compoundCommandHasCd,
  //     astSubcommands !== null,
  //   )
  //   // If command wasn't allowed, attach pending classifier check.
  //   // At this point, 'ask' can only come from bashCommandIsSafe (security check inside
  //   // checkCommandAndSuggestRules), NOT from explicit ask rules - those were already
  //   // filtered out at step 13 (askSubresult check). The classifier can bypass security.
  //   if (result.behavior === 'ask' || result.behavior === 'passthrough') {
  //     return {
  //       ...result,
  //     }
  //   }
  //   return result
  // }

  // // Check subcommand permission results
  // const subcommandResults: Map<string, PermissionResult> = new Map()
  // for (const subcommand of subcommands) {
  //   subcommandResults.set(
  //     subcommand,
  //     await checkCommandAndSuggestRules(
  //       {
  //         // Pass through input params like `sandbox`
  //         ...input,
  //         command: subcommand,
  //       },
  //       appState.toolPermissionContext,
  //       commandSubcommandPrefix?.subcommandPrefixes.get(subcommand),
  //       compoundCommandHasCd,
  //       astSubcommands !== null,
  //     ),
  //   )
  // }

  // // Allow if all subcommands are allowed
  // // Note that this is different than 6b because we are checking the command injection results.
  // if (
  //   subcommands.every(subcommand => {
  //     const permissionResult = subcommandResults.get(subcommand)
  //     return permissionResult?.behavior === 'allow'
  //   })
  // ) {
  //   // Keep subcommandResults as PermissionResult for decisionReason
  //   return {
  //     behavior: 'allow',
  //     updatedInput: input,
  //     decisionReason: {
  //       type: 'subcommandResults',
  //       reasons: subcommandResults,
  //     },
  //   }
  // }

  // // Otherwise, ask for permission
  // const collectedRules: Map<string, PermissionRuleValue> = new Map()

  // for (const [subcommand, permissionResult] of subcommandResults) {
  //   if (
  //     permissionResult.behavior === 'ask' ||
  //     permissionResult.behavior === 'passthrough'
  //   ) {
  //     const updates =
  //       'suggestions' in permissionResult
  //         ? permissionResult.suggestions
  //         : undefined

  //     const rules = extractRules(updates)
  //     for (const rule of rules) {
  //       // Use string representation as key for deduplication
  //       const ruleKey = permissionRuleValueToString(rule)
  //       collectedRules.set(ruleKey, rule)
  //     }

  //     // GH#28784 follow-up: security-check asks (compound-cd+write, process
  //     // substitution, etc.) carry no suggestions. In a compound command like
  //     // `cd ~/out && rm -rf x`, that means only cd's Read rule gets collected
  //     // and the UI labels the prompt "Yes, allow reading from <dir>/" — never
  //     // mentioning rm. Synthesize a Bash(exact) rule so the UI shows the
  //     // chained command. Skip explicit ask rules (decisionReason.type 'rule')
  //     // where the user deliberately wants to review each time.
  //     if (
  //       permissionResult.behavior === 'ask' &&
  //       rules.length === 0 &&
  //       permissionResult.decisionReason?.type !== 'rule'
  //     ) {
  //       for (const rule of extractRules(
  //         suggestionForExactCommand(subcommand),
  //       )) {
  //         const ruleKey = permissionRuleValueToString(rule)
  //         collectedRules.set(ruleKey, rule)
  //       }
  //     }
  //     // Note: We only collect rules, not other update types like mode changes
  //     // This is appropriate for bash subcommands which primarily need rule suggestions
  //   }
  // }

  // const decisionReason = {
  //   type: 'subcommandResults' as const,
  //   reasons: subcommandResults,
  // }

  // // GH#11380: Cap at MAX_SUGGESTED_RULES_FOR_COMPOUND. Map preserves insertion
  // // order (subcommand order), so slicing keeps the leftmost N.
  // const cappedRules = Array.from(collectedRules.values()).slice(
  //   0,
  //   MAX_SUGGESTED_RULES_FOR_COMPOUND,
  // )
  // const suggestedUpdates: PermissionUpdate[] | undefined =
  //   cappedRules.length > 0
  //     ? [
  //         {
  //           type: 'addRules',
  //           rules: cappedRules,
  //           behavior: 'allow',
  //           destination: 'localSettings',
  //         },
  //       ]
  //     : undefined

  // // Attach pending classifier check - may auto-approve before user responds.
  // // Behavior is 'ask' if any subcommand was 'ask' (e.g., path constraint or ask
  // // rule) — before the GH#28784 fix, ask subresults always short-circuited above
  // // so this path only saw 'passthrough' subcommands and hardcoded that.
  // return {
  //   behavior: askSubresult !== undefined ? 'ask' : 'passthrough',
  //   message: createPermissionRequestMessage(BashTool.name, decisionReason),
  //   decisionReason,
  //   suggestions: suggestedUpdates,
  //   ...(feature('BASH_CLASSIFIER')
  //     ? {
  //         pendingClassifierCheck: buildPendingClassifierCheck(
  //           input.command,
  //           appState.toolPermissionContext,
  //         ),
  //       }
  //     : {}),
  // }
}









/**
 * Checks if a subcommand is a cd command after normalizing away safe wrappers
 * (env vars, timeout, etc.) and shell quotes.
 *
 * SECURITY: Must normalize before matching to prevent bypasses like:
 *   FORCE_COLOR=1 cd sub — env var prefix hides the cd from a naive /^cd / regex
 *   This mirrors isNormalizedGitCommand to ensure symmetric normalization.
 *
 * Also matches pushd/popd — they change cwd just like cd, so
 *   pushd /tmp/bare-repo && git status
 * must trigger the same cd+git guard. Mirrors PowerShell's
 * DIRECTORY_CHANGE_ALIASES (src/utils/powershell/parser.ts).
 */
export function isNormalizedCdCommand(command: string): boolean {
  const stripped = stripSafeWrappers(command)
  const parsed = tryParseShellCommand(stripped)
  if (parsed.success && parsed.tokens.length > 0) {
    const cmd = parsed.tokens[0]
    return cmd === 'cd' || cmd === 'pushd' || cmd === 'popd'
  }
  return /^(?:cd|pushd|popd)(?:\s|$)/.test(stripped)
}


/**
 * Checks if a compound command contains any cd command,
 * using normalized detection that handles env var prefixes and shell quotes.
 */
export function commandHasAnyCd(command: string): boolean {
  return splitCommand(command).some(subcmd =>
    isNormalizedCdCommand(subcmd.trim()),
  )
}
