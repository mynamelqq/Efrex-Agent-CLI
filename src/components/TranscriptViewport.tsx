import React, { useState, useMemo, useCallback } from 'react';
import { Box, Text, useInput } from '../ink.js';
import MarkdownText from './MarkdownText.js';
import { OffscreenFreeze } from './OffscreenFreeze.js';
import type { ViewportMessage } from './MessageViewport.js';

// ─── Constants ──────────────────────────────────────────────────────

const LONG_CONTENT_THRESHOLD = 20;
const TOOL_RESULT_PREVIEW_LINES = 5;

const BRAND_COLOR = '#4fd1c5';
const TOOL_COLOR = '#58a6ff';
const TOOL_DONE_COLOR = '#3fb950';
const TOOL_ERROR_COLOR = '#f85149';
const THINKING_COLOR = '#6e7681';
const META_COLOR = '#484f58';
const USER_COLOR = '#8b949e';
const BORDER_COLOR = '#30363d';
const COMMAND_COLOR = '#d2a8ff';
const BASH_COLOR = '#7ee787';

// ─── Types ──────────────────────────────────────────────────────────

type TranscriptBlock =
	| { kind: 'user'; message: ViewportMessage }
	| { kind: 'assistant'; message: ViewportMessage }
	| { kind: 'thinking'; message: ViewportMessage }
	| { kind: 'command'; message: ViewportMessage; commandName?: string; commandType?: 'slash' | 'bash' }
	| {
			kind: 'tool';
			callMessage: ViewportMessage;
			resultMessage?: ViewportMessage;
			blockKey: string;
	  }
	| { kind: 'meta'; message: ViewportMessage };

type Props = {
	messages: ViewportMessage[];
	width: number;
};

// ─── Helpers ────────────────────────────────────────────────────────

function truncateText(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text;
	return text.slice(0, maxLength - 1) + '…';
}

function countTextLines(text: string, _width: number): number {
	if (!text) return 0;
	return text.split('\n').length;
}

function getToolResultPreviewLines(text: string, maxLines: number): string[] {
	if (!text) return [];
	const lines = text.split('\n').filter(l => l.trim().length > 0);
	return lines.slice(0, maxLines);
}

/**
 * Create a human-readable summary from a tool result text.
 * Handles JSON (extracts counts, titles) and plain text (character counts).
 */
function humanizeToolResult(text: string): string {
	if (!text || text.length < 2) return text || '';

	// Try JSON parsing
	try {
		const parsed = JSON.parse(text);

		// firecrawl-style: { success, data: { web: [...] } }
		if (parsed?.success && parsed.data) {
			const data = parsed.data;
			for (const key of ['web', 'results', 'items', 'data']) {
				if (Array.isArray(data[key])) {
					return `${data[key].length} results found`;
				}
			}
			if (typeof data.markdown === 'string') {
				const chars = data.markdown.length;
				const title = data.metadata?.title || '';
				return title
					? `"${truncateText(title, 40)}" · ${chars} chars`
					: `Article extracted · ${chars} chars`;
			}
		}

		// Direct array
		if (Array.isArray(parsed)) {
			return `${parsed.length} items`;
		}

		// Object with data array
		if (typeof parsed === 'object' && parsed !== null) {
			for (const key of ['results', 'items', 'data', 'files', 'entries']) {
				if (Array.isArray(parsed[key])) {
					return `${parsed[key].length} ${key}`;
				}
			}
			// Object with markdown (scrape result)
			if (typeof parsed.markdown === 'string') {
				const chars = parsed.markdown.length;
				const title = parsed.metadata?.title || '';
				return title
					? `"${truncateText(title, 40)}" · ${chars} chars`
					: `Article extracted · ${chars} chars`;
			}
			// Generic object
			const keys = Object.keys(parsed);
			if (keys.length <= 5) {
				return keys.join(', ');
			}
			return `Object with ${keys.length} fields`;
		}
	} catch {
		// Not JSON
	}

	// Large text: summarize by size
	if (text.length > 500) {
		const lines = text.split('\n').length;
		return `${lines} lines · ${text.length} chars`;
	}

	// Short text: truncate as preview
	return truncateText(text, 80);
}

/**
 * Extract a display-friendly tool label from the tool name and message text.
 */
