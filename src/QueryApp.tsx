import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import chalk from 'chalk';
// import { useMainLoopModel } from './hooks/useMainLoopModel.js';
import { Command, getCommandName } from './types/command.js';
import { restoreSessionStateFromLog } from './utils/sessionRestore.js';
import {cwd}from "process"
import { useQueueProcessor } from './hooks/useQueueProcessor.js';
import {getCommandQueueLength} from './utils/messageQueueManager.js';
import { randomUUID, UUID } from 'node:crypto';
import { LogOption } from './types/logs.js';
import { dirname } from 'path';
import { ResumeEntrypoint } from './types/command.js';
import { FileHistoryState } from './utils/fileHistory.js';
import {
	isCompactBoundaryMessage,
	isSyntheticMessage,
	NO_RESPONSE_REQUESTED,
	textForResubmit
} from './utils/messages.js';
import {
	Box,
	Text,
	useApp,
	useInput,
	useWindowSize
} from './ink.js';
import { getTerminalFocused } from './ink/terminal-focus-state.js';
import { resetCostState, switchSession } from './bootstrap/state.js';
import { stringWidth } from './ink/stringWidth.js';
import { createFileStateCacheWithSizeLimit, READ_FILE_STATE_CACHE_SIZE } from './utils/fileStateCache.js';
import {selectableUserMessagesFilter,messagesAfterAreOnlySynthetic} from './components/MessageSelector.js';
import { useAppStateStore } from './state/AppState.js';
import type { ContentBlockParam, ContentBlock, ImageBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs';
import { buildEffectiveSystemPrompt } from './utils/systemPrompt.js';
import { addToHistory,removeLastFromHistory} from './history.js';
import { useMemo } from 'react';
import { useArrowKeyHistory } from './hooks/useArrowKeyHistory.js';
import { useLogMessages } from './hooks/useLogMessages.js';
import type { ProcessUserInputContext } from './utils/executeUserInput.js';
import type { ScrollBoxHandle } from './ink/components/ScrollBox.js';
import { AlternateScreen } from './ink/components/AlternateScreen.js';
import PromptInput from './components/PromptInput.js';
import { IdeStatusIndicator } from './components/IdeStatusIndicator.js';
import { isCommandEnabled } from './types/command.js';
import MessageViewport from './components/MessageViewport.js';
import TranscriptViewport, { computeTranscriptStats } from './components/TranscriptViewport.js';
import { OffscreenFreeze } from './components/OffscreenFreeze.js';
import WelcomeHeader from './components/WelcomeHeader.js';
import FullscreenLayout from './components/FullscreenLayout.js';
import { ScrollKeybindingHandler } from './components/ScrollKeybindingHandler.js';
import { PastedContent } from './utils/config.js';
import type {
	ApiRetryStatusEvent,
	Message as MessageType,
	ProgressMessage,
	UserMessage
} from './package/message.js';
import {
	findToolByName,
	type CompactProgressEvent,
	type SetToolJSXFn,
	type Tool,
	type ToolProgressData,
	type ToolPermissionContext
} from './Tool.js';
import { expandPastedTextRefs } from './history.js';
import { assembleToolPool, getAllBaseTools, getTools } from './tools.js';
import { query } from './query.js';
import { handlePromptSubmit } from './utils/handlePromptSubmit.js';
import { getAnthropicModel, getEffortLevel } from './utils/anthropicConfig.js';
import { getInitialSettings } from './utils/settings/settings.js';
import { FileStateCache } from './utils/fileStateCache.js';
import { getSystemPrompt } from './constants/prompts.js';
import { getUserContext, getSystemContext } from './context.js';
import { extractTag, isSystemLocalCommandMessage } from './utils/messages.js';
import { type AppState } from './state/AppStateStore.js';
import { useAppState } from './state/AppState.js';
import { ThinkingConfig } from './utils/effort.js';
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
	BASH_INPUT_TAG,
	BASH_STDERR_TAG,
	BASH_STDOUT_TAG,
	COMMAND_ARGS_TAG,
	COMMAND_NAME_TAG,
	LOCAL_COMMAND_CAVEAT_TAG,
	LOCAL_COMMAND_STDERR_TAG,
	LOCAL_COMMAND_STDOUT_TAG
} from './constants/xml.js';
import { PromptInputMode } from './types/textInputTypes.js';
import { UserBashOutputMessage } from './components/messages/UserBashOutputMessage.js';
import { UserBashInputMessage } from './components/messages/UserBashInputMessage.js';
import {
	renderToolErrorContent,
	renderToolProgressContent,
	renderToolResultContent,
	renderToolUseContent
} from './components/messages/renderToolContent.js';
import StatusAnimationRow from './components/StatusAnimationRow.js';
import { CLI_APP_VERSION } from 'utils/load.js';
import { logForDebugging } from './utils/debug.js';
import { deserializeMessages } from './utils/conservationRecovery.js';
import { asSessionId } from './types/ids.js';
import { clearSessionMetadata, resetSessionFilePointer, restoreSessionMetadata } from './utils/sessionStorage.js';
import { consumeEarlyInput } from './utils/earlyInput.js';
import { resetMicrocompactState } from './services/compact/mircoCompact.js';
import { mcpInfoFromString } from './utils/mcpStringUtils.js';
import { InternalPermissionMode } from './types/permissions.js';
import { useIDEIntegration } from './hooks/useIDEIntegration.js';
import { MCPServerConnection, ScopedMcpServerConfig } from "src/services/mcp/types.js"
import { IDEExtensionInstallationStatus, IdeType } from './utils/ide.js';
import { MCPConnectionManager } from './services/mcp/MCPConnectionManager.js';
import { IDESelection, useIdeSelection } from './hooks/useIdeSelection.js';
import { useMergedTools } from './hooks/useMergedTools.js';
import { mergeAndFilterTools } from './utils/toolPool.js';
type ViewportMessage = {
	id: number;
	role: 'user' | 'assistant' | 'tool' | 'meta';
	text: string;
	content?: React.ReactNode;
	baseContent?: React.ReactNode;
	toolPhase?: 'call' | 'done' | 'error';
	toolDisplayStyle?: 'use' | 'result' | 'progress';
	toolUseId?: string;
	animatePrefix?: 'blink';
	tone?: 'error';
	compactMcpLabel?: string;
	toolName?: string;
	commandType?: 'slash' | 'bash';
	baseText?: string;
};

type ViewportSliceAnchor = { key: string; idx: number } | null;
// 为接受 MCPServerConnection[] 的钩子提供稳定的空数组 — 避免在远程模式下每次渲染都创建新的 [] 字面量，这会导致 useEffect 依赖变化和无限重渲染循环。
const EMPTY_MCP_CLIENTS: MCPServerConnection[] = [];

const MAX_VIEWPORT_MESSAGES_WITHOUT_VIRTUALIZATION = 200;
const VIEWPORT_MESSAGE_CAP_STEP = 50;

function getViewportSliceKey(message: ViewportMessage): string {
	return [
		message.id,
		message.role,
		message.toolUseId ?? '',
		message.toolDisplayStyle ?? '',
		message.toolPhase ?? ''
	].join(':');
}

function computeViewportSliceStart(
	messages: readonly ViewportMessage[],
	anchorRef: { current: ViewportSliceAnchor },
	cap = MAX_VIEWPORT_MESSAGES_WITHOUT_VIRTUALIZATION,
	step = VIEWPORT_MESSAGE_CAP_STEP
): number {
	const anchor = anchorRef.current;
	const anchorIdx = anchor
		? messages.findIndex(message => getViewportSliceKey(message) === anchor.key)
		: -1;
	let start = anchorIdx >= 0
		? anchorIdx
		: anchor
			? Math.min(anchor.idx, Math.max(0, messages.length - cap))
			: 0;

	if (messages.length - start > cap + step) {
		start = messages.length - cap;
	}

	const messageAtStart = messages[start];
	if (messageAtStart) {
		const key = getViewportSliceKey(messageAtStart);
		if (anchor?.key !== key || anchor.idx !== start) {
			anchorRef.current = { key, idx: start };
		}
	} else if (anchor) {
		anchorRef.current = null;
	}

	return start;
}


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

type ApiRetrySummary = {
	attempt: number;
	maxRetries: number;
	remainingMs: number;
};

type StreamingAssistantState = {
	active: boolean;
	streamMode: 'requesting' | 'thinking' | 'responding';
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

type ApiRetryUiState = {
	active: boolean;
	statusText: string | null;
	retryAtMs?: number;
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
const COMMAND_SELECTOR_VISIBLE_COUNT = 5;
const APP_BRAND = 'efrex code';
const APP_VERSION = CLI_APP_VERSION;
const COMMAND_ROW_NAME = '#B784FF';
const COMMAND_ROW_SELECTED_ACCENT = '#D16DFF';
const COMMAND_ROW_ARG_MARKER = '#8B93A7';
const COMMAND_ROW_ARG_VALUE = '#E6EAF2';
const COMMAND_ROW_DESC = '#AAB3C5';
const COMMAND_ROW_MUTED = '#6E7485';
const API_ERROR_COLOR = 'rgb(255,107,128)';
const TURN_META_ID_BASE = 1_000_000_000;


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
				color={COMMAND_ROW_SELECTED_ACCENT}
				bold
			>
				{matched}
			</Text>
			{text.slice(matchIndex + query.length)}
		</>
	);
}

