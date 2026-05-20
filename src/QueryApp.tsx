import React, { useCallback, useEffect, useRef, useState } from 'react';
import chalk from 'chalk';
// import { useMainLoopModel } from './hooks/useMainLoopModel.js';
import { CommandResultDisplay } from './types/command.js';
import { Command,getCommandName } from './types/command.js';
import { useQueueProcessor } from './hooks/useQueueProcessor.js';
import { randomUUID } from 'node:crypto';
import { FileHistoryState } from './utils/fileHistory.js';
import { Box, Text, useApp, useInput, useWindowSize } from './ink.js';
import { stringWidth } from './ink/stringWidth.js';
import { createAbortController } from './utils/abortController.js';
import { createFileStateCacheWithSizeLimit,READ_FILE_STATE_CACHE_SIZE } from './utils/fileStateCache.js';
import { useAppStateStore } from './state/AppState.js';
import { buildEffectiveSystemPrompt } from './utils/systemPrompt.js';
import { addToHistory } from './history.js';
import { useMemo } from 'react';
import { useArrowKeyHistory } from './hooks/useArrowKeyHistory.js';
import type { ProcessUserInputContext } from './utils/executeUserInput.js';
import type { ScrollBoxHandle } from './ink/components/ScrollBox.js';
import { AlternateScreen } from './ink/components/AlternateScreen.js';
import PromptInput from './components/PromptInput.js';
import { isCommandEnabled } from './types/command.js';
import MessageViewport from './components/MessageViewport.js';
import FullscreenLayout from './components/FullscreenLayout.js';
import { ScrollKeybindingHandler } from './components/ScrollKeybindingHandler.js';
import { PastedContent } from './utils/config.js';
import { parseReferences } from './history.js';
import type { Message as MessageType } from './package/message.js';
import {
	findToolByName,
	type Tool,
	type ToolPermissionContext,
	type ToolUseContext
} from './Tool.js';
import { expandPastedTextRefs } from './history.js';
import { getAllBaseTools } from './tools.js';
import { query } from './query.js';
import { handlePromptSubmit } from './utils/handlePromptSubmit.js';
import { getAnthropicModel, getEffortLevel } from './utils/anthropicConfig.js';
import { FileStateCache } from './utils/fileStateCache.js';
import { getSystemPrompt } from './constants/prompts.js';
import { getUserContext } from './context.js';
import { createUserMessage } from './utils/messages.js';
import { getDefaultAppState, type AppState } from './state/AppStateStore.js';
import { ThinkingConfig } from './utils/effort.js';
import { handleMessageFromStream } from './utils/handleMessageFromStream.js';
import useCanUseTool from './hooks/useCanUseTool.js';
import { QueryGuard } from './utils/QueryGuard.js';
import type { QueuedCommand } from './types/textInputTypes.js';
import { PromptInputQueuedCommands } from './components/PromptInput/PromptInputQueuedCommands.js';
import { isFullscreenEnvEnabled } from './utils/fullscreen.js';
import {
	PermissionRequest,
	type ToolUseConfirm
} from './components/permissions/PermissionRequest.js';
import {
	renderToolErrorContent,
	renderToolResultContent,
	renderToolUseContent
} from './components/messages/renderToolContent.js';
import { CLI_APP_VERSION } from 'utils/load.js';
type ViewportMessage = {
	id: number;
	role: 'user' | 'assistant' | 'tool';
	text: string;
	content?: React.ReactNode;
	toolPhase?: 'call' | 'done' | 'error';
	toolDisplayStyle?: 'use' | 'result' | 'progress';
	toolUseId?: string;
	animatePrefix?: 'blink';
};

type ToolUseRenderItem = {
	text: string;
	content: React.ReactNode;
};

type ParsedAssistantToolUse = {
	toolName: string;
	parsedInput: Record<string, unknown> | undefined;
	userFacingToolName: string;
};

type StreamingAssistantState = {
	active: boolean;
	placeholderId: number | null;
	text: string;
	pendingToolCalls: string[];
};

const MAX_PROMPT_INPUT_ROWS = 6;
const APP_BRAND = 'efrex code';
const APP_VERSION = CLI_APP_VERSION;


const GLIMMER_PAD_COLUMNS = 10;
const GLIMMER_WIDTH_COLUMNS = 8;
const statusSegmenter =
	typeof Intl !== 'undefined' && 'Segmenter' in Intl
		? new Intl.Segmenter('zh-Hans', { granularity: 'grapheme' })
		: null;

function getCurrentModel(): string {
	return getAnthropicModel();
}

function splitGraphemes(text: string): string[] {
	if (statusSegmenter) {
		return Array.from(
			statusSegmenter.segment(text),
			segment => segment.segment
		);
	}

	return Array.from(text);
}

function getShimmerSegments(
	text: string,
	glimmerIndex: number
): { before: string; shimmer: string; after: string } {
	const graphemes = splitGraphemes(text);
	const shimmerStart = glimmerIndex;
	const shimmerEnd = glimmerIndex + GLIMMER_WIDTH_COLUMNS;

	let cursor = 0;
	const before: string[] = [];
	const shimmer: string[] = [];
	const after: string[] = [];

	for (const grapheme of graphemes) {
		const width = stringWidth(grapheme);
		const nextCursor = cursor + width;
		const intersects = nextCursor > shimmerStart && cursor < shimmerEnd;

		if (intersects) {
			shimmer.push(grapheme);
		} else if (nextCursor <= shimmerStart) {
			before.push(grapheme);
		} else {
			after.push(grapheme);
		}

		cursor = nextCursor;
	}

	return {
		before: before.join(''),
		shimmer: shimmer.join(''),
		after: after.join('')
	};
}

function getStatusLabelSegments(
	text: string,
	glimmerIndex: number
): { before: string; shimmer: string; after: string } {
	return getShimmerSegments(text, glimmerIndex);
}

