import OpenAI from 'openai';
import fs from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { captureAPIRequest } from './utils/logger.js';
import { GlobTool } from './tools/GlobTool/GlobTool.js';
import { GrepTool } from './tools/GrepTool/GrepTool.js';
import { getCwd } from './utils/cwd.js';
import { expandPath } from './utils/path.js';
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';

interface Settings {
  env?: {
    AUTH_TOKEN?: string;
    ANTHROPIC_BASE_URL?: string;
    ANTHROPIC_MODEL?: string;
    REQUEST_TIMEOUT_MS?: string;
    [key: string]: string | undefined;
  };
  effortLevel?: 'low' | 'medium' | 'high';
}

let client: OpenAI | null = null;
let model: string = 'gpt-5';
let settingsLoaded = false;
const systemPrompt = '当前工作目录是 F:\\ChatUI-Cli\\src。使用工具查找或读取项目文件时，默认以这个目录作为当前路径。';

const tools: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: GlobTool.name,
      description: 'Find files by glob pattern. Use this when you need to locate files by name or wildcard pattern.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'The glob pattern to match files against, for example "**/*.ts" or "src/**/*.json".',
          },
          path: {
            type: 'string',
            description: 'Optional directory to search in. Omit this field to use the current working directory.',
          },
        },
        required: ['pattern'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: GrepTool.name,
      description: 'Search file contents with ripgrep regex. Use this to find text, symbols, functions, imports, or matching files.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'The regular expression pattern to search for in file contents.',
          },
          path: {
            type: 'string',
            description: 'Optional file or directory to search in. Omit this field to use the current working directory.',
          },
          glob: {
            type: 'string',
            description: 'Optional glob filter, for example "**/*.ts", "*.{ts,tsx}", or "src/**/*.json".',
          },
          output_mode: {
            type: 'string',
            enum: ['content', 'files_with_matches', 'count'],
            description: 'Output mode. "content" returns matching lines, "files_with_matches" returns file paths, "count" returns match counts. Defaults to "files_with_matches".',
          },
          '-B': {
            type: 'number',
            description: 'Number of context lines before each match. Only used with output_mode "content".',
          },
          '-A': {
            type: 'number',
            description: 'Number of context lines after each match. Only used with output_mode "content".',
          },
          '-C': {
            type: 'number',
            description: 'Number of context lines before and after each match. Only used with output_mode "content".',
          },
          context: {
            type: 'number',
            description: 'Alias for -C. Only used with output_mode "content".',
          },
          '-n': {
            type: 'boolean',
            description: 'Show line numbers in content mode. Defaults to true.',
          },
          '-i': {
            type: 'boolean',
            description: 'Case-insensitive search.',
          },
          type: {
            type: 'string',
            description: 'Optional ripgrep file type filter, for example "ts", "js", "py", or "json".',
          },
          head_limit: {
            type: 'number',
            description: 'Limit returned lines or entries. Defaults to the tool limit when omitted.',
          },
          offset: {
            type: 'number',
            description: 'Skip the first N returned lines or entries before applying head_limit.',
          },
          multiline: {
            type: 'boolean',
            description: 'Enable multiline matching.',
          },
        },
        required: ['pattern'],
        additionalProperties: false,
      },
    },
  },
];

export function resetSettings(): void {
  client = null;
  settingsLoaded = false;
}

async function ensureClient(): Promise<void> {
  if (settingsLoaded && client) return;
  const settingsPath = path.join(homedir(),"/.efrex", 'setting.json');
  const content = await fs.readFile(settingsPath, 'utf-8');
  const settings: Settings = JSON.parse(content);
  const apiKey = settings.env?.AUTH_TOKEN || process.env.OPENAI_API_KEY;
  const baseURL = settings.env?.ANTHROPIC_BASE_URL;
  model = settings.env?.ANTHROPIC_MODEL || 'gpt-5';
  const configured = Number(settings.env?.REQUEST_TIMEOUT_MS);
  const timeout = Number.isFinite(configured) && configured > 0 ? configured : 120_000;
  client = new OpenAI({ apiKey, baseURL, maxRetries: 0, timeout });
  settingsLoaded = true;
}
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createToolAbortController(signal: AbortSignal): AbortController {
  const abortController = new AbortController();
  if (signal.aborted) {
    abortController.abort(signal.reason);
  } else {
    signal.addEventListener('abort', () => abortController.abort(signal.reason), { once: true });
  }
  return abortController;
}