function getToolLabel(message: ViewportMessage): string {
	if (message.compactMcpLabel) {
		return message.compactMcpLabel;
	}
	if (message.toolName) {
		return message.toolName;
	}
	// Fallback: first word of text
	const firstWord = message.text.split(/\s+/)[0] || 'tool';
	return firstWord;
}

function getStatusLabel(block: Extract<TranscriptBlock, { kind: 'tool' }>): string {
	const call = block.callMessage;
	const result = block.resultMessage;

	if (call.toolPhase === 'call') {
		return 'running…';
	}
	if (call.toolPhase === 'error' || result?.toolPhase === 'error') {
		return 'error';
	}
	if (result) {
		return humanizeToolResult(result.text);
	}
	return call.toolPhase === 'done' ? 'done' : '';
}

function getStatusColor(block: Extract<TranscriptBlock, { kind: 'tool' }>): string {
	if (block.callMessage.toolPhase === 'error' || block.resultMessage?.toolPhase === 'error') {
		return TOOL_ERROR_COLOR;
	}
	if (block.callMessage.toolPhase === 'done' || block.resultMessage) {
		return TOOL_DONE_COLOR;
	}
	return TOOL_COLOR;
}

// ─── Block Processing ───────────────────────────────────────────────

function processMessagesIntoBlocks(messages: ViewportMessage[]): TranscriptBlock[] {
	const blocks: TranscriptBlock[] = [];
	const toolUseIndex = new Map<string, number>();

	for (const message of messages) {
		if (message.role === 'meta') {
			blocks.push({ kind: 'meta', message });
			continue;
		}

		if (message.role === 'user') {
			// Slash command or bash input → command block
			if (message.commandType) {
				blocks.push({
					kind: 'command',
					message,
					commandName: message.toolName || message.text,
					commandType: message.commandType
				});
				continue;
			}
			blocks.push({ kind: 'user', message });
			continue;
		}

		if (message.role === 'assistant') {
			// Check for thinking content (dimmed segments)
			blocks.push({ kind: 'assistant', message });
			continue;
		}

		// Local command output → attach to previous command block or standalone
		if (message.commandType) {
			const lastBlock = blocks[blocks.length - 1];
			if (lastBlock?.kind === 'command') {
				blocks.push({
					kind: 'command',
					message,
					commandName: lastBlock.commandName,
					commandType: message.commandType
				});
				continue;
			}
			blocks.push({ kind: 'command', message, commandType: message.commandType });
			continue;
		}

		// Tool message
		if (message.toolDisplayStyle === 'use') {
			const blockKey = message.toolUseId || `tool-${message.id}`;
			const toolBlock: TranscriptBlock = {
				kind: 'tool',
				callMessage: message,
				blockKey
			};
			blocks.push(toolBlock);
			if (message.toolUseId) {
				toolUseIndex.set(message.toolUseId, blocks.length - 1);
			}
			continue;
		}

		// Tool result/progress — try to attach to the matching tool_use
		if (
			(message.toolDisplayStyle === 'result' ||
				message.toolDisplayStyle === 'progress') &&
			message.toolUseId
		) {
			const idx = toolUseIndex.get(message.toolUseId);
			if (idx !== undefined) {
				const existing = blocks[idx];
				if (existing.kind === 'tool') {
					existing.resultMessage = message;
					continue;
				}
			}
		}

		// Orphan tool result — render as standalone tool block
		if (message.role === 'tool') {
			blocks.push({
				kind: 'tool',
				callMessage: message,
				blockKey: `orphan-${message.id}`
			});
		}
	}

	return blocks;
}

// ─── Sub-components ─────────────────────────────────────────────────

function UserBlock({
	block,
	width
}: {
	block: Extract<TranscriptBlock, { kind: 'user' }>;
	width: number;
}) {
	const contentWidth = Math.max(1, width - 5);
	return (
		<Box flexDirection="row" width={width}>
			<Box flexShrink={0} width={5}>
				<Text color={USER_COLOR}>you  </Text>
			</Box>
			<Box
				flexDirection="column"
				flexGrow={1}
				flexShrink={1}
				width={contentWidth}
			>
				{block.message.content ? (
					block.message.content
				) : (
					<MarkdownText
						text={block.message.text}
						width={contentWidth}
					/>
				)}
			</Box>
		</Box>
	);
}

