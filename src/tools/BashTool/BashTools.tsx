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
import { ValidationResult } from '../../Tool';
import { getDefaultBashTimeoutMs, getMaxBashTimeoutMs } from '../../utils/timeouts';
import { isENOENT, ShellError } from '../../utils/errors';
import {readFile}from "fs/promises"
import { ToolUseContext } from '../../Tool';
import { isEnvTruthy } from 'src/utils/envUtils';
import { truncate } from '../../utils/format.js';
import { renderToolUseErrorMessage,renderToolResultMessage,renderToolUseMessage } from './UI';
import { expandPath } from '../../utils/path.js';
import { DESCRIPTION } from '../GlobTool/prompt';
import { exec } from 'src/utils/shell';
import {interpretCommandResult}from "./commandSemantics"
const EOL = '\n';
import { EndTruncatingAccumulator } from 'src/utils/stringUtils.js';
import { PermissionResult } from 'src/types/permissions';
import { ensureToolResultsDir,getToolResultPath } from 'src/utils/toolResultStorage';
import { stripEmptyLines } from './utils';
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
// export function isSearchOrReadBashCommand(command: string): {//如果是搜索或者阅读，那么需要判断然后方便在前端展示
//   isSearch: boolean;
//   isRead: boolean;
//   isList: boolean;
// } {
//   let partsWithOperators: string[];
//   try {
//     partsWithOperators = splitCommandWithOperators(command);
//   } catch {
//     // 如果由于语法错误无法解析命令，
//     // 则它不是搜索/读取命令
//     return {
//       isSearch: false,
//       isRead: false,
//       isList: false
//     };
//   }
//   if (partsWithOperators.length === 0) {
//     return {
//       isSearch: false,
//       isRead: false,
//       isList: false
//     };
//   }
//   let hasSearch = false;
//   let hasRead = false;
//   let hasList = false;
//   let hasNonNeutralCommand = false;
//   let skipNextAsRedirectTarget = false;
//   for (const part of partsWithOperators) {
//     if (skipNextAsRedirectTarget) {
//       skipNextAsRedirectTarget = false;
//       continue;
//     }
//     if (part === '>' || part === '>>' || part === '>&') {
//       skipNextAsRedirectTarget = true;
//       continue;
//     }
//     if (part === '||' || part === '&&' || part === '|' || part === ';') {
//       continue;
//     }
//     const baseCommand = part.trim().split(/\s+/)[0];
//     if (!baseCommand) {
//       continue;
//     }
//     if (BASH_SEMANTIC_NEUTRAL_COMMANDS.has(baseCommand)) {
//       continue;
//     }
//     hasNonNeutralCommand = true;
//     const isPartSearch = BASH_SEARCH_COMMANDS.has(baseCommand);
//     const isPartRead = BASH_READ_COMMANDS.has(baseCommand);
//     const isPartList = BASH_LIST_COMMANDS.has(baseCommand);
//     if (!isPartSearch && !isPartRead && !isPartList) {
//       return {
//         isSearch: false,
//         isRead: false,
//         isList: false
//       };
//     }
//     if (isPartSearch) hasSearch = true;
//     if (isPartRead) hasRead = true;
//     if (isPartList) hasList = true;
//   }

//   // 仅包含中性命令（例如，只有 "echo foo"）——不可折叠
//   if (!hasNonNeutralCommand) {
//     return {
//       isSearch: false,
//       isRead: false,
//       isList: false
//     };
//   }
//   return {
//     isSearch: hasSearch,
//     isRead: hasRead,
//     isList: hasList
//   };
// }