function parseToolArguments(rawArguments: string): Record<string, unknown> {
  if (!rawArguments.trim()) return {};
  const parsed = JSON.parse(rawArguments) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Tool arguments must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function quoteCommandArg(value: string): string {
  return JSON.stringify(value);
}

function getToolCommand(toolName: string, args: Record<string, unknown>): string {
  if (toolName === GlobTool.name) {
    const pattern = typeof args.pattern === 'string' ? args.pattern : '';
    return `rg --files --glob ${quoteCommandArg(pattern)} --sort=modified`;
  }
  if (toolName === GrepTool.name) {
    const command = ['rg', '--hidden'];
    const outputMode = typeof args.output_mode === 'string' ? args.output_mode : 'files_with_matches';
    const pattern = typeof args.pattern === 'string' ? args.pattern : '';

    if (args.multiline === true) command.push('-U', '--multiline-dotall');
    if (args['-i'] === true) command.push('-i');
    if (outputMode === 'files_with_matches') command.push('-l');
    if (outputMode === 'count') command.push('-c');
    if (args['-n'] !== false && outputMode === 'content') command.push('-n');
    if (typeof args.context === 'number' && outputMode === 'content') {
      command.push('-C', String(args.context));
    } else if (typeof args['-C'] === 'number' && outputMode === 'content') {
      command.push('-C', String(args['-C']));
    } else if (outputMode === 'content') {
      if (typeof args['-B'] === 'number') command.push('-B', String(args['-B']));
      if (typeof args['-A'] === 'number') command.push('-A', String(args['-A']));
    }
    if (pattern.startsWith('-')) {
      command.push('-e', quoteCommandArg(pattern));
    } else {
      command.push(quoteCommandArg(pattern));
    }
    if (typeof args.type === 'string') command.push('--type', quoteCommandArg(args.type));
    if (typeof args.glob === 'string') command.push('--glob', quoteCommandArg(args.glob));
    if (typeof args.path === 'string') command.push(quoteCommandArg(args.path));

    return command.join(' ');
  }
  return `${toolName} ${JSON.stringify(args)}`;
}

function logToolCall(message: string): void {
  console.info(`[tool] ${message}`);
}

async function callTool(
  toolCall: ChatCompletionMessageFunctionToolCall,
  signal: AbortSignal,
): Promise<string> {
  try {
    const rawArgs = parseToolArguments(toolCall.function.arguments);
    const toolContext = {
      options: { debug: false, verbose: false },
      abortController: createToolAbortController(signal),
      globLimits: { maxResults: 100 },
    };

    if (toolCall.function.name === GlobTool.name) {
      const args = GlobTool.inputSchema.parse(rawArgs);
      const searchPath = args.path ? expandPath(args.path) : getCwd();
      const cwdInfo = `cwd: ${searchPath}`;
      logToolCall(`call ${GlobTool.name}: ${getToolCommand(GlobTool.name, args)} (${cwdInfo})`);
      const result = await GlobTool.call(args, toolContext);
      logToolCall(
        `done ${GlobTool.name}: ${result.data.numFiles} files in ${result.data.durationMs}ms` +
          (result.data.truncated ? ' (truncated)' : ''),
      );
      return JSON.stringify(result);
    }

    if (toolCall.function.name === GrepTool.name) {
      const args = GrepTool.inputSchema.parse(rawArgs);
      const searchPath = args.path ? expandPath(args.path) : getCwd();
      const cwdInfo = `cwd: ${searchPath}`;
      logToolCall(`call ${GrepTool.name}: ${getToolCommand(GrepTool.name, args)} (${cwdInfo})`);
      const result = await GrepTool.call(args, toolContext);
      const extra =
        result.data.mode === 'content'
          ? `, ${result.data.numLines ?? 0} lines`
          : result.data.mode === 'count'
            ? `, ${result.data.numMatches ?? 0} matches`
            : '';
      logToolCall(`done ${GrepTool.name}: ${result.data.numFiles} files${extra}`);
      return JSON.stringify(result);
    }

    return JSON.stringify({
      type: 'error',
      error: `Unknown tool: ${toolCall.function.name}`,
    });
  } catch (error: any) {
    logToolCall(`error ${toolCall.function.name}: ${error?.message || String(error)}`);
    return JSON.stringify({
      type: 'error',
      error: error?.message || String(error),
    });
  }
}

function toToolCalls(
  toolCallsByIndex: Map<number, {
    id: string;
    name: string;
    arguments: string;
  }>,
): ChatCompletionMessageFunctionToolCall[] {
  return [...toolCallsByIndex.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, toolCall]) => ({
      id: toolCall.id,
      type: 'function' as const,
      function: {
        name: toolCall.name,
        arguments: toolCall.arguments,
      },
    }));
}

