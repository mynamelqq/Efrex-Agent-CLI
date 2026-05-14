import { z } from 'zod/v4';
import { lazySchema } from '../../utils/lazySchema';
import { semanticNumber } from '../../utils/semanticNumber';
import { buildTool } from '../../Tool';
import { AssistantMessage } from 'src/package/message';
import { BASH_TOOL_NAME } from './toolName';
import { detectFileEncoding } from '../../utils/file';
import { TOOL_SUMMARY_MAX_LENGTH } from '../../constants/toolLimits';
import { copyFile, stat as fsStat, truncate as fsTruncate, link } from 'fs/promises';
import { ToolDef } from '../../Tool';
import { ExecResult } from '../../utils/ShellCommand';
import { getDefaultBashTimeoutMs, getMaxBashTimeoutMs } from '../../utils/timeouts';
import { isENOENT } from '../../utils/errors';
import {readFile}from "fs/promises"
import { ToolUseContext } from '../../Tool';
import { truncate } from '../../utils/format.js';
import { expandPath } from '../../utils/path.js';
import { DESCRIPTION } from '../GlobTool/prompt';
const EOL = '\n';

// Progress display constants
const PROGRESS_THRESHOLD_MS = 2000; // Show progress after 2 seconds

// Search commands for collapsible display (grep, find, etc.)
const BASH_SEARCH_COMMANDS = new Set(['find', 'grep', 'rg', 'ag', 'ack', 'locate', 'which', 'whereis']);

// Read/view commands for collapsible display (cat, head, etc.)
const BASH_READ_COMMANDS = new Set(['cat', 'head', 'tail', 'less', 'more',
// Analysis commands
'wc', 'stat', 'file', 'strings',
// Data processing — commonly used to parse/transform file content in pipes
'jq', 'awk', 'cut', 'sort', 'uniq', 'tr']);

// Directory-listing commands for collapsible display (ls, tree, du).
// Split from BASH_READ_COMMANDS so the summary says "Listed N directories"
// instead of the misleading "Read N files".
const BASH_LIST_COMMANDS = new Set(['ls', 'tree', 'du']);

// Commands that are semantic-neutral in any position — pure output/status commands
// that don't change the read/search nature of the overall pipeline.
// e.g. `ls dir && echo "---" && ls dir2` is still a read-only compound command.
const BASH_SEMANTIC_NEUTRAL_COMMANDS = new Set(['echo', 'printf', 'true', 'false', ':' // bash no-op
]);

// Commands that typically produce no stdout on success
const BASH_SILENT_COMMANDS = new Set(['mv', 'cp', 'rm', 'mkdir', 'rmdir', 'chmod', 'chown', 'chgrp', 'touch', 'ln', 'cd', 'export', 'unset', 'wait']);