function renderCommandArgumentHint(
	argumentHint: string,
	query: string,
	selected: boolean
): React.ReactNode {
	return argumentHint.split(/([\[\]|])/g).map((part, index) => {
		if (part === '[' || part === ']' || part === '|') {
			return (
				<Text key={`argument-marker-${index}`} color={COMMAND_ROW_ARG_MARKER}>
					{part}
				</Text>
			);
		}

		return (
			<Text
				key={`argument-value-${index}`}
				color={COMMAND_ROW_ARG_VALUE}
				dimColor={!selected}
			>
				{renderHighlightedText(part, query, selected)}
			</Text>
		);
	});
}

function renderCommandDisplayName(
	command: Command,
	displayName: string,
	query: string,
	selected: boolean
): React.ReactNode {
	const commandName = `/${getCommandName(command)}`;
	const visibleCommandName = displayName.slice(0, commandName.length);
	const visibleArgumentHint = displayName.slice(commandName.length);

	return (
		<>
			<Text color={COMMAND_ROW_SELECTED_ACCENT}>
				{visibleCommandName.slice(0, 1)}
			</Text>
			<Text color={COMMAND_ROW_NAME} bold={selected}>
				{renderHighlightedText(visibleCommandName.slice(1), query, selected)}
			</Text>
			{visibleArgumentHint
				? renderCommandArgumentHint(visibleArgumentHint, query, selected)
				: null}
		</>
	);
}

function padDisplay(text: string, width: number): string {
    return `${text}${' '.repeat(Math.max(0, width - stringWidth(text)))}`;
}

function centerDisplay(text: string, width: number): string {
    const textWidth = stringWidth(text);
    const leftPad = Math.max(0, Math.floor((width - textWidth) / 2));
    return `${' '.repeat(leftPad)}${text}${' '.repeat(Math.max(0, width - textWidth - leftPad))}`;
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

function hideApiErrorRequestId(text: string): string {
	return text
		.replace(
			/(?:\r?\n)?[ \t]*Request id:\s*[A-Za-z0-9_-]+[ \t]*/gi,
			''
		)
		.trimEnd();
}

function renderApiErrorContent(text: string): React.ReactNode {
	const [title, ...details] = hideApiErrorRequestId(text).split(/\r?\n/);

	return (
		<Box flexDirection="column">
			<Text color={API_ERROR_COLOR} bold>
				{title}
			</Text>
			{details.length > 0 ? (
				<Text color={API_ERROR_COLOR}>{details.join('\n')}</Text>
			) : null}
		</Box>
	);
}

function buildAssistantTextViewport(
	text: string,
	id: number,
	isApiErrorMessage: boolean
): ViewportMessage {
	const visibleAssistantText = text.trim();
	if (!isApiErrorMessage) {
		return {
			id,
			role: 'assistant',
			text: visibleAssistantText
		};
	}

	const visibleText = hideApiErrorRequestId(visibleAssistantText);
	return {
		id,
		role: 'assistant',
		text: visibleText,
		content: renderApiErrorContent(visibleText),
		tone: 'error'
	};
}

function isNoResponseRequestedMessage(message: MessageType): boolean {
	if (message.type !== 'assistant') {
		return false;
	}

	const content = message.message?.content;
	if (content === NO_RESPONSE_REQUESTED) {
		return true;
	}

	const firstContentBlock = Array.isArray(content) ? content[0] : null;
	return Boolean(
		firstContentBlock &&
			typeof firstContentBlock === 'object' &&
			(firstContentBlock as { type?: unknown }).type === 'text' &&
			(firstContentBlock as { text?: unknown }).text ===
				NO_RESPONSE_REQUESTED
	);
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

	const bashInput = extractTag(content, BASH_INPUT_TAG);
	if (bashInput) {
		return {
			id: fallbackId,
			role: 'user',
			text: bashInput,
			content: (
				<UserBashInputMessage
					addMargin={false}
					param={{ text: content, type: 'text' }}
				/>
			),
			commandType: 'bash'
		};
	}

	const bashStdout = extractTag(content, BASH_STDOUT_TAG) ?? '';
	const bashStderr = extractTag(content, BASH_STDERR_TAG) ?? '';
	if (bashStdout || bashStderr) {
		return {
			id: fallbackId,
			role: 'tool',
			text: [bashStdout, bashStderr].filter(Boolean).join('\n'),
			content: <UserBashOutputMessage content={content} verbose={false} />,
			toolPhase: bashStderr ? 'error' : 'done',
			toolDisplayStyle: 'result',
			commandType: 'bash'
		};
	}

	const commandName = extractTag(content, COMMAND_NAME_TAG);
	if (commandName) {
		const args = extractTag(content, COMMAND_ARGS_TAG)?.trim() ?? '';
		return {
			id: fallbackId,
			role: 'user',
			text: args ? `${commandName} ${args}` : commandName,
			commandType: 'slash',
			toolName: commandName
		};
	}

	const stdout = extractTag(content, LOCAL_COMMAND_STDOUT_TAG)?.trim();
	if (stdout) {
		return {
			id: fallbackId,
			role: 'tool',
			text: ` ${stdout}`,
			toolPhase: 'done',
			toolDisplayStyle: 'result',
			commandType: 'slash'
		};
	}

	const stderr = extractTag(content, LOCAL_COMMAND_STDERR_TAG)?.trim();
	if (stderr) {
		return {
			id: fallbackId,
			role: 'tool',
			text: ` ${compressStderrLines(stderr, 2)}`,
			toolPhase: 'error',
			toolDisplayStyle: 'result',
			commandType: 'slash'
		};
	}

	return null;
}

function compressStderrLines(stderr: string, maxLines: number): string {
	const lines = stderr.trimEnd().split('\n');
	const safeMaxLines = Math.max(1, maxLines);
	if (lines.length <= safeMaxLines) {
		return stderr;
	}

	const headCount = Math.max(1, Math.ceil(safeMaxLines / 2));
	const tailCount = Math.max(0, safeMaxLines - headCount);
	const omitted = lines.length - headCount - tailCount;
	return [
		...lines.slice(0, headCount),
		`… +${omitted} stderr lines`,
		...(tailCount > 0 ? lines.slice(-tailCount) : [])
	].join('\n');
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

function getCompactMcpToolLabel(
	tool: Tool | undefined,
	rawToolName: string
): string | null {
	const mcpInfo =
		tool?.isMcp
			? tool.mcpInfo
			: mcpInfoFromString(rawToolName);
	if (!mcpInfo) {
		return null;
	}

	const serverName = mcpInfo.serverName?.trim();
	const toolName = mcpInfo.toolName?.trim();
	if (serverName && toolName) {
		return `${serverName} - ${toolName}`;
	}

	return toolName || serverName || tool?.name || rawToolName;
}

function renderCompactMcpCall(
	label: string,
	phase: 'call' | 'done' | 'error'
): React.ReactNode {
	const action =
		phase === 'call'
			? `Calling ${label}…`
			: phase === 'error'
				? `Failed ${label}`
				: `Called ${label}`;

	return (
		<Box flexDirection="row" flexWrap="nowrap">
			<Text>{action}</Text>
			{phase === 'call' ? (
				<Text color="ansi:blackBright"> </Text>
			) : null}
		</Box>
	);
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

	const content = (
		<Box flexDirection="row" flexWrap="wrap">
			<Text bold>{parsedToolUse.userFacingToolName}</Text>
			<Text>{' '}</Text>
			{renderedToolUseMessage}
		</Box>
	);
	const renderedToolUseText = renderNodeToPlainText(content).trim();
	return {
		text: renderedToolUseText
			? `${parsedToolUse.userFacingToolName} ${renderedToolUseText}`
			: fallbackLabel,
		content
	};
}

function getAssistantToolUseViewportMessages(
	message: MessageType,
	fallbackId: number,
	tools: readonly Tool[],
	verbose: boolean
): ViewportMessage[] {
	const content = message.message?.content;
	if (!Array.isArray(content)) {
		return [];
	}

	return content
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
			const compactMcpLabel = !verbose
				? getCompactMcpToolLabel(tool, toolName) ?? undefined
				: undefined;

			return {
				id: fallbackId * 100 + index + 1,
				role: 'tool',
				text: compactMcpLabel
					? `Calling ${compactMcpLabel}… `
					: item.text,
				content: compactMcpLabel
					? renderCompactMcpCall(compactMcpLabel, 'call')
					: item.content,
				baseContent: compactMcpLabel
					? renderCompactMcpCall(compactMcpLabel, 'call')
					: item.content,
				toolPhase: 'call',
				toolDisplayStyle: 'use',
				toolUseId,
				animatePrefix: compactMcpLabel ? undefined : 'blink',
				compactMcpLabel,
				toolName
			};
		})
		.filter((value): value is ViewportMessage => value !== null);
}

