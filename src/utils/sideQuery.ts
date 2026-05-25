import type Anthropic from '@anthropic-ai/sdk';
import type { BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages.js';
import type {
	ChatCompletion,
	ChatCompletionTool,
	ChatCompletionToolChoiceOption,
} from 'openai/resources/chat/completions';
import { getLastApiCompletionTimestamp, setLastApiCompletionTimestamp } from '../bootstrap/state.js';
import { getOpenAIClient } from '../services/api/openai/client.js';
import { messagesToOpenAI } from '../services/api/openai/convertMessages.js';
import { toolsToOpenAI } from '../services/api/openai/convertTools.js';
import type { OpenAIToolSchema } from '../services/api/openai/types.js';
import type { AssistantMessage, UserMessage } from '../package/message.js';
import { asSystemPrompt } from '../prompt.js';

type MessageParam = Anthropic.MessageParam;
type TextBlockParam = Anthropic.TextBlockParam;
type Tool = Anthropic.Tool;
type ToolChoice = Anthropic.ToolChoice;
type BetaJSONOutputFormat = Anthropic.Beta.Messages.BetaJSONOutputFormat;

export type SideQueryOptions = {
	model: string;
	querySource?: string;
	system?: string | TextBlockParam[];
	messages: MessageParam[];
	tools?: Tool[] | BetaToolUnion[];
	tool_choice?: ToolChoice;
	output_format?: BetaJSONOutputFormat;
	max_tokens?: number;
	maxRetries?: number;
	signal?: AbortSignal;
	skipSystemPromptPrefix?: boolean;
	temperature?: number;
	thinking?: number | false;
	stop_sequences?: string[];
	optional?: boolean;
};
function toOpenAIToolChoice(
	toolChoice?: ToolChoice,
): ChatCompletionToolChoiceOption | undefined {
	if (!toolChoice || typeof toolChoice !== 'object') return undefined;

	const tc = toolChoice as unknown as Record<string, unknown>;
	switch (tc.type) {
		case 'auto':
			return 'auto';
               case 'any':
                       return 'required';
               case 'tool':
                       return typeof tc.name === 'string'
                              ? { type: 'function', function: { name: tc.name } }
                               : undefined;
               default:
                       return undefined;
	   }
}


function systemPromptToText(system?: string | TextBlockParam[]): string[] {
	if (!system) return [];
	if (typeof system === 'string') return [system];

	const text = system
		.filter(block => block?.type === 'text' && typeof block.text === 'string')
		.map(block => block.text.trim())
		.filter(Boolean)
		.join('\n\n');

	return text ? [text] : [];
}

function toInternalMessages(messages: MessageParam[]): (UserMessage | AssistantMessage)[] {
	return messages
		.filter(
			(message): message is MessageParam & { role: 'user' | 'assistant' } =>
				message.role === 'user' || message.role === 'assistant',
		)
		.map(message => ({
			type: message.role,
			message,
		})) as (UserMessage | AssistantMessage)[];
}

function toOpenAITools(tools?: Tool[] | BetaToolUnion[]): ChatCompletionTool[] {
	if (!tools?.length) return [];
	return toolsToOpenAI(tools as OpenAIToolSchema[]);
}

function toOpenAIResponseFormat(
	outputFormat?: BetaJSONOutputFormat,
):
	| { type: 'json_object' }
	| {
			type: 'json_schema';
			json_schema: {
				name: string;
				description?: string;
				schema: Record<string, unknown>;
				strict?: boolean;
			};
	  }
	| undefined {
	if (!outputFormat) return undefined;
	// if (outputFormat.type === 'json_object') {
	// 	return { type: 'json_object' };
	// }

	// if (outputFormat.type === 'json_schema') {
	// 	return {
	// 		type: 'json_schema',
	// 		json_schema: {
	// 			name: outputFormat.name,
	// 			...(outputFormat.description
	// 				? { description: outputFormat.description }
	// 				: {}),
	// 			schema:
	// 				(outputFormat.schema as Record<string, unknown> | undefined) ?? {},
	// 			...(outputFormat.strict !== undefined
	// 				? { strict: outputFormat.strict }
	// 				: {}),
	// 		},
	// 	};
	// }

	return undefined;
}

export function normalizeModelStringForAPI(model: string): string {
	return model.replace(/\[(1|2)m\]/gi, '');
}

export async function sideQuery(
	opts: SideQueryOptions,
): Promise<ChatCompletion> {
	const {
		model,
		system,
		messages,
		tools,
		tool_choice,
		output_format,
		max_tokens = 1024,
		maxRetries = 2,
		signal,
		temperature,
		stop_sequences,
	} = opts;

	const client = getOpenAIClient({
		maxRetries,
		source: 'side_query',
	});

	const normalizedModel = normalizeModelStringForAPI(model);
	const openAIMessages = messagesToOpenAI(
		toInternalMessages(messages),
		asSystemPrompt(systemPromptToText(system)),
	);
	const openAITools = toOpenAITools(tools);
	const openAIToolChoice = toOpenAIToolChoice(tool_choice);
	const responseFormat = toOpenAIResponseFormat(output_format);

	const response = await client.chat.completions.create(
		{
			model: normalizedModel,
			messages: openAIMessages,
			stream: false,
			...(openAITools.length > 0 ? { tools: openAITools } : {}),
			...(openAIToolChoice ? { tool_choice: openAIToolChoice } : {}),
			...(responseFormat ? { response_format: responseFormat } : {}),
			...(temperature !== undefined ? { temperature } : {}),
			...(stop_sequences?.length ? { stop: stop_sequences } : {}),
			max_tokens,
		},
		{ signal },
	);

	void getLastApiCompletionTimestamp();
	setLastApiCompletionTimestamp(Date.now());

	return response;
}