const fullInputSchema = lazySchema(() => z.strictObject({
  command: z.string().describe('The command to execute'),
  timeout: semanticNumber(z.number().optional()).describe(`Optional timeout in milliseconds (max ${getMaxBashTimeoutMs})`),
  description: z.string().optional().describe(`Clear, concise description of what this command does in active voice. Never use words like "complex" or "risk" in the description - just describe what it does.
For simple commands (git, npm, standard CLI tools), keep it brief (5-10 words):
- ls → "List files in current directory"
- git status → "Show working tree status"
- npm install → "Install package dependencies"

For commands that are harder to parse at a glance (piped commands, obscure flags, etc.), add enough context to clarify what it does:
- find . -name "*.tmp" -exec rm {} \\; → "Find and delete all .tmp files recursively"
- git reset --hard origin/main → "Discard all local changes and match remote main"
- curl -s url | jq '.data[]' → "Fetch JSON from URL and extract data array elements"`),
//   dangerouslyDisableSandbox: semanticBoolean(z.boolean().optional()).describe('Set this to true to dangerously override sandbox mode and run commands without sandboxing.'),
//沙箱禁用  
_simulatedSedEdit: z.object({
    filePath: z.string(),
    newContent: z.string()
  }).optional().describe('Internal: pre-computed sed edit result from preview')
}));
const outputSchema = lazySchema(() => z.object({
  stdout: z.string().describe('The standard output of the command'),
  stderr: z.string().describe('The standard error output of the command'),
  rawOutputPath: z.string().optional().describe('Path to raw output file for large MCP tool outputs'),
  interrupted: z.boolean().describe('Whether the command was interrupted'),
  isImage: z.boolean().optional().describe('Flag to indicate if stdout contains image data'),
  dangerouslyDisableSandbox: z.boolean().optional().describe('Flag to indicate if sandbox mode was overridden'),
  returnCodeInterpretation: z.string().optional().describe('Semantic interpretation for non-error exit codes with special meaning'),
  noOutputExpected: z.boolean().optional().describe('Whether the command is expected to produce no output on success'),
  structuredContent: z.array(z.any()).optional().describe('Structured content blocks'),
  persistedOutputPath: z.string().optional().describe('Path to the persisted full output in tool-results dir (set when output is too large for inline)'),
  persistedOutputSize: z.number().optional().describe('Total size of the output in bytes (set when output is too large for inline)')
}));
type OutputSchema = ReturnType<typeof outputSchema>;
export type Out = z.infer<OutputSchema>;
const inputSchema = lazySchema(() => fullInputSchema().omit({
  _simulatedSedEdit: true

}));
type InputSchema = ReturnType<typeof inputSchema>;
export type BashToolInput = z.infer<ReturnType<typeof fullInputSchema>>;
/**
 * Checks if a bash command is a search or read operation.
 * Used to determine if the command should be collapsed in the UI.
 * Returns an object indicating whether it's a search or read operation.
 *
 * For pipelines (e.g., `cat file | bq`), ALL parts must be search/read commands
 * for the whole command to be considered collapsible.
 *
 * Semantic-neutral commands (echo, printf, true, false, :) are skipped in any
 * position, as they're pure output/status commands that don't affect the read/search
 * nature of the pipeline (e.g. `ls dir && echo "---" && ls dir2` is still a read).
 */
export function isSearchOrReadBashCommand(command: string): {//如果是搜索或者阅读，那么需要判断然后方便在前端展示
  isSearch: boolean;
  isRead: boolean;
  isList: boolean;
} {
  let partsWithOperators: string[];
  try {
    partsWithOperators = splitCommandWithOperators(command);
  } catch {
    // If we can't parse the command due to malformed syntax,
    // it's not a search/read command
    return {
      isSearch: false,
      isRead: false,
      isList: false
    };
  }
  if (partsWithOperators.length === 0) {
    return {
      isSearch: false,
      isRead: false,
      isList: false
    };
  }
  let hasSearch = false;
  let hasRead = false;
  let hasList = false;
  let hasNonNeutralCommand = false;
  let skipNextAsRedirectTarget = false;
  for (const part of partsWithOperators) {
    if (skipNextAsRedirectTarget) {
      skipNextAsRedirectTarget = false;
      continue;
    }
    if (part === '>' || part === '>>' || part === '>&') {
      skipNextAsRedirectTarget = true;
      continue;
    }
    if (part === '||' || part === '&&' || part === '|' || part === ';') {
      continue;
    }
    const baseCommand = part.trim().split(/\s+/)[0];
    if (!baseCommand) {
      continue;
    }
    if (BASH_SEMANTIC_NEUTRAL_COMMANDS.has(baseCommand)) {
      continue;
    }
    hasNonNeutralCommand = true;
    const isPartSearch = BASH_SEARCH_COMMANDS.has(baseCommand);
    const isPartRead = BASH_READ_COMMANDS.has(baseCommand);
    const isPartList = BASH_LIST_COMMANDS.has(baseCommand);
    if (!isPartSearch && !isPartRead && !isPartList) {
      return {
        isSearch: false,
        isRead: false,
        isList: false
      };
    }
    if (isPartSearch) hasSearch = true;
    if (isPartRead) hasRead = true;
    if (isPartList) hasList = true;
  }

  // Only neutral commands (e.g., just "echo foo") -- not collapsible
  if (!hasNonNeutralCommand) {
    return {
      isSearch: false,
      isRead: false,
      isList: false
    };
  }
  return {
    isSearch: hasSearch,
    isRead: hasRead,
    isList: hasList
  };
}

