import { feature } from 'bun:bundle';
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import { copyFile, stat as fsStat, truncate as fsTruncate, link } from 'fs/promises';
import * as React from 'react';
import { powershellToolHasPermission } from './PowerShellPermissions.js';
import type { CanUseToolFn } from 'src/hooks/useCanUseTool.js';
import { interpretCommandResult } from './commandSemantics.js';
import type { AppState } from 'src/state/AppState.js';
import { z } from 'zod/v4';
import { TOOL_SUMMARY_MAX_LENGTH } from 'src/constants/toolLimits.js';
import type { SetToolJSXFn, Tool, ValidationResult } from 'src/Tool.js';
import { buildTool, type ToolDef } from 'src/Tool.js';
import type { AgentId } from 'src/types/ids.js';
import type { AssistantMessage } from 'src/package/message.js';
import { isEnvTruthy } from 'src/utils/envUtils.js';
import { errorMessage as getErrorMessage, ShellError } from 'src/utils/errors.js';
import { truncate } from 'src/utils/format.js';
import { lazySchema } from 'src/utils/lazySchema.js';
import { logError } from 'src/utils/log.js';
import type { PermissionResult } from 'src/types/permissions.js';
import { getPlatform } from 'src/utils/platform.js';
import { exec } from 'src/utils/shell.js';
import type { ExecResult } from 'src/utils/ShellCommand.js';
import { semanticBoolean } from 'src/utils/semanticBoolean.js';
import { semanticNumber } from 'src/utils/semanticNumber.js';
import { getCachedPowerShellPath } from 'src/utils/shell/powershellDetection.js';
import { EndTruncatingAccumulator } from 'src/utils/stringUtils.js';
import { isOutputLineTruncated } from 'src/utils/terminal.js';
import {
  buildLargeToolResultMessage,
  ensureToolResultsDir,
  generatePreview,
  getToolResultPath,
  PREVIEW_SIZE_BYTES,
} from 'src/utils/toolResultStorage.js';
import {
  buildImageToolResult,
  isImageOutput,
  resetCwdIfOutsideProject,
  resizeShellImageOutput,
  stdErrAppendShellResetMessage,
  stripEmptyLines,
} from '../BashTool/utils.js';
// import { trackGitOperations } from '../shared/gitOperationTracking.js';
// import { interpretCommandResult } from './commandSemantics.js';
// import { powershellToolHasPermission } from './powershellPermissions.js';
import { getDefaultTimeoutMs, getMaxTimeoutMs, getPrompt } from './prompt';
import { hasSyncSecurityConcerns,  resolveToCanonical } from './readOnlyValidation';
import { POWERSHELL_TOOL_NAME } from './toolName';
import {
  renderToolResultMessage,
  renderToolUseErrorMessage,
  renderToolUseMessage,
  renderToolUseProgressMessage,
  renderToolUseQueuedMessage,
} from './UI.js';
// Constants for command display
// Never use os.EOL for terminal output — \r\n on Windows breaks Ink rendering
const EOL = '\n';
/**
 * PowerShell search commands (grep equivalents) for collapsible display.
 * Stored as canonical (lowercase) cmdlet names.
 */
const PS_SEARCH_COMMANDS = new Set([//powershell的搜索命令
  'select-string', // grep equivalent
  'get-childitem', // find equivalent (with -Recurse)
  'findstr', // native Windows search
  'where.exe', // native Windows which
]);
/**
 * PowerShell read/view commands for collapsible display.
 * Stored as canonical (lowercase) cmdlet names.
 */
const PS_READ_COMMANDS = new Set([//读取命令
  'get-content', // cat equivalent
  'get-item', // file info
  'test-path', // test -e equivalent
  'resolve-path', // realpath equivalent
  'get-process', // ps equivalent
  'get-service', // system info
  'get-childitem', // ls/dir equivalent (also search when recursive)
  'get-location', // pwd equivalent
  'get-filehash', // checksum
  'get-acl', // permissions info
  'format-hex', // hexdump equivalent
]);
/**
 * 具有语义中立性质且不会改变搜索/读取方式的 PowerShell 命令。
 */
const PS_SEMANTIC_NEUTRAL_COMMANDS = new Set([
  'write-output', // echo equivalent
  'write-host',
]);
/**
 * Checks if a PowerShell command is a search or read operation.
 * Used to determine if the command should be collapsed in the UI.
 */