function AssistantBlock({
	block,
	width
}: {
	block: Extract<TranscriptBlock, { kind: 'assistant' }>;
	width: number;
}) {
	const contentWidth = Math.max(1, width - 3);
	return (
		<Box flexDirection="row" width={width}>
			<Box flexShrink={0} width={3}>
				<Text color={BRAND_COLOR}>{'│  '}</Text>
			</Box>
			<Box
				flexDirection="column"
				flexGrow={1}
				flexShrink={1}
				width={contentWidth}
			>
				{block.message.content ? (
					block.message.content
				) : (
					<MarkdownText
						text={block.message.text}
						width={contentWidth}
					/>
				)}
			</Box>
		</Box>
	);
}

function ToolCard({
	block,
	width,
	expanded,
	onToggle
}: {
	block: Extract<TranscriptBlock, { kind: 'tool' }>;
	width: number;
	expanded: boolean;
	onToggle: () => void;
}) {
	const contentWidth = Math.max(1, width - 5);
	const label = getToolLabel(block.callMessage);
	const status = getStatusLabel(block);
	const statusColor = getStatusColor(block);
	const isError =
		block.callMessage.toolPhase === 'error' ||
		block.resultMessage?.toolPhase === 'error';
	const isRunning = block.callMessage.toolPhase === 'call';

	// Determine if content is long enough to be collapsible
	const resultText = block.resultMessage?.text || '';
	const isLongResult =
		countTextLines(resultText, width) > LONG_CONTENT_THRESHOLD;
	const canCollapse = isLongResult || resultText.length > 300;

	// Status icon
	const statusIcon = isError
		? '✗'
		: isRunning
			? '◦'
			: '✓';

	// Render expanded content
	const expandedContent = useMemo(() => {
		if (!expanded) return null;

		const parts: React.ReactNode[] = [];

		// Show tool call content
		if (block.callMessage.content) {
			parts.push(
				<Box
					key="call"
					flexDirection="column"
					paddingLeft={2}
					width={contentWidth}
				>
					{block.callMessage.content}
				</Box>
			);
		}

		// Show tool result content
		if (block.resultMessage?.content) {
			parts.push(
				<Box
					key="result"
					flexDirection="column"
					paddingLeft={2}
					width={contentWidth}
				>
					{block.resultMessage.content}
				</Box>
			);
		} else if (resultText) {
			parts.push(
				<Box
					key="result-text"
					flexDirection="column"
					paddingLeft={2}
					width={contentWidth}
				>
					<MarkdownText text={resultText} width={contentWidth} />
				</Box>
			);
		}

		return parts.length > 0 ? (
			<Box flexDirection="column" width={contentWidth}>
				{parts}
			</Box>
		) : null;
	}, [expanded, block, resultText, contentWidth]);

	// Preview lines for collapsed long content
	const previewLines = useMemo(() => {
		if (expanded || !canCollapse) return null;
		const lines = getToolResultPreviewLines(
			resultText,
			TOOL_RESULT_PREVIEW_LINES
		);
		if (lines.length === 0) return null;

		return (
			<Box flexDirection="column" paddingLeft={2} width={contentWidth}>
				{lines.map((line, i) => (
					<Text key={i} color="#6e7681" wrap="truncate-end">
						{truncateText(line, contentWidth)}
					</Text>
				))}
			</Box>
		);
	}, [expanded, canCollapse, resultText, contentWidth]);

	return (
		<OffscreenFreeze>
			<Box flexDirection="column" width={width}>
				{/* Card header */}
				<Box flexDirection="row" width={width}>
					<Box flexShrink={0} width={2}>
						<Text color={TOOL_COLOR}>{'┌─'}</Text>
					</Box>
					<Box flexGrow={1} flexShrink={1}>
						<Text color={TOOL_COLOR} bold>
							{' '}
							{label}
						</Text>
						<Text color={META_COLOR}>{' ─'}</Text>
						<Text color={statusColor}>
							{' '}
							{statusIcon} {status}
						</Text>
						{canCollapse ? (
							<Text color={META_COLOR}>
								{' '}
								{expanded ? '[−]' : '[+]'}
							</Text>
						) : null}
					</Box>
				</Box>

				{/* Collapsed preview */}
				{previewLines}

				{/* Expanded full content */}
				{expandedContent}

				{/* Card footer */}
				<Box flexDirection="row" width={width}>
					<Box flexShrink={0} width={2}>
						<Text color={TOOL_COLOR}>{'└─'}</Text>
					</Box>
					<Box flexGrow={1}>
						<Text color={META_COLOR}>
							{'─'.repeat(Math.max(1, width - 4))}
						</Text>
					</Box>
				</Box>
			</Box>
		</OffscreenFreeze>
	);
}