async function streamCompletion(
  messages: ChatCompletionMessageParam[],
  signal: AbortSignal,
  onChunk?: (text: string) => void,
  onReasoningStart?: () => void,
  onReasoningEnd?: (durationMs: number) => void,
  enableTools = false,
): Promise<{
  text: string;
  reasoningText: string;
  usage?: any;
  reasoningDurationMs: number;
  toolCalls: ChatCompletionMessageFunctionToolCall[];
}> {
  const requestParams = {
    model,
    messages,
    stream: true as const,
    stream_options: { include_usage: true },
    ...(enableTools ? { tools, tool_choice: 'auto' as const } : {}),
  };
  captureAPIRequest(requestParams, { includeMessages: false });
  const stream = await client!.chat.completions.create(requestParams, { signal });
  const toolCallsByIndex = new Map<number, { id: string; name: string; arguments: string }>();
  let fullText = '';
  let reasoningText = '';
  let usage: any = undefined;
  let reasoningStartTime: number | null = null;
  let reasoningEndTime: number | null = null;
  let isReasoning = false;

  for await (const chunk of stream) {
    if (chunk.usage) {
      usage = chunk.usage;
    }
    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;

    if (delta.tool_calls) {
      for (const toolCallDelta of delta.tool_calls) {
        const index = toolCallDelta.index;
        const existing = toolCallsByIndex.get(index) ?? { id: '', name: '', arguments: '' };
        if (toolCallDelta.id) existing.id = toolCallDelta.id;
        if (toolCallDelta.function?.name) existing.name += toolCallDelta.function.name;
        if (toolCallDelta.function?.arguments) existing.arguments += toolCallDelta.function.arguments;
        toolCallsByIndex.set(index, existing);
      }
    }

    // 处理推理内容 (reasoning_content)
    if ('reasoning_content' in delta && delta.reasoning_content) {
      if (!isReasoning) {
        isReasoning = true;
        reasoningStartTime = Date.now();
        onReasoningStart?.();
      }
      reasoningText += delta.reasoning_content;
    }

    // 处理普通内容
    if (delta.content) {
      if (isReasoning && reasoningStartTime && !reasoningEndTime) {
        isReasoning = false;
        reasoningEndTime = Date.now();
        const duration = reasoningEndTime - reasoningStartTime;
        onReasoningEnd?.(duration);
      }
      fullText += delta.content;
      onChunk?.(fullText);
    }
  }

  // 如果推理一直持续到结束
  if (isReasoning && reasoningStartTime && !reasoningEndTime) {
    reasoningEndTime = Date.now();
    onReasoningEnd?.(reasoningEndTime - reasoningStartTime);
  }

  const reasoningDurationMs = reasoningStartTime && reasoningEndTime
    ? reasoningEndTime - reasoningStartTime
    : 0;

  return {
    text: fullText,
    reasoningText,
    usage,
    reasoningDurationMs,
    toolCalls: toToolCalls(toolCallsByIndex),
  };
}
function isRetryableError(error: any): boolean {//判断是否可重试
  const status = error?.status || error?.response?.status;
  const message = String(error?.message || '').toLowerCase();

  return (
    status === 429 || // 限流
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    error.code === "ETIMEDOUT" ||
    error.code === "ECONNRESET" ||
    error.name === 'APIConnectionTimeoutError' ||
    message.includes('timed out') ||
    message.includes('timeout')
  );
}