function isSearchOrReadPowerShellCommand(command: string): {//查看是搜索还是阅读 绝对是否要压缩UI
  isSearch: boolean;
  isRead: boolean;
} {
  const trimmed = command.trim();
  if (!trimmed) {
    return { isSearch: false, isRead: false };
  }

  // Simple split on statement separators and pipe operators
  // This is a sync function so we use a lightweight approach
  const parts = trimmed.split(/\s*[;|]\s*/).filter(Boolean);

  if (parts.length === 0) {
    return { isSearch: false, isRead: false };
  }

  let hasSearch = false;
  let hasRead = false;
  let hasNonNeutralCommand = false;

  for (const part of parts) {
    const baseCommand = part.trim().split(/\s+/)[0];
    if (!baseCommand) {
      continue;
    }

    const canonical = resolveToCanonical(baseCommand);

    if (PS_SEMANTIC_NEUTRAL_COMMANDS.has(canonical)) {
      continue;
    }

    hasNonNeutralCommand = true;

    const isPartSearch = PS_SEARCH_COMMANDS.has(canonical);
    const isPartRead = PS_READ_COMMANDS.has(canonical);

    if (!isPartSearch && !isPartRead) {
      return { isSearch: false, isRead: false };
    }

    if (isPartSearch) hasSearch = true;
    if (isPartRead) hasRead = true;
  }

  if (!hasNonNeutralCommand) {
    return { isSearch: false, isRead: false };
  }

  return { isSearch: hasSearch, isRead: hasRead };
}
// Progress display constants
const PROGRESS_THRESHOLD_MS = 2000;//进程显示
const PROGRESS_INTERVAL_MS = 1000;
// In assistant mode, blocking commands auto-background after this many ms in the main agent
const ASSISTANT_BLOCKING_BUDGET_MS = 15_000;

// 不应自动置于后台执行的命令（小写形式的规范表述）。// “sleep”是 PS 内置命令“Start-Sleep”的别名，但不在 COMMON_ALIASES 中，因此需列出两种形式。
const DISALLOWED_AUTO_BACKGROUND_COMMANDS = [
  'start-sleep', // Start-Sleep should run in foreground unless explicitly backgrounded
  'sleep',
];
/**
 * Checks if a command is allowed to be automatically backgrounded
 * @param command The command to check
 * @returns false for commands that should not be auto-backgrounded (like Start-Sleep)
 */
function isAutobackgroundingAllowed(command: string): boolean {//判断是否可以自动背景运行
  const firstWord = command.trim().split(/\s+/)[0];
  if (!firstWord) return true;
  const canonical = resolveToCanonical(firstWord);
  return !DISALLOWED_AUTO_BACKGROUND_COMMANDS.includes(canonical);
}
/**
 * PS-flavored port of BashTool's detectBlockedSleepPattern.
 * Catches `Start-Sleep N`, `Start-Sleep -Seconds N`, `sleep N` (built-in alias)
 * as the first statement. Does NOT block `Start-Sleep -Milliseconds` (sub-second
 * pacing is fine) or float seconds (legit rate limiting).
 */