/**
 * Checks if a bash command is expected to produce no stdout on success.
 * Used to show "Done" instead of "(No output)" in the UI.
 */
function isSilentBashCommand(command: string): boolean {
  let partsWithOperators: string[];
  try {
    partsWithOperators = splitCommandWithOperators(command);
  } catch {
    return false;
  }
  if (partsWithOperators.length === 0) {
    return false;
  }
  let hasNonFallbackCommand = false;
  let lastOperator: string | null = null;
  let skipNextAsRedirectTarget = false;
  for (const part of partsWithOperators) {
    if (skipNextAsRedirectTarget) {
      skipNextAsRedirectTarget = false;
      continue;
    }
    if (part === '>' || part === '>>' || part === '>&') {
      skipNextAsRedirectTarget = true;
      continue;
    }
    if (part === '||' || part === '&&' || part === '|' || part === ';') {
      lastOperator = part;
      continue;
    }
    const baseCommand = part.trim().split(/\s+/)[0];
    if (!baseCommand) {
      continue;
    }
    if (lastOperator === '||' && BASH_SEMANTIC_NEUTRAL_COMMANDS.has(baseCommand)) {
      continue;
    }
    hasNonFallbackCommand = true;
    if (!BASH_SILENT_COMMANDS.has(baseCommand)) {
      return false;
    }
  }
  return hasNonFallbackCommand;
}
/**
 * Detect standalone or leading `sleep N` patterns that should use Monitor
 * instead. Catches `sleep 5`, `sleep 5 && check`, `sleep 5; check` — but
 * not sleep inside pipelines, subshells, or scripts (those are fine).
 */
export function detectBlockedSleepPattern(command: string): string | null {
  const parts = splitCommand_DEPRECATED(command);
  if (parts.length === 0) return null;
  const first = parts[0]?.trim() ?? '';
  // Bare `sleep N` or `sleep N.N` as the first subcommand.
  // Float durations (sleep 0.5) are allowed — those are legit pacing, not polls.
  const m = /^sleep\s+(\d+)\s*$/.exec(first);
  if (!m) return null;
  const secs = parseInt(m[1]!, 10);
  if (secs < 2) return null; // sub-2s sleeps are fine (rate limiting, pacing)

  // `sleep N` alone → "what are you waiting for?"
  // `sleep N && check` → "use Monitor { command: check }"
  const rest = parts.slice(1).join(' ').trim();
  return rest ? `sleep ${secs} followed by: ${rest}` : `standalone sleep ${secs}`;
}

/**
 * Checks if a command contains tools that shouldn't run in sandbox
 * This includes:
 * - Dynamic config-based disabled commands and substrings (tengu_sandbox_disabled_commands)
 * - User-configured commands from settings.json (sandbox.excludedCommands)
 *
 * User-configured commands support the same pattern syntax as permission rules:
 * - Exact matches: "npm run lint"
 * - Prefix patterns: "npm run test:*"
 */

type SimulatedSedEditResult = {
  data: Out;
};
type SimulatedSedEditContext = Pick<ToolUseContext, 'readFileState' | 'updateFileHistoryState'>;

/**
 * Applies a simulated sed edit directly instead of running sed.
 * This is used by the permission dialog to ensure what the user previews
 * is exactly what gets written to the file.
 */