function CommandCard({
	block,
	width
}: {
	block: Extract<TranscriptBlock, { kind: 'command' }>;
	width: number;
}) {
	const contentWidth = Math.max(1, width - 5);
	const { message, commandName, commandType } = block;
	const isBash = commandType === 'bash';
	const borderColor = isBash ? BASH_COLOR : COMMAND_COLOR;
	const typeTag = isBash ? 'bash' : 'slash command';

	// Label: show command name with appropriate prefix
	const label = isBash
		? commandName || '$ ' + truncateText(message.text, 40)
		: commandName
			? `/${commandName}`
			: message.text.startsWith('/')
				? message.text.split(/\s+/)[0]
				: message.text || 'command';

	// For user-type command messages (input), just show the command name
	if (message.role === 'user') {
		return (
			<OffscreenFreeze>
				<Box flexDirection="column" width={width}>
					<Box flexDirection="row" width={width}>
						<Box flexShrink={0} width={2}>
							<Text color={borderColor}>{'┌─'}</Text>
						</Box>
						<Box flexGrow={1} flexShrink={1}>
							<Text color={borderColor} bold>
								{' '}
								{label}
							</Text>
							<Text color={META_COLOR}>{' ─'}</Text>
							<Text color={borderColor}>{` ${typeTag}`}</Text>
						</Box>
					</Box>
					<Box flexDirection="row" width={width}>
						<Box flexShrink={0} width={2}>
							<Text color={borderColor}>{'└─'}</Text>
						</Box>
						<Box flexGrow={1}>
							<Text color={META_COLOR}>
								{'─'.repeat(Math.max(1, width - 4))}
							</Text>
						</Box>
					</Box>
				</Box>
			</OffscreenFreeze>
		);
	}

	// For tool-type command output messages
	const isError = message.toolPhase === 'error';
	const statusIcon = isError ? '✗' : '✓';
	const statusColor = isError ? TOOL_ERROR_COLOR : TOOL_DONE_COLOR;

	return (
		<OffscreenFreeze>
			<Box flexDirection="column" width={width}>
				{/* Card header */}
				<Box flexDirection="row" width={width}>
					<Box flexShrink={0} width={2}>
						<Text color={borderColor}>{'┌─'}</Text>
					</Box>
					<Box flexGrow={1} flexShrink={1}>
						<Text color={borderColor} bold>
							{' '}
							{label}
						</Text>
						<Text color={META_COLOR}>{' ─'}</Text>
						<Text color={statusColor}>
							{' '}
							{statusIcon} {isError ? 'error' : 'done'}
						</Text>
					</Box>
				</Box>

				{/* Content */}
				<Box flexDirection="column" paddingLeft={2} width={contentWidth}>
					{message.content ? (
						message.content
					) : (
						<Text wrap="wrap" color="#c9d1d9">
							{message.text || ' '}
						</Text>
					)}
				</Box>

				{/* Card footer */}
				<Box flexDirection="row" width={width}>
					<Box flexShrink={0} width={2}>
						<Text color={borderColor}>{'└─'}</Text>
					</Box>
					<Box flexGrow={1}>
						<Text color={META_COLOR}>
							{'─'.repeat(Math.max(1, width - 4))}
						</Text>
					</Box>
				</Box>
			</Box>
		</OffscreenFreeze>
	);
}

function MetaBlock({
	block,
	width
}: {
	block: Extract<TranscriptBlock, { kind: 'meta' }>;
	width: number;
}) {
	if (block.message.content) {
		return <>{block.message.content}</>;
	}

	const content = block.message.text
		? padMetaLine(block.message.text, width)
		: ' ';
	return (
		<Text color={META_COLOR} dimColor wrap="truncate-end">
			{content}
		</Text>
	);
}

