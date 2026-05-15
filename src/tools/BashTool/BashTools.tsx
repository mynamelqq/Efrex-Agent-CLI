import { z } from 'zod/v4';
import { lazySchema } from '../../utils/lazySchema';
import { semanticNumber } from '../../utils/semanticNumber';
import { buildTool } from '../../Tool';
import { AssistantMessage, ToolResultBlockParam } from 'src/package/message';
import { BASH_TOOL_NAME } from './toolName';
import { detectFileEncoding } from '../../utils/file';
import { TOOL_SUMMARY_MAX_LENGTH } from '../../constants/toolLimits';
import { copyFile, stat as fsStat, truncate as fsTruncate, link } from 'fs/promises';
import { ToolDef } from '../../Tool';
import { ExecResult } from '../../utils/ShellCommand';
import { getDefaultBashTimeoutMs, getMaxBashTimeoutMs } from '../../utils/timeouts';
import { isENOENT } from '../../utils/errors';
import { ShellError } from '../../utils/errors';
import { ToolUseContext } from '../../Tool';
import { EndTruncatingAccumulator } from '../../utils/stringUtils';
import { truncate } from '../../utils/format.js';
import { DESCRIPTION } from '../GlobTool/prompt';
import { runShellDemo } from '../../utils/shellDemo.js';
import { interpretCommandResult } from './commandSemantics.js';
import {
  buildLargeToolResultMessage,
  ensureToolResultsDir,
  generatePreview,
  getToolResultPath,
  PREVIEW_SIZE_BYTES,
} from '../../utils/toolResultStorage.js';
import {
	isImageOutput,
	resizeShellImageOutput,
	stdErrAppendShellResetMessage,
	stripEmptyLines,
} from './utils.js';
import {
  renderToolResultMessage,
  renderToolUseErrorMessage,
  renderToolUseMessage,
} from './UI.js';
const EOL = '\n';

const COMMAND_OPERATORS = new Set(['||', '&&', '|', ';', '>', '>>', '>&']);

function splitCommandWithOperators(command: string): string[] {
  return command
    .split(/(\|\||&&|\||;|>>|>&|>)/)
    .map(part => part.trim())
    .filter(Boolean);
}

function splitCommand_DEPRECATED(command: string): string[] {
  return splitCommandWithOperators(command).filter(
    part => !COMMAND_OPERATORS.has(part),
  );
}

function trackGitOperations(
  _command: string,
  _code: number,
  _stdout: string,
): void {}

function resetCwdIfOutsideProject(_context: unknown): boolean {
  return false;
}

const SandboxManager = {
  annotateStderrWithSandboxFailures(
    _command: string,
    output: string,
  ): string {
    return output;
  },
};

function detectCodeIndexingFromCommand(_command: string): null {
  return null;
}

function extractClaudeCodeHints(
  text: string,
  _command: string,
): { stripped: string; hints: string[] } {
  return { stripped: text, hints: [] };
}

function maybeRecordPluginHint(_hint: string): void {}
export function getDefaultTimeoutMs(): number {
  return getDefaultBashTimeoutMs()
}
// 进度显示常量
const PROGRESS_THRESHOLD_MS = 2000; // 2秒后显示进度

// 用于可折叠显示的搜索命令（grep、find 等）
const BASH_SEARCH_COMMANDS = new Set(['find', 'grep', 'rg', 'ag', 'ack', 'locate', 'which', 'whereis']);

// 用于可折叠显示的读取/查看命令（cat、head 等）
const BASH_READ_COMMANDS = new Set(['cat', 'head', 'tail', 'less', 'more',
// 分析命令
'wc', 'stat', 'file', 'strings',
// 数据处理——常用于在管道中解析/转换文件内容
'jq', 'awk', 'cut', 'sort', 'uniq', 'tr']);

// 用于可折叠显示的目录列表命令（ls、tree、du）。
// 从 BASH_READ_COMMANDS 中分离出来，以便摘要显示"列出 N 个目录"
// 而不是误导性的"读取 N 个文件"。
const BASH_LIST_COMMANDS = new Set(['ls', 'tree', 'du']);

// 在任何位置都是语义中性的命令——纯输出/状态命令，
// 不会改变整个管道的读取/搜索性质。
// 例如 `ls dir && echo "---" && ls dir2` 仍然是只读的复合命令。
const BASH_SEMANTIC_NEUTRAL_COMMANDS = new Set(['echo', 'printf', 'true', 'false', ':' // bash 空操作
]);