// /**
//  * 检查 bash 命令在成功时是否预期不产生 stdout。
//  * 用于在 UI 中显示"完成"而不是"（无输出）"。
//  */
// function isSilentBashCommand(command: string): boolean {
//   let partsWithOperators: string[];
//   try {
//     partsWithOperators = splitCommandWithOperators(command);
//   } catch {
//     return false;
//   }
//   if (partsWithOperators.length === 0) {
//     return false;
//   }
//   let hasNonFallbackCommand = false;
//   let lastOperator: string | null = null;
//   let skipNextAsRedirectTarget = false;
//   for (const part of partsWithOperators) {
//     if (skipNextAsRedirectTarget) {
//       skipNextAsRedirectTarget = false;
//       continue;
//     }
//     if (part === '>' || part === '>>' || part === '>&') {
//       skipNextAsRedirectTarget = true;
//       continue;
//     }
//     if (part === '||' || part === '&&' || part === '|' || part === ';') {
//       lastOperator = part;
//       continue;
//     }
//     const baseCommand = part.trim().split(/\s+/)[0];
//     if (!baseCommand) {
//       continue;
//     }
//     if (lastOperator === '||' && BASH_SEMANTIC_NEUTRAL_COMMANDS.has(baseCommand)) {
//       continue;
//     }
//     hasNonFallbackCommand = true;
//     if (!BASH_SILENT_COMMANDS.has(baseCommand)) {
//       return false;
//     }
//   }
//   return hasNonFallbackCommand;
// }
/**
 * 检测应改用 Monitor 的独立或前置 `sleep N` 模式。
 * 捕获 `sleep 5`、`sleep 5 && check`、`sleep 5; check`——但不捕获
 * 管道、子 shell 或脚本内部的 sleep（那些是正常的）。
 */
// export function detectBlockedSleepPattern(command: string): string | null {
//   const parts = splitCommand_DEPRECATED(command);
//   if (parts.length === 0) return null;
//   const first = parts[0]?.trim() ?? '';
//   // 作为第一个子命令的裸 `sleep N` 或 `sleep N.N`。
//   // 允许浮点时长（sleep 0.5）——那些是合法的 pacing，不是轮询。
//   const m = /^sleep\s+(\d+)\s*$/.exec(first);
//   if (!m) return null;
//   const secs = parseInt(m[1]!, 10);
//   if (secs < 2) return null; // 2秒以下的 sleep 没问题（速率限制、pacing）