async function applySedEdit(simulatedEdit: {
  filePath: string;
  newContent: string;
}, toolUseContext: SimulatedSedEditContext, parentMessage?: AssistantMessage): Promise<SimulatedSedEditResult> {
  const {
    filePath,
    newContent
  } = simulatedEdit;
  const absoluteFilePath = expandPath(filePath);

  // Read original content for VS Code notification
  const encoding = detectFileEncoding(absoluteFilePath);
  let originalContent: string;
  try {
    originalContent = await readFile(absoluteFilePath, {
      encoding
    });
  } catch (e) {
    if (isENOENT(e)) {
      return {
        data: {
          stdout: '',
          stderr: `sed: ${filePath}: No such file or directory\nExit code 1`,
          interrupted: false
        }
      };
    }
    throw e;
  }

  // Track file history before making changes (for undo support)
  if (fileHistoryEnabled() && parentMessage) {
    await fileHistoryTrackEdit(toolUseContext.updateFileHistoryState, absoluteFilePath, parentMessage.uuid);
  }

  // Detect line endings and write new content
  const endings = detectLineEndings(absoluteFilePath);
  writeTextContent(absoluteFilePath, newContent, encoding, endings);

  // Notify VS Code about the file change
  notifyVscodeFileUpdated(absoluteFilePath, originalContent, newContent);

  // Update read timestamp to invalidate stale writes
  toolUseContext.readFileState.set(absoluteFilePath, {
    content: newContent,
    timestamp: getFileModificationTime(absoluteFilePath),
    offset: undefined,
    limit: undefined
  });

  // Return success result matching sed output format (sed produces no output on success)
  return {
    data: {
      stdout: '',
      stderr: '',
      interrupted: false
    }
  };
}
export const BashTool = buildTool({
  name: BASH_TOOL_NAME,
  searchHint: 'execute shell commands',
  // 30K chars - tool result persistence threshold
  maxResultSizeChars: 30_000,
  async description() {
    return DESCRIPTION || 'Run shell command';
  },
  isConcurrencySafe(input) {
    return this.isReadOnly?.(input) ?? false;
  },
  isReadOnly(input) {
    const compoundCommandHasCd = commandHasAnyCd(input.command);
    const result = checkReadOnlyConstraints(input, compoundCommandHasCd);
    return result.behavior === 'allow';
  },
  get inputSchema(): InputSchema {
    return inputSchema();
  },
  get outputSchema(): OutputSchema {
    return outputSchema();
  },
  userFacingName(input) {
    if (!input) {
      return 'Bash';
    }
    // Render sed in-place edits as file edits
    if (input.command) {
      const sedInfo = parseSedEditCommand(input.command);
      if (sedInfo) {
        return fileEditUserFacingName({
          file_path: sedInfo.filePath,
          old_string: 'x'
        });
      }
    }
    // Env var FIRST: shouldUseSandbox → splitCommand_DEPRECATED → shell-quote's
    // `new RegExp` per call. userFacingName runs per-render for every bash
    // message in history; with ~50 msgs + one slow-to-tokenize command, this
    // exceeds the shimmer tick → transition abort → infinite retry (#21605).
    return isEnvTruthy(process.env.CLAUDE_CODE_BASH_SANDBOX_SHOW_INDICATOR) && shouldUseSandbox(input) ? 'SandboxedBash' : 'Bash';
  },
  getToolUseSummary(input) {
    if (!input?.command) {
      return null;
    }
    const {
      command,
      description
    } = input;
    if (description) {
      return description;
    }
    return truncate(command, TOOL_SUMMARY_MAX_LENGTH);
  },
  async call(input: BashToolInput, toolUseContext: ToolUseContext) {
    // Handle simulated sed edit - apply directly instead of running sed
    // This ensures what the user previewed is exactly what gets written
    if (input._simulatedSedEdit) {
      return applySedEdit(input._simulatedSedEdit, toolUseContext, parentMessage);
    }
    const {
      abortController,
      getAppState,
      setToolJSX
    } = toolUseContext;
    const stdoutAccumulator = new EndTruncatingAccumulator();
    let stderrForShellReset = '';
    let interpretationResult: ReturnType<typeof interpretCommandResult> | undefined;
    let progressCounter = 0;
    let wasInterrupted = false;
    let result: ExecResult;
    const isMainThread = !toolUseContext.agentId;
    const preventCwdChanges = !isMainThread;
    try {
      // Use the new async generator version of runShellCommand
      const commandGenerator = runShellCommand({
        input,
        abortController,
        preventCwdChanges,
      });

      // Consume the generator and capture the return value
      let generatorResult;
      do {
        generatorResult = await commandGenerator.next();
        if (!generatorResult.done && onProgress) {
          const progress = generatorResult.value;
          onProgress({
            toolUseID: `bash-progress-${progressCounter++}`,
            data: {
              type: 'bash_progress',
              output: progress.output,
              fullOutput: progress.fullOutput,
              elapsedTimeSeconds: progress.elapsedTimeSeconds,
              totalLines: progress.totalLines,
              totalBytes: progress.totalBytes,
              taskId: progress.taskId,
              timeoutMs: progress.timeoutMs
            }
          });
        }
      } while (!generatorResult.done);

      // Get the final result from the generator's return value
      result = generatorResult.value;
      trackGitOperations(input.command, result.code, result.stdout);
      const isInterrupt = result.interrupted && abortController.signal.reason === 'interrupt';

      // stderr is interleaved in stdout (merged fd) — result.stdout has both
      stdoutAccumulator.append((result.stdout || '').trimEnd() + EOL);

      // Interpret the command result using semantic rules
      interpretationResult = interpretCommandResult(input.command, result.code, result.stdout || '', '');

      // Check for git index.lock error (stderr is in stdout now)
      if (result.stdout && result.stdout.includes(".git/index.lock': File exists")) {
        logEvent('tengu_git_index_lock_error', {});
      }
      if (interpretationResult.isError && !isInterrupt) {
        // Only add exit code if it's actually an error
        if (result.code !== 0) {
          stdoutAccumulator.append(`Exit code ${result.code}`);
        }
      }
      if (!preventCwdChanges) {
        const appState = getAppState();
        if (resetCwdIfOutsideProject(appState.toolPermissionContext)) {
          stderrForShellReset = stdErrAppendShellResetMessage('');
        }
      }

      // Annotate output with sandbox violations if any (stderr is in stdout)
      const outputWithSbFailures = SandboxManager.annotateStderrWithSandboxFailures(input.command, result.stdout || '');
      if (result.preSpawnError) {
        throw new Error(result.preSpawnError);
      }
      if (interpretationResult.isError && !isInterrupt) {
        // stderr is merged into stdout (merged fd); outputWithSbFailures
        // already has the full output. Pass '' for stdout to avoid
        // duplication in getErrorParts() and processBashCommand.
        throw new ShellError('', outputWithSbFailures, result.code, result.interrupted);
      }
      wasInterrupted = result.interrupted;
    } finally {
      if (setToolJSX) setToolJSX(null);
    }

    // Get final string from accumulator
    const stdout = stdoutAccumulator.toString();

    // Large output: the file on disk has more than getMaxOutputLength() bytes.
    // stdout already contains the first chunk (from getStdout()). Copy the
    // output file to the tool-results dir so the model can read it via
    // FileRead. If > 64 MB, truncate after copying.
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
    const commandType = input.command.split(' ')[0];
    logEvent('tengu_bash_tool_command_executed', {
      command_type: commandType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      stdout_length: stdout.length,
      stderr_length: 0,
      exit_code: result.code,
      interrupted: wasInterrupted
    });

    // Log code indexing tool usage
    const codeIndexingTool = detectCodeIndexingFromCommand(input.command);
    if (codeIndexingTool) {
      logEvent('tengu_code_indexing_tool_used', {
        tool: codeIndexingTool as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        source: 'cli' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        success: result.code === 0
      });
    }
    let strippedStdout = stripEmptyLines(stdout);

    // Claude Code hints protocol: CLIs/SDKs gated on CLAUDECODE=1 emit a
    // `<claude-code-hint />` tag to stderr (merged into stdout here). Scan,
    // record for useClaudeCodeHintRecommendation to surface, then strip
    // so the model never sees the tag — a zero-token side channel.
    // Stripping runs unconditionally (subagent output must stay clean too);
    // only the dialog recording is main-thread-only.
    const extracted = extractClaudeCodeHints(strippedStdout, input.command);
    strippedStdout = extracted.stripped;
    if (isMainThread && extracted.hints.length > 0) {
      for (const hint of extracted.hints) maybeRecordPluginHint(hint);
    }
    let isImage = isImageOutput(strippedStdout);

    // Cap image dimensions + size if present (CC-304 — see
    // resizeShellImageOutput). Scope the decoded buffer so it can be reclaimed
    // before we build the output Out object.
    let compressedStdout = strippedStdout;
    if (isImage) {
      const resized = await resizeShellImageOutput(strippedStdout, result.outputFilePath, persistedOutputSize);
      if (resized) {
        compressedStdout = resized;
      } else {
        // Parse failed or file too large (e.g. exceeds MAX_IMAGE_FILE_SIZE).
        // Keep isImage in sync with what we actually send so the UI label stays
        // accurate — mapToolResultToToolResultBlockParam's defensive
        // fallthrough will send text, not an image block.
        isImage = false;
      }
    }
    const data: Out = {
      stdout: compressedStdout,
      stderr: stderrForShellReset,
      interrupted: wasInterrupted,
      isImage,
      returnCodeInterpretation: interpretationResult?.message,
      noOutputExpected: isSilentBashCommand(input.command),
      dangerouslyDisableSandbox: 'dangerouslyDisableSandbox' in input ? input.dangerouslyDisableSandbox as boolean | undefined : undefined,
      persistedOutputPath,
      persistedOutputSize
    };
    return {
      data
    };
  }
} satisfies ToolDef<InputSchema, Out>);





