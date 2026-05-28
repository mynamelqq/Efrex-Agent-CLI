import React, { useCallback, useEffect, useRef, useState } from 'react';
import chalk from 'chalk';
// import { useMainLoopModel } from './hooks/useMainLoopModel.js';
import { CommandResultDisplay } from './types/command.js';
import { Command,getCommandName } from './types/command.js';
import { useQueueProcessor } from './hooks/useQueueProcessor.js';
import { randomUUID } from 'node:crypto';
import { FileHistoryState } from './utils/fileHistory.js';
import { isCompactBoundaryMessage } from './utils/messages.js';
import {
	Box,
	Text,
	useApp,
	useInput,
	useTerminalFocus,
	useWindowSize
} from './ink.js';
import { stringWidth } from './ink/stringWidth.js';
import { createAbortController } from './utils/abortController.js';
import { createFileStateCacheWithSizeLimit,READ_FILE_STATE_CACHE_SIZE } from './utils/fileStateCache.js';
import { useAppStateStore,useSetAppState } from './state/AppState.js';
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
import MessagesScrollback from './components/MessagesScrollback.js';
import FullscreenLayout from './components/FullscreenLayout.js';
import { ScrollKeybindingHandler } from './components/ScrollKeybindingHandler.js';
import { PastedContent } from './utils/config.js';
import { parseReferences } from './history.js';
import type { Message as MessageType } from './package/message.js';
import {
	findToolByName,
	type CompactProgressEvent,
	type SetToolJSXFn,
	type Tool,
	type ToolPermissionContext,
	type ToolUseContext
} from './Tool.js';
import { expandPastedTextRefs } from './history.js';
import { getAllBaseTools } from './tools.js';
import { query } from './query.js';
import { handlePromptSubmit } from './utils/handlePromptSubmit.js';
import { getAnthropicModel } from './utils/anthropicConfig.js';
import { FileStateCache } from './utils/fileStateCache.js';
import { getSystemPrompt } from './constants/prompts.js';
import { getUserContext,getSystemContext } from './context.js';
import { createUserMessage } from './utils/messages.js';
import { extractTag, isSystemLocalCommandMessage } from './utils/messages.js';
import { getDefaultAppState, type AppState} from './state/AppStateStore.js';
import { useAppState } from './state/AppState.js';
import { EffortLevel, ThinkingConfig } from './utils/effort.js';
import { handleMessageFromStream } from './utils/handleMessageFromStream.js';
import useCanUseTool from './hooks/useCanUseTool.js';
import { QueryGuard } from './utils/QueryGuard.js';
import { useTranscriptHeaderInfo } from './hooks/useTranscriptHeaderInfo.js';
import type { QueuedCommand } from './types/textInputTypes.js';
import { PromptInputQueuedCommands } from './components/PromptInput/PromptInputQueuedCommands.js';
import { isFullscreenEnvEnabled } from './utils/fullscreen.js';
import { cyclePermissionMode } from './utils/permissions/getNextPermissionMode.js';
import {
	getPermissionModeConfig
} from './utils/permissions/PermissionMode.js';
import {
	PermissionRequest,
	type ToolUseConfirm
} from './components/permissions/PermissionRequest.js';
import {
	COMMAND_ARGS_TAG,
	COMMAND_NAME_TAG,
	LOCAL_COMMAND_CAVEAT_TAG,
	LOCAL_COMMAND_STDERR_TAG,
	LOCAL_COMMAND_STDOUT_TAG
} from './constants/xml.js';
import {
	renderToolErrorContent,
	renderToolResultContent,
	renderToolUseContent
} from './components/messages/renderToolContent.js';
import StatusAnimationRow from './components/StatusAnimationRow.js';
import { CLI_APP_VERSION } from 'utils/load.js';
import { logForDebugging } from './utils/debug.js';
type ViewportMessage = {
	id: number;
	role: 'user' | 'assistant' | 'tool' | 'meta';
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

type AssistantContentSegment = {
	text: string;
	dimColor: boolean;
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

type CompactUiState = {
	active: boolean;
	streamMode: 'requesting' | 'responding';
	responseLength: number;
	statusText: string | null;
};

type AppScreen = 'prompt' | 'transcript';

type CompletedTurnFooter = {
	afterMessageCount: number;
	text: string;
};

type SlashCommandMatch = {
	command: Command;
	displayName: string;
};

const MAX_PROMPT_INPUT_ROWS = 6;
const COMMAND_SELECTOR_VISIBLE_COUNT = 8;
const APP_BRAND = 'efrex code';
const APP_VERSION = CLI_APP_VERSION;
const COMMAND_ROW_SELECTED_FG = '#7dd3fc';
const COMMAND_ROW_SELECTED_DESC = '#b7c9d3';
const TURN_META_ID_BASE = 1_000_000_000;

const GLIMMER_PAD_COLUMNS = 10;
const GLIMMER_WIDTH_COLUMNS = 8;
const statusSegmenter =
	typeof Intl !== 'undefined' && 'Segmenter' in Intl
		? new Intl.Segmenter('zh-Hans', { granularity: 'grapheme' })
		: null;

function getCurrentModel(): string {
	return getAnthropicModel();
}

function getSlashCommandMatches(
	value: string,
	commands: Command[]
): SlashCommandMatch[] {
	if (!value.startsWith('/')) {
		return [];
	}

	const trimmed = value.trimStart();
	if (!trimmed.startsWith('/')) {
		return [];
	}

	const body = trimmed.slice(1);
	if (body.includes(' ')) {
		return [];
	}

	const query = body.toLowerCase();
	const matches = commands
		.filter(command => isCommandEnabled(command))
		.map(command => ({
			command,
			displayName: getCommandName(command)
		}))
		.filter(({ command, displayName }) => {
			if (!query) {
				return true;
			}

			return getCommandMatchRank(command, displayName, query) !== null;
		});

	return matches.sort((a, b) => {
		if (!query) {
			return a.displayName.localeCompare(b.displayName);
		}

		const aRank = getCommandMatchRank(a.command, a.displayName, query);
		const bRank = getCommandMatchRank(b.command, b.displayName, query);
		if (aRank === null && bRank === null) {
			return a.displayName.localeCompare(b.displayName);
		}
		if (aRank === null) {
			return 1;
		}
		if (bRank === null) {
			return -1;
		}

		if (aRank.bucket !== bRank.bucket) {
			return aRank.bucket - bRank.bucket;
		}
		if (aRank.index !== bRank.index) {
			return aRank.index - bRank.index;
		}
		return a.displayName.localeCompare(b.displayName);
	});
}

function getCommandMatchRank(
	command: Command,
	displayName: string,
	query: string
): { bucket: number; index: number } | null {
	const display = displayName.toLowerCase();
	const internalName = command.name.toLowerCase();
	const aliases = command.aliases?.map(alias => alias.toLowerCase()) ?? [];
	const description = command.description.toLowerCase();

	const displayPrefix = display.startsWith(query) ? 0 : -1;
	if (displayPrefix === 0) {
		return { bucket: 0, index: 0 };
	}

	const internalPrefix = internalName.startsWith(query) ? 0 : -1;
	if (internalPrefix === 0) {
		return { bucket: 1, index: 0 };
	}

	const aliasPrefix = aliases.findIndex(alias => alias.startsWith(query));
	if (aliasPrefix !== -1) {
		return { bucket: 2, index: aliasPrefix };
	}

	const displayIndex = display.indexOf(query);
	if (displayIndex !== -1) {
		return { bucket: 3, index: displayIndex };
	}

	const internalIndex = internalName.indexOf(query);
	if (internalIndex !== -1) {
		return { bucket: 4, index: internalIndex };
	}

	const aliasContains = aliases
		.map(alias => alias.indexOf(query))
		.find(index => index !== -1);
	if (aliasContains !== undefined) {
		return { bucket: 5, index: aliasContains };
	}

	const descriptionIndex = description.indexOf(query);
	if (descriptionIndex !== -1) {
		return { bucket: 6, index: descriptionIndex };
	}

	return null;
}

function getSlashCommandQuery(value: string): string {
	if (!value.startsWith('/')) {
		return '';
	}

	const trimmed = value.trimStart();
	if (!trimmed.startsWith('/')) {
		return '';
	}

	const body = trimmed.slice(1);
	return body.includes(' ') ? '' : body;
}

function getVisibleWindow<T>(
	items: T[],
	selectedIndex: number,
	visibleCount: number
): { items: T[]; startIndex: number } {
	if (items.length <= visibleCount) {
		return { items, startIndex: 0 };
	}

	const maxStart = Math.max(0, items.length - visibleCount);
	const centeredStart = selectedIndex - Math.floor(visibleCount / 2);
	const startIndex = Math.max(0, Math.min(centeredStart, maxStart));
	return {
		items: items.slice(startIndex, startIndex + visibleCount),
		startIndex
	};
}

function renderHighlightedText(
	text: string,
	query: string,
	selected = false
): React.ReactNode {
	if (!query) {
		return text;
	}

	const lowerText = text.toLowerCase();
	const lowerQuery = query.toLowerCase();
	const matchIndex = lowerText.indexOf(lowerQuery);
	if (matchIndex === -1) {
		return text;
	}

	const matched = text.slice(matchIndex, matchIndex + query.length);
	return (
		<>
			{text.slice(0, matchIndex)}
			<Text
				color={selected ? COMMAND_ROW_SELECTED_FG : 'cyanBright'}
				bold
			>
				{matched}
			</Text>
			{text.slice(matchIndex + query.length)}
		</>
	);
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
function padDisplay(text: string, width: number): string {
    return `${text}${' '.repeat(Math.max(0, width - stringWidth(text)))}`;
}

function centerDisplay(text: string, width: number): string {
    const textWidth = stringWidth(text);
    const leftPad = Math.max(0, Math.floor((width - textWidth) / 2));
    return `${' '.repeat(leftPad)}${text}${' '.repeat(Math.max(0, width - textWidth - leftPad))}`;
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

function formatWorkedDuration(ms: number): string {
	if (ms < 60000) {
		return `${Math.max(0, Math.floor(ms / 1000))}s`;
	}

	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const seconds = totalSeconds % 60;
	const totalMinutes = Math.floor(totalSeconds / 60);
	const minutes = totalMinutes % 60;
	const hours = Math.floor(totalMinutes / 60);

	if (hours > 0) {
		return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
	}

	return `${totalMinutes}m ${String(seconds).padStart(2, '0')}s`;
}

function buildTurnDurationLine(durationMs: number, width: number): string {
	const label = `done · ${formatWorkedDuration(durationMs)}`;
	return fitDisplay(label, Math.max(1, width));
}

function getTranscriptHeaderLines({
	cwd,
	model,
	effort,
	width,
	welcome
}: {
	cwd: string;
	model: string |null;
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
	model = truncateDisplay(model as string, 21);
	const primary = chalk.hex('#23d3b6');
	const brandColor = chalk.hex('#4da3ff');
	const muted = chalk.gray;
	const brand = `${primary.bold('»')} ${brandColor.bold(APP_BRAND)} ${muted(APP_VERSION)}`;
	const brandPlain = `» ${APP_BRAND} ${APP_VERSION}`;
	const rule = muted(
		` ${'─'.repeat(Math.max(0, boxWidth - stringWidth(brandPlain) - 2))}`
	);

	// if (!welcome || boxWidth < 72) {
	// 	return [`${brand}${rule}`, chalk.gray(fitDisplay(meta, boxWidth)), ''];
	// }

	const leftWidth = Math.max(28, Math.min(52, Math.floor(innerWidth * 0.42)));
	const rightWidth = Math.max(20, innerWidth - leftWidth - 1);
	const border = chalk.hex('#2f6f89');
	const divider = chalk.hex('#2b9c8c');
	const top = `${border(`╭${'─'.repeat(leftWidth)}`)}${divider(`┬${'─'.repeat(rightWidth)}╮`)}`;
	const bottom = `${border(`╰${'─'.repeat(leftWidth)}`)}${divider(`┴${'─'.repeat(rightWidth)}╯`)}`;
	const row = (
		leftPlain: string,
		leftStyled: string,
		rightPlain: string,
		rightStyled: string
	) =>
		`${border('│')}${leftStyled}${' '.repeat(Math.max(0, leftWidth - stringWidth(leftPlain)))}${divider('│')}${rightStyled}${' '.repeat(Math.max(0, rightWidth - stringWidth(rightPlain)))}${divider('│')}`;
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
		const rightCell = right(rightText, value => muted(value));
		return row(
			leftPlain,
			muted(leftPlain),
			rightCell.plain,
			rightCell.styled
		);
	};
	const action = (value: string) =>
		muted(value.replace('→', primary.bold('→')));

	return [
		`${brand}${rule}`,
		top,
		makeRow(
			'efrex code',
			'✦  Getting Started',
			value => brandColor.bold(value),
			value => primary.bold(value)
		),
		makeRow(
			'AI Coding Assistant',
			'Ask anything, edit code, run commands.',
			value => muted(value),
			value => muted(value)
		),
		makeRow(
			'Power your ideas with code.',
			'Let efrex code handle the rest.',
			value => muted(value),
			value => muted(value)
		),
		makeRow(
			'╭ ────── ╮',
			'✦  Tips',
			value => brandColor(value),
			value => primary.bold(value)
		),
		// makeRow('╰─┬──┬─╯', '→  Ask questions about your codebase', value => chalk.blueBright(value), value => chalk.gray(value.replace('→', chalk.yellowBright('→')))),
		// makeRow('      ', '', value => chalk.blueBright(value)),
		makeRow(
			'│  •  •  │',
			'→  Ask questions about your codebase',
			value => brandColor(value),
			action
		),
		makeRow(
			'╰─┬──┬─╯',
			'→  Generate or refactor code',
			value => brandColor(value),
			action
		),
		makeRow(
			`model: ${model} | effort: ${effort} `,
			'→  Run shell commands and analyze results',
			value => muted(value),
			action
		),
		makeRow(`${cwd}`, '', value => brandColor.bold(value), value => value),
		// makeRow('Type /help to see available commands', '→  Use natural language to automate tasks', value => chalk.gray(value.replace('/help', chalk.cyanBright('/help'))), value => chalk.gray(value.replace('→', chalk.yellowBright('→')))),
		bottom,
		''
	];
}

function extractTextContent(
	content: unknown,
	{ includeThinking = false }: { includeThinking?: boolean } = {}
): string {
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

			if (
				includeThinking &&
				typedBlock.type === 'thinking' &&
				typeof typedBlock.thinking === 'string'
			) {
				return `Thinking\n${typedBlock.thinking}`;
			}

			if (
				includeThinking &&
				typedBlock.type === 'redacted_thinking' &&
				typeof typedBlock.data === 'string'
			) {
				return `Redacted thinking\n${typedBlock.data}`;
			}

			return '';
		})
		.filter(Boolean)
		.join('\n');
}

function extractAssistantContentSegments(
	content: unknown,
	includeThinking = false
): AssistantContentSegment[] {
	if (typeof content === 'string') {
		return [{ text: content, dimColor: false }];
	}

	if (!Array.isArray(content)) {
		return [];
	}

	const segments: AssistantContentSegment[] = [];
	for (const block of content) {
		if (!block || typeof block !== 'object') {
			continue;
		}

		const typedBlock = block as unknown as Record<string, unknown>;
		if (typedBlock.type === 'text' && typeof typedBlock.text === 'string') {
			segments.push({ text: typedBlock.text, dimColor: false });
			continue;
		}

		if (
			includeThinking &&
			typedBlock.type === 'thinking' &&
			typeof typedBlock.thinking === 'string'
		) {
			segments.push({ text: typedBlock.thinking, dimColor: true });
			continue;
		}

		if (
			includeThinking &&
			typedBlock.type === 'redacted_thinking' &&
			typeof typedBlock.thinking === 'string'
		) {
			segments.push({ text: typedBlock.thinking, dimColor: true });
			continue;
		}

		if (
			includeThinking &&
			typedBlock.type === 'redacted_thinking' &&
			typeof typedBlock.data === 'string'
		) {
			segments.push({ text: typedBlock.data, dimColor: true });
		}
	}

	return segments;
}

function buildAssistantContentNode(
	segments: AssistantContentSegment[]
): React.ReactNode {
	return (
		<Box flexDirection="column" width="100%">
			{segments.map((segment, index) => (
				<Text
					key={index}
					color={segment.dimColor ? '#6b7280' : undefined}
					dimColor={false}
					wrap="wrap"
				>
					{segment.text}
				</Text>
			))}
		</Box>
	);
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


function buildLocalCommandViewport(
	content: string,
	fallbackId: number
): ViewportMessage | null | 'hidden' {
	if (content.includes(`<${LOCAL_COMMAND_CAVEAT_TAG}>`)) {
		return 'hidden';
	}

	const commandName = extractTag(content, COMMAND_NAME_TAG);
	if (commandName) {
		const args = extractTag(content, COMMAND_ARGS_TAG)?.trim() ?? '';
		return {
			id: fallbackId,
			role: 'user',
			text: args ? `${commandName} ${args}` : commandName
		};
	}

	const stdout = extractTag(content, LOCAL_COMMAND_STDOUT_TAG)?.trim();
	if (stdout) {
		return {
			id: fallbackId,
			role: 'tool',
			text: stdout,
			toolPhase: 'done'
		};
	}

	const stderr = extractTag(content, LOCAL_COMMAND_STDERR_TAG)?.trim();
	if (stderr) {
		return {
			id: fallbackId,
			role: 'tool',
			text: stderr,
			toolPhase: 'error'
		};
	}

	return null;
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
	block: Record<string, unknown>,
	verbose: boolean
): ToolUseRenderItem {
	const parsedToolUse = parseAssistantToolUse(tool, block);
	const renderedToolUseMessage = renderToolUseContent(
		tool,
		parsedToolUse.parsedInput,
		verbose
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
	tools: readonly Tool[],
	verbose: boolean
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
			const item = buildAssistantToolUseRenderItem(tool, typedBlock, verbose);
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
	tools: readonly Tool[],
	completedTurnFooters: CompletedTurnFooter[] = [],
	verbose = false
): ViewportMessage[] {
	const viewportMessages: ViewportMessage[] = [];
	const toolUseMessagesById = new Map<string, ViewportMessage>();
	const pendingFooters = [...completedTurnFooters];
	const appendCompletedTurnFooter = (messageCount: number) => {
		while (
			pendingFooters.length > 0 &&
			pendingFooters[0].afterMessageCount === messageCount
		) {
			const footer = pendingFooters.shift();
			if (!footer) {
				break;
			}

			viewportMessages.push({
				id: TURN_META_ID_BASE + viewportMessages.length + 1,
				role: 'meta',
				text: footer.text
			});
		}
	};

	messages.forEach((message, index) => {
		const fallbackId = index + 1;

		if (message.type === 'assistant') {
			let hasAssistantContent = false;
			if (verbose) {
				const assistantViewport = messageToViewport(
					message,
					fallbackId,
					messages,
					tools,
					verbose
				);
				if (assistantViewport?.role === 'assistant') {
					viewportMessages.push(assistantViewport);
					hasAssistantContent = true;
				}
			}

			if (!hasAssistantContent) {
				const text = extractTextContent(message.message?.content, {
					includeThinking: verbose
				});
				if (text) {
					viewportMessages.push({
						id: fallbackId,
						role: 'assistant',
						text
					});
					hasAssistantContent = true;
				}
			}

			const toolUseMessages = getAssistantToolUseViewportMessages(
				message,
				fallbackId,
				tools,
				verbose
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

			if (hasAssistantContent || toolUseMessages.length > 0) {
				appendCompletedTurnFooter(fallbackId);
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
				tools,
				verbose
			);
			if (viewportMessage) {
				viewportMessage.toolDisplayStyle = 'result';
				viewportMessages.push(viewportMessage);
			}
			appendCompletedTurnFooter(fallbackId);
			return;
		}

		if (message.type === 'progress') {
			const viewportMessage = messageToViewport(
				message,
				fallbackId,
				messages,
				tools,
				verbose
			);
			if (viewportMessage) {
				viewportMessage.toolDisplayStyle = 'progress';
				viewportMessages.push(viewportMessage);
			}
			appendCompletedTurnFooter(fallbackId);
			return;
		}

		const viewportMessage = messageToViewport(
			message,
			fallbackId,
			messages,
			tools,
			verbose
		);
		if (viewportMessage) {
			viewportMessages.push(viewportMessage);
		}
		appendCompletedTurnFooter(fallbackId);
	});

		while (pendingFooters.length > 0) {
			const footer = pendingFooters.shift();
			if (!footer) {
				break;
			}

			viewportMessages.push({
				id: TURN_META_ID_BASE + viewportMessages.length + 1,
				role: 'meta',
				text: ''
			});
			viewportMessages.push({
				id: TURN_META_ID_BASE + viewportMessages.length + 1,
				role: 'meta',
				text: footer.text
			});
	}

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
	tools: readonly Tool[],
	verbose: boolean
): ViewportMessage | null {
	const transcriptOnlyMessage = message as MessageType & {
		isVisibleInTranscriptOnly?: boolean;
	};
	if (transcriptOnlyMessage.isVisibleInTranscriptOnly && !verbose) {
		return null;
	}

	if (message.type === 'user') {
		if (message.isMeta && !verbose) {
			return null;
		}

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
					tools,
					verbose
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
					tools,
					verbose
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

		const text = extractTextContent(message.message?.content, {
			includeThinking: verbose
		});
		const localCommandMessage = text
			? buildLocalCommandViewport(text, fallbackId)
			: null;
		if (localCommandMessage === 'hidden') {
			return null;
		}
		if (localCommandMessage) {
			return localCommandMessage;
		}
		return text
			? {
					id: fallbackId,
					role: 'user',
					text
				}
			: null;
	}

	if (message.type === 'assistant') {
		if (verbose && Array.isArray(message.message?.content)) {
			const segments = extractAssistantContentSegments(
				message.message?.content,
				true
			);
			if (segments.length > 0) {
				return {
					id: fallbackId,
					role: 'assistant',
					text: segments.map(segment => segment.text).join('\n'),
					content: buildAssistantContentNode(segments)
				};
			}
		}

		const text = extractTextContent(message.message?.content, {
			includeThinking: verbose
		});
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
							typedBlock,
							verbose
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
		const systemContent =
			typeof message.content === 'string' ? message.content : null;
		const text = systemContent ?? extractTextContent(message.message?.content);
		if (isSystemLocalCommandMessage(message) && text) {
			const localCommandMessage = buildLocalCommandViewport(text, fallbackId);
			return localCommandMessage === 'hidden' ? null : localCommandMessage;
		}
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
	const isTerminalFocused = useTerminalFocus();
	const [input, setInput] = useState('');
	const [screen, setScreen] = useState<AppScreen>('prompt');
	const [cursorSyncKey, setCursorSyncKey] = useState(0);
	const [pastedContents, setPastedContents] = useState<Record<number, PastedContent>>({});
	const toolPermissionContext = useAppState(s => s.toolPermissionContext);
	const fileHistory = useAppState(s => s.fileHistory);
	// feature() is a build-time constant — dead code elimination removes the hook
	// call entirely in external builds, so this is safe despite looking conditional.
	const store = useAppStateStore();
	const { onHistoryUp, onHistoryDown, resetHistory } = useArrowKeyHistory(
		setInput,
		setPastedContents,
		input,
		pastedContents,
	);
	// Local state for commands (hot-reloadable when skill files change)
  	const [localCommands, setLocalCommands] = useState(initialCommands);
  	const activeTools = initialTools.length > 0 ? initialTools : getAllBaseTools();
  	const mergedCommands = initialCommands
	const commands = useMemo(() => (disableSlashCommands ? [] : mergedCommands), [disableSlashCommands, mergedCommands]);
	const handleInputChange = useCallback((nextValue: string) => {
		const matches = getSlashCommandMatches(nextValue, commands);
		setInput(nextValue);
		setFilteredCommands(matches.map(match => match.command));
		setShowCommandSelector(matches.length > 0);
		setSelectedCommandIndex(0);
		resetHistory();
	}, [commands, resetHistory]);
	const [alertMessage, setAlertMessage] = useState<string | null>(null);
	const [exitHint, setExitHint] = useState(false);
	const [streamingAssistant, setStreamingAssistant] =
		useState<StreamingAssistantState>({
			active: false,
			placeholderId: null,
			text: '',
			pendingToolCalls: []
		});
	const [compactUiState, setCompactUiState] = useState<CompactUiState>({
		active: false,
		streamMode: 'requesting',
		responseLength: 0,
		statusText: null
	});
	const [messages, rawSetMessages] = useState<MessageType[]>([]);
	const [nonFullscreenScrollbackHeader, setNonFullscreenScrollbackHeader] =
		useState<string[]>([]);
	const [nonFullscreenScrollbackMessages, setNonFullscreenScrollbackMessages] =
		useState<ViewportMessage[]>([]);
	const [completedTurnFooters, setCompletedTurnFooters] = useState<
		CompletedTurnFooter[]
	>([]);
	const [showCommandSelector, setShowCommandSelector] = useState(false);
	const [filteredCommands, setFilteredCommands] = useState(commands);
	  const [initialReadFileState] = useState(() => createFileStateCacheWithSizeLimit(READ_FILE_STATE_CACHE_SIZE));
	const readFileState = useRef(initialReadFileState);
	const nonFullscreenHeaderCapturedRef = useRef(false);
	const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
	const appState = React.useSyncExternalStore(
		store.subscribe,
		store.getState,
		store.getState
	);
	const mainLoopModel = appState.mainLoopModel || getCurrentModel();
	const [toolUseConfirmQueue, setToolUseConfirmQueue] = useState<
		ToolUseConfirm[]
	>([]);
	const [toolJSX, setToolJSXInternal] = useState<{
		jsx: React.ReactNode | null;
		shouldHidePromptInput: boolean;
		shouldContinueAnimation?: true;
		showSpinner?: boolean;
		isLocalJSXCommand?: boolean;
		isImmediate?: boolean;
	} | null>(null);
	const queryGuard = useRef(new QueryGuard()).current;
	const isQueryActive = React.useSyncExternalStore(
		queryGuard.subscribe,
		queryGuard.getSnapshot
	);
	const loading = isQueryActive;
	const showSpinner = loading && (!toolJSX || toolJSX.showSpinner !== false);
	
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
	const localJSXCommandRef = useRef<{
		jsx: React.ReactNode | null;
		shouldHidePromptInput: boolean;
		shouldContinueAnimation?: true;
		showSpinner?: boolean;
		isLocalJSXCommand: true;
		isImmediate?: boolean;
	} | null>(null);
	const loadingStartTimeRef = useRef<number | null>(null);
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

	useEffect(() => {
		if (loading) {
			if (loadingStartTimeRef.current === null) {
				loadingStartTimeRef.current = Date.now();
			}
			return;
		}

		loadingStartTimeRef.current = null;
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
	const handleCyclePermissionMode = useCallback(() => {
		const { nextMode, context: preparedContext } =
			cyclePermissionMode(toolPermissionContext);

		// Set the mode via setAppState directly because setToolPermissionContext
		// intentionally preserves the existing mode (to prevent coordinator mode
		// corruption from workers). Then call setToolPermissionContext to trigger
		// recheck of queued permission prompts.
		setAppState(prev => ({
			...prev,
			toolPermissionContext: {
				...preparedContext,
				mode: nextMode
			}
		}));
		setToolPermissionContext({
			...preparedContext,
			mode: nextMode
		});
	}, [setAppState, setToolPermissionContext, toolPermissionContext]);
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

	useEffect(() => {
		if (
			completedTurnFooters.length > 0 &&
			scrollRef.current?.isSticky()
		) {
			scrollRef.current?.scrollToBottom();
		}
	}, [completedTurnFooters.length]);

	useEffect(() => {
		if (!showCommandSelector) {
			setFilteredCommands(commands);
		}
	}, [commands, showCommandSelector]);

	useEffect(() => {
		setSelectedCommandIndex(index =>
			filteredCommands.length === 0
				? 0
				: Math.min(index, filteredCommands.length - 1)
		);
	}, [filteredCommands]);

	const setToolJSX = useCallback<SetToolJSXFn>(args => {
		if (args?.isLocalJSXCommand) {
			const { clearLocalJSX: _clearLocalJSX, ...rest } = args;
			localJSXCommandRef.current = {
				...rest,
				isLocalJSXCommand: true
			};
			setToolJSXInternal(rest);
			return;
		}

		if (localJSXCommandRef.current) {
			if (args?.clearLocalJSX) {
				localJSXCommandRef.current = null;
				setToolJSXInternal(null);
			}
			return;
		}

		if (args?.clearLocalJSX) {
			setToolJSXInternal(null);
			return;
		}

		setToolJSXInternal(args);
	}, []);


	const handleCommandSelect = useCallback((command: Command) => {
		const nextValue = `/${getCommandName(command)}${command.argumentHint ? ' ' : ''}`;
		setInput(nextValue);
		setCursorSyncKey(prev => prev + 1);
		setFilteredCommands(commands);
		setShowCommandSelector(false);
	}, [commands]);

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
		}, 800);
	}, [exit, exitHint, loading, queryGuard]);

	const repinScroll = useCallback(() => {
		scrollRef.current?.scrollToBottom();
	}, []);

	useInput(
		(input, key, event) => {
			if (key.ctrl && input === 'o') {
				event.stopImmediatePropagation();
				setScreen(current =>
					current === 'transcript' ? 'prompt' : 'transcript'
				);
				return;
			}

			if (
				screen === 'transcript' &&
				(key.escape || (key.ctrl && input === 'c'))
			) {
				event.stopImmediatePropagation();
				setScreen('prompt');
			}
		},
		{ isActive: true }
	);

	useInput(
		(_, key) => {
			if (!showCommandSelector) {
				return;
			}

			if (key.escape) {
				setShowCommandSelector(false);
				return;
			}

			if (key.return) {
				const selectedCommand = filteredCommands[selectedCommandIndex];
				if (selectedCommand) {
					const commandValue = `/${getCommandName(selectedCommand)}`;
					setInput('');
					setCursorSyncKey(prev => prev + 1);
					setFilteredCommands(commands);
					setShowCommandSelector(false);
					void onSubmit(commandValue);
					return;

					handleCommandSelect(selectedCommand);
				}
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
				onMessage: newMessage => {
					if (isCompactBoundaryMessage(newMessage)) {
						if (!isFullscreenEnvEnabled() && screen !== 'transcript') {
							if (
								!nonFullscreenHeaderCapturedRef.current &&
								transcriptHeaderLinesRef.current.length > 0
							) {
								setNonFullscreenScrollbackHeader(
									transcriptHeaderLinesRef.current
								);
								nonFullscreenHeaderCapturedRef.current = true;
							}
							if (viewportMessagesRef.current.length > 0) {
								setNonFullscreenScrollbackMessages(previous => [
									...previous,
									...viewportMessagesRef.current
								]);
							}
						}
						setCompletedTurnFooters([]);
						setMessages(() => [newMessage]);
					} else {
						setMessages(prev => [...prev, newMessage]);
					}
					if (newMessage.type === 'assistant') {
						setStreamingAssistant({
							active: false,
							placeholderId: null,
							text: '',
							pendingToolCalls: []
						});
					}
				}
			});
		},
		[screen, setMessages]
	);
	const handleCompactProgress = useCallback((event: CompactProgressEvent) => {
		logForDebugging('query-app: received compact progress event', {
			level: event.type === 'compact_end' ? 'info' : 'debug',
			eventType: event.type,
			hookType: 'hookType' in event ? event.hookType : undefined
		});
		switch (event.type) {
			case 'hooks_start':
				setCompactUiState(prev => ({
					...prev,
					active: true,
					statusText:
						event.hookType === 'pre_compact'
							? 'Efrex 正在整理历史上下文...'
							: event.hookType === 'post_compact'
								? 'Efrex 正在恢复压缩后的会话状态...'
								: 'Efrex 正在初始化压缩流程...'
				}));
				break;
			case 'compact_start':
				setCompactUiState(prev => ({
					...prev,
					active: true,
					streamMode: 'requesting',
					responseLength: 0,
					statusText: 'Efrex 正在生成对话摘要...'
				}));
				break;
			case 'compact_end':
				setCompactUiState({
					active: false,
					streamMode: 'requesting',
					responseLength: 0,
					statusText: null
				});
				break;
		}
	}, []);
	useEffect(() => {
		logForDebugging('query-app: compact UI state updated', {
			level: compactUiState.active ? 'info' : 'debug',
			active: compactUiState.active,
			streamMode: compactUiState.streamMode,
			responseLength: compactUiState.responseLength,
			statusText: compactUiState.statusText
		});
	}, [compactUiState]);
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
			commands,
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
			setResponseLength: updater => {
				setCompactUiState(prev => {
					const responseLength = updater(prev.responseLength);
					return {
						...prev,
						responseLength,
						statusText:
							prev.active && prev.streamMode === 'responding'
								? responseLength > 0
									? 'Efrex 正在生成压缩摘要...'
									: 'Efrex 正在压缩对话...'
								: prev.statusText
					};
				});
			},
			setStreamMode: mode => {
				setCompactUiState(prev => ({
					...prev,
					active: true,
					streamMode: mode,
					statusText:
						mode === 'responding'
							? prev.responseLength > 0
								? 'Efrex 正在生成压缩摘要...'
								: 'Efrex 正在压缩对话...'
							: prev.statusText ?? 'Efrex 正在压缩对话...'
				}));
			},
			onCompactProgress: handleCompactProgress,
			messages,
			setToolJSX,
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
      setToolJSX,
      handleCompactProgress,
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
			const [defaultSystemPrompt, baseUserContext,systemContext] = await Promise.all([
				getSystemPrompt(freshTools, mainLoopModelParam, [
					// 'F:\\pythonProject'
				]),
				getUserContext()
				,getSystemContext(),
			]); 

			const userContext = {
				...baseUserContext,
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
					systemContext: systemContext,
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
			mainLoopModel: string,
	
		): Promise<void> => {
			const thisGeneration = queryGuard.tryStart();
			if (thisGeneration === null) {
				return;
			}
			const startedAt = Date.now();
			setMessages(oldMessages => [...oldMessages, ...newMessages]);
			setInput('');
			setStreamingAssistant({
				active: false,
				placeholderId: nextPlaceholderIdRef.current++,
				text: '',
				pendingToolCalls: []
			});
			setCompactUiState({
				active: false,
				streamMode: 'requesting',
				responseLength: 0,
				statusText: null
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
					const durationMs = Date.now() - startedAt;
					setCompletedTurnFooters(oldFooters => [
						...oldFooters,
						{
							afterMessageCount: messagesRef.current.length,
							text: buildTurnDurationLine(
								durationMs,
								Math.max(8, (columns || process.stdout.columns || 80) - 4)
							)
						}
					]);
					setStreamingAssistant({
						active: false,
						placeholderId: null,
						text: '',
						pendingToolCalls: []
					});
					setCompactUiState({
						active: false,
						streamMode: 'requesting',
						responseLength: 0,
						statusText: null
					});
				}
			}
		},
		[columns, onQueryImpl, queryGuard]
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
	const transcriptColumnWidth = Math.max(
		72,
		Math.min(terminalColumns - 4, terminalColumns - (terminalColumns >= 120 ? 8 : 4))
	);
	// The prompt row is already inside outer paddingX=1, and the leading "› "
	// consumes 2 columns. The input itself should use the remaining content width.
	const promptInputWidth = Math.max(8, terminalColumns - 4);
	const inputRule = '─'.repeat(Math.max(8, terminalColumns - 2));
	const maxPromptInputRows = Math.max(1, MAX_PROMPT_INPUT_ROWS);
	const permissionModeConfig = getPermissionModeConfig(
		toolPermissionContext.mode
	);
	const permissionModeLabel = permissionModeConfig.title;
	const permissionModeColor = permissionModeConfig.color;

	const isTranscriptMode = screen === 'transcript';
	const renderTools = activeTools;
	const viewportMessages = buildViewportMessages(
		messages,
		renderTools,
		completedTurnFooters,
		isTranscriptMode
	);

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

	const { model: modelLabel, effort: effortLabel } = useTranscriptHeaderInfo();

	const transcriptHeaderLines = getTranscriptHeaderLines({
		cwd: process.cwd(),
		model: modelLabel,
		effort: effortLabel,
		width: messageWidth,
		welcome: messages.length === 0 && !showSpinner
	});
	const viewportMessagesRef = useRef<ViewportMessage[]>([]);
	const transcriptHeaderLinesRef = useRef<string[]>([]);
	viewportMessagesRef.current = viewportMessages;
	transcriptHeaderLinesRef.current = transcriptHeaderLines;

	useEffect(() => {
		if (isFullscreenEnvEnabled() || isTranscriptMode) {
			return;
		}

		if (
			!nonFullscreenHeaderCapturedRef.current &&
			messages.length > 0 &&
			transcriptHeaderLines.length > 0
		) {
			setNonFullscreenScrollbackHeader(transcriptHeaderLines);
			nonFullscreenHeaderCapturedRef.current = true;
		}
	}, [isTranscriptMode, messages.length, transcriptHeaderLines]);

	const activeToolUseConfirm = toolUseConfirmQueue[0];
	const highlightInputChrome =
		isTerminalFocused && loading && !activeToolUseConfirm;
	const statusText = showSpinner
		? compactUiState.active
			? compactUiState.statusText
			: streamingAssistant.text.trim().length > 0
				? 'Efrex 正在生成回复...'
				: streamingAssistant.pendingToolCalls.length > 0
					? 'Efrex 正在请求工具...'
					: 'Efrex 正在思考...'
		: null;
	const statusMode = showSpinner
		? compactUiState.active
			? compactUiState.streamMode === 'requesting'
				? 'requesting'
				: 'default'
			: streamingAssistant.pendingToolCalls.length > 0
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
	const commandSelectorQuery = getSlashCommandQuery(input.trim());
	const visibleCommandWindow = getVisibleWindow(
		filteredCommands,
		selectedCommandIndex,
		COMMAND_SELECTOR_VISIBLE_COUNT
	);
	const commandSelectorWidth = Math.max(20, terminalColumns - 6);
	const commandNameWidth = Math.max(
		18,
		Math.min(40, Math.floor(commandSelectorWidth * 0.42))
	);
	const commandDescriptionWidth = Math.max(
		20,
		commandSelectorWidth - commandNameWidth - 4
	);
	const inputRuleColor = 'gray';
	const inputPromptColor = !isTerminalFocused
		? 'gray'
		: activeToolUseConfirm
			? 'gray'
			: loading
				? 'ansi:blueBright'
				: 'ansi:greenBright';
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
			{showSpinner &&
			!activeToolUseConfirm &&
			statusText &&
			statusPrefix &&
			statusSegments ? (
				<StatusAnimationRow
					prefix={statusPrefix}
					prefixDim={statusPrefixDim}
					prefixBold={statusPrefixBold}
					before={statusSegments.before}
					shimmer={statusSegments.shimmer}
					after={statusSegments.after}
					startedAtMs={loadingStartTimeRef.current}
					toolCount={streamingAssistant.pendingToolCalls.length}
				/>
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

			{toolJSX?.isLocalJSXCommand && toolJSX.isImmediate ? (
				<Box flexDirection="column" width="100%">
					{toolJSX.jsx}
				</Box>
			) : null}

			<Box flexDirection="column" flexShrink={0}>
				<PromptInputQueuedCommands width={terminalColumns} />
				{!toolJSX?.shouldHidePromptInput ? (
					<>
						<Text color={inputRuleColor}>{inputRule}</Text>
						<Box
							flexDirection="row"
							flexWrap="nowrap"
							width={terminalColumns - 2}
						>
							<Box flexShrink={0} width={2}>
								<Text color={inputPromptColor}>
									›{' '}
								</Text>
							</Box>
							<PromptInput
								messages={messages}
								value={input}
								height={terminalRows}
								width={promptInputWidth}
								maxVisibleLines={maxPromptInputRows}
								cursorSyncKey={cursorSyncKey}
								isActive={!activeToolUseConfirm && !toolJSX?.isLocalJSXCommand}
								suspendSubmit={showCommandSelector}
								suspendVerticalArrows={showCommandSelector}
								onChange={handleInputChange}
								onSubmit={onSubmit}
								onHistoryPrev={onHistoryUp}
								onHistoryNext={onHistoryDown}
								onCtrlC={handleCtrlC}
								onCyclePermissionMode={handleCyclePermissionMode}
								placeholder={showSpinner ? '等待 query.ts 响应中...' : 'Ask efrex anything...'}
								pastedContents={pastedContents}
								setPastedContents={setPastedContents}
							/>
						</Box>
						<Text color={inputRuleColor}>{inputRule}</Text>
						{showCommandSelector ? (
							<Box
								paddingX={1}
								paddingY={0}
								marginTop={1}
								flexDirection="column"
							>
								<Text dimColor>
									{filteredCommands.length > COMMAND_SELECTOR_VISIBLE_COUNT
										? ` (${visibleCommandWindow.startIndex + 1}-${visibleCommandWindow.startIndex + visibleCommandWindow.items.length}/${filteredCommands.length})`
										: ''}
								</Text>
								{visibleCommandWindow.items.map((command, index) => {
									const actualIndex =
										visibleCommandWindow.startIndex + index;
									const selected = actualIndex === selectedCommandIndex;
									const displayName = fitDisplay(
										`/${getCommandName(command)}${command.argumentHint ? ` ${command.argumentHint}` : ''}`,
										commandNameWidth
									);
									const description = fitDisplay(
										command.description,
										commandDescriptionWidth
									);
									return (
										<Box
											key={command.name}
											flexDirection="row"
											width="100%"
										>
											<Box width={2} flexShrink={0}>
												<Text
													color={selected ? COMMAND_ROW_SELECTED_FG : 'gray'}
												>
													{selected ? '› ' : '  '}
												</Text>
											</Box>
											<Box width={commandNameWidth} flexShrink={0}>
												<Text
													color={selected ? COMMAND_ROW_SELECTED_FG : undefined}
												>
													{renderHighlightedText(
														displayName,
														commandSelectorQuery,
														selected
													)}
												</Text>
											</Box>
											<Box width={2} flexShrink={0}>
												<Text dimColor={!selected}>
													{'  '}
												</Text>
											</Box>
											<Box flexGrow={1} flexShrink={1}>
												<Text
													dimColor={!selected}
													color={
														selected
															? COMMAND_ROW_SELECTED_DESC
															: undefined
													}
												>
													{renderHighlightedText(
														description,
														commandSelectorQuery,
														selected
													)}
												</Text>
											</Box>
										</Box>
									);
								})}
							</Box>
						) : (
							<>
								<Box paddingLeft={2}>
									<Text color={permissionModeColor}>
										{permissionModeLabel}
										<Text dimColor> · Shift+Tab</Text>
									</Text>
								</Box>
							</>
						)}
					</>
				) : null}
			</Box>

			{!showCommandSelector ? (
				<Box flexDirection="column" flexShrink={0}>
					<Box>
						{exitHint ? (
							<Text color="subtle">再按一次 Ctrl+C 退出</Text>
						) : ''}
					</Box>
				</Box>
			) : null}
		</Box>
	);

	const scrollableContent = (
		<Box flexDirection="column">
			<MessageViewport
				headerLines={transcriptHeaderLines}
				messages={viewportMessages}
				width={messageWidth}
				alertMessage={alertMessage}
				statusLine={null}
				blinkOn={blinkVisible}
			/>
			{toolJSX && !(toolJSX.isLocalJSXCommand && toolJSX.isImmediate) ? (
				<Box flexDirection="column" width="100%">
					{toolJSX.jsx}
				</Box>
			) : null}
		</Box>
	);

	const nonFullscreenScrollableContent = (
		<Box flexDirection="column">
			{nonFullscreenScrollbackHeader.length > 0 ||
			nonFullscreenScrollbackMessages.length > 0 ? (
				<MessagesScrollback
					headerLines={nonFullscreenScrollbackHeader}
					messages={nonFullscreenScrollbackMessages}
					width={messageWidth}
					alertMessage={null}
					blinkOn={blinkVisible}
				/>
			) : null}
			{messages.length === 0 ? (
				<MessageViewport
					headerLines={transcriptHeaderLines}
					messages={[]}
					width={messageWidth}
					alertMessage={alertMessage}
					statusLine={null}
					blinkOn={blinkVisible}
				/>
			) : null}
			{messages.length > 0 || alertMessage ? (
				<MessagesScrollback
					headerLines={
						nonFullscreenHeaderCapturedRef.current
							? []
							: transcriptHeaderLines
					}
					messages={viewportMessages}
					width={messageWidth}
					alertMessage={alertMessage}
					blinkOn={blinkVisible}
				/>
			) : null}
			{toolJSX && !(toolJSX.isLocalJSXCommand && toolJSX.isImmediate) ? (
				<Box flexDirection="column" width="100%">
					{toolJSX.jsx}
				</Box>
			) : null}
		</Box>
	);

	const transcriptScrollableContent = (
		<Box flexDirection="column" width="100%" paddingTop={1}>
			<Box paddingX={2} width="100%">
				<Box flexDirection="column" width={transcriptColumnWidth}>
					<Text color="#e5e7eb" bold>
						Transcript
					</Text>
					<Text color="#6b7280">
						{process.cwd()} · {modelLabel} · {effortLabel}
					</Text>
					<Text color="#374151">
						{'─'.repeat(Math.max(24, transcriptColumnWidth))}
					</Text>
				</Box>
			</Box>
			<Box paddingX={2} width="100%">
				<Box width={transcriptColumnWidth}>
					<MessageViewport
						headerLines={[]}
						messages={viewportMessages}
						width={transcriptColumnWidth}
						alertMessage={alertMessage}
						statusLine={null}
						blinkOn={blinkVisible}
						variant="transcript"
					/>
				</Box>
			</Box>
			{toolJSX && !(toolJSX.isLocalJSXCommand && toolJSX.isImmediate) ? (
				<Box paddingX={2} width="100%">
					<Box flexDirection="column" width={transcriptColumnWidth}>
						{toolJSX.jsx}
					</Box>
				</Box>
			) : null}
		</Box>
	);

	const transcriptBottom = (
		<Box flexDirection="column" flexShrink={0} paddingTop={1}>
			<Text color="#4b5563">
				Ctrl+O / Esc close · Ctrl+B/F page · Home/End jump
			</Text>
		</Box>
	);

	if (isTranscriptMode) {
		if (isFullscreenEnvEnabled()) {
			return (
				<AlternateScreen mouseTracking>
					<ScrollKeybindingHandler
						scrollRef={scrollRef}
						isActive
					/>
					<FullscreenLayout
						scrollRef={scrollRef}
						scrollable={transcriptScrollableContent}
						bottom={transcriptBottom}
					/>
				</AlternateScreen>
			);
		}

		return (
			<Box flexDirection="column" paddingX={1} paddingY={0}>
				{transcriptScrollableContent}
				{transcriptBottom}
			</Box>
		);
	}

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
			{nonFullscreenScrollableContent}
			{bottomContent}
		</Box>
	);
}