function normalizeLineEndings(text: string): string {
	return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function truncateDisplay(text: string, width: number): string {
	if (text.length <= width) {
		return text;
	}

	return `${text.slice(0, Math.max(0, width - 1))}…`;
}

function fitDisplay(text: string, width: number): string {
	if (stringWidth(text) <= width) {
		return text;
	}

	let next = '';
	for (const char of Array.from(text)) {
		if (stringWidth(`${next}${char}…`) > width) {
			break;
		}
		next += char;
	}

	return `${next}…`;
}

function padDisplay(text: string, width: number): string {
	return `${text}${' '.repeat(Math.max(0, width - stringWidth(text)))}`;
}

function centerDisplay(text: string, width: number): string {
	const textWidth = stringWidth(text);
	const leftPad = Math.max(0, Math.floor((width - textWidth) / 2));
	return `${' '.repeat(leftPad)}${text}${' '.repeat(Math.max(0, width - textWidth - leftPad))}`;
}

function getTranscriptHeaderLines({
	cwd,
	model,
	effort,
	width,
	welcome
}: {
	cwd: string;
	model: string;
	effort: string;
	width: number;
	welcome: boolean;
}): string[] {
	const boxWidth = Math.max(12, width);
	const innerWidth = Math.max(1, boxWidth - 2);
	const meta = fitDisplay(
		`${cwd}  ·  model: ${model}  ·  effort: ${effort}`,
		innerWidth
	);
	const brand = `${chalk.cyanBright.bold('»')} ${chalk.cyanBright.bold(APP_BRAND)} ${chalk.gray(APP_VERSION)}`;
	const brandPlain = `» ${APP_BRAND} ${APP_VERSION}`;
	const rule = chalk.gray(
		` ${'─'.repeat(Math.max(0, boxWidth - stringWidth(brandPlain) - 2))}`
	);

	// if (!welcome || boxWidth < 72) {
	// 	return [`${brand}${rule}`, chalk.gray(fitDisplay(meta, boxWidth)), ''];
	// }

	const leftWidth = Math.max(28, Math.min(52, Math.floor(innerWidth * 0.42)));
	const rightWidth = Math.max(20, innerWidth - leftWidth - 1);
	const top = `${chalk.blue(`╭${'─'.repeat(leftWidth)}`)}${chalk.green(`┬${'─'.repeat(rightWidth)}╮`)}`;
	const bottom = `${chalk.blue(`╰${'─'.repeat(leftWidth)}`)}${chalk.green(`┴${'─'.repeat(rightWidth)}╯`)}`;
	const row = (
		leftPlain: string,
		leftStyled: string,
		rightPlain: string,
		rightStyled: string
	) =>
		`${chalk.blue('│')}${leftStyled}${' '.repeat(Math.max(0, leftWidth - stringWidth(leftPlain)))}${chalk.green('│')}${rightStyled}${' '.repeat(Math.max(0, rightWidth - stringWidth(rightPlain)))}${chalk.green('│')}`;
	const left = (
		text: string,
		style: (value: string) => string = value => value
	) => {
		const plain = centerDisplay(fitDisplay(text, leftWidth), leftWidth);
		return { plain, styled: style(plain) };
	};
	const right = (
		text: string,
		style: (value: string) => string = value => value
	) => {
		const plain = padDisplay(fitDisplay(text, rightWidth), rightWidth);
		return { plain, styled: style(plain) };
	};
	const makeRow = (
		leftText: string,
		rightText: string,
		leftStyle: (value: string) => string = value => value,
		rightStyle: (value: string) => string = value => value
	) => {
		const leftCell = left(leftText, leftStyle);
		const rightCell = right(rightText, rightStyle);
		return row(
			leftCell.plain,
			leftCell.styled,
			rightCell.plain,
			rightCell.styled
		);
	};
	const makeLeftInfoRow = (leftText: string, rightText: string) => {
		const leftPlain = padDisplay(
			`  ${fitDisplay(leftText, Math.max(1, leftWidth - 4))}`,
			leftWidth
		);
		const rightCell = right(rightText, value => chalk.gray(value));
		return row(
			leftPlain,
			chalk.gray(leftPlain),
			rightCell.plain,
			rightCell.styled
		);
	};

	return [
		`${brand}${rule}`,
		top,
		makeRow(
			'efrex code',
			'✦  Getting Started',
			value => chalk.hex('#8f7cff').bold(value),
			value => chalk.greenBright.bold(value)
		),
		makeRow(
			'AI Coding Assistant',
			'Ask anything, edit code, run commands.',
			value => chalk.gray(value),
			value => chalk.gray(value)
		),
		makeRow(
			'Power your ideas with code.',
			'Let efrex code handle the rest.',
			value => chalk.gray(value),
			value => chalk.gray(value)
		),
		makeRow(
			'╭ ────── ╮',
			'Tips',
			value => chalk.blueBright(value),
			value => chalk.yellowBright.bold(`${value}`)
		),
		makeRow(
			'│  •  •  │',
			'────────────────────────────────────────',
			value => chalk.blueBright(value),
			value => chalk.green(value)
		),
		makeRow('│  ────  │', '', value => chalk.blueBright(value)),
		makeRow(
			'─────  ─────',
			'→  Ask questions about your codebase',
			value => chalk.blueBright(value),
			value => chalk.gray(value.replace('→', chalk.yellowBright('→')))
		),
		// makeRow('╰─┬──┬─╯', '→  Ask questions about your codebase', value => chalk.blueBright(value), value => chalk.gray(value.replace('→', chalk.yellowBright('→')))),
		// makeRow('      ', '', value => chalk.blueBright(value)),
		makeRow(
			`model: ${model} | effort: ${effort} `,
			'→  Generate or refactor code',
			value => chalk.gray(value),
			value => chalk.gray(value.replace('→', chalk.yellowBright('→')))
		),
		makeRow(
			`${cwd}`,
			'→  Run shell commands and analyze results',
			value => chalk.hex('#438bcc').bold(value),
			value => chalk.gray(value.replace('→', chalk.yellowBright('→')))
		),
		// makeRow('Type /help to see available commands', '→  Use natural language to automate tasks', value => chalk.gray(value.replace('/help', chalk.cyanBright('/help'))), value => chalk.gray(value.replace('→', chalk.yellowBright('→')))),
		bottom,
		''
	];
}

function extractTextContent(content: unknown): string {
	if (typeof content === 'string') {
		return content;
	}

	if (!Array.isArray(content)) {
		return '';
	}

	return content
		.map(block => {
			if (!block || typeof block !== 'object') {
				return '';
			}

			const typedBlock = block as unknown as Record<string, unknown>;
			if (
				typedBlock.type === 'text' &&
				typeof typedBlock.text === 'string'
			) {
				return typedBlock.text;
			}

			if (
				typedBlock.type === 'tool_result' &&
				typeof typedBlock.content === 'string'
			) {
				return typedBlock.content;
			}

			return '';
		})
		.filter(Boolean)
		.join('\n');
}

function extractToolUseLabels(content: unknown): string[] {
	if (!Array.isArray(content)) {
		return [];
	}

	return content
		.map(block => {
			if (!block || typeof block !== 'object') {
				return null;
			}

			const typedBlock = block as unknown as Record<string, unknown>;
			if (typedBlock.type !== 'tool_use') {
				return null;
			}

			return getToolUseFallbackLabel(undefined, typedBlock);
		})
		.filter((value): value is string => value !== null);
}

function parseAssistantToolUse(
	tool: Tool | undefined,
	block: Record<string, unknown>
): ParsedAssistantToolUse {
	const toolName =
		typeof block.name === 'string' ? block.name : 'unknown_tool';
	if (!tool) {
		return {
			toolName,
			parsedInput: undefined,
			userFacingToolName: toolName
		};
	}

	const input = tool.inputSchema.safeParse(block.input);
	const parsedInput = input.success
		? (input.data as Record<string, unknown>)
		: undefined;

	return {
		toolName,
		parsedInput,
		userFacingToolName: tool.userFacingName(parsedInput) || toolName
	};
}

function getToolUseFallbackLabel(
	tool: Tool | undefined,
	block: Record<string, unknown>
): string {
	const { toolName, userFacingToolName } = parseAssistantToolUse(tool, block);
	return userFacingToolName || toolName;
}

function buildAssistantToolUseRenderItem(
	tool: Tool | undefined,
	block: Record<string, unknown>
): ToolUseRenderItem {
	const parsedToolUse = parseAssistantToolUse(tool, block);
	const renderedToolUseMessage = renderToolUseContent(
		tool,
		parsedToolUse.parsedInput
	);
	const fallbackLabel = parsedToolUse.userFacingToolName;

	if (renderedToolUseMessage === null || renderedToolUseMessage === '') {
		return {
			text: fallbackLabel,
			content: <Text bold>{fallbackLabel}</Text>
		};
	}

	const renderedToolUseText = renderNodeToPlainText(
		renderedToolUseMessage
	).trim();
	return {
		text: renderedToolUseText
			? `${parsedToolUse.userFacingToolName} ${renderedToolUseText}`
			: fallbackLabel,
		content: (
			<Box flexDirection="row" flexWrap="wrap">
				<Text bold>{parsedToolUse.userFacingToolName}</Text>
				<Text>{' '}</Text>
				{renderedToolUseMessage}
			</Box>
		)
	};
}

function getAssistantToolUseViewportMessages(
	message: MessageType,
	fallbackId: number,
	tools: readonly Tool[]
): ViewportMessage[] {
	if (!Array.isArray(message.message?.content)) {
		return [];
	}

	return message.message.content
		.map((block, index): ViewportMessage | null => {
			if (!block || typeof block !== 'object') {
				return null;
			}

			const typedBlock = block as unknown as Record<string, unknown>;
			if (typedBlock.type !== 'tool_use') {
				return null;
			}

			const toolName =
				typeof typedBlock.name === 'string'
					? typedBlock.name
					: 'unknown_tool';
			const tool = findToolByName(tools, toolName);
			const item = buildAssistantToolUseRenderItem(tool, typedBlock);
			const toolUseId =
				typeof typedBlock.id === 'string' ? typedBlock.id : undefined;

			return {
				id: fallbackId * 100 + index + 1,
				role: 'tool',
				text: item.text,
				content: item.content,
				toolPhase: 'call',
				toolDisplayStyle: 'use',
				toolUseId,
				animatePrefix: 'blink'
			};
		})
		.filter((value): value is ViewportMessage => value !== null);
}

function updateAssistantToolUseViewportMessage(
	message: ViewportMessage,
	phase: 'done' | 'error'
): void {
	message.toolPhase = phase;
	message.animatePrefix = undefined;
}

function buildViewportMessages(
	messages: MessageType[],
	tools: readonly Tool[]
): ViewportMessage[] {
	const viewportMessages: ViewportMessage[] = [];
	const toolUseMessagesById = new Map<string, ViewportMessage>();

	messages.forEach((message, index) => {
		const fallbackId = index + 1;

		if (message.type === 'assistant') {
			const text = extractTextContent(message.message?.content);
			if (text) {
				viewportMessages.push({
					id: fallbackId,
					role: 'assistant',
					text
				});
			}

			const toolUseMessages = getAssistantToolUseViewportMessages(
				message,
				fallbackId,
				tools
			);
			if (toolUseMessages.length > 0) {
				toolUseMessages.forEach(viewportMessage => {
					viewportMessages.push(viewportMessage);
					if (viewportMessage.toolUseId) {
						toolUseMessagesById.set(
							viewportMessage.toolUseId,
							viewportMessage
						);
					}
				});
			}

			if (text || toolUseMessages.length > 0) {
				return;
			}
		}

		if (message.type === 'user' && isToolResultUserMessage(message)) {
			const toolResultBlock = getToolResultBlock(message);
			if (toolResultBlock) {
				const existingToolUseMessage = toolUseMessagesById.get(
					toolResultBlock.toolUseId
				);
				if (existingToolUseMessage) {
					updateAssistantToolUseViewportMessage(
						existingToolUseMessage,
						toolResultBlock.isError ? 'error' : 'done'
					);
				}
			}

			const viewportMessage = messageToViewport(
				message,
				fallbackId,
				messages,
				tools
			);
			if (viewportMessage) {
				viewportMessage.toolDisplayStyle = 'result';
				viewportMessages.push(viewportMessage);
			}
			return;
		}

		if (message.type === 'progress') {
			const viewportMessage = messageToViewport(
				message,
				fallbackId,
				messages,
				tools
			);
			if (viewportMessage) {
				viewportMessage.toolDisplayStyle = 'progress';
				viewportMessages.push(viewportMessage);
			}
			return;
		}

		const viewportMessage = messageToViewport(
			message,
			fallbackId,
			messages,
			tools
		);
		if (viewportMessage) {
			viewportMessages.push(viewportMessage);
		}
	});

	return viewportMessages;
}

function renderNodeToPlainText(node: React.ReactNode): string {
	if (node === null || node === undefined || typeof node === 'boolean') {
		return '';
	}

	if (typeof node === 'string' || typeof node === 'number') {
		return String(node);
	}

	if (Array.isArray(node)) {
		return node.map(child => renderNodeToPlainText(child)).join('');
	}

	if (React.isValidElement(node)) {
		const props = node.props as { children?: React.ReactNode };
		return renderNodeToPlainText(props.children);
	}

	return '';
}

function getToolResultBlock(message: MessageType): {
	toolUseId: string;
	isError: boolean;
	content: unknown;
} | null {
	if (!Array.isArray(message.message?.content)) {
		return null;
	}

	const block = message.message.content.find((contentBlock: unknown) => {
		if (!contentBlock || typeof contentBlock !== 'object') {
			return false;
		}

		return (contentBlock as unknown as Record<string, unknown>).type === 'tool_result';
	}) as
		| { tool_use_id?: unknown; is_error?: unknown; content?: unknown }
		| undefined;

	if (!block || typeof block.tool_use_id !== 'string') {
		return null;
	}

	return {
		toolUseId: block.tool_use_id,
		isError: Boolean(block.is_error),
		content: block.content
	};
}

function findAssistantToolUse(
	messages: MessageType[],
	message: MessageType,
	toolUseId: string
): { name: string; input: unknown } | null {
	const sourceAssistantUUID =
		typeof message.sourceToolAssistantUUID === 'string'
			? message.sourceToolAssistantUUID
			: null;

	const candidateMessages = sourceAssistantUUID
		? messages.filter(
				candidate => String(candidate.uuid) === sourceAssistantUUID
			)
		: messages;

	for (const candidate of candidateMessages) {
		if (!Array.isArray(candidate.message?.content)) {
			continue;
		}

		const toolUse = candidate.message.content.find((block: unknown) => {
			if (!block || typeof block !== 'object') {
				return false;
			}

			const typedBlock = block as unknown as Record<string, unknown>;
			return (
				typedBlock.type === 'tool_use' && typedBlock.id === toolUseId
			);
		}) as { name?: unknown; input?: unknown } | undefined;

		if (toolUse && typeof toolUse.name === 'string') {
			return {
				name: toolUse.name,
				input: toolUse.input
			};
		}
	}

	return null;
}

function appendUnique(values: string[], nextValue: string): string[] {
	return values.includes(nextValue) ? values : [...values, nextValue];
}

function buildStreamingPlaceholderText(
	streamingAssistant: StreamingAssistantState
): string {
	const sections: string[] = [];

	if (streamingAssistant.pendingToolCalls.length > 0) {
		sections.push(
			[
				'Requesting tools',
				...streamingAssistant.pendingToolCalls.map(
					label => `- ${label}`
				)
			].join('\n')
		);
	}

	if (streamingAssistant.text.trim().length > 0) {
		sections.push(streamingAssistant.text);
	}

	if (sections.length === 0) {
		return '正在思考...';
	}

	return sections.join('\n\n');
}

function isToolResultUserMessage(message: MessageType): boolean {
	if (message.type !== 'user' || !Array.isArray(message.message?.content)) {
		return false;
	}

	return message.message.content.some(block => {
		if (!block || typeof block !== 'object') {
			return false;
		}

		return (block as unknown as Record<string, unknown>).type === 'tool_result';
	});
}

function extractToolResult(message: MessageType): {
	text: string;
	phase: 'call' | 'done' | 'error';
} {
	if (!Array.isArray(message.message?.content)) {
		return { text: '', phase: 'done' };
	}

	const toolResult = message.message.content.find((block: unknown) => {
		if (!block || typeof block !== 'object') {
			return false;
		}

		return (block as unknown as Record<string, unknown>).type === 'tool_result';
	}) as { content?: unknown; is_error?: boolean } | undefined;

	const rawText =
		typeof toolResult?.content === 'string'
			? toolResult.content
			: JSON.stringify(toolResult?.content ?? '');

	return {
		text: rawText
			.replace(/<tool_use_error>/g, '')
			.replace(/<\/tool_use_error>/g, ''),
		phase: toolResult?.is_error ? 'error' : 'done'
	};
}

function messageToViewport(
	message: MessageType,
	fallbackId: number,
	messages: MessageType[],
	tools: readonly Tool[]
): ViewportMessage | null {
	if (message.type === 'user') {
		if (isToolResultUserMessage(message)) {
			const toolResultBlock = getToolResultBlock(message);
			const toolUse = toolResultBlock
				? findAssistantToolUse(
						messages,
						message,
						toolResultBlock.toolUseId
					)
				: null;
			const tool = toolUse
				? findToolByName(tools, toolUse.name)
				: undefined;

			if (toolResultBlock && !toolResultBlock.isError) {
				const renderedContent = renderToolResultContent(
					tool,
					message.toolUseResult,
					toolUse?.input,
					tools
				);

				if (renderedContent) {
					return {
						id: fallbackId,
						role: 'tool',
						text: renderNodeToPlainText(renderedContent),
						content: renderedContent,
						toolPhase: 'done'
					};
				}
			}

			if (toolResultBlock?.isError) {
				const renderedContent = renderToolErrorContent(
					tool,
					toolResultBlock.content,
					tools
				);

				if (renderedContent) {
					return {
						id: fallbackId,
						role: 'tool',
						text: renderNodeToPlainText(renderedContent),
						content: renderedContent,
						toolPhase: 'error'
					};
				}
			}

			const { text, phase } = extractToolResult(message);
			return text
				? {
						id: fallbackId,
						role: 'tool',
						text,
						toolPhase: phase
					}
				: null;
		}

		const text = extractTextContent(message.message?.content);
		return text
			? {
					id: fallbackId,
					role: 'user',
					text
				}
			: null;
	}

	if (message.type === 'assistant') {
		const text = extractTextContent(message.message?.content);
		if (text) {
			return {
				id: fallbackId,
				role: 'assistant',
				text
			};
		}

		const toolUseItems: ToolUseRenderItem[] = Array.isArray(
			message.message?.content
		)
			? message.message.content
					.map((block): ToolUseRenderItem | null => {
						if (!block || typeof block !== 'object') {
							return null;
						}

						const typedBlock = block as unknown as Record<string, unknown>;
						if (typedBlock.type !== 'tool_use') {
							return null;
						}

						const toolName =
							typeof typedBlock.name === 'string'
								? typedBlock.name
								: 'unknown_tool';
						const tool = findToolByName(tools, toolName);
						return buildAssistantToolUseRenderItem(
							tool,
							typedBlock
						);
					})
					.filter(
						(value): value is ToolUseRenderItem => value !== null
					)
			: extractToolUseLabels(message.message?.content).map(label => ({
					text: label,
					content: <Text>{label}</Text>
				}));

		return toolUseItems.length > 0
			? {
					id: fallbackId,
					role: 'tool',
					text: toolUseItems.map(item => item.text).join('\n'),
					content: (
						<Box flexDirection="column">
							{toolUseItems.map((item, index) => (
								<Box key={index} flexDirection="column">
									{item.content}
								</Box>
							))}
						</Box>
					),
					toolPhase: 'call'
				}
			: null;
	}

	if (message.type === 'progress') {
		const data =
			message.data && typeof message.data === 'object'
				? JSON.stringify(message.data)
				: String(message.data ?? 'working...');

		return {
			id: fallbackId,
			role: 'tool',
			text: data,
			toolPhase: 'call'
		};
	}

	if (message.type === 'system') {
		const text = extractTextContent(message.message?.content);
		return text
			? {
					id: fallbackId,
					role: 'assistant',
					text
				}
			: null;
	}

	return null;
}
export type Props = {
	commands: Command[];
	debug: boolean;
	initialTools: Tool[];
	// Initial messages to populate the REPL with
	initialMessages?: MessageType[];
	// Content-replacement records from a resumed session's transcript — used to
	// Initial agent context for session resume (name/color set via /rename or /color)
	initialAgentName?: string;
	autoConnectIdeFlag?: boolean;
	strictMcpConfig?: boolean;
	systemPrompt?: string;
	appendSystemPrompt?: string;
	// Optional callback invoked before query execution
	// Called after user message is added to conversation but before API call
	// Return false to prevent query execution
	onBeforeQuery?: (
		input: string,
		newMessages: MessageType[]
	) => Promise<boolean>;
	// Optional callback when a turn completes (model finishes responding)
	onTurnComplete?: (messages: MessageType[]) => void | Promise<void>;
	// When true, disables REPL input (hides prompt and prevents message selector)
	disabled?: boolean;
	// When true, disables all slash commands
	disableSlashCommands?: boolean;
	// Task list id: when set, enables tasks mode that watches a task list and auto-processes tasks.
	taskListId?: string;
	thinkingConfig: ThinkingConfig;
};
export default function QueryApp({
	commands:initialCommands,
	debug,
	initialMessages,
	initialTools,
	strictMcpConfig = false,
	systemPrompt: customSystemPrompt,
	appendSystemPrompt,
	onBeforeQuery,
	onTurnComplete,
	disabled = false,
	disableSlashCommands = false,
	taskListId,
	thinkingConfig
}: Props) {
	const { exit } = useApp();
	const { columns, rows } = useWindowSize();
	const [input, setInput] = useState('');
	const [cursorSyncKey, setCursorSyncKey] = useState(0);
	const [pastedContents, setPastedContents] = useState<Record<number, PastedContent>>({});
	const store = useAppStateStore();
	const { onHistoryUp, onHistoryDown, resetHistory } = useArrowKeyHistory(
		setInput,
		setPastedContents,
		input,
		pastedContents,
	);
	// Local state for commands (hot-reloadable when skill files change)
  	const [localCommands, setLocalCommands] = useState(initialCommands);
	const handleInputChange = useCallback((nextValue: string) => {
		setInput(nextValue);
		resetHistory();
	}, [resetHistory]);
  	const mainLoopModel = ""
  	const activeTools = initialTools.length > 0 ? initialTools : getAllBaseTools();
  	const mergedCommands = initialCommands
	const commands = useMemo(() => (disableSlashCommands ? [] : mergedCommands), [disableSlashCommands, mergedCommands]);
	const [alertMessage, setAlertMessage] = useState<string | null>(null);
	const [exitHint, setExitHint] = useState(false);
	const [streamingAssistant, setStreamingAssistant] =
		useState<StreamingAssistantState>({
			active: false,
			placeholderId: null,
			text: '',
			pendingToolCalls: []
		});
	const [messages, rawSetMessages] = useState<MessageType[]>([]);
	const [showCommandSelector, setShowCommandSelector] = useState(false);
	const [filteredCommands, setFilteredCommands] = useState(commands);
	  const [initialReadFileState] = useState(() => createFileStateCacheWithSizeLimit(READ_FILE_STATE_CACHE_SIZE));
	const readFileState = useRef(initialReadFileState);
	const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
	const appState = React.useSyncExternalStore(
		store.subscribe,
		store.getState,
		store.getState
	);
	const [toolUseConfirmQueue, setToolUseConfirmQueue] = useState<
		ToolUseConfirm[]
	>([]);
	const queryGuard = useRef(new QueryGuard()).current;
	const isQueryActive = React.useSyncExternalStore(
		queryGuard.subscribe,
		queryGuard.getSnapshot
	);
	const loading = isQueryActive;
	
	const messagesRef = useRef(messages);
	const appStateRef = useRef(appState);
	const [abortController, setAbortController] =
		useState<AbortController | null>(null);
	// 始终指向当前中止控制器的 Ref，用于在异步回调中读取最新 controller。
	const abortControllerRef = useRef<AbortController | null>(null);
	abortControllerRef.current = abortController;
	const readFileStateRef = useRef(new FileStateCache(500, 50 * 1024 * 1024));
	const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const nextPlaceholderIdRef = useRef(1);
	const scrollRef = useRef<ScrollBoxHandle | null>(null);
	const [animationTick, setAnimationTick] = useState(0);
	useEffect(() => {
		if (!loading) {
			setAnimationTick(0);
			return;
		}

		const timer = setInterval(() => {
			setAnimationTick(prev => prev + 1);
		}, 50);

		return () => clearInterval(timer);
	}, [loading]);

	const blinkVisible = Math.floor(animationTick / 14) % 2 === 0;
	const breathingCycle = 24;
	const breathingPhase = animationTick % breathingCycle;
	const breathingStrength =
		breathingPhase <= breathingCycle / 2
			? breathingPhase / (breathingCycle / 2)
			: (breathingCycle - breathingPhase) / (breathingCycle / 2);

	const setMessages = useCallback(
		(updater: React.SetStateAction<MessageType[]>) => {
			const next =
				typeof updater === 'function'
					? updater(messagesRef.current)
					: updater;
			messagesRef.current = next;
			rawSetMessages(next);
		},
		[]
	);

	const setAppState = useCallback(
		(updater: (prev: AppState) => AppState) => {
			store.setState(prev => {
				const next = updater(prev);
				appStateRef.current = next;
				return next;
			});
		},
		[store]
	);

	const setToolPermissionContext = useCallback(
		(context: ToolPermissionContext) => {
			setAppState(prev => ({
				...prev,
				toolPermissionContext: context
			}));
		},
		[setAppState]
	);
	const shiftToolUseConfirmQueue = useCallback(() => {
		setToolUseConfirmQueue(([, ...tail]) => tail);
	}, []);
	const handlePermissionReject = useCallback(() => undefined, []);

	const canUseTool = useCanUseTool(
		setToolUseConfirmQueue,
		setToolPermissionContext
	);

	useEffect(() => {
		messagesRef.current = messages;
	}, [messages]);

	useEffect(() => {
		appStateRef.current = appState;
	}, [appState]);


	const handleCommandSelect = useCallback((value: string) => {
		setInput(value);
		setCursorSyncKey(prev => prev + 1);
		setShowCommandSelector(false);
	}, []);

	const handleCtrlC = useCallback(() => {
		if (loading) {
			queryGuard.forceEnd();
			abortControllerRef.current?.abort('user-cancel');
			setAbortController(null);
			return;
		}

		if (exitHint) {
			if (exitTimerRef.current) {
				clearTimeout(exitTimerRef.current);
			}
			exit();
			return;
		}

		setInput('');
		setExitHint(true);
		if (exitTimerRef.current) {
			clearTimeout(exitTimerRef.current);
		}

		exitTimerRef.current = setTimeout(() => {
			setExitHint(false);
			exitTimerRef.current = null;
		}, 3000);
	}, [exit, exitHint, loading, queryGuard]);

	const repinScroll = useCallback(() => {
		scrollRef.current?.scrollToBottom();
	}, []);

	useInput(
		(_, key) => {
			if (!showCommandSelector) {
				return;
			}

			if (key.upArrow) {
				setSelectedCommandIndex(index => Math.max(0, index - 1));
				return;
			}

			if (key.downArrow) {
				setSelectedCommandIndex(index =>
					Math.min(filteredCommands.length - 1, index + 1)
				);
				return;
			}

		},
		{ isActive: showCommandSelector && toolUseConfirmQueue.length === 0 }
	);

	// const buildToolUseContext = useCallback(
	// 	(
	// 		nextMessages: MessageType[],
	// 		abortController: AbortController
	// 	): ToolUseContext => ({
	// 		options: {
	// 			debug: false,
	// 			verbose: false,
	// 			thinkingConfig: { type: 'disabled' },
	// 			mainLoopModel: getCurrentModel(),
	// 			tools: getAllBaseTools(),
	// 			isNonInteractiveSession: false,
	// 			customSystemPrompt,
	// 			appendSystemPrompt
	// 		},
	// 		readFileState: readFileStateRef.current,
	// 		abortController,
	// 		updateFileHistoryState: updater => {
	// 			void updater;
	// 		},
	// 		getAppState: () => appStateRef.current,
	// 		setAppState,
	// 		messages: nextMessages
	// 	}),
	// 	[appendSystemPrompt, canUseTool, customSystemPrompt, setAppState]
	// );

	const onQueryEvent = useCallback(
		(event: MessageType | { type: string; [key: string]: unknown }) => {
			handleMessageFromStream(event, {
				onMessageStart: () => {
					setStreamingAssistant(prev => ({
						active: true,
						placeholderId: prev.placeholderId,
						text: '',
						pendingToolCalls: []
					}));
				},
				onTextBlockStart: () => {
					setStreamingAssistant(prev => ({
						...prev,
						active: true
					}));
				},
				onToolUseBlockStart: toolName => {
					const toolLabel = toolName;
					setStreamingAssistant(prev => ({
						...prev,
						active: true,
						pendingToolCalls: appendUnique(
							prev.pendingToolCalls,
							toolLabel
						)
					}));
				},
				onTextDelta: text => {
					setStreamingAssistant(prev => ({
						...prev,
						active: true,
						text: prev.text + text
					}));
				},
				onMessageStop: () => {
					setStreamingAssistant(prev => ({
						...prev,
						active:
							prev.text.length > 0 ||
							prev.pendingToolCalls.length > 0
					}));
				},
				onTombstone: tombstone => {
					const targetUuid =
						tombstone.message &&
						typeof tombstone.message === 'object' &&
						'uuid' in tombstone.message
							? String(
									(
										tombstone.message as Record<
											string,
											unknown
										>
									).uuid ?? ''
								)
							: '';

					if (!targetUuid) {
						return;
					}

					setMessages(prev =>
						prev.filter(
							message => String(message.uuid) !== targetUuid
						)
					);
				},
				onMessage: message => {
					if (message.type === 'assistant') {
						setStreamingAssistant({
							active: false,
							placeholderId: null,
							text: '',
							pendingToolCalls: []
						});
					}
					setMessages(prev => [...prev, message]);
				}
			});
		},
		[setMessages]
	);
const getToolUseContext = useCallback(
		(
		messages: MessageType[],
		newMessages: MessageType[],
		abortController: AbortController,
		mainLoopModel: string,
		): ProcessUserInputContext => {
		// Read mutable values fresh from the store rather than closure-capturing
		// useAppState() snapshots. Same values today (closure is refreshed by the
		// render between turns); decouples freshness from React's render cycle for
		// a future headless conversation loop. Same pattern refreshTools() uses.
		const s = store.getState();
		return {
			abortController,
			options: {
			tools: activeTools,
			debug,
			verbose: false,
			thinkingConfig:{ type: 'disabled' },
			mainLoopModel,
			isNonInteractiveSession: false,
			customSystemPrompt,
			appendSystemPrompt,
			},
			getAppState: () => store.getState(),
			setAppState,
			messages,
			setMessages,
			updateFileHistoryState(updater: (prev: FileHistoryState) => FileHistoryState) {
			// Perf: skip the setState when the updater returns the same reference
			// (e.g. fileHistoryTrackEdit returns `state` when the file is already
			// tracked). Otherwise every no-op call would notify all store listeners.
			setAppState(prev => {
				const updated = updater(prev.fileHistory  as FileHistoryState);
				if (updated === prev.fileHistory) return prev;
				return { ...prev, fileHistory: updated };
			});
			},
			readFileState: readFileState.current,
			onChangeAPIKey: () => {}
			};
		},
		[
		 commands,
      debug,
      store,
      setAppState,
      setMessages,
      disabled,
      customSystemPrompt,
      appendSystemPrompt,
      activeTools,
		],
	);
	const onQueryImpl = useCallback(
		async (
			messagesIncludingNewMessages: MessageType[],
			_newMessages: MessageType[],
			abortController: AbortController,
			shouldQuery: boolean,
			_additionalAllowedTools: string[],
			mainLoopModelParam: string
		): Promise<void> => {
			if (!shouldQuery) {
				return;
			}
			const toolUseContext = getToolUseContext(
				messagesIncludingNewMessages,
				messagesIncludingNewMessages,
				abortController,
				mainLoopModelParam,
      		);
			const { tools: freshTools } = toolUseContext.options;
			const [defaultSystemPrompt, baseUserContext] = await Promise.all([
				getSystemPrompt(freshTools, mainLoopModelParam, [
					'F:\\pythonProject'
				]),
				getUserContext()
			]); //, getSystemContext()] systemContext
			const userContext = {
				...baseUserContext
			};
			const systemPrompt = buildEffectiveSystemPrompt({
				toolUseContext,
				customSystemPrompt,
				defaultSystemPrompt,
				appendSystemPrompt
			});

			try {
				for await (const event of query({
					messages: messagesIncludingNewMessages,
					systemPrompt: systemPrompt,
					userContext: userContext,
					systemContext: {},
					canUseTool,
					toolUseContext: toolUseContext,
					querySource: 'repl_main_thread'
				})) {
					onQueryEvent(event as MessageType);
				}
			} catch (error) {
				if (error instanceof Error && error.name === 'AbortError') {
					setAlertMessage('当前请求已取消');
				} else {
					setAlertMessage(
						error instanceof Error ? error.message : String(error)
					);
				}
			}
		},
		[getToolUseContext, onQueryEvent]
	);

	const onQuery = useCallback(
		async (
			newMessages: MessageType[],
			abortController: AbortController,
			shouldQuery: boolean,
			additionalAllowedTools: string[],
			mainLoopModel: string
		): Promise<void> => {
			const thisGeneration = queryGuard.tryStart();
			if (thisGeneration === null) {
				return;
			}
			setMessages(oldMessages => [...oldMessages, ...newMessages]);
			setInput('');
			setStreamingAssistant({
				active: false,
				placeholderId: nextPlaceholderIdRef.current++,
				text: '',
				pendingToolCalls: []
			});

			try {
				const latestMessages = messagesRef.current;
				await onQueryImpl(
					latestMessages,
					newMessages,
					abortController,
					shouldQuery,
					additionalAllowedTools,
					mainLoopModel
				);
			} finally {
				if (queryGuard.end(thisGeneration) && shouldQuery) {
					setStreamingAssistant({
						active: false,
						placeholderId: null,
						text: '',
						pendingToolCalls: []
					});
					setAppState(prev => ({
						...prev,
						mainLoopModel: getCurrentModel()
					}));
				}
			}
		},
		[onQueryImpl, queryGuard, setAppState, setMessages]
	);

	const onSubmit = useCallback(
		async (value: string) => {
			const text = value.trim();
			repinScroll(); //滚回底部
			if (text.startsWith('/')) {
				//展开文本
				const trimmedInput = expandPastedTextRefs(
					value,
					pastedContents
				).trim();
				const spaceIndex = trimmedInput.indexOf(' ');
				const commandName = spaceIndex === -1 ? trimmedInput.slice(1) : trimmedInput.slice(1, spaceIndex);
				const commandArgs = spaceIndex === -1 ? '' : trimmedInput.slice(spaceIndex + 1).trim();
				// Find matching command - treat as immediate if:
				// 1. Command has `immediate: true`, OR
				// 2. Command was triggered via keybinding (fromKeybinding option)
				const matchingCommand = commands.find(
				cmd =>
					isCommandEnabled(cmd) &&
					(cmd.name === commandName || cmd.aliases?.includes(commandName) || getCommandName(cmd) === commandName),
				);
				const shouldTreatAsImmediate =  (matchingCommand?.immediate);
				// if (matchingCommand && shouldTreatAsImmediate && matchingCommand.type === 'local-jsx') {
				// const pastedTextRefs = parseReferences(input).filter(r => pastedContents[r.id]?.type === 'text');
				// const pastedTextCount = pastedTextRefs.length;
				// const pastedTextBytes = pastedTextRefs.reduce(
				// 	(sum, r) => sum + (pastedContents[r.id]?.content.length ?? 0),
				// 	0,
				// );
				// // Execute the command directly
				// const executeImmediateCommand = async (): Promise<void> => {
				// 	let doneWasCalled = false;
				// 	const onDone = (
				// 	result?: string,
				// 	doneOptions?: {
				// 		display?: CommandResultDisplay;
				// 		metaMessages?: string[];
				// 	},
				// 	): void => {
				// 	doneWasCalled = true;
				// 	// setToolJSX({
				// 	// 	jsx: null,
				// 	// 	shouldHidePromptInput: false,
				// 	// 	clearLocalJSX: true,
				// 	// });
				// 	const newMessages: MessageType[] = [];
				// 	// Inject meta messages (model-visible, user-hidden) into the transcript
				// 	if (doneOptions?.metaMessages?.length) {
				// 		newMessages.push(
				// 		...doneOptions.metaMessages.map(content => createUserMessage({ content, isMeta: true })),
				// 		);
				// 	}
				// 	if (newMessages.length) {
				// 		setMessages(prev => [...prev, ...newMessages]);
				// 	}

				// };

				// 	// Build context for the command (reuses existing getToolUseContext).
				// 	// Read messages via ref to keep onSubmit stable across message
				// 	// updates — matches the pattern at L2384/L2400/L2662 and avoids
				// 	// pinning stale REPL render scopes in downstream closures.
				// 	const context = getToolUseContext(messagesRef.current, [], createAbortController(), mainLoopModel);

				// 	const mod = await matchingCommand.load();
				// 	const jsx = await mod.call(onDone, context, commandArgs);

				// 	};
				// 	void executeImmediateCommand();
				// 	return; // Always return early - don't add to history or queue
				// }
			}
			addToHistory({
				display: value,
				pastedContents: pastedContents,
			});
			resetHistory();
			setAlertMessage(null);

			
			await handlePromptSubmit({
				input: value,
				onInputChange: setInput,
				helpers: {
					setCursorOffset: () => {
						setCursorSyncKey(prev => prev + 1);
					},
					clearBuffer: () => {
						setCursorSyncKey(prev => prev + 1);
					},
					resetHistory,
				},
				setAbortController,
				getToolUseContext,
				pastedContents,
				setPastedContents,
				onQuery,
				messages,
				mainLoopModel,
				commands,
				setAppState,
				queryGuard,
			});
		},
		[
			commands,
			getToolUseContext,
			mainLoopModel,
			messages,
			onQuery,
			pastedContents,
			queryGuard,
			repinScroll,
			resetHistory,
			setAppState
		]
	);
	
	const terminalColumns = columns || process.stdout.columns || 80;
	const terminalRows = rows || process.stdout.rows || 24;
	const messageWidth = Math.max(8, terminalColumns - 4);
	const promptInputWidth = Math.max(8, terminalColumns - 6);
	const inputRule = '─'.repeat(Math.max(8, terminalColumns - 2));
	const maxPromptInputRows = Math.max(1, MAX_PROMPT_INPUT_ROWS);

	const renderTools = activeTools;
	const viewportMessages = buildViewportMessages(messages, renderTools);

	if (loading && streamingAssistant.placeholderId !== null) {
		if (streamingAssistant.text.trim().length > 0) {
			viewportMessages.push({
				id: streamingAssistant.placeholderId,
				role: 'assistant',
				text: buildStreamingPlaceholderText(streamingAssistant),
				animatePrefix: 'blink'
			});
		} else if (streamingAssistant.pendingToolCalls.length > 0) {
			viewportMessages.push({
				id: streamingAssistant.placeholderId,
				role: 'tool',
				text: streamingAssistant.pendingToolCalls.join('\n'),
				toolPhase: 'call',
				toolDisplayStyle: 'use',
				animatePrefix: 'blink'
			});
		}
	}

	const transcriptHeaderLines = getTranscriptHeaderLines({
		cwd: process.cwd(),
		model: getCurrentModel(),
		effort: getEffortLevel(),
		width: messageWidth,
		welcome: messages.length === 0 && !loading
	});

	const activeToolUseConfirm = toolUseConfirmQueue[0];
	const statusText = loading
		? streamingAssistant.text.trim().length > 0
			? 'Efrex 正在生成回复...'
			: streamingAssistant.pendingToolCalls.length > 0
				? 'Efrex 正在请求工具...'
				: 'Efrex 正在思考...'
		: null;
	const statusMode = loading
		? streamingAssistant.pendingToolCalls.length > 0
			? 'requesting'
			: 'default'
		: null;

	const statusPrefix = statusText ? '•' : null;
	const statusPrefixDim = breathingStrength < 0.35;
	const statusPrefixBold = breathingStrength > 0.7;

	const statusMessageWidth = statusText ? stringWidth(statusText) : 0;
	const glimmerSpeed = statusMode === 'requesting' ? 55 : 50;
	const elapsedMs = animationTick * 50;
	const glimmerCycleLength = statusMessageWidth + GLIMMER_PAD_COLUMNS * 2;
	const cyclePosition =
		glimmerCycleLength > 0 ? Math.floor(elapsedMs / glimmerSpeed) : 0;
	const glimmerIndex = statusText
		? (cyclePosition % glimmerCycleLength) - GLIMMER_PAD_COLUMNS
		: 0;
	const statusSegments = statusText
		? getStatusLabelSegments(statusText, glimmerIndex)
		: null;
  // Process queued commands when query completes and queue has items

	const executeQueuedInput = useCallback(
		async (queuedCommands: QueuedCommand[]) => {
		await handlePromptSubmit({
			helpers: {
			setCursorOffset: () => {},
			clearBuffer: () => {},
			resetHistory: () => {},
			},
			queryGuard,
			commands,
			onInputChange: () => {},
			setPastedContents: () => {},
			getToolUseContext,
			messages,
			mainLoopModel,
			setAbortController,
			onQuery,
			setAppState,
			onBeforeQuery,
			setMessages,
			queuedCommands,
		});
		},
		[
		queryGuard,
		commands,
		getToolUseContext,
		messages,
		mainLoopModel,
		canUseTool,
		setAbortController,
		onQuery,
		setAppState,
		onBeforeQuery,
		],
	);

	useQueueProcessor({
		executeQueuedInput,
		queryGuard,
	});
	const bottomContent = (
		<Box flexDirection="column" width="100%">
			{loading &&
			!activeToolUseConfirm &&
			statusText &&
			statusPrefix &&
			statusSegments ? (
				<Box flexDirection="column" flexShrink={0} marginTop={1}>
					<Box
						flexDirection="row"
						flexWrap="nowrap"
						flexShrink={0}
					>
						<Box flexShrink={0} width={3}>
							<Text
								color="yellowBright"
								dim={statusPrefixDim}
								bold={statusPrefixBold}
							>
								{statusPrefix}{' '}
							</Text>
						</Box>
						<Box flexDirection="row" flexWrap="nowrap" flexShrink={1}>
							<Text color="gray">{statusSegments.before}</Text>
							{statusSegments.shimmer ? (
								<Text color="cyanBright" bold>
									{statusSegments.shimmer}
								</Text>
							) : null}
							<Text color="gray">{statusSegments.after}</Text>
						</Box>
					</Box>
				</Box>
			) : null}

			{activeToolUseConfirm ? (
				<PermissionRequest
					key={activeToolUseConfirm.toolUseID}
					onDone={shiftToolUseConfirmQueue}
					onReject={handlePermissionReject}
					toolUseConfirm={activeToolUseConfirm}
					toolUseContext={activeToolUseConfirm.toolUseContext}
					verbose={false}
					workerBadge={undefined}
				/>
			) : null}

			<Box flexDirection="column" flexShrink={0}>
				<PromptInputQueuedCommands width={terminalColumns} />
				<Text color={loading ? 'blue' : 'gray'}>{inputRule}</Text>
				<Box
					flexDirection="row"
					flexWrap="nowrap"
					width={terminalColumns - 2}
				>
					<Text color={loading ? 'blueBright' : 'greenBright'}>
						›{' '}
					</Text>
					<PromptInput
						messages={messages}
						value={input}
						height={terminalRows}
						width={promptInputWidth}
						maxVisibleLines={maxPromptInputRows}
						cursorSyncKey={cursorSyncKey}
						isActive={!activeToolUseConfirm}
						suspendSubmit={showCommandSelector}
						suspendVerticalArrows={showCommandSelector}
						onChange={handleInputChange}
						onSubmit={onSubmit}
						onHistoryPrev={onHistoryUp}
						onHistoryNext={onHistoryDown}
						onCtrlC={handleCtrlC}
						placeholder={loading ? '等待 query.ts 响应中...' : ''}
						pastedContents={pastedContents}
						setPastedContents={setPastedContents}
					/>
				</Box>
				<Text color={loading ? 'blue' : 'gray'}>{inputRule}</Text>
			</Box>

			<Box flexDirection="column" flexShrink={0}>
				<Box>
					{exitHint ? (
						<Text dimColor>再按一次 Ctrl+C 确认退出</Text>
					) : (
						<Text color="gray">
							Enter 发送  Ctrl+C 退出
						</Text>
					)}
				</Box>
			</Box>
		</Box>
	);

	const scrollableContent = (
		<MessageViewport
			headerLines={transcriptHeaderLines}
			messages={viewportMessages}
			width={messageWidth}
			alertMessage={alertMessage}
			statusLine={null}
			blinkOn={blinkVisible}
		/>
	);

	if (isFullscreenEnvEnabled()) {
		return (
			<AlternateScreen mouseTracking>
				<ScrollKeybindingHandler
					scrollRef={scrollRef}
					isActive
				/>
				<FullscreenLayout
					scrollRef={scrollRef}
					scrollable={scrollableContent}
					bottom={bottomContent}
				/>
			</AlternateScreen>
		);
	}

	return (
		<Box flexDirection="column" paddingX={1} paddingY={0}>
			{scrollableContent}
			{bottomContent}
		</Box>
	);
}