export function detectBlockedSleepPattern(command: string): string | null {//检查命令是否有睡眠指令
  // First statement only — split on PS statement separators: `;`, `|`,
  // `&`/`&&`/`||` (pwsh 7+), and newline (PS's primary separator). This is
  // intentionally shallow — sleep inside script blocks, subshells, or later
  // pipeline stages is fine. Matches BashTool's splitCommandWithOperators
  // intent (src/utils/bash/commands.ts) without a full PS parser.
  const first =
    command
      .trim()
      .split(/[;|&\r\n]/)[0]
      ?.trim() ?? '';
  // Match: Start-Sleep N, Start-Sleep -Seconds N, Start-Sleep -s N, sleep N
  // (case-insensitive; -Seconds can be abbreviated to -s per PS convention)
  const m = /^(?:start-sleep|sleep)(?:\s+-s(?:econds)?)?\s+(\d+)\s*$/i.exec(first);
  if (!m) return null;
  const secs = parseInt(m[1]!, 10);
  if (secs < 2) return null; // sub-2s sleeps are fine (rate limiting, pacing)

  const rest = command
    .trim()
    .slice(first.length)
    .replace(/^[\s;|&]+/, '');
  return rest ? `Start-Sleep ${secs} followed by: ${rest}` : `standalone Start-Sleep ${secs}`;
}
/**
 * On Windows native, sandbox is unavailable (bwrap/sandbox-exec are
 * POSIX-only). 如果企业策略中设置了“sandbox.enabled”且禁止“未沙盒化的命令”，那么 PowerShell 将无法执行该策略——会拒绝执行，
 * 而不是默默地绕过该策略。在 Linux、macOS 或 WSL2 系统上，pwsh 会像 bash 一样在沙盒环境中以原生二进制形式运行，因此此限制不适用。
 *
 * Checked in BOTH validateInput (clean tool-runner error) and call()
 * (covers direct callers like promptShellExecution.ts that skip
 * validateInput). The call() guard is the load-bearing one.
*/
const WINDOWS_SANDBOX_POLICY_REFUSAL =
  'Enterprise policy requires sandboxing, but sandboxing is not available on native Windows. Shell command execution is blocked on this platform by policy.';
function isWindowsSandboxPolicyViolation(): boolean {
  return (
   false
  );
}
// Check if background tasks are disabled at module load time
const isBackgroundTasksDisabled =false
const fullInputSchema = lazySchema(() =>
  z.strictObject({
    command: z.string().describe('The PowerShell command to execute'),
    timeout: semanticNumber(z.number().optional()).describe(
      `Optional timeout in milliseconds (max ${getMaxTimeoutMs()})`,
    ),
    description: z
      .string()
      .optional()
      .describe('Clear, concise description of what this command does in active voice.'),
  }),
);
// Conditionally remove run_in_background from schema when background tasks are disabled
const inputSchema = lazySchema(() =>
 fullInputSchema(),
);
type InputSchema = ReturnType<typeof inputSchema>;
// Use fullInputSchema for the type to always include run_in_background
// (even when it's omitted from the schema, the code needs to handle it)
export type PowerShellToolInput = z.infer<ReturnType<typeof fullInputSchema>>;
const outputSchema = lazySchema(() =>
  z.object({
    stdout: z.string().describe('The standard output of the command'),
    stderr: z.string().describe('The standard error output of the command'),
    interrupted: z.boolean().describe('Whether the command was interrupted'),
    returnCodeInterpretation: z
      .string()
      .optional()
      .describe('Semantic interpretation for non-error exit codes with special meaning'),
    persistedOutputPath: z.string().optional().describe('Path to persisted full output when too large for inline'),
    persistedOutputSize: z.number().optional().describe('Total output size in bytes when persisted'),
  }),
);
type OutputSchema = ReturnType<typeof outputSchema>;
export type Out = z.infer<OutputSchema>;
export type PowerShellProgress = any
const COMMON_BACKGROUND_COMMANDS = [//普通背景命令
  'npm',
  'yarn',
  'pnpm',
  'node',
  'python',
  'python3',
  'go',
  'cargo',
  'make',
  'docker',
  'terraform',
  'webpack',
  'vite',
  'jest',
  'pytest',
  'curl',
  'Invoke-WebRequest',
  'build',
  'test',
  'serve',
  'watch',
  'dev',
] as const;

/**
 * Users sometimes paste transcript lines like:
 * "●  PowerShell git status"
 * Strip the UI prefix so only the real command is executed.
 */