//   // 单独的 `sleep N` → "你在等什么？"
//   // `sleep N && check` → "使用 Monitor { command: check }"
//   const rest = parts.slice(1).join(' ').trim();
//   return rest ? `sleep ${secs} followed by: ${rest}` : `standalone sleep ${secs}`;
// }

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
  renderToolResultMessage,
  renderToolUseErrorMessage,
  renderToolUseMessage,
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
  async validateInput(input: BashToolInput): Promise<ValidationResult> {
    return { result: true };
  },
  async call(input: BashToolInput, toolUseContext: ToolUseContext,_canUseTool?,
    assistantMessage?) {
    // 处理模拟的 sed 编辑——直接应用而不是运行 sed
    // 这确保用户预览的内容就是实际写入的内容
    const {
      abortController,
      getAppState,
    } = toolUseContext;
    const stdoutAccumulator = new EndTruncatingAccumulator();//很简单的字符串累加，超出限制了就截断
    let stderrForShellReset = '';
    let interpretationResult: ReturnType<typeof interpretCommandResult> | undefined;
    let progressCounter = 0;
    let wasInterrupted = false;
    let result: ExecResult;
    const isMainThread = true//toolUseContext.agentId;
    const preventCwdChanges = !isMainThread;//防止cwd变化
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
        generatorResult = await commandGenerator.next();//等待下一次结果
        // if (!generatorResult.done && onProgress) {
        //   const progress = generatorResult.value;
        //   onProgress({
        //     toolUseID: `bash-progress-${progressCounter++}`,
        //     data: {
        //       type: 'bash_progress',
        //       output: progress.output,
        //       fullOutput: progress.fullOutput,
        //       elapsedTimeSeconds: progress.elapsedTimeSeconds,
        //       totalLines: progress.totalLines,
        //       totalBytes: progress.totalBytes,
        //       taskId: progress.taskId,
        //       timeoutMs: progress.timeoutMs
        //     }
        //   });
        // }
      } while (!generatorResult.done);

      // 从生成器的返回值获取最终结果
      result = generatorResult.value;
      // trackGitOperations(input.command, result.code, result.stdout);
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

      }

      // Annotate output with sandbox violations if any (stderr is in stdout)
      // const outputWithSbFailures = SandboxManager.annotateStderrWithSandboxFailures(input.command, result.stdout || '');
      if (result.preSpawnError) {
        throw new Error(result.preSpawnError);
      }
      if (interpretationResult.isError && !isInterrupt) {
        // stderr is merged into stdout (merged fd); outputWithSbFailures
        // already has the full output. Pass '' for stdout to avoid
        // duplication in getErrorParts() and processBashCommand.
        throw new ShellError('',"" , result.code, result.interrupted);
      }
      wasInterrupted = result.interrupted;
    } finally {
      // if (setToolJSX) setToolJSX(null);
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
    // Log code indexing tool usage
    // const codeIndexingTool = detectCodeIndexingFromCommand(input.command);
    let strippedStdout = stripEmptyLines(stdout);

    // Claude Code hints protocol: CLIs/SDKs gated on CLAUDECODE=1 emit a
    // `<claude-code-hint />` tag to stderr (merged into stdout here). Scan,
    // record for useClaudeCodeHintRecommendation to surface, then strip
    // so the model never sees the tag — a zero-token side channel.
    // Stripping runs unconditionally (subagent output must stay clean too);
    // only the dialog recording is main-thread-only.
    // const extracted = extractClaudeCodeHints(strippedStdout, input.command);
    // strippedStdout = extracted.stripped;
    // if (isMainThread && extracted.hints.length > 0) {
      // for (const hint of extracted.hints) maybeRecordPluginHint(hint);
    // }
    // let isImage = isImageOutput(strippedStdout);

    // Cap image dimensions + size if present (CC-304 — see
    // resizeShellImageOutput). Scope the decoded buffer so it can be reclaimed
    // before we build the output Out object.
    let compressedStdout = strippedStdout;
    const data: Out = {
      stdout: compressedStdout,
      stderr: stderrForShellReset,
      interrupted: wasInterrupted,
      isImage: false,
      returnCodeInterpretation: interpretationResult?.message,
      // noOutputExpected: isSilentBashCommand(input.command),
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
    // Handle structured content
    if (structuredContent && structuredContent.length > 0) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: structuredContent,
      };
    }

    // // For image data, format as image content block for Claude
    // if (isImage) {
    //   const block = buildImageToolResult(stdout, toolUseID);
    //   if (block) return block;
    // }

    let processedStdout = stdout;
    if (stdout) {
      // Replace any leading newlines or lines with only whitespace
      processedStdout = stdout.replace(/^(\s*\n)+/, '');
      // Still trim the end as before
      processedStdout = processedStdout.trimEnd();
    }

    // // 注释：如果是持久化到磁盘的超大输出内容，为模型构建<persisted-output>（持久化输出）消息
    // // 关键：UI（前端界面）永远不会直接看到这个结构化消息 —— 前端只使用 data.stdout 字段
    // if (persistedOutputPath) {
    //   // 1. 生成预览内容：截取指定大小的输出作为预览，避免展示全部超大文本
    //   // processedStdout：处理后的完整输出文本；PREVIEW_SIZE_BYTES：预览的字节大小限制（常量）
    //   const preview = generatePreview(processedStdout, PREVIEW_SIZE_BYTES);
      
    //   // 2. 替换原始输出：把超大文本替换成「结构化的大结果消息」，不再携带完整文本
    //   processedStdout = buildLargeToolResultMessage({
    //     filepath: persistedOutputPath,    // 超大内容在磁盘上的文件路径
    //     originalSize: persistedOutputSize ?? 0,  // 原始文件大小（空则默认0）
    //     isJson: false,                    // 标记内容不是JSON格式
    //     preview: preview.preview,         // 截取的预览文本
    //     hasMore: preview.hasMore          // 标记：是否有未展示的剩余内容（true=内容被截断）
    //   });
    // }

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
  async checkPermissions(input, context): Promise<PermissionResult> {
    return bashToolHasPermission(input, context);
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
  const shellCommand = await exec(command, abortController.signal, 'bash', {
      timeout: timeoutMs,
      preventCwdChanges,
      // 去掉: shouldUseSandbox, shouldAutoBackground
    });
  const result = await shellCommand.result;
  shellCommand.cleanup();
/*   具体删除 runShellCommand 内的：
  - spawnBackgroundTask() 函数
  - startBackgrounding() 函数
  - shellCommand.onTimeout 处理
  - run_in_background === true 分支
  - TaskOutput.startPolling() / stopPolling()
  - foregroundTaskId 注册/注销
  - BackgroundHint JSX 设置
  - backgroundShellId 跟踪 */
  return result;
}