function padMetaLine(text: string, width: number): string {
	const safeWidth = Math.max(1, width);
	const visibleText = text.length > safeWidth
		? text.slice(0, safeWidth - 1) + '…'
		: text;
	const padding = Math.max(0, safeWidth - visibleText.length);
	return `${' '.repeat(padding)}${visibleText}`;
}

// ─── Spacer Logic ───────────────────────────────────────────────────

function shouldInsertBlockSpacer(
	prev: TranscriptBlock | undefined,
	current: TranscriptBlock
): boolean {
	if (!prev) return false;
	// No spacer before meta
	if (current.kind === 'meta') return false;
	// No spacer after meta
	if (prev.kind === 'meta') return false;
	// No spacer between tool call and its result (they're already in one card)
	return true;
}

// ─── Main Component ─────────────────────────────────────────────────

function TranscriptViewport({ messages, width }: Props): React.ReactNode {
	const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

	const toggleBlock = useCallback((key: string) => {
		setExpandedKeys(prev => {
			const next = new Set(prev);
			if (next.has(key)) {
				next.delete(key);
			} else {
				next.add(key);
			}
			return next;
		});
	}, []);

	const blocks = useMemo(() => processMessagesIntoBlocks(messages), [messages]);

	// Collect all tool block keys for collapse-all / expand-all
	const allToolKeys = useMemo(
		() => blocks.filter(b => b.kind === 'tool').map(b => b.blockKey),
		[blocks]
	);

	// Tab: collapse all if any expanded, otherwise expand all
	useInput((input, key, event) => {
		if (key.tab) {
			event.stopImmediatePropagation();
			setExpandedKeys(prev => {
				const hasAnyExpanded = allToolKeys.some(k => prev.has(k));
				if (hasAnyExpanded) {
					// Collapse all
					return new Set();
				}
				// Expand all tool blocks
				return new Set(allToolKeys);
			});
		}
	});

	return (
		<Box flexDirection="column" flexShrink={0} width="100%">
			{blocks.map((block, index) => {
				const prevBlock = blocks[index - 1];
				const spacer = shouldInsertBlockSpacer(prevBlock, block);

				return (
					<Box key={`tb-${index}`} flexDirection="column" width="100%">
						{spacer ? <Text>{' '}</Text> : null}
						{block.kind === 'user' && (
							<UserBlock block={block} width={width} />
						)}
						{block.kind === 'assistant' && (
							<AssistantBlock block={block} width={width} />
						)}
						{block.kind === 'tool' && (
							<ToolCard
								block={block}
								width={width}
								expanded={expandedKeys.has(block.blockKey)}
								onToggle={() => toggleBlock(block.blockKey)}
							/>
						)}
						{block.kind === 'command' && (
							<CommandCard block={block} width={width} />
						)}
						{block.kind === 'meta' && (
							<MetaBlock block={block} width={width} />
						)}
					</Box>
				);
			})}
		</Box>
	);
}

export default React.memo(TranscriptViewport, (prev, next) =>
	prev.messages === next.messages && prev.width === next.width
);

// ─── Exports for stats computation ──────────────────────────────────

export function computeTranscriptStats(messages: ViewportMessage[]) {
	let steps = 0;
	const toolNames = new Set<string>();
	const slashNames = new Set<string>();
	const bashNames = new Set<string>();

	for (const msg of messages) {
		if (msg.role === 'user' && !msg.commandType) steps++;
		if (msg.role === 'assistant') steps++;
		if (msg.role === 'tool' && msg.toolDisplayStyle === 'use') {
			if (msg.toolName) {
				toolNames.add(msg.toolName);
			}
		}
		if (msg.commandType === 'slash' && msg.toolName) {
			slashNames.add(msg.toolName);
		}
		if (msg.commandType === 'bash') {
			// Count each bash invocation (use message id for uniqueness)
			bashNames.add(`bash-${msg.id}`);
		}
	}

	return {
		steps,
		tools: toolNames.size,
		slashCommands: slashNames.size,
		bashCommands: bashNames.size
	};
}