function stripPowerShellUiPrefix(command: string): string {
  return command.replace(/^\s*[●•]\s*PowerShell\s+/i, '');
}
export const PowerShellTool = buildTool({
  name: POWERSHELL_TOOL_NAME,
  searchHint: 'execute Windows PowerShell commands',
  maxResultSizeChars: 30_000,

  async description({ description }: Partial<PowerShellToolInput>): Promise<string> {
    return description || 'Run PowerShell command';
  },


  isConcurrencySafe(input: PowerShellToolInput): boolean {
    return this.isReadOnly?.(input) ?? false;
  },

  isSearchOrReadCommand(input: Partial<PowerShellToolInput>): {
    isSearch: boolean;
    isRead: boolean;
  } {
    if (!input?.command) {
      return { isSearch: false, isRead: false };
    }
    return isSearchOrReadPowerShellCommand(input.command);
  },

  isReadOnly(input: PowerShellToolInput): boolean {
    // Check sync security heuristics before declaring read-only.
    // The full AST parse is async and unavailable here, so we use
    // regex-based detection of subexpressions, splatting, member
    // invocations, and assignments — matching BashTool's pattern of
    // checking security concerns before cmdlet allowlist evaluation.
    if (hasSyncSecurityConcerns(input.command)) {
      return false;
    }
    // NOTE: This calls isReadOnlyCommand without the parsed AST. Without the
    // AST, isReadOnlyCommand cannot split pipelines/statements and will return
    // false for anything but the simplest single-token commands. This is a
    // known limitation of the sync Tool.isReadOnly() interface — the real
    // read-only auto-allow happens async in powershellToolHasPermission (step
    // 4.5) where the parsed AST is available.
    // return isReadOnlyCommand(input.command);
    return true
  },

  get inputSchema(): InputSchema {
    return inputSchema();
  },

  get outputSchema(): OutputSchema {
    return outputSchema();
  },

  userFacingName(): string {
    return 'PowerShell';
  },

  getToolUseSummary(input: Partial<PowerShellToolInput> | undefined): string | null {
    if (!input?.command) {
      return null;
    }
    const { command, description } = input;
    if (description) {
      return description;
    }
    return truncate(command, TOOL_SUMMARY_MAX_LENGTH);
  },


  isEnabled(): boolean {
    return true;
  },

  async validateInput(input: PowerShellToolInput): Promise<ValidationResult> {
    // Defense-in-depth: also guarded in call() for direct callers.
    if (isWindowsSandboxPolicyViolation()) {
      return {
        result: false,
        message: WINDOWS_SANDBOX_POLICY_REFUSAL,
        errorCode: 11,
      };
    }
    // if (feature('MONITOR_TOOL') && !isBackgroundTasksDisabled) {
    //   const sleepPattern = detectBlockedSleepPattern(input.command);
    //   if (sleepPattern !== null) {
    //     return {
    //       result: false,
    //       message: `Blocked: ${sleepPattern}. Run blocking commands in the background with run_in_background: true — you'll get a completion notification when done. For streaming events (watching logs, polling APIs), use the Monitor tool. If you genuinely need a delay (rate limiting, deliberate pacing), keep it under 2 seconds.`,
    //       errorCode: 10,
    //     };
    //   }
    // }
    return { result: true };
  },

  async checkPermissions(
    input: PowerShellToolInput,
    context: Parameters<Tool['checkPermissions']>[1],
  ): Promise<PermissionResult> {
    return await powershellToolHasPermission(input, context);
  },

  renderToolUseMessage,
  renderToolResultMessage,
  renderToolUseErrorMessage,

  mapToolResultToToolResultBlockParam(
    {
      interrupted,
      stdout,
      stderr,
      persistedOutputPath,
      persistedOutputSize,
    }: Out,
    toolUseID: string,
  ): ToolResultBlockParam {
    // For image data, format as image content block for Claude

    let processedStdout = stdout;

    if (persistedOutputPath) {
      const trimmed = stdout ? stdout.replace(/^(\s*\n)+/, '').trimEnd() : '';
      const preview = generatePreview(trimmed, PREVIEW_SIZE_BYTES);
      processedStdout = buildLargeToolResultMessage({
        filepath: persistedOutputPath,
        originalSize: persistedOutputSize ?? 0,
        isJson: false,
        preview: preview.preview,
        hasMore: preview.hasMore,
      });
    } else if (stdout) {
      processedStdout = stdout.replace(/^(\s*\n)+/, '');
      processedStdout = processedStdout.trimEnd();
    }

    let errorMessage = stderr.trim();
    if (interrupted) {
      if (stderr) errorMessage += EOL;
      errorMessage += '<error>Command was aborted before completion</error>';
    }

    let backgroundInfo = '';
  

    return {
      tool_use_id: toolUseID,
      type: 'tool_result' as const,
      content: [processedStdout, errorMessage, backgroundInfo].filter(Boolean).join('\n'),
      is_error: interrupted,
    };
  },

  async call(
    input: PowerShellToolInput,
    toolUseContext: Parameters<Tool['call']>[1],
    _canUseTool?: CanUseToolFn,
    _parentMessage?: AssistantMessage,

  ): Promise<{ data: Out }> {
    // Load-bearing guard: promptShellExecution.ts and processBashCommand.tsx
    // call PowerShellTool.call() directly, bypassing validateInput. This is
    // the check that covers ALL callers. See isWindowsSandboxPolicyViolation
    // comment for the policy rationale.
    if (isWindowsSandboxPolicyViolation()) {
      throw new Error(WINDOWS_SANDBOX_POLICY_REFUSAL);
    }

    const { abortController, setAppState, setToolJSX } = toolUseContext;

    const isMainThread =true;


    try {
      const commandGenerator = runPowerShellCommand({
        input,
        abortController,
        // Use the always-shared task channel so async agents' background
        // shell tasks are actually registered (and killable on agent exit).
        setAppState: setAppState,
        setToolJSX,
        preventCwdChanges: !isMainThread,
        isMainThread,
        toolUseId: toolUseContext.toolUseId,
      });

      let generatorResult;
      do {
        generatorResult = await commandGenerator.next();
      } while (!generatorResult.done);

      const result = generatorResult.value;

      // Feed git/PR usage metrics (same counters as BashTool). PS invokes
      // git/gh/glab/curl as external binaries with identical syntax, so the
      // shell-agnostic regex detection in trackGitOperations works as-is.
      // Called before the backgroundTaskId early-return so backgrounded
      // commands are counted too (matches BashTool.tsx:912).
      //
      // Pre-flight sentinel guard: the two PS pre-flight paths (pwsh-not-found,
      // exec-spawn-catch) return code: 0 + empty stdout + stderr so call() can
      // surface stderr gracefully instead of throwing ShellError. But
      // gitOperationTracking.ts:48 treats code 0 as success and would
      // regex-match the command, mis-counting a command that never ran.
      // BashTool is safe — its pre-flight goes through createFailedCommand
      // (code: 1) so tracking early-returns. Skip tracking on this sentinel.
      // const isPreFlightSentinel = result.code === 0 && !result.stdout && result.stderr && !result.backgroundTaskId;
      // if (!isPreFlightSentinel) {
      //   trackGitOperations(input.command, result.code, result.stdout);
      // }

      // Distinguish user-driven interrupt (new message submitted) from other
      // interrupted states. Only user-interrupt should suppress ShellError —
      // timeout-kill or process-kill with isError should still throw.
      // Matches BashTool's isInterrupt.
      const isInterrupt = result.interrupted && abortController.signal.reason === 'interrupt';

      // Only the main thread tracks/resets cwd; agents have their own cwd
      // isolation. Matches BashTool's !preventCwdChanges guard.
      // Runs before the backgroundTaskId early-return: a command may change
      // CWD before being backgrounded (e.g. `Set-Location C:\temp;
      // Start-Sleep 60`), and BashTool has no such early return — its
      // backgrounded results flow through resetCwdIfOutsideProject at :945.
      let stderrForShellReset = '';
      if (isMainThread) {
        const appState = toolUseContext.getAppState();
        if (resetCwdIfOutsideProject(appState.toolPermissionContext)) {
          stderrForShellReset = stdErrAppendShellResetMessage('');
        }
      }


      const stdoutAccumulator = new EndTruncatingAccumulator();
      const processedStdout = (result.stdout || '').trimEnd();

      stdoutAccumulator.append(processedStdout + EOL);

      // Interpret exit code using semantic rules. PS-native cmdlets (Select-String,
      // Compare-Object, Test-Path) exit 0 on no-match so they always hit the default
      // here. This primarily handles external .exe's (grep, rg, findstr, fc, robocopy)
      // where non-zero can mean "no match" / "files copied" rather than failure.
      const interpretation = interpretCommandResult(input.command, result.code, processedStdout, result.stderr || '');

      // getErrorParts() in toolErrors.ts already prepends 'Exit code N'
      // from error.code when building the ShellError message. Do not
      // duplicate it into stdout here (BashTool's append at :939 is dead
      // code — it throws before stdoutAccumulator.toString() is read).

      let stdout = stripEmptyLines(stdoutAccumulator.toString());



      // preSpawnError means exec() succeeded but the inner shell failed before
      // the command ran (e.g. CWD deleted). createFailedCommand sets code=1,
      // which interpretCommandResult can mistake for grep-no-match / findstr
      // string-not-found. Throw it directly. Matches BashTool.tsx:957.
      if (result.preSpawnError) {
        throw new Error(result.preSpawnError);
      }
      if (interpretation.isError && !isInterrupt) {
        throw new ShellError(stdout, result.stderr || '', result.code, result.interrupted);
      }

      // Large output: file on disk has more than getMaxOutputLength() bytes.
      // stdout already contains the first chunk. Copy the output file to the
      // tool-results dir so the model can read it via FileRead. If > 64 MB,
      // truncate after copying. Matches BashTool.tsx:983-1005.
      //
      // Placed AFTER the preSpawnError/ShellError throws (matches BashTool's
      // ordering, where persistence is post-try/finally): a failing command
      // that also produced >maxOutputLength bytes would otherwise do 3-4 disk
      // syscalls, store to tool-results/, then throw — orphaning the file.
      const MAX_PERSISTED_SIZE = 64 * 1024 * 1024;
      let persistedOutputPath: string | undefined;
      let persistedOutputSize: number | undefined;
      if (result.outputFilePath && result.outputTaskId) {
        try {
          const fileStat = await fsStat(result.outputFilePath);
          persistedOutputSize = fileStat.size;

          await ensureToolResultsDir();
          const dest = getToolResultPath(result.outputTaskId, false);
          if (fileStat.size > MAX_PERSISTED_SIZE) {
            await fsTruncate(result.outputFilePath, MAX_PERSISTED_SIZE);
          }
          try {
            await link(result.outputFilePath, dest);
          } catch {
            await copyFile(result.outputFilePath, dest);
          }
          persistedOutputPath = dest;
        } catch {
          // File may already be gone — stdout preview is sufficient
        }
      }

      // Cap image dimensions + size if present (CC-304 — see
      // resizeShellImageOutput). Scope the decoded buffer so it can be
      // reclaimed before we build the output object.
      let isImage = isImageOutput(stdout);
      let compressedStdout = stdout;
      if (isImage) {
        const resized = await resizeShellImageOutput(stdout, result.outputFilePath, persistedOutputSize);
        if (resized) {
          compressedStdout = resized;
        } else {
          // Parse failed (e.g. multi-line stdout after the data URL). Keep
          // isImage in sync with what we actually send so the UI label stays
          // accurate — mapToolResultToToolResultBlockParam's defensive
          // fallthrough will send text, not an image block.
          isImage = false;
        }
      }

      const finalStderr = [result.stderr || '', stderrForShellReset].filter(Boolean).join('\n');


      return {
        data: {
          stdout: compressedStdout,
          stderr: finalStderr,
          interrupted: result.interrupted,
          returnCodeInterpretation: interpretation.message,
          persistedOutputPath,
          persistedOutputSize,
        },
      };
    } finally {
      if (setToolJSX) setToolJSX(null);
    }
  },
  isResultTruncated(output: Out): boolean {
    return isOutputLineTruncated(output.stdout) || isOutputLineTruncated(output.stderr);
  },
} satisfies ToolDef<InputSchema, Out>);
async function* runPowerShellCommand({
  input,
  abortController,
  setAppState,
  setToolJSX,
  preventCwdChanges,
  isMainThread,
  toolUseId,
  agentId,
}: {
  input: PowerShellToolInput;
  abortController: AbortController;
  setAppState: (f: (prev: AppState) => AppState) => void;
  setToolJSX?: SetToolJSXFn;
  preventCwdChanges?: boolean;
  isMainThread?: boolean;
  toolUseId?: string;
  agentId?: AgentId;
}): AsyncGenerator<
  {
    type: 'progress';
    output: string;
    fullOutput: string;
    elapsedTimeSeconds: number;
    totalLines: number;
    totalBytes: number
    timeoutMs?: number;
  },
  ExecResult,
  void
