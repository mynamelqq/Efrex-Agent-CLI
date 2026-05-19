import * as React from 'react';
import chalk from 'chalk';
import { stripANSI as stripAnsi } from 'bun';
import {  Box } from '../ink.js';
import { Ansi } from 'packages/@ant/ink/src/index.js';
import useTextInput from '../hooks/useTextInput.js';
import { useDeclaredCursor } from '../ink/hooks/use-declared-cursor.js';
import type { Message } from 'src/package/message.js';
import {
	formatPastedTextRef,
	getPastedTextRefNumLines,
	parseReferences
} from 'src/history.js';
import { PASTE_THRESHOLD } from 'src/utils/paste.js';
import type { PastedContent } from 'src/utils/config.js';

const INPUT_CURSOR_BG = '#3a3a35';
const INPUT_CURSOR_FG = '#f0f0ea';

type Props = {
	messages: Message[];
	value: string;
	height: number;
	width: number;
	maxVisibleLines?: number;
	cursorSyncKey?: number;
	isActive?: boolean;
	suspendSubmit?: boolean;
	suspendVerticalArrows?: boolean;
	placeholder?: string;
	onChange: (value: string) => void;
	onSubmit?: (value: string) => void;
	onHistoryPrev?: () => void;
	onHistoryNext?: () => void;
	onCtrlC?: () => void;
	pastedContents: Record<number, PastedContent>;
	setPastedContents: React.Dispatch<
		React.SetStateAction<Record<number, PastedContent>>
	>;
};

export default function PromptInput({
	messages,
	value,
	height,
	width,
	maxVisibleLines,
	cursorSyncKey = 0,
	isActive = true,
	suspendSubmit = false,
	suspendVerticalArrows = false,
	placeholder = '',
	onChange,
	onSubmit,
	onHistoryPrev,
	onHistoryNext,
	onCtrlC,
	pastedContents: _pastedContents,
	setPastedContents
}: Props) {
	const [cursorOffset, setCursorOffset] = React.useState(value.length);
	const lastInternalValueRef = React.useRef(value);
	const nextPasteIdRef = React.useRef(-1);

	if (nextPasteIdRef.current === -1) {
		nextPasteIdRef.current = getInitialPasteId(messages, _pastedContents);
	}

	React.useEffect(() => {
		if (value !== lastInternalValueRef.current) {
			lastInternalValueRef.current = value;
			setCursorOffset(value.length);
		}
	}, [value]);

	const handleChange = React.useCallback(
		(nextValue: string) => {
			lastInternalValueRef.current = nextValue;
			onChange(nextValue);
		},
		[onChange]
	);

	const insertTextAtCursor = React.useCallback(
		(text: string) => {
			if (!text) {
				return;
			}

			const safeOffset = Math.min(cursorOffset, value.length);
			const nextValue =
				value.slice(0, safeOffset) + text + value.slice(safeOffset);
			lastInternalValueRef.current = nextValue;
			setCursorOffset(safeOffset + text.length);
			onChange(nextValue);
		},
		[cursorOffset, onChange, value]
	);

	const onTextPaste = React.useCallback(
		(rawText: string) => {
			const text = stripAnsi(rawText)
				.replace(/\r\n/g, '\n')
				.replace(/\r/g, '\n')
				.replaceAll('\t', '    ');

			if (!text) {
				return;
			}

			const numLines = getPastedTextRefNumLines(text);
			const maxLines = Math.max(1, Math.min(height - 10, 2));

			if (text.length > PASTE_THRESHOLD || numLines > maxLines) {
				const pasteId = nextPasteIdRef.current++;
				const newContent: PastedContent = {
					id: pasteId,
					type: 'text',
					content: text
				};

				setPastedContents(prev => ({ ...prev, [pasteId]: newContent }));
				insertTextAtCursor(formatPastedTextRef(pasteId, numLines));
				return;
			}

			insertTextAtCursor(text);
		},
		[height, insertTextAtCursor, setPastedContents]
	);

	const { cursor } = useTextInput({
		value,
		width,
		cursorSyncKey,
		isActive,
		suspendSubmit,
		suspendVerticalArrows,
		cursorOffset,
		onChange: handleChange,
		onCursorOffsetChange: setCursorOffset,
		onSubmit,
		onHistoryPrev,
		onHistoryNext,
		onCtrlC,
		onPasteText: onTextPaste
	});

	React.useEffect(() => {
		if (cursorOffset > value.length) {
			setCursorOffset(value.length);
		}
	}, [cursorOffset, value.length]);

	const cursorPosition = cursor.getPosition({
		width,
		maxVisibleLines
	});

	const cursorRef = useDeclaredCursor({
		line: cursorPosition.line,
		column: cursorPosition.column,
		active: isActive
	});

	const renderedValue = value.length === 0;
	if (renderedValue) {
		const renderedPlaceholder = isActive
			? placeholder.length > 0
				? chalk.bgHex(INPUT_CURSOR_BG).hex(INPUT_CURSOR_FG)(
						placeholder[0]
					) + chalk.gray(placeholder.slice(1))
				: chalk.bgHex(INPUT_CURSOR_BG)(' ')
			: chalk.gray(placeholder);

		return (
			<Box ref={cursorRef} width={width} flexShrink={0}>
				<Ansi>{renderedPlaceholder}</Ansi>
			</Box>
		);
	}

	const lines = cursor.render({
		width,
		maxVisibleLines,
		invert: text => chalk.bgHex(INPUT_CURSOR_BG).hex(INPUT_CURSOR_FG)(text)
	});

	return (
		<Box ref={cursorRef} flexDirection="column" width={width} flexShrink={0}>
			{lines.map((line, index) => (
				<Ansi key={index}>{line.length === 0 ? ' ' : line}</Ansi>
			))}
		</Box>
	);
}

/**
 * Compute the initial paste ID by finding the max ID used in existing messages.
 * This handles --continue/--resume scenarios where we need to avoid ID collisions.
 */
function getInitialPasteId(
	messages: Message[],
	pastedContents: Record<number, PastedContent>
): number {
	let maxId = 0;

	for (const key of Object.keys(pastedContents)) {
		const id = Number(key);
		if (Number.isFinite(id) && id > maxId) {
			maxId = id;
		}
	}

	for (const message of messages) {
		if (message.type === 'user') {
			if (message.imagePasteIds) {
				for (const id of message.imagePasteIds as number[]) {
					if (id > maxId) maxId = id;
				}
			}
			if (Array.isArray(message.message?.content)) {
				for (const block of message.message.content) {
					if (block.type === 'text') {
						const refs = parseReferences(block.text as string);
						for (const ref of refs) {
							if (ref.id > maxId) maxId = ref.id;
						}
					}
				}
			}
		}
	}
	return maxId + 1;
}