async function doStreamRequest(input: string,signal:AbortSignal): Promise<string> {
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: input },
  ];
  const firstResult = await streamCompletion(messages, signal, undefined, undefined, undefined, true);
  if (firstResult.toolCalls.length === 0) {
    return firstResult.text || '没有拿到回复';
  }

  messages.push({
    role: 'assistant',
    content: firstResult.text || null,
    tool_calls: firstResult.toolCalls,
  });
  for (const toolCall of firstResult.toolCalls) {
    messages.push({
      role: 'tool',
      tool_call_id: toolCall.id,
      content: await callTool(toolCall, signal),
    });
  }

  const secondResult = await streamCompletion(messages, signal);
  return secondResult.text || firstResult.text || '没有拿到回复';
}

export interface AskOpenAIResult {
  text: string;
  reasoningText: string;
  usage?: any;
  reasoningDurationMs: number;
}

export async function askOpenAI(
  input: string,
  signal:AbortSignal,
  onRetry?: (attempt: number, maxRetries: number) => void,
  onChunk?: (text: string) => void,
  onReasoningStart?: () => void,
  onReasoningEnd?: (durationMs: number) => void,
): Promise<AskOpenAIResult> {
  const maxRetries = 5;
  const baseDelay = 500;
  await ensureClient();

  try {
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: input },
    ];
    const firstResult = await streamCompletion(
      messages,
      signal,
      onChunk,
      onReasoningStart,
      onReasoningEnd,
      true,
    );

    if (firstResult.toolCalls.length === 0) {
      return {
        text: firstResult.text || '没有拿到回复',
        reasoningText: firstResult.reasoningText,
        usage: firstResult.usage,
        reasoningDurationMs: firstResult.reasoningDurationMs,
      };
    }

    const assistantMessage: ChatCompletionAssistantMessageParam = {
      role: 'assistant',
      content: firstResult.text || null,
      tool_calls: firstResult.toolCalls,
    };
    messages.push(assistantMessage);

    for (const toolCall of firstResult.toolCalls) {
      const content = await callTool(toolCall, signal);
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content,
      });
    }

    const secondResult = await streamCompletion(
      messages,
      signal,
      onChunk,
      undefined,
      undefined,
      false,
    );

    return {
      text: secondResult.text || firstResult.text || '没有拿到回复',
      reasoningText: [firstResult.reasoningText, secondResult.reasoningText].filter(Boolean).join(''),
      usage: secondResult.usage ?? firstResult.usage,
      reasoningDurationMs: firstResult.reasoningDurationMs + secondResult.reasoningDurationMs,
    };
  } catch (error: any) {
    if (error?.name === "AbortError") {
      console.log("请求已取消");
      return { text: "", reasoningText: "", reasoningDurationMs: 0 };
    }
    if (isRetryableError(error)) {
      let attempt = 0;
      while (true) {
        try {
          const result = await doStreamRequest(input,signal);
          return { text: result, reasoningText: "", reasoningDurationMs: 0 };
        } catch (error: any) {
          if (error?.name === "AbortError") {
            console.log("请求已取消");
            return { text: "", reasoningText: "", reasoningDurationMs: 0 };
          }
          attempt++;
          if (attempt >= maxRetries || !isRetryableError(error)) {
            throw error;
          }
          onRetry?.(attempt, maxRetries);
          const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 100;
          await sleep(delay);
        }
      }
    } else throw error;
  }
}
