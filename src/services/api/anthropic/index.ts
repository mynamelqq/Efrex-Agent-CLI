import Anthropic from '@anthropic-ai/sdk';
import type {
	BetaMessage,
	BetaMessageParam,
	BetaRawMessageStreamEvent,
	BetaToolChoice,
	BetaToolUnion,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs';
import { randomUUID } from 'crypto';
import type { Tools } from 'src/Tool.js';
import type {
	ApiRetryStatusEvent,
	AssistantMessage,
	Message,
	StreamEvent,
	SystemAPIErrorMessage,
} from 'src/package/message.js';
import type { SystemPrompt } from 'src/prompt.js';
import { createAssistantAPIErrorMessage, normalizeContentFromAPI } from 'src/utils/messages.js';
import { getAnthropicApiKey, getAnthropicBaseURL, getRequestTimeoutMs } from 'src/utils/anthropicConfig.js';
import { normalizeMessagesForAPI, toolToAPISchema } from 'src/utils/api.js';
import { strip1mContextSuffix } from 'src/utils/model/modelName.js';
import type { ThinkingConfig } from 'src/utils/effort.js';
import type { Options } from '../efrex.js';
import { getUserAgent } from 'src/utils/http.js';
import { getSessionId } from 'src/bootstrap/state.js';
import { checkAndRefreshOAuthTokenIfNeeded, isClaudeAISubscriber } from 'src/utils/auth.js';
import { ClientOptions } from 'openai/client';

async function getAnthropicClient(): Promise<Anthropic> {
	const apiKey = getAnthropicApiKey();
	if (!apiKey?.trim()) {
		throw new Error(
			'Missing Anthropic API key. Configure AUTH_TOKEN or the corresponding settings env.',
		);
	}

	return new Anthropic({
		apiKey,
		...(getAnthropicBaseURL() ? { baseURL: getAnthropicBaseURL() } : {}),
		timeout: getRequestTimeoutMs(),
		maxRetries: 0,
	});
}
export function getCustomHeaders(): Record<string, string> {
  const customHeaders: Record<string, string> = {}
  const customHeadersEnv = process.env.ANTHROPIC_CUSTOM_HEADERS

  if (!customHeadersEnv) return customHeaders

  // Split by newlines to support multiple headers
  const headerStrings = customHeadersEnv.split(/\n|\r\n/)

  for (const headerString of headerStrings) {
    if (!headerString.trim()) continue

    // Parse header in format "Name: Value" (curl style). Split on first `:`
    // then trim — avoids regex backtracking on malformed long header lines.
    const colonIdx = headerString.indexOf(':')
    if (colonIdx === -1) continue
    const name = headerString.slice(0, colonIdx).trim()
    const value = headerString.slice(colonIdx + 1).trim()
    if (name) {
      customHeaders[name] = value
    }
  }

  return customHeaders
}
function toAnthropicMessages(messages: Message[], tools: Tools): BetaMessageParam[] {
	return normalizeMessagesForAPI(messages, tools).map(message => ({
		role: message.type,
		content: message.message.content as BetaMessageParam['content'],
	}));
}

function toAnthropicThinking(thinkingConfig: ThinkingConfig): { type: 'adaptive' } | { type: 'enabled'; budget_tokens: number } | undefined {
	switch (thinkingConfig.type) {
		case 'adaptive':
			return { type: 'adaptive' };
		case 'enabled':
			return {
				type: 'enabled',
				budget_tokens: thinkingConfig.budgetTokens,
			};
		default:
			return undefined;
	}
}

function toAnthropicToolChoice(toolChoice: Options['toolChoice']): BetaToolChoice | undefined {
	if (toolChoice === 'auto') return { type: 'auto' };
	if (toolChoice === 'none') return { type: 'none' };
	return undefined;
}

function toAssistantMessage(
	message: BetaMessage,
	tools: Tools,
	requestId: string | null | undefined,
): AssistantMessage {
	return {
		type: 'assistant',
		uuid: randomUUID(),
		timestamp: new Date().toISOString(),
		requestId: requestId ?? undefined,
		message: {
			...message,
			role: 'assistant',
			content: normalizeContentFromAPI(message.content, tools),
			finish_reason: message.stop_reason ?? null,
		},
	};
}

export async function* queryModelAnthropic(
	messages: Message[],
	systemPrompt: SystemPrompt,
	thinkingConfig: ThinkingConfig,
	tools: Tools,
	signal: AbortSignal,
	options: Options,
): AsyncGenerator<
	StreamEvent | AssistantMessage | SystemAPIErrorMessage | ApiRetryStatusEvent,
	void
> {
	try {
		const client = await getAnthropicClient();
		const apiModel = strip1mContextSuffix(options.model);
		const anthropicMessages = toAnthropicMessages(messages, tools);
		const anthropicTools: BetaToolUnion[] = await Promise.all(
			tools.map(tool =>
				toolToAPISchema(tool, {
					tools,
					model: options.model,
				}),
			),
		);

		const stream = client.beta.messages.stream(
			{
				model: apiModel,
				max_tokens: options.maxOutputTokensOverride ?? 32_000,
				messages: anthropicMessages,
				system: systemPrompt.join('\n\n'),
				stream: true,
				...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
				...(toAnthropicToolChoice(options.toolChoice)
					? { tool_choice: toAnthropicToolChoice(options.toolChoice) }
					: {}),
				...(toAnthropicThinking(thinkingConfig)
					? { thinking: toAnthropicThinking(thinkingConfig) }
					: {}),
			},
			{ signal },
		);

		for await (const event of stream as AsyncIterable<BetaRawMessageStreamEvent>) {
			yield {
				type: 'stream_event',
				event,
			} as StreamEvent;
		}

		const finalMessage = await stream.finalMessage();
		yield toAssistantMessage(finalMessage, tools, stream.request_id);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		yield createAssistantAPIErrorMessage({
			content: `API Error: ${errorMessage}`,
			apiError: 'api_error',
			error: error instanceof Error ? (error as never) : 'unknown',
		});
	}
}
