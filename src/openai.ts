import OpenAI from 'openai';
import fs from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
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
let model: string = 'kimi-k2.6';
let settingsLoaded = false;

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
  model = settings.env?.ANTHROPIC_MODEL || 'kimi-k2.6';
  const configured = Number(settings.env?.REQUEST_TIMEOUT_MS);
  const timeout = Number.isFinite(configured) && configured > 0 ? configured : 120_000;
  client = new OpenAI({ apiKey, baseURL, maxRetries: 0, timeout });
  settingsLoaded = true;
}
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const stream = await client!.chat.completions.create({
    model,
    messages: [{ role: 'user', content: input }],
    stream: true,
  },{signal});
  let fullText = '';
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content || '';
    fullText += delta;
  }
  return fullText || '没有拿到回复';
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
    const stream = await client!.chat.completions.create({
      model,
      messages: [{ role: 'user', content: input }],
      stream: true,
      stream_options: { include_usage: true },
    },{signal});
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
      text: fullText || '没有拿到回复',
      reasoningText,
      usage,
      reasoningDurationMs,
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