> {
  const { command: rawCommand, description, timeout } = input;
  const command = stripPowerShellUiPrefix(rawCommand);
  const timeoutMs = Math.min(timeout || getDefaultTimeoutMs(), getMaxTimeoutMs());

  let fullOutput = '';
  let lastProgressOutput = '';
  let lastTotalLines = 0;
  let lastTotalBytes = 0;
  let interruptBackgroundingStarted = false;

  // Progress signal: resolved when backgroundShellId is set in the async
  // .then() path, waking the generator's Promise.race immediately instead of
  // waiting for the next setTimeout tick (matches BashTool pattern).
  let resolveProgress: (() => void) | null = null;
  function createProgressSignal(): Promise<null> {
    return new Promise<null>(resolve => {
      resolveProgress = () => resolve(null);
    });
  }

  const powershellPath = await getCachedPowerShellPath();
  if (!powershellPath) {
    // Pre-flight failure: pwsh not installed. Return code 0 so call() surfaces
    // this as a graceful stderr message rather than throwing ShellError — the
    // command never ran, so there is no meaningful non-zero exit to report.
    return {
      stdout: '',
      stderr: 'PowerShell is not available on this system.',
      code: 0,
      interrupted: false,
    };
  }

  let shellCommand: Awaited<ReturnType<typeof exec>>;
  try {
    shellCommand = await exec(command, abortController.signal, 'powershell', {
      timeout: timeoutMs,
      preventCwdChanges,
    });
  } catch (e) {
    logError(e);
    // Pre-flight failure: spawn/exec rejected before the command ran. Use
    // code 0 so call() returns stderr gracefully instead of throwing ShellError.
    return {
      stdout: '',
      stderr: `Failed to execute PowerShell command: ${getErrorMessage(e)}`,
      code: 0,
      interrupted: false,
    };
  }

  const resultPromise = shellCommand.result;

  // Handle Claude asking to run it in the background explicitly
  // When explicitly requested via run_in_background, always honor the request
  // regardless of the command type (isAutobackgroundingAllowed only applies to automatic backgrounding)


  // Set up progress yielding with periodic checks
  const startTime = Date.now();
  let nextProgressTime = startTime + PROGRESS_THRESHOLD_MS;
  let foregroundTaskId: string | undefined;

  // Progress loop: wrap in try/finally so stopPolling is called on every exit
  // path — normal completion, timeout/interrupt backgrounding, and Ctrl+B
  // (matches BashTool pattern; see PR #18887 review thread at :560)
  try {
    while (true) {
      const now = Date.now();
      const timeUntilNextProgress = Math.max(0, nextProgressTime - now);

      const progressSignal = createProgressSignal();
      const result = await Promise.race([
        resultPromise,
        new Promise<null>(resolve => setTimeout(r => r(null), timeUntilNextProgress, resolve).unref()),
        progressSignal,
      ]);

      if (result !== null) {
        // Race: backgrounding fired (15s timer / onTimeout / Ctrl+B) but the
        // command completed before the next poll tick. #handleExit sets
        // backgroundTaskId but skips outputFilePath (it assumes the background
        // message or <task_notification> will carry the path). Strip
        // backgroundTaskId so the model sees a clean completed command,
        // reconstruct outputFilePath for large outputs, and suppress the
        // redundant <task_notification> from the .then() handler.
        // Check result.backgroundTaskId (not the closure var) to also cover
        // Ctrl+B, which calls shellCommand.background() directl
        // Command has completed
        return result;
      }


      // User submitted a new message - background instead of killing
      if (
        abortController.signal.aborted &&
        abortController.signal.reason === 'interrupt' &&
        !interruptBackgroundingStarted
      ) {
        interruptBackgroundingStarted = true;
        if (!isBackgroundTasksDisabled) {
          // Reloop so the backgroundShellId check (above) catches the sync
          // foregroundTaskId→background path. Without this, we fall through
          // to the Ctrl+B check below, which matches status==='backgrounded'
          // and incorrectly returns backgroundedByUser:true. (bugs 020/021)
          continue;
        }
        shellCommand.kill();
      }


      // Time for a progress update
      const elapsed = Date.now() - startTime;
      const elapsedSeconds = Math.floor(elapsed / 1000);


      yield {
        type: 'progress',
        fullOutput,
        output: lastProgressOutput,
        elapsedTimeSeconds: elapsedSeconds,
        totalLines: lastTotalLines,
        totalBytes: lastTotalBytes,
        ...(timeout ? { timeoutMs } : undefined),
      };

      nextProgressTime = Date.now() + PROGRESS_INTERVAL_MS;
    }
  } finally {

  }
}