// 成功时通常不产生 stdout 的命令
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
// _simulatedSedEdit: z.object({
//     filePath: z.string(),
//     newContent: z.string()
//   }).optional().describe('Internal: pre-computed sed edit result from preview')
}));
const outputSchema = lazySchema(() => z.object({
  stdout: z.string().describe('The standard output of the command'),
  stderr: z.string().describe('The standard error output of the command'),
  rawOutputPath: z.string().optional().describe('Path to raw output file for large MCP tool outputs'),
  interrupted: z.boolean().describe('Whether the command was interrupted'),
  isImage: z.boolean().optional().describe('Flag to indicate if stdout contains image data'),
  // dangerouslyDisableSandbox: z.boolean().optional().describe('Flag to indicate if sandbox mode was overridden'),
  returnCodeInterpretation: z.string().optional().describe('Semantic interpretation for non-error exit codes with special meaning'),
  noOutputExpected: z.boolean().optional().describe('Whether the command is expected to produce no output on success'),
  structuredContent: z.array(z.any()).optional().describe('Structured content blocks'),
  persistedOutputPath: z.string().optional().describe('Path to the persisted full output in tool-results dir (set when output is too large for inline)'),
  persistedOutputSize: z.number().optional().describe('Total size of the output in bytes (set when output is too large for inline)')
}));
type OutputSchema = ReturnType<typeof outputSchema>;
export type Out = z.infer<OutputSchema>;
const inputSchema = lazySchema(() => fullInputSchema().omit({
  // _simulatedSedEdit: true
}));
type InputSchema = ReturnType<typeof inputSchema>;
export type BashToolInput = z.infer<ReturnType<typeof fullInputSchema>>;
/**
 * 检查 bash 命令是否为搜索或读取操作。
 * 用于确定该命令是否应在 UI 中折叠显示。
 * 返回一个对象，指示其是否为搜索或读取操作。
 *
 * 对于管道（例如 `cat file | bq`），所有部分都必须是搜索/读取命令，
 * 整个命令才会被视为可折叠。
 *
 * 语义中性命令（echo、printf、true、false、:）在任何位置都会被跳过，
 * 因为它们是纯粹的输出/状态命令，不影响管道的读取/搜索性质
 *（例如 `ls dir && echo "---" && ls dir2` 仍然是读取操作）。
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
    // 如果由于语法错误无法解析命令，
    // 则它不是搜索/读取命令
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

  // 仅包含中性命令（例如，只有 "echo foo"）——不可折叠
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
 * 检查 bash 命令在成功时是否预期不产生 stdout。
 * 用于在 UI 中显示"完成"而不是"（无输出）"。
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
 * 检测应改用 Monitor 的独立或前置 `sleep N` 模式。
 * 捕获 `sleep 5`、`sleep 5 && check`、`sleep 5; check`——但不捕获
 * 管道、子 shell 或脚本内部的 sleep（那些是正常的）。
 */
export function detectBlockedSleepPattern(command: string): string | null {
  const parts = splitCommand_DEPRECATED(command);
  if (parts.length === 0) return null;
  const first = parts[0]?.trim() ?? '';
  // 作为第一个子命令的裸 `sleep N` 或 `sleep N.N`。
  // 允许浮点时长（sleep 0.5）——那些是合法的 pacing，不是轮询。
  const m = /^sleep\s+(\d+)\s*$/.exec(first);
  if (!m) return null;
  const secs = parseInt(m[1]!, 10);
  if (secs < 2) return null; // 2秒以下的 sleep 没问题（速率限制、pacing）

  // 单独的 `sleep N` → "你在等什么？"
  // `sleep N && check` → "使用 Monitor { command: check }"
  const rest = parts.slice(1).join(' ').trim();
  return rest ? `sleep ${secs} followed by: ${rest}` : `standalone sleep ${secs}`;
}

/**
 * 检查命令是否包含不应在沙箱中运行的工具
 * 这包括：
 * - 基于动态配置禁用的命令和子字符串（tengu_sandbox_disabled_commands）
 * - 用户通过 settings.json 配置的命令（sandbox.excludedCommands）
 *
 * 用户配置的命令支持与权限规则相同的模式语法：
 * - 精确匹配："npm run lint"
 * - 前缀模式："npm run test:*"
 */