async function* runShellCommand({
  input,
  abortController,
  preventCwdChanges,
}: {
  input: BashToolInput;
  abortController: AbortController;
  preventCwdChanges?: boolean;
}): AsyncGenerator<{
  type: 'progress';
  output: string;
  fullOutput: string;
  elapsedTimeSeconds: number;
  totalLines: number;
  totalBytes?: number;
  taskId?: string;
  timeoutMs?: number;
}, ExecResult, void> {
  const {
    command,
    timeout,
  } = input;
  const timeoutMs = timeout || getDefaultBashTimeoutMs();
  let fullOutput = '';
  let lastProgressOutput = '';
  let lastTotalLines = 0;
  let lastTotalBytes = 0;

  // Progress signal: resolved by onProgress callback from the shared poller,
  // waking the generator to yield a progress update.
  let resolveProgress: (() => void) | null = null;
  function createProgressSignal(): Promise<null> {
    return new Promise<null>(resolve => {
      resolveProgress = () => resolve(null);
    });
  }


  const shellCommand = await exec(command, abortController.signal, 'bash', {
    timeout: timeoutMs,
    onProgress(lastLines, allLines, totalLines, totalBytes, isIncomplete) {
      lastProgressOutput = lastLines;
      fullOutput = allLines;
      lastTotalLines = totalLines;
      lastTotalBytes = isIncomplete ? totalBytes : 0;
      // Wake the generator so it yields the new progress data
      const resolve = resolveProgress;
      if (resolve) {
        resolveProgress = null;
        resolve();
      }
    },
    preventCwdChanges,
    shouldUseSandbox: shouldUseSandbox(input),
  });

  // Start the command execution
  const resultPromise = shellCommand.result;

  // Wait for the initial threshold before showing progress
  const startTime = Date.now();
  {
    const initialResult = await Promise.race([resultPromise, new Promise<null>(resolve => {
      const t = setTimeout((r: (v: null) => void) => r(null), PROGRESS_THRESHOLD_MS, resolve);
      t.unref();
    })]);
    if (initialResult !== null) {
      shellCommand.cleanup();
      return initialResult;
    }
  }

  // Progress loop: run in the foreground until the command completes.
  try {
    while (true) {
      const progressSignal = createProgressSignal();
      const result = await Promise.race([resultPromise, progressSignal]);
      if (result !== null) {
        // Command has completed - return the actual result
        return result;
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
        taskId: shellCommand.taskOutput.taskId,
        ...(timeout ? {
          timeoutMs
        } : undefined)
      };
    }
  } finally {
    shellCommand.cleanup();
  }
}