function getAssistantViewportMessagesInContentOrder(
	message: MessageType,
	fallbackId: number,
	tools: readonly Tool[],
	verbose: boolean
): ViewportMessage[] {
	const content = message.message?.content;
	if (isNoResponseRequestedMessage(message)) {
		return [];
	}

	const isApiErrorMessage = message.isApiErrorMessage === true;
	if (typeof content === 'string') {
		return content.trim()
			? [buildAssistantTextViewport(content, fallbackId, isApiErrorMessage)]
			: [];
	}

	if (!Array.isArray(content)) {
		return [];
	}

	return content
		.map((block, index): ViewportMessage | null => {
			if (!block || typeof block !== 'object') {
				return null;
			}

			const typedBlock = block as unknown as Record<string, unknown>;
			const id = fallbackId * 100 + index + 1;

			if (typedBlock.type === 'text' && typeof typedBlock.text === 'string') {
				return typedBlock.text.trim()
					? buildAssistantTextViewport(
							typedBlock.text,
							id,
							isApiErrorMessage
						)
					: null;
			}

			if (
				verbose &&
				typedBlock.type === 'thinking' &&
				typeof typedBlock.thinking === 'string'
			) {
				return {
					id,
					role: 'assistant',
					text: typedBlock.thinking,
					content: buildAssistantContentNode([
						{ text: typedBlock.thinking, dimColor: true }
					])
				};
			}

			if (
				verbose &&
				typedBlock.type === 'redacted_thinking' &&
				typeof (typedBlock.thinking ?? typedBlock.data) === 'string'
			) {
				const text = String(typedBlock.thinking ?? typedBlock.data);
				return {
					id,
					role: 'assistant',
					text,
					content: buildAssistantContentNode([
						{ text, dimColor: true }
					])
				};
			}

			if (typedBlock.type !== 'tool_use') {
				return null;
			}

			const toolName =
				typeof typedBlock.name === 'string'
					? typedBlock.name
					: 'unknown_tool';
			const tool = findToolByName(tools, toolName);
			const toolUseId =
				typeof typedBlock.id === 'string' ? typedBlock.id : undefined;
			const item = buildAssistantToolUseRenderItem(
				tool,
				typedBlock,
				verbose
			);
			const compactMcpLabel = !verbose
				? getCompactMcpToolLabel(tool, toolName) ?? undefined
				: undefined;

			return {
				id,
				role: 'tool',
				text: compactMcpLabel
					? `Calling ${compactMcpLabel}… `
					: item.text,
				content: compactMcpLabel
					? renderCompactMcpCall(compactMcpLabel, 'call')
					: item.content,
				baseContent: compactMcpLabel
					? renderCompactMcpCall(compactMcpLabel, 'call')
					: item.content,
				toolPhase: 'call',
				toolDisplayStyle: 'use',
				toolUseId,
				animatePrefix: compactMcpLabel ? undefined : 'blink',
				compactMcpLabel,
				toolName
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
	if (message.compactMcpLabel) {
		message.content = renderCompactMcpCall(message.compactMcpLabel, phase);
		message.baseContent = message.content;
		message.text =
			phase === 'error'
				? `Failed ${message.compactMcpLabel}`
				: `Called ${message.compactMcpLabel}`;
		return;
	}
	if (message.baseContent) {
		message.content = message.baseContent;
		message.text = renderNodeToPlainText(message.content).trim();
	}
}

function getProgressMessageToolUseId(message: MessageType): string | null {
	const toolUseId = (message as MessageType & { toolUseID?: unknown }).toolUseID;
	return typeof toolUseId === 'string' ? toolUseId : null;
}

function updateAssistantToolUseProgressViewportMessage(
	message: ViewportMessage,
	progressContent: React.ReactNode
): void {
	const baseContent = message.baseContent ?? message.content;
	message.baseContent = baseContent;
	message.content = (
		<Box flexDirection="column">
			{baseContent}
			{progressContent}
		</Box>
	);
	message.text = renderNodeToPlainText(message.content).trim();
}

function attachAssistantToolUseResultViewportMessage(
	message: ViewportMessage,
	resultContent: React.ReactNode,
	phase: 'done' | 'error'
): void {
	message.toolPhase = phase;
	message.animatePrefix = undefined;
	if (message.compactMcpLabel) {
		message.content = renderCompactMcpCall(message.compactMcpLabel, phase);
		message.baseContent = message.content;
		message.text =
			phase === 'error'
				? `Failed ${message.compactMcpLabel}`
				: `Called ${message.compactMcpLabel}`;
		return;
	}
	const baseContent = message.baseContent ?? message.content;
	message.baseContent = baseContent;
	message.content = (
		<Box flexDirection="column">
			{baseContent}
			{resultContent}
		</Box>
	);
	message.text = renderNodeToPlainText(message.content).trim();
}

function registerAssistantToolUseViewportMessages(
	viewportMessages: ViewportMessage[],
	toolUseMessagesById: Map<string, ViewportMessage>,
	assistantViewportMessages: readonly ViewportMessage[]
): void {
	for (const viewportMessage of assistantViewportMessages) {
		viewportMessages.push(viewportMessage);
		if (viewportMessage.toolUseId) {
			toolUseMessagesById.set(viewportMessage.toolUseId, viewportMessage);
		}
	}
}

function reconcileToolResultViewportMessages(
	viewportMessages: ViewportMessage[],
	toolUseMessagesById: Map<string, ViewportMessage>,
	toolResultBlocks: Array<{
		block: { tool_use_id: string; is_error?: unknown; content?: unknown };
		index: number;
	}>,
	viewportMessagesForToolResult: readonly ViewportMessage[]
): void {
	const shouldAttachResultsToToolUses = toolResultBlocks.length > 1;

	for (const { block } of toolResultBlocks) {
		const existingToolUseMessage = toolUseMessagesById.get(block.tool_use_id);
		if (existingToolUseMessage && !shouldAttachResultsToToolUses) {
			updateAssistantToolUseViewportMessage(
				existingToolUseMessage,
				Boolean(block.is_error) ? 'error' : 'done'
			);
		}
	}

	if (!shouldAttachResultsToToolUses) {
		viewportMessages.push(...viewportMessagesForToolResult);
		return;
	}

	const attachedToolUseIds = new Set<string>();

	for (const viewportMessage of viewportMessagesForToolResult) {
		const toolUseId = viewportMessage.toolUseId;
		const existingToolUseMessage = toolUseId
			? toolUseMessagesById.get(toolUseId)
			: undefined;
		if (existingToolUseMessage && viewportMessage.content && toolUseId) {
			attachAssistantToolUseResultViewportMessage(
				existingToolUseMessage,
				viewportMessage.content,
				viewportMessage.toolPhase === 'error' ? 'error' : 'done'
			);
			attachedToolUseIds.add(toolUseId);
			continue;
		}

		viewportMessages.push(viewportMessage);
	}

	for (const { block } of toolResultBlocks) {
		if (attachedToolUseIds.has(block.tool_use_id)) {
			continue;
		}
		const existingToolUseMessage = toolUseMessagesById.get(block.tool_use_id);
		if (existingToolUseMessage) {
			updateAssistantToolUseViewportMessage(
				existingToolUseMessage,
				Boolean(block.is_error) ? 'error' : 'done'
			);
		}
	}
}

function buildViewportMessages(
	messages: MessageType[],
	tools: readonly Tool[],
	completedTurnFooters: CompletedTurnFooter[] = [],
	verbose = false,
	currentTimeMs = Date.now()
): ViewportMessage[] {
	const viewportMessages: ViewportMessage[] = [];
	const toolUseMessagesById = new Map<string, ViewportMessage>();
	const progressMessagesByToolUseId = new Map<
		string,
		ProgressMessage<ToolProgressData>[]
	>();
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

		if (isNoResponseRequestedMessage(message)) {
			appendCompletedTurnFooter(fallbackId);
			return;
		}

		if (shouldCollapseApiRetryMessage(messages, index)) {
			appendCompletedTurnFooter(fallbackId);
			return;
		}

		if (message.type === 'assistant') {
			const assistantViewportMessages =
				getAssistantViewportMessagesInContentOrder(
					message,
					fallbackId,
					tools,
					verbose
				);
			if (assistantViewportMessages.length > 0) {
				registerAssistantToolUseViewportMessages(
					viewportMessages,
					toolUseMessagesById,
					assistantViewportMessages
				);
			}

			if (assistantViewportMessages.length > 0) {
				appendCompletedTurnFooter(fallbackId);
				return;
			}
		}

		if (message.type === 'user' && isToolResultUserMessage(message)) {
			const toolResultBlocks = getToolResultBlocks(message);
			const viewportMessagesForToolResult = getToolResultViewportMessages(
				message,
				fallbackId,
				messages,
				tools,
				verbose
			);
			if (viewportMessagesForToolResult.length > 0) {
				reconcileToolResultViewportMessages(
					viewportMessages,
					toolUseMessagesById,
					toolResultBlocks,
					viewportMessagesForToolResult
				);
			}
			appendCompletedTurnFooter(fallbackId);
			return;
		}

		if (message.type === 'progress') {
			const toolUseId = getProgressMessageToolUseId(message);
			const existingToolUseMessage = toolUseId
				? toolUseMessagesById.get(toolUseId)
				: undefined;
			const assistantToolUse = toolUseId
				? findAssistantToolUse(messages, message, toolUseId)
				: null;
			const tool = assistantToolUse
				? findToolByName(tools, assistantToolUse.name)
				: undefined;

			if (toolUseId && existingToolUseMessage && tool) {
				const progressMessagesForToolUse = [
					...(progressMessagesByToolUseId.get(toolUseId) ?? []),
					message as ProgressMessage<ToolProgressData>
				];
				progressMessagesByToolUseId.set(
					toolUseId,
					progressMessagesForToolUse
				);

				const renderedProgressContent = renderToolProgressContent(
					tool,
					progressMessagesForToolUse,
					tools,
					verbose
				);

				if (renderedProgressContent) {
					updateAssistantToolUseProgressViewportMessage(
						existingToolUseMessage,
						renderedProgressContent
					);
					appendCompletedTurnFooter(fallbackId);
					return;
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
			verbose,
			currentTimeMs
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

function shouldCollapseApiRetryMessage(
	messages: MessageType[],
	index: number
): boolean {
	const current = messages[index];
	if (!isApiRetrySystemMessage(current)) {
		return false;
	}

	const next = messages[index + 1];
	return isApiRetrySystemMessage(next);
}

function isApiRetrySystemMessage(
	message: MessageType | undefined
): message is MessageType & {
	type: 'system';
	subtype: 'api_error';
	retryAttempt: number;
	retryInMs: number;
	maxRetries: number;
} {
	return (
		message?.type === 'system' &&
		message.subtype === 'api_error' &&
		typeof message.retryAttempt === 'number' &&
		typeof message.retryInMs === 'number' &&
		typeof message.maxRetries === 'number'
	);
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
	const content = message.message?.content;
	if (!Array.isArray(content)) {
		return null;
	}

	const block = content.find((contentBlock: unknown) => {
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

function getToolResultBlocks(message: MessageType): Array<{
	block: { tool_use_id: string; is_error?: unknown; content?: unknown };
	index: number;
}> {
	const content = message.message?.content;
	if (!Array.isArray(content)) {
		return [];
	}

	return content
		.map((contentBlock, index) => {
			if (!contentBlock || typeof contentBlock !== 'object') {
				return null;
			}

			const typedBlock = contentBlock as {
				type?: unknown;
				tool_use_id?: unknown;
				is_error?: unknown;
				content?: unknown;
			};
			if (
				typedBlock.type !== 'tool_result' ||
				typeof typedBlock.tool_use_id !== 'string'
			) {
				return null;
			}

			return {
				block: typedBlock as {
					tool_use_id: string;
					is_error?: unknown;
					content?: unknown;
				},
				index
			};
		})
		.filter(
			(value): value is {
				block: { tool_use_id: string; is_error?: unknown; content?: unknown };
				index: number;
			} => value !== null
		);
}

function hasToolResultForConfirmation(
	messages: readonly MessageType[],
	toolUseConfirm: ToolUseConfirm
): boolean {
	return messages.some(message => {
		if (
			typeof message.sourceToolAssistantUUID === 'string' &&
			message.sourceToolAssistantUUID !== String(toolUseConfirm.assistantMessage.uuid)
		) {
			return false;
		}

		return getToolResultBlocks(message).some(
			({ block }) => block.tool_use_id === toolUseConfirm.toolUseID
		);
	});
}

function createSingleToolResultMessage(
	message: MessageType,
	block: {
		tool_use_id: string;
		is_error?: unknown;
		content?: unknown;
	},
	blockCount = 1
): MessageType {
	if (!Array.isArray(message.message?.content)) {
		return message;
	}

	const toolUseResult =
		blockCount === 1 && message.toolUseResult !== undefined
			? message.toolUseResult
			: block.content;

	return {
		...message,
		toolUseResult,
		message: {
			...message.message,
			content: [
				{
					type: 'tool_result',
					tool_use_id: block.tool_use_id,
					is_error: block.is_error,
					content: block.content
				}
			] as never
		}
	};
}

function getToolResultViewportMessages(
	message: MessageType,
	fallbackId: number,
	messages: MessageType[],
	tools: readonly Tool[],
	verbose: boolean
): ViewportMessage[] {
	const toolResultBlocks = getToolResultBlocks(message);

	return toolResultBlocks
		.map(({ block, index }) => {
			const viewportMessage = messageToViewport(
				createSingleToolResultMessage(
					message,
					block,
					toolResultBlocks.length
				),
				fallbackId * 100 + index + 1,
				messages,
				tools,
				verbose
			);
			if (!viewportMessage) {
				return null;
			}

			viewportMessage.toolDisplayStyle = 'result';
			viewportMessage.toolUseId = block.tool_use_id;
			return viewportMessage;
		})
		.filter((value): value is ViewportMessage => value !== null);
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

function shouldAppendStreamingPlaceholder(
	baseViewportMessages: ViewportMessage[],
	streamingPlaceholder: ViewportMessage | null
): boolean {
	if (!streamingPlaceholder) {
		return false;
	}

	if (
		streamingPlaceholder.role === 'tool' &&
		streamingPlaceholder.toolDisplayStyle === 'use'
	) {
		for (let index = baseViewportMessages.length - 1; index >= 0; index--) {
			const message = baseViewportMessages[index];
			if (message.role === 'meta') {
				continue;
			}

			if (
				message.role === 'tool' &&
				message.toolDisplayStyle === 'use' &&
				message.toolPhase === 'call'
			) {
				return false;
			}

			break;
		}
	}

	return true;
}

function isToolResultUserMessage(message: MessageType): boolean {
	const content = message.message?.content;
	if (message.type !== 'user' || !Array.isArray(content)) {
		return false;
	}

	return content.some(block => {
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
	const content = message.message?.content;
	if (!Array.isArray(content)) {
		return { text: '', phase: 'done' };
	}

	const toolResult = content.find((block: unknown) => {
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
	verbose: boolean,
	currentTimeMs = Date.now()
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
						toolPhase: 'done',
						toolName: toolUse?.name
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
						toolPhase: 'error',
						toolName: toolUse?.name
					};
				}
			}

			const { text, phase } = extractToolResult(message);
			return text
				? {
						id: fallbackId,
						role: 'tool',
						text,
						toolPhase: phase,
						toolName: toolUse?.name
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

		const content = message.message?.content;
		const toolUseItems: ToolUseRenderItem[] = Array.isArray(content)
			? content
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
			: extractToolUseLabels(content).map(label => ({
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
		const retrySummary = getApiRetrySummary(message, currentTimeMs);
		if (retrySummary) {
			return null;
		}

		const systemContent =
			typeof message.content === 'string' ? message.content : null;
		const text = systemContent ?? extractTextContent(message.message?.content);
		if (message.subtype === 'api_error' && text) {
			const visibleText = hideApiErrorRequestId(text);
			return {
				id: fallbackId,
				role: 'assistant',
				text: visibleText,
				content: renderApiErrorContent(visibleText),
				tone: 'error'
			};
		}
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

function getApiRetrySummary(
	message: MessageType,
	currentTimeMs: number
): ApiRetrySummary | null {
	if (message.type !== 'system' || message.subtype !== 'api_error') {
		return null;
	}

	if (
		typeof message.retryAttempt !== 'number' ||
		typeof message.maxRetries !== 'number' ||
		typeof message.retryInMs !== 'number'
	) {
		return null;
	}

	const retryInMs = Math.max(0, message.retryInMs);
	const timestampMs =
		typeof message.timestamp === 'string'
			? Date.parse(message.timestamp)
			: NaN;
	const remainingMs = Number.isFinite(timestampMs)
		? Math.max(0, timestampMs + retryInMs - currentTimeMs)
		: retryInMs;

	return {
		attempt: message.retryAttempt,
		maxRetries: message.maxRetries,
		remainingMs
	};
}

function formatRetryDuration(remainingMs: number): string {
	if (remainingMs < 1000) {
		return '1s';
	}

	const totalSeconds = Math.ceil(remainingMs / 1000);
	if (totalSeconds < 60) {
		return `${totalSeconds}s`;
	}

	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

function buildApiRetryText(summary: ApiRetrySummary): string {
	const headline = `API request failed, retrying in ${formatRetryDuration(summary.remainingMs)}.`;
	const attempt = `Attempt ${summary.attempt}/${summary.maxRetries + 1}`;
	return `${headline}\n${attempt}`;
}

function buildApiRetryStatusText(summary: ApiRetrySummary): string {
	return `Retrying ${summary.attempt}/${summary.maxRetries + 1}`;
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

type MainScrollbackProps = {
	welcomeHeader: React.ComponentProps<typeof MessageViewport>['welcomeHeader'];
	messages: ViewportMessage[];
	width: number;
	alertMessage: string | null;
	toolJSX: {
		jsx: React.ReactNode | null;
		isLocalJSXCommand?: boolean;
		isImmediate?: boolean;
	} | null;
};

// Keep the complete leading scrollback subtree stable while only the prompt
// and slash selector change. Freezing individual welcome rows is not enough:
// a dirty first sibling can invalidate blitting for the whole scrollback.
const MainScrollback = React.memo(function MainScrollback({
	welcomeHeader,
	messages,
	width,
	alertMessage,
	toolJSX,
}: MainScrollbackProps): React.ReactNode {
	return (
		<Box flexDirection="column">
			<OffscreenFreeze>
				<WelcomeHeader {...welcomeHeader} />
			</OffscreenFreeze>
			<MessageViewport
				headerLines={[]}
				messages={messages}
				width={width}
				alertMessage={alertMessage}
				statusLine={null}
				blinkOn={false}
			/>
			{toolJSX && !(toolJSX.isLocalJSXCommand && toolJSX.isImmediate) ? (
				<Box flexDirection="column" width="100%">
					{toolJSX.jsx}
				</Box>
			) : null}
		</Box>
	);
});

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
	const isTerminalFocused = getTerminalFocused();
	// Initialize input with any early input that was captured before REPL was ready.
	// Using lazy initialization ensures cursor offset is set correctly in PromptInput.
	const [inputValue, setInputValueRaw] = useState(() => consumeEarlyInput());
	const inputValueRef = useRef(inputValue);
	inputValueRef.current = inputValue;
	const setInputValue = useCallback(
		(value: React.SetStateAction<string>) => {
			const nextValue =
				typeof value === 'function'
					? value(inputValueRef.current)
					: value;
			inputValueRef.current = nextValue;
			setInputValueRaw(nextValue);
		},
		[]
	);
	const mcp = useAppState(s => s.mcp);
	const [screen, setScreen] = useState<AppScreen>('prompt');
	const [cursorSyncKey, setCursorSyncKey] = useState(0);
	const [pastedContents, setPastedContents] = useState<Record<number, PastedContent>>({});
	const toolPermissionContext = useAppState(s => s.toolPermissionContext);
	const fileHistory = useAppState(s => s.fileHistory);
	// feature() is a build-time constant — dead code elimination removes the hook
	// call entirely in external builds, so this is safe despite looking conditional.
	const store = useAppStateStore();
	const { onHistoryUp, onHistoryDown, resetHistory } = useArrowKeyHistory(
		setInputValue,
		setPastedContents,
		inputValue,
		pastedContents,
	);
	const localTools = useMemo(
		() => getTools(toolPermissionContext),
		[toolPermissionContext,],
	);
	  // Memoize the combined initial tools array to prevent reference changes
	const combinedInitialTools = useMemo(() => {
		return [...localTools, ...initialTools];
	}, [localTools, initialTools]);
	const mergedTools = useMergedTools(
		combinedInitialTools,
		mcp.tools,
		toolPermissionContext,
	)

	// Local state for commands (hot-reloadable when skill files change)
  	const [localCommands, setLocalCommands] = useState(initialCommands);
  	// Must keep a stable identity: this feeds the buildViewportMessages memo,
  	// and getAllBaseTools() returns a fresh array every call. A new array per
  	// render invalidates that memo, which rebuilds every message's React node,
  	// which breaks the row-level and MainScrollback memos in turn — so every
  	// keystroke would repaint the whole transcript and the welcome card.
  	const activeTools = useMemo(
  		() => (initialTools.length > 0 ? initialTools : getAllBaseTools()),
  		[initialTools]
  	);
  	const mergedCommands = initialCommands
	const commands = useMemo(() => (disableSlashCommands ? [] : mergedCommands), [disableSlashCommands, mergedCommands]);
	const handleInputChange = useCallback((nextValue: string) => {
		const matches = getSlashCommandMatches(nextValue, commands);
		const trimmed = nextValue.trimStart();
		const isSlashCommandInput =
			trimmed.startsWith('/') && !trimmed.slice(1).includes(' ');
		setInputValue(nextValue);
		setFilteredCommands(matches.map(match => match.command));
		// Keep the fixed-height selector mounted even when a query has no
		// matches (for example `/cles`). Hiding it here makes the main screen
		// shrink on the same keystroke and can leave the old rows in scrollback.
		setShowCommandSelector(isSlashCommandInput);
		setSelectedCommandIndex(0);
		resetHistory();
	}, [commands, resetHistory, setInputValue]);
	const [alertMessage, setAlertMessage] = useState<string | null>(null);
	const [exitHint, setExitHint] = useState(false);
	const exitHintRef = useRef(false);
	const [streamingAssistant, setStreamingAssistant] =
		useState<StreamingAssistantState>({
			active: false,
			streamMode: 'requesting',
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
	const [apiRetryUiState, setApiRetryUiState] = useState<ApiRetryUiState>({
		active: false,
		statusText: null
	});
	const [messages, rawSetMessages] = useState<MessageType[]>(
		() => initialMessages ?? []
	);
	const [conversationId, setConversationId] = useState(() => randomUUID());
	const [lastQueryCompletionTime, setLastQueryCompletionTime] = useState(0);
	const [completedTurnFooters, setCompletedTurnFooters] = useState<
		CompletedTurnFooter[]
	>([]);
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
	const mainLoopModel = appState.mainLoopModel || getCurrentModel();
	const [toolUseConfirmQueue, setToolUseConfirmQueue] = useState<
		ToolUseConfirm[]
	>([]);
	let initialDynamicMcpConfig: Record<string, ScopedMcpServerConfig>={}//初始的MCP 配置一般为空
	const [dynamicMcpConfig, setDynamicMcpConfig] = useState<Record<string, ScopedMcpServerConfig> | undefined>(
		initialDynamicMcpConfig,
	);
	 const onChangeDynamicMcpConfig = useCallback(
		(config: Record<string, ScopedMcpServerConfig>) => {
			setDynamicMcpConfig(config);
		},
		[setDynamicMcpConfig],
	);
	  // IDE integration
  	const [ideSelection, setIDESelection] = useState<IDESelection | undefined>(undefined);//保存当前IDE选择的位置文本
	const [ideInstallationStatus, setIDEInstallationStatus] = useState<IDEExtensionInstallationStatus | null>(null);
	const [showIdeOnboarding, setShowIdeOnboarding] = useState(false);
	const [ideToInstallExtension, setIDEToInstallExtension] = useState<IdeType | null>(null);

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
	const isRemoteSession = false
	// Ref for the synchronous restore callback — set after restoreMessageSync is
	// defined, read in the onQuery finally block for auto-restore on interrupt.
	const restoreMessageSyncRef = useRef<(m: UserMessage) => void>(() => {});

	useIdeSelection(isRemoteSession ? EMPTY_MCP_CLIENTS : mcp.clients, setIDESelection);

	const messagesRef = useRef(messages);
	const appStateRef = useRef(appState);
	const [inputMode, setInputMode] = useState<PromptInputMode>('prompt');
	const [abortController, setAbortController] =
		useState<AbortController | null>(null);
	// 始终指向当前中止控制器的 Ref，用于在异步回调中读取最新 controller。
	const abortControllerRef = useRef<AbortController | null>(null);
	abortControllerRef.current = abortController;
	const userCancelAbortRef = useRef(false);
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

	useLogMessages(
		messages,
		messages.length === initialMessages?.length
	);

	useEffect(() => {
		if (loading) {
			if (loadingStartTimeRef.current === null) {
				loadingStartTimeRef.current = Date.now();
			}
			return;
		}

		loadingStartTimeRef.current = null;
	}, [loading]);

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

	function resetLoadingState() {
		// Reset only the transient loading residue for the current turn.
		loadingStartTimeRef.current = null;
		setToolJSX(null);
	}

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
	// Initialize IDE integration
	useIDEIntegration({//读取ide lock配置 加入到appstate中，安装插件
		autoConnectIdeFlag:true,
		ideToInstallExtension,
		setDynamicMcpConfig,
		setShowIdeOnboarding,
		setIDEInstallationState: setIDEInstallationStatus,
	});
	const resume = useCallback(
		async (sessionId: UUID, log: LogOption, entrypoint: ResumeEntrypoint) => {
			const resumeStart = performance.now();
			try {
			// Deserialize messages to properly clean up the conversation
			// This filters unresolved tool uses and adds a synthetic assistant message if needed
			const messages = deserializeMessages(log.messages);
			// For forks, generate a new plan slug and copy the plan content so the
			// original and forked sessions don't clobber each other's plan files.
			// For regular resumes, reuse the original session's plan slug.

			// Restore file history and attribution state from the resumed conversation
			restoreSessionStateFromLog(log, setAppState);
			// if (log.fileHistorySnapshots) {
			// 	void copyFileHistoryForResume(log);
			// }
			// Restore standalone agent context from the resumed conversation
			// Always reset to the new session's values (or clear if none)

			// void updateSessionName(log.agentName);

			// Restore read file state from the message history
			// restoreReadFileState(messages, log.projectPath ?? getOriginalCwd());

			// Clear any active loading state (no queryId since we're not in a query)
			loadingStartTimeRef.current = null;
			setToolJSX({
				jsx: null,
				shouldHidePromptInput: false,
				clearLocalJSX: true
			});
			setAbortController(null);
			setConversationId(sessionId);
			// Get target session's costs BEFORE saving current session
			// (saveCurrentSessionCosts overwrites the config, so we need to read first)
			// const targetSessionCosts = getStoredSessionCosts(sessionId);

			// Save current session's costs before switching to avoid losing accumulated costs
			// saveCurrentSessionCosts();

			// Reset cost state for clean slate before restoring target session
			resetCostState();

			// Switch session (id + project dir atomically). fullPath may point to
			// a different project (cross-worktree, /branch); null derives from
			// current originalCwd.
			switchSession(asSessionId(sessionId), log.fullPath ? dirname(log.fullPath) : null);
			// Rename asciicast recording to match the resumed session ID
			// const { renameRecordingForSession } = await import('../utils/asciicast.js');
			// await renameRecordingForSession();
			await resetSessionFilePointer();

			// Clear then restore session metadata so it's re-appended on exit via
			// reAppendSessionMetadata. clearSessionMetadata must be called first:
			// restoreSessionMetadata only sets-if-truthy, so without the clear,
			// a session without an agent name would inherit the previous session's
			// cached name and write it to the wrong transcript on first message.
			clearSessionMetadata();
			restoreSessionMetadata(log);
	

			// Restore target session's costs from the data we read earlier
			// if (targetSessionCosts) {
			// 	setCostStateForRestore(targetSessionCosts);
			// }

			// Reconstruct replacement state for the resumed session. Runs after
			// setSessionId so any NEW replacements post-resume write to the
			// resumed session's tool-results dir. Gated on ref.current: the
			// initial mount already read the feature flag, so we don't re-read
			// it here (mid-session flag flips stay unobservable in both
			// directions).
			//
			// Skipped for in-session /branch: the existing ref is already correct
			// (branch preserves tool_use_ids), so there's no need to reconstruct.
			// createFork() does write content-replacement entries to the forked
			// JSONL with the fork's sessionId, so `claude -r {forkId}` also works.
			// if (contentReplacementStateRef.current && entrypoint !== 'fork') {
			// contentReplacementStateRef.current = reconstructContentReplacementState(
			// 	messages,
			// 	log.contentReplacements ?? [],
			// );
			// }

			// Reset messages to the provided initial messages
			// Use a callback to ensure we're not dependent on stale state
			setMessages(() => messages);

			// Clear input to ensure no residual state
			// setInputValue('');
			setInputValue('');

		} catch (error) {
			throw error;
		}
		},
		[resetLoadingState, setAppState, setMessages, setInputValue, setToolJSX],
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
	const activeToolUseConfirm = toolUseConfirmQueue[0];
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


	const handleCommandSelect = useCallback((command: Command) => {
		const nextValue = `/${getCommandName(command)}${command.argumentHint ? ' ' : ''}`;
		setInputValue(nextValue);
		setCursorSyncKey(prev => prev + 1);
		setFilteredCommands(commands);
		setShowCommandSelector(false);
	}, [commands, setInputValue]);

	const handleCtrlC = useCallback(() => {
		if (exitHintRef.current) {
			if (exitTimerRef.current) {
				clearTimeout(exitTimerRef.current);
				exitTimerRef.current = null;
			}
			exit();
			return;
		}

		if (loading) {
			queryGuard.forceEnd();
			resetLoadingState();
			userCancelAbortRef.current = true;
			abortControllerRef.current?.abort('user-cancel');
			setAbortController(null);
			return;
		}

		setInputValue('');
		exitHintRef.current = true;
		setExitHint(true);
		if (exitTimerRef.current) {
			clearTimeout(exitTimerRef.current);
		}

		exitTimerRef.current = setTimeout(() => {
			exitHintRef.current = false;
			setExitHint(false);
			exitTimerRef.current = null;
		}, 800);
	}, [exit, loading, queryGuard, resetLoadingState]);

	const repinScroll = useCallback(() => {
		scrollRef.current?.scrollToBottom();
	}, []);

	const resetMainScroll = useCallback(() => {
		scrollRef.current?.scrollTo(0);
	}, []);

	useInput(
		(input, key, event) => {
			if (key.ctrl && input === 'c' && exitHintRef.current) {
				event.stopImmediatePropagation();
				handleCtrlC();
				return;
			}

			if (key.ctrl && input === 'o') {
				event.stopImmediatePropagation();
				setScreen(current =>
					current === 'transcript' ? 'prompt' : 'transcript'
				);
				return;
			}

			if (screen === 'transcript' && key.escape) {
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
					setInputValue('');
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
			if (event.type === 'api_retry_status') {
				const retryEvent = event as ApiRetryStatusEvent;
				const summary: ApiRetrySummary = {
					attempt: retryEvent.retryAttempt,
					maxRetries: retryEvent.maxRetries,
					remainingMs: retryEvent.retryInMs
				};

				setApiRetryUiState({
					active: true,
					statusText: buildApiRetryStatusText(summary),
					retryAtMs: Date.now() + retryEvent.retryInMs
				});
				return;
			}

			handleMessageFromStream(event, {
				onMessageStart: () => {
					setApiRetryUiState({
						active: false,
						statusText: null
					});
					setStreamingAssistant(prev => ({
						active: true,
						streamMode: 'requesting',
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
				onThinkingBlockStart: () => {
					setStreamingAssistant(prev => ({
						...prev,
						active: true,
						streamMode: 'thinking'
					}));
				},
				onToolUseBlockStart: toolName => {
					const toolLabel = toolName;
					setStreamingAssistant(prev => ({
						...prev,
						active: true,
						streamMode: 'requesting',
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
						streamMode: 'responding',
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
					const apiErrorText =
						newMessage.type === 'assistant' &&
						Array.isArray(newMessage.message?.content)
							? newMessage.message.content
									.filter(block => block.type === 'text')
									.map(block => block.text)
									.join('\n')
							: '';
					const isUserAbortApiError =
						userCancelAbortRef.current &&
						newMessage.type === 'assistant' &&
						newMessage.isApiErrorMessage &&
						apiErrorText.includes('API Error: Request was aborted.');
					if (isUserAbortApiError) {
						return;
					}
					if (isCompactBoundaryMessage(newMessage)) {
						setCompletedTurnFooters([]);
						setConversationId(randomUUID());
						setMessages(() => [newMessage]);
					} else {
						setMessages(prev => [...prev, newMessage]);
					}
					if (newMessage.type === 'assistant') {
						setApiRetryUiState({
							active: false,
							statusText: null
						});
						setStreamingAssistant({
							active: false,
							streamMode: 'requesting',
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

		switch (event.type) {
			case 'hooks_start':
				setCompactUiState(prev => ({
					...prev,
					active: true,
					statusText: '正在压缩'
				}));
				break;
			case 'compact_start':
				setCompactUiState(prev => ({
					...prev,
					active: true,
					streamMode: 'requesting',
					responseLength: 0,
					statusText: '正在压缩'
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
		const computeTools = () => {
			const state = store.getState();
			const assembled = assembleToolPool(state.toolPermissionContext, state.mcp.tools);
			const merged = mergeAndFilterTools(combinedInitialTools, assembled, state.toolPermissionContext.mode);

			return  merged
		};
		return {
			abortController,
			options: {
			commands,
			tools: computeTools(),
			debug,
			mcpClients:s.mcp.clients,
			verbose: false,
			thinkingConfig:{ type: 'disabled' },
			mainLoopModel,
			isNonInteractiveSession: false,
			customSystemPrompt,
			appendSystemPrompt,
			refreshTools:computeTools,

			},
			getAppState: () => store.getState(),
			resume,
			setAppState,
			setResponseLength: updater => {
				setCompactUiState(prev => {
					const responseLength = updater(prev.responseLength);
					return {
						...prev,
						responseLength,
						statusText:
							prev.active && prev.streamMode === 'responding'
								? '正在压缩'
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
							? '正在压缩'
							: prev.statusText ?? '正在压缩'
				}));
			},
			onCompactProgress: handleCompactProgress,
			messages,
			setToolJSX,
			setCompletedTurnFooters,
			resetMainScroll,
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
			setConversationId,
			readFileState: readFileState.current,
			onChangeAPIKey: () => {
				const settings = getInitialSettings();
				setAppState(prev => ({
					...prev,
					settings,
					mainLoopModel:
						typeof settings.model === 'string'
							? settings.model
							: prev.mainLoopModel,
				}));
			}
			};
		},
		[
		 commands,
      debug,
      store,
	  setConversationId,
      setAppState,
      setMessages,
      disabled,
	  resume,
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
			const { tools: freshTools , mcpClients: freshMcpClients} = toolUseContext.options;
			const [defaultSystemPrompt, baseUserContext,systemContext] = await Promise.all([
				getSystemPrompt(freshTools, mainLoopModelParam,       
					[],
					freshMcpClients,
			),
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
					if (abortController.signal.reason !== 'user-cancel') {
						setAlertMessage('当前请求已取消');
					}
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
			const startedAt = Date.now();
			if (!queryGuard.getSnapshot()) {
				loadingStartTimeRef.current = startedAt;
			}
			userCancelAbortRef.current = false;
			const thisGeneration = queryGuard.tryStart();
			if (thisGeneration === null) {
				return;
			}
			if (loadingStartTimeRef.current === null) {
				loadingStartTimeRef.current = startedAt;
			}
			setMessages(oldMessages => [...oldMessages, ...newMessages]);
			setInputValue('');
			setStreamingAssistant({
				active: false,
				streamMode: 'requesting',
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
			setApiRetryUiState({
				active: false,
				statusText: null
			});
			const latestMessages = messagesRef.current;
			try {
				
				await onQueryImpl(
					latestMessages,
					newMessages,
					abortController,
					shouldQuery,
					additionalAllowedTools,
					mainLoopModel
				);
			} finally {
				if (queryGuard.end(thisGeneration) ) {
					const durationMs = Date.now() - startedAt;
					setLastQueryCompletionTime(Date.now());
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
						streamMode: 'requesting',
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
					setApiRetryUiState({
						active: false,
						statusText: null
					});
					// Clear the controller so CancelRequestHandler's canCancelRunningTask
					// reads false at the idle prompt. Without this, the stale non-aborted
					// controller makes ctrl+c fire onCancel() (aborting nothing) instead of
					// propagating to the double-press exit flow.
					setAbortController(null);
				}
				// Auto-restore: if the user interrupted before any meaningful response
				// arrived, rewind the conversation and restore their prompt — same as
				// opening the message selector and picking the last message.
				// This runs OUTSIDE the queryGuard.end() check because onCancel calls
				// forceEnd(), which bumps the generation so end() returns false above.
				// Guards: reason === 'user-cancel' (onCancel/Esc; programmatic aborts
				// use 'background'/'interrupt' and must not rewind — note abort() with
				// no args sets reason to a DOMException, not undefined), !isActive (no
				// newer query started — cancel+resubmit race), empty input (don't
				// clobber text typed during loading), no queued commands (user queued
				// B while A was loading → they've moved on, don't restore A; also
				// avoids removeLastFromHistory removing B's entry instead of A's),
				// not viewing a teammate (messagesRef is the main conversation — the
				// old Up-arrow quick-restore had this guard, preserve it).
				if (
					abortController.signal.reason === 'user-cancel' &&
					!queryGuard.isActive &&
					inputValueRef.current === '' &&
					getCommandQueueLength() === 0 
					) {
					const msgs = messagesRef.current;
					const lastUserMsg = msgs.findLast(
						(message): message is UserMessage =>
							selectableUserMessagesFilter(message) &&
							!isSyntheticMessage(message)
					);
					if (lastUserMsg) {
						const idx = msgs.lastIndexOf(lastUserMsg);
						if (messagesAfterAreOnlySynthetic(msgs, idx)) {
							// The submit is being undone — undo its history entry too,
							// otherwise Up-arrow shows the restored text twice.
							removeLastFromHistory();
							restoreMessageSyncRef.current(lastUserMsg );
						}
					}
				}
			}
		},
		[columns, onQueryImpl, queryGuard]
	);
	// Rewind conversation state to just before `message`: slice messages,
	// reset conversation ID, microcompact state, permission mode, prompt suggestion.
	// Does NOT touch the prompt input. Index is computed from messagesRef (always
	// fresh via the setMessages wrapper) so callers don't need to worry about
	// stale closures.
	const rewindConversationTo = useCallback(
		(message: UserMessage) => {
		const prev = messagesRef.current;
		const messageIndex = prev.lastIndexOf(message);
		if (messageIndex === -1) return;

		setMessages(prev.slice(0, messageIndex));//恢复
		// Careful, this has to happen after setMessages
		setConversationId(randomUUID());
		// Reset cached microcompact state so stale pinned cache edits
		// don't reference tool_use_ids from truncated messages
		resetMicrocompactState();

		// Restore state from the message we're rewinding to
		const permMode = message.permissionMode as InternalPermissionMode | undefined;
		setAppState(prev => ({
			...prev,
			// Restore permission mode from the message
			toolPermissionContext:
			permMode && prev.toolPermissionContext.mode !== permMode
				? {
					...prev.toolPermissionContext,
					mode: permMode,
				}
				: prev.toolPermissionContext,
			// Clear stale prompt suggestion from previous conversation state
			promptSuggestion: {
			text: null,
			promptId: null,
			shownAt: 0,
			acceptedAt: 0,
			generationRequestId: null,
			},
		}));
		},
		[setMessages, setAppState],
	);
	// Synchronous rewind + input population. Used directly by auto-restore on
	// interrupt (so React batches with the abort's setMessages → single render,
	// no flicker). MessageSelector wraps this in setImmediate via handleRestoreMessage.
	const restoreMessageSync = useCallback(
		(message: UserMessage) => {
		rewindConversationTo(message);

		const r = textForResubmit(message);
		if (r) {
			setInputValue(r.text);
			setInputMode(r.mode);
		}

		// Restore pasted images
		if (Array.isArray(message.message.content) && message.message.content.some(block => block.type === 'image')) {
			const imageBlocks: Array<ImageBlockParam> = message.message.content.filter(block => block.type === 'image');
			if (imageBlocks.length > 0) {
			const newPastedContents: Record<number, PastedContent> = {};
			imageBlocks.forEach((block, index) => {
				if (block.source.type === 'base64') {
				const id = (message.imagePasteIds as number[] | undefined)?.[index] ?? index + 1;
				newPastedContents[id] = {
					id,
					type: 'image',
					content: block.source.data,
					mediaType: block.source.media_type,
				};
				}
			});
			setPastedContents(newPastedContents);
			}
		}
		},
		[rewindConversationTo, setInputValue],
	);
	restoreMessageSyncRef.current = restoreMessageSync;

	// MessageSelector path: defer via setImmediate so the "Interrupted" message
	// renders to static output before rewind — otherwise it remains vestigial
	// at the top of the screen.
	const handleRestoreMessage = useCallback(
		async (message: UserMessage) => {
		setImmediate((restore, message) => restore(message), restoreMessageSync, message);
		},
		[restoreMessageSync],
	);
	const onSubmit = useCallback(
		async (value: string) => {
			const text = value.trim();
			const trimmedSlashInput = text.startsWith('/')
				? expandPastedTextRefs(value, pastedContents).trim()
				: '';
			const slashSpaceIndex =
				trimmedSlashInput.length > 0
					? trimmedSlashInput.indexOf(' ')
					: -1;
			const slashCommandName =
				slashSpaceIndex === -1
					? trimmedSlashInput.slice(1)
					: trimmedSlashInput.slice(1, slashSpaceIndex);
			const matchingSlashCommand =
				slashCommandName.length > 0
					? commands.find(
							cmd =>
								isCommandEnabled(cmd) &&
								(cmd.name === slashCommandName ||
									cmd.aliases?.includes(slashCommandName) ||
									getCommandName(cmd) === slashCommandName),
					  )
					: undefined;
			const shouldSkipPromptHistory =
				matchingSlashCommand?.type === 'local-jsx' &&
				getCommandName(matchingSlashCommand) === 'resume';
			repinScroll(); //滚回底部
			if (text.startsWith('/')) {
				//展开文本
				const trimmedInput = trimmedSlashInput;
				const spaceIndex = slashSpaceIndex;
				const commandName = slashCommandName;
				const commandArgs =
					spaceIndex === -1 ? '' : trimmedInput.slice(spaceIndex + 1).trim();
				// Find matching command - treat as immediate if:
				// 1. Command has `immediate: true`, OR
				// 2. Command was triggered via keybinding (fromKeybinding option)
				const matchingCommand = matchingSlashCommand;
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
			if (!shouldSkipPromptHistory) {
				addToHistory({
					display: inputMode === 'bash' ? `!${value}` : value,
					pastedContents: pastedContents,
				});
				// Add the just-submitted command to the front of the ghost-text
				// cache so it's suggested immediately (not after the 60s TTL).
				if (inputMode === 'bash') {
					// prependToShellHistoryCache(inputValue.trim());
				}

			}
			resetHistory();
			setAlertMessage(null);
			if (inputMode === 'bash') {
				setInputMode('prompt');
			}
			await handlePromptSubmit({
				input: value,
				inputMode,
				onInputChange: handleInputChange,
				setToolJSX,
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
				ideSelection
			});
			
		},
		[
			commands,
			getToolUseContext,
			handleInputChange,
			inputMode,
			mainLoopModel,
			messages,
			onQuery,
			pastedContents,
			queryGuard,
			repinScroll,
			resetHistory,
			setAppState,
			setInputMode
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
	const viewportSliceAnchorRef = useRef<ViewportSliceAnchor>(null);
	const previousActiveToolUseConfirmRef = useRef(activeToolUseConfirm);
	useLayoutEffect(() => {
		const previousActiveToolUseConfirm =
			previousActiveToolUseConfirmRef.current;
		const permissionStateChanged =
			Boolean(previousActiveToolUseConfirm) !== Boolean(activeToolUseConfirm);
		previousActiveToolUseConfirmRef.current = activeToolUseConfirm;

		if (permissionStateChanged) {
			scrollRef.current?.scrollToBottom();
		}
	}, [activeToolUseConfirm]);
	// Rendering must use the same merged pool as execution. Dynamic MCP tools
	// inherit MCPTool's renderers; using only activeTools makes lookup fail and
	// falls back to dumping the raw tool_result JSON into the main transcript.
	const renderTools = mergedTools;
	const baseViewportMessages = useMemo(
		() => buildViewportMessages(
			messages,
			renderTools,
			completedTurnFooters,
			false,
			Date.now()
		),
		[
			messages,
			renderTools,
			completedTurnFooters,
			isTranscriptMode
		]
	);
	  const [remountKey, setRemountKey] = useState(0);
	const streamingPlaceholder = useMemo(() => {
		if (loading && streamingAssistant.placeholderId !== null) {
			if (streamingAssistant.text.trim().length > 0) {
				return {
					id: streamingAssistant.placeholderId,
					role: 'assistant' as const,
					text: buildStreamingPlaceholderText(streamingAssistant),
					animatePrefix: 'blink' as const
				};
			} else if (streamingAssistant.pendingToolCalls.length > 0) {
				return {
					id: streamingAssistant.placeholderId,
					role: 'tool' as const,
					text: streamingAssistant.pendingToolCalls.join('\n'),
					toolPhase: 'call' as const,
					toolDisplayStyle: 'use' as const,
					animatePrefix: 'blink' as const
				};
			}
		}
		return null;
	}, [loading, streamingAssistant.placeholderId, streamingAssistant.text, streamingAssistant.pendingToolCalls]);

	const viewportMessages = useMemo(() => {
		const nextMessages = shouldAppendStreamingPlaceholder(
			baseViewportMessages,
			streamingPlaceholder
		)
			? [...baseViewportMessages, streamingPlaceholder!]
			: baseViewportMessages;
		if (isTranscriptMode || isFullscreenEnvEnabled()) {
			return nextMessages;
		}

		const sliceStart = computeViewportSliceStart(
			nextMessages,
			viewportSliceAnchorRef
		);
		return sliceStart > 0 ? nextMessages.slice(sliceStart) : nextMessages;
	}, [baseViewportMessages, streamingPlaceholder, isTranscriptMode]);
	const hasInlineLoadingPlaceholder =
		loading &&
		streamingAssistant.placeholderId !== null &&
		(streamingAssistant.text.trim().length > 0 ||
			streamingAssistant.pendingToolCalls.length > 0);

	const { model: modelLabel, effort: effortLabel } = useTranscriptHeaderInfo();
	// The welcome card becomes terminal scrollback once a conversation grows.
	// Keep its identity fixed for the session: updating the model text in an
	// already-scrolled card forces Ink to repaint rows it can no longer reach,
	// which interleaves the /model picker with conversation output.
	const initialWelcomeHeaderRef = useRef({
		cwd: cwd(),
		model: modelLabel,
		effort: effortLabel,
	});
	if (messages.length === 0) {
		initialWelcomeHeaderRef.current = {
			...initialWelcomeHeaderRef.current,
			model: modelLabel,
			effort: effortLabel,
		};
	}
	const welcomeHeader = useMemo(
		() => ({
			brand: APP_BRAND,
			version: APP_VERSION,
			...initialWelcomeHeaderRef.current,
			width: messageWidth
		}),
		[messageWidth]
	);
	const highlightInputChrome =
		isTerminalFocused && loading && !activeToolUseConfirm;
	const thinkingStatusText =
		'Efrex 正在思考';
	const statusText = showSpinner && !hasInlineLoadingPlaceholder
		? apiRetryUiState.active
			? apiRetryUiState.statusText
			: compactUiState.active
			? compactUiState.statusText
			: streamingAssistant.text.trim().length > 0
				? 'Efrex 正在生成回复...'
				: streamingAssistant.pendingToolCalls.length > 0
					? 'Efrex 正在请求工具...'
					: streamingAssistant.streamMode === 'thinking'
						? thinkingStatusText
						: 'Efrex 正在思考...'
		: null;
	const statusMode = showSpinner
		? apiRetryUiState.active
			? 'requesting'
			: compactUiState.active
			? compactUiState.streamMode === 'requesting'
				? 'requesting'
				: 'default'
			: streamingAssistant.pendingToolCalls.length > 0
				? 'requesting'
				: 'default'
		: null;
	const statusKind =
		apiRetryUiState.active
			? 'retry'
			: compactUiState.active
				? 'compact'
				: 'default';


	const commandSelectorQuery = getSlashCommandQuery(inputValue.trim());
	const visibleCommandWindow = getVisibleWindow(
		filteredCommands,
		selectedCommandIndex,
		COMMAND_SELECTOR_VISIBLE_COUNT
	);
	// Keep the autocomplete region at a fixed height while the query changes
	// from `/` to `/m` (or any other filter). Blank rows must contain spaces so
	// Ink overwrites old rows instead of leaving them in terminal scrollback.
	const commandSelectorRows = Array.from(
		{ length: COMMAND_SELECTOR_VISIBLE_COUNT },
		(_, index) => visibleCommandWindow.items[index] ?? null
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
	const bashInputAccentColor = 'ansi:magentaBright';
	const inputRuleColor =
		inputMode === 'bash' ? bashInputAccentColor : 'gray';
	const inputPromptColor = inputMode === 'bash'
		? bashInputAccentColor
		: !isTerminalFocused
			? 'gray'
			: activeToolUseConfirm
				? 'gray'
				: loading
					? 'ansi:blueBright'
					: 'ansi:greenBright';
	const inputPromptPrefix = inputMode === 'bash' ? '! ' : '› ';
  // Process queued commands when query completes and queue has items

	const executeQueuedInput = useCallback(
		async (queuedCommands: QueuedCommand[]) => {
		await handlePromptSubmit({
			helpers: {
			setCursorOffset: () => {},
			clearBuffer: () => {},
			resetHistory: () => {},
			},
			setToolJSX,
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
			ideSelection
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
	const toolPermissionOverlay = activeToolUseConfirm ? (
		<PermissionRequest
			key={activeToolUseConfirm.toolUseID}
			onDone={shiftToolUseConfirmQueue}
			onReject={handlePermissionReject}
			toolUseConfirm={activeToolUseConfirm}
			toolUseContext={activeToolUseConfirm.toolUseContext}
			verbose={false}
			workerBadge={undefined}
			currentMessageCount={messages.length}
		/>
	) : null;
	const bottomContent = (
		<Box flexDirection="column" width="100%">
			{showSpinner &&
			!activeToolUseConfirm &&
			statusText ? (
				<StatusAnimationRow
					statusText={statusText}
					statusMode={statusMode}
					statusKind={statusKind}
					startedAtMs={loadingStartTimeRef.current}
					isThinking={streamingAssistant.streamMode === 'thinking'}
					thinkingEffort={
						String(appState.effortValue ?? getEffortLevel())
					}
					toolCount={streamingAssistant.pendingToolCalls.length}
					retryAtMs={apiRetryUiState.retryAtMs}
				/>
			) : null}

			{toolJSX?.isLocalJSXCommand && toolJSX.isImmediate ? (
				<Box flexDirection="column" width="100%">
					{toolJSX.jsx}
				</Box>
			) : null}

			<Box flexDirection="column" flexShrink={0}>
				<PromptInputQueuedCommands width={terminalColumns} />
				{!toolJSX?.shouldHidePromptInput && !activeToolUseConfirm ? (
					<>
						<Text> </Text>
						<Text color={inputRuleColor}>{inputRule}</Text>
						<Box
							flexDirection="row"
							flexWrap="nowrap"
							width={terminalColumns - 2}
						>
							<Box flexShrink={0} width={2}>
								<Text color={inputPromptColor}>
									{inputPromptPrefix}
								</Text>
							</Box>
							<PromptInput
								messages={messages}
								value={inputValue}
								height={terminalRows}
								width={promptInputWidth}
								maxVisibleLines={maxPromptInputRows}
								cursorSyncKey={cursorSyncKey}
								isActive={!exitHint && !activeToolUseConfirm && !toolJSX?.isLocalJSXCommand}
								suspendSubmit={showCommandSelector}
								suspendVerticalArrows={showCommandSelector}
								onChange={handleInputChange}
								onSubmit={onSubmit}
								onHistoryPrev={onHistoryUp}
								onHistoryNext={onHistoryDown}
								onCtrlC={handleCtrlC}
								onCyclePermissionMode={handleCyclePermissionMode}
								placeholder={
									activeToolUseConfirm
										? ''
										: showSpinner
											? '等待 query.ts 响应中...'
											: 'Ask efrex anything...'
								}
								pastedContents={pastedContents}
								setPastedContents={setPastedContents}
								mode={inputMode}
								onModeChange={setInputMode}
								ideSelection={ideSelection}
								mcpClients={mcp.clients}
							/>
						</Box>
						<Box width={terminalColumns - 2}>
							<Text color={inputRuleColor}>{inputRule}</Text>
						</Box>
						{inputMode === 'bash' ? (
							<Text color={bashInputAccentColor}>! for bash mode</Text>
						) : null}
						{showCommandSelector ? (
							<Box
								paddingX={1}
								paddingY={0}
								flexDirection="column"
							>
								{commandSelectorRows.map((command, index) => {
									if (!command) {
										return (
											<Box
												key={`empty-command-row-${index}`}
												width="100%"
												height={1}
											>
												<Text dimColor>
													{filteredCommands.length === 0 && index === 0
														? ''
														: ' '.repeat(commandSelectorWidth)}
												</Text>
											</Box>
										);
									}
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
														color={selected ? COMMAND_ROW_SELECTED_ACCENT : COMMAND_ROW_MUTED}
													>
														{selected ? '› ' : '  '}
													</Text>
												</Box>
												<Box width={commandNameWidth} flexShrink={0}>
													<Text wrap="truncate-end">
														{renderCommandDisplayName(
															command,
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
															color={COMMAND_ROW_DESC}
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
								<Box
									paddingLeft={2}
									width={terminalColumns - 2}
									flexDirection="row"
									justifyContent="space-between"
								>
									<Text color={permissionModeColor}>
										{permissionModeLabel}
										<Text color="ansi:blackBright"> · Shift+Tab</Text>
									</Text>
									<IdeStatusIndicator
										ideSelection={ideSelection}
										mcpClients={mcp.clients}
									/>
								</Box>
							</>
						)}
					</>
				) : null}
			</Box>

			{!showCommandSelector && exitHint ? (
				<Box flexDirection="column" flexShrink={0}>
					<Box>
						<Text color="subtle">再按一次 Ctrl+C 退出</Text>
					</Box>
				</Box>
			) : null}
		</Box>
	);

	const scrollableContent = (
		<MainScrollback
			welcomeHeader={welcomeHeader}
			messages={viewportMessages}
			width={messageWidth}
			alertMessage={alertMessage}
			toolJSX={toolJSX}
		/>
	);

	const transcriptStats = useMemo(
		() => computeTranscriptStats(viewportMessages),
		[viewportMessages]
	);

	const transcriptScrollableContent = (
		<Box flexDirection="column" width="100%" paddingTop={1}>
			<Box paddingX={2} width="100%">
				<Box flexDirection="column" width={transcriptColumnWidth}>
					<Text color="#e5e7eb" bold>
						Transcript
					</Text>
					<Text color="#6b7280">
						{process.cwd()}
					</Text>
					<Text color="#4b5563">
						{modelLabel} · {transcriptStats.steps} steps · {transcriptStats.tools} tools{transcriptStats.slashCommands > 0 ? ` · ${transcriptStats.slashCommands} slash` : ''}{transcriptStats.bashCommands > 0 ? ` · ${transcriptStats.bashCommands} bash` : ''}
					</Text>
					<Text color="#374151">
						{'─'.repeat(Math.max(24, transcriptColumnWidth))}
					</Text>
				</Box>
			</Box>
			<Box paddingX={2} width="100%">
				<Box width={transcriptColumnWidth}>
					<TranscriptViewport
						key={conversationId}
						messages={viewportMessages}
						width={transcriptColumnWidth}
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
				Ctrl+O / Esc close · Ctrl+B/F page · Home/End jump · j/k navigate · Tab collapse Tool
			</Text>
		</Box>
	);

	if (isTranscriptMode) {
		return (
			<AlternateScreen
				mouseTracking
				preserveMainScreenOnExit
			>
				<ScrollKeybindingHandler
					scrollRef={scrollRef}
					isActive
				/>
				<FullscreenLayout
					scrollRef={scrollRef}
					scrollable={transcriptScrollableContent}
					bottom={transcriptBottom}
					forceViewportLayout
				/>
			</AlternateScreen>
		);
	}

	if (isFullscreenEnvEnabled()) {
		return (
			<MCPConnectionManager key={remountKey} dynamicMcpConfig={dynamicMcpConfig} isStrictMcpConfig={strictMcpConfig}>
			<AlternateScreen mouseTracking>
				<ScrollKeybindingHandler
					scrollRef={scrollRef}
					isActive
				/>
				<FullscreenLayout
					scrollRef={scrollRef}
					scrollable={scrollableContent}
					overlay={toolPermissionOverlay}
					bottom={bottomContent}
				/>
			</AlternateScreen>
		</MCPConnectionManager>
		);
	}

	return (
		<MCPConnectionManager key={remountKey} dynamicMcpConfig={dynamicMcpConfig} isStrictMcpConfig={strictMcpConfig}>
			<FullscreenLayout
				scrollRef={scrollRef}
				scrollable={scrollableContent}
				overlay={toolPermissionOverlay}
				bottom={bottomContent}
			/>
		</MCPConnectionManager>
	);
}