type SimulatedSedEditResult = {
  data: Out;
};
type SimulatedSedEditContext = Pick<ToolUseContext, 'readFileState' | 'updateFileHistoryState'>;

export const BashTool = buildTool({
  name: BASH_TOOL_NAME,
  searchHint: 'execute shell commands',
  // 3万字符——工具结果持久化阈值
  maxResultSizeChars: 30_000,
  async description() {
    return DESCRIPTION || 'Run shell command';
  },
  isConcurrencySafe(input) {
    return this.isReadOnly?.(input) ?? false;
  },
  isReadOnly(input) {
    return true;
    // const compoundCommandHasCd = commandHasAnyCd(input.command);
    // const result = checkReadOnlyConstraints(input, compoundCommandHasCd);
    // return result.behavior === 'allow';
  },
  get inputSchema(): InputSchema {
    return inputSchema();
  },
  get outputSchema(): OutputSchema {
    return outputSchema();
  },
  renderToolUseMessage,
  renderToolResultMessage,
  renderToolUseErrorMessage,
  userFacingName(input) {
    if (!input) {
      return 'Bash';
    }
    // // 将 sed 就地编辑渲染为文件编辑
    // if (input.command) {
    //   const sedInfo = parseSedEditCommand(input.command);
    //   if (sedInfo) {
    //     return fileEditUserFacingName({
    //       file_path: sedInfo.filePath,
    //       old_string: 'x'
    //     });
    //   }
    // }
    // 环境变量优先：shouldUseSandbox → splitCommand_DEPRECATED → shell-quote 的
    // 每次调用 `new RegExp`。userFacingName 对历史记录中的每条 bash 消息在每次渲染时都会运行；
    // 约 50 条消息 + 一个慢速分词的命令时，
    // 这会超出 shimmer tick → 过渡中止 → 无限重试 (#21605)。
    return 'Bash';//const splitCommand = splitCommand_DEPRECATED
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
    // 处理模拟的 sed 编辑——直接应用而不是运行 sed
    // 这确保用户预览的内容就是实际写入的内容
    const {
      abortController,
      getAppState,
    } = toolUseContext;
    const onProgress = (toolUseContext as ToolUseContext & {
      onProgress?: (message: unknown) => void;
    }).onProgress;
    const stdoutAccumulator = new EndTruncatingAccumulator();
    let stderrForShellReset = '';
    let interpretationResult: ReturnType<typeof interpretCommandResult> | undefined;
    let progressCounter = 0;
    let wasInterrupted = false;
    let result: ExecResult;
    const isMainThread = !toolUseContext.agentId;
    const preventCwdChanges = !isMainThread;
    try {
      // 使用新的 runShellCommand 异步生成器版本
      const commandGenerator = runShellCommand({
        input,
        abortController,
        preventCwdChanges,
      });

      // 消费生成器并捕获返回值
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

      // 从生成器的返回值获取最终结果
      result = generatorResult.value;
      trackGitOperations(input.command, result.code, result.stdout);
      const isInterrupt = result.interrupted && abortController.signal.reason === 'interrupt';

      // stderr 与 stdout 交错（合并的 fd）——result.stdout 包含两者
      stdoutAccumulator.append((result.stdout || '').trimEnd() + EOL);

      // 使用语义规则解释命令结果
      interpretationResult = interpretCommandResult(input.command, result.code, result.stdout || '', '');

      if (interpretationResult.isError && !isInterrupt) {
        // 仅在确实是错误时才添加退出码
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

      // 如有沙箱违规，为输出添加注释（stderr 在 stdout 中）
      const outputWithSbFailures = SandboxManager.annotateStderrWithSandboxFailures(input.command, result.stdout || '');
      if (result.preSpawnError) {
        throw new Error(result.preSpawnError);
      }
      if (interpretationResult.isError && !isInterrupt) {
        // stderr 合并到 stdout 中（合并的 fd）；outputWithSbFailures
        // 已包含完整输出。stdout 传 '' 以避免
        // getErrorParts() 和 processBashCommand 中的重复。
        throw new ShellError('', outputWithSbFailures, result.code, result.interrupted);
      }
      wasInterrupted = result.interrupted;
    } finally {
      // if (setToolJSX) setToolJSX(null);
    }

    // 从累加器获取最终字符串
    const stdout = stdoutAccumulator.toString();

    // 大输出：磁盘上的文件大小超过 getMaxOutputLength() 字节。
    // stdout 已包含第一块（来自 getStdout()）。将
    // 输出文件复制到 tool-results 目录，以便模型可以通过
    // FileRead 读取。如果大于 64 MB，复制后截断。
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
        // 文件可能已消失——stdout 预览已足够
      }
    }
    const commandType = input.command.split(' ')[0];
    // 记录代码索引工具使用情况
    const codeIndexingTool = detectCodeIndexingFromCommand(input.command);
    let strippedStdout = stripEmptyLines(stdout);

    // Claude Code 提示协议：基于 CLAUDECODE=1 的 CLI/SDK 会发出
    // `<claude-code-hint />` 标签到 stderr（在此合并到 stdout）。扫描、
    // 记录以供 useClaudeCodeHintRecommendation 展示，然后剥离
    // 以便模型永远看不到该标签——一个零令牌的旁信道。
    // 剥离无条件运行（子代理输出也必须保持干净）；
    // 仅对话记录仅限主线程。
    const extracted = extractClaudeCodeHints(strippedStdout, input.command);
    strippedStdout = extracted.stripped;
    if (isMainThread && extracted.hints.length > 0) {
      for (const hint of extracted.hints) maybeRecordPluginHint(hint);
    }
    let isImage = isImageOutput(strippedStdout);

    // 如有图片则限制尺寸 + 大小（CC-304——参见
    // resizeShellImageOutput）。限定解码缓冲区的范围以便
    // 在构建输出 Out 对象之前回收。
    let compressedStdout = strippedStdout;
    if (isImage) {
      const resized = await resizeShellImageOutput(strippedStdout, result.outputFilePath, persistedOutputSize);
      if (resized) {
        compressedStdout = resized;
      } else {
        // 解析失败或文件太大（例如超过 MAX_IMAGE_FILE_SIZE）。
        // 保持 isImage 与我们实际发送的内容同步，以便 UI 标签保持
        // 准确——mapToolResultToToolResultBlockParam 的防御性
        // 降级将发送文本，而不是图片块。
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
      persistedOutputPath,
      persistedOutputSize
    };
    return {
      data
    };
  },
  mapToolResultToToolResultBlockParam(
    {
      interrupted,
      stdout,
      stderr,
      isImage,
      structuredContent,
      persistedOutputPath,
      persistedOutputSize,
    },
    toolUseID,
  ): ToolResultBlockParam {
    // 处理结构化内容
    if (structuredContent && structuredContent.length > 0) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: structuredContent,
      };
    }

    // // 对于图片数据，格式化为 Claude 的图片内容块
    // if (isImage) {
    //   const block = buildImageToolResult(stdout, toolUseID);
    //   if (block) return block;
    // }

    let processedStdout = stdout;
    if (stdout) {
      // 替换任何前导换行符或仅包含空白字符的行
      processedStdout = stdout.replace(/^(\s*\n)+/, '');
      // 仍像以前一样修剪末尾
      processedStdout = processedStdout.trimEnd();
    }

    // 对于已持久化到磁盘的大输出，构建 <persisted-output>
    // 消息给模型。UI 永远不会看到它——它使用 data.stdout。
    if (persistedOutputPath) {
      const preview = generatePreview(processedStdout, PREVIEW_SIZE_BYTES);
      processedStdout = buildLargeToolResultMessage({
        filepath: persistedOutputPath,
        originalSize: persistedOutputSize ?? 0,
        isJson: false,
        preview: preview.preview,
        hasMore: preview.hasMore,
      });
    }

    let errorMessage = stderr.trim();
    if (interrupted) {
      if (stderr) errorMessage += EOL;
      errorMessage += '<error>Command was aborted before completion</error>';
    }



    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: [processedStdout, errorMessage].filter(Boolean).join('\n'),
      is_error: interrupted,
    };
  },
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
  const { command, timeout } = input;
  const timeoutMs = timeout || getDefaultTimeoutMs();
  return await runShellDemo({
    command,
    shellType: 'bash',
    timeout: timeoutMs,
    preventCwdChanges,
    abortSignal: abortController.signal,
  });
}
