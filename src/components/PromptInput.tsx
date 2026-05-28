import * as React from 'react';
import chalk from 'chalk';
import { stripANSI as stripAnsi } from 'bun';
import { Ansi, Box, Text, useInput, useTerminalFocus } from '../ink.js';
import { usePasteHandler } from '../hooks/usePasteHandler.js';
import useTextInput from '../hooks/useTextInput.js';
import { useDeclaredCursor } from '../ink/hooks/use-declared-cursor.js';
import type { Message } from 'src/package/message.js';
import {
	formatImageRef,
	formatPastedTextRef,
	getPastedTextRefNumLines,
	parseReferences
} from 'src/history.js';
import { PASTE_THRESHOLD } from 'src/utils/paste.js';
import type { PastedContent } from 'src/utils/config.js';
import type { ImageDimensions } from 'src/utils/imageResizer.js';

const FOCUSED_INPUT_CURSOR_BG = '#f7f7f3';
const FOCUSED_INPUT_CURSOR_FG = '#141414';
const BLURRED_INPUT_CURSOR_BG = '#3a3a35';
const BLURRED_INPUT_CURSOR_FG = '#f0f0ea';
const PASTE_TOKEN_PATTERN =
	/\[(?:Pasted text #\d+(?: \+\d+ lines)?|Image #\d+)\]/g;
const PASTE_TOKEN_COLOR = '#f79aff';
const PASTE_TOKEN_BG = '#16324a';

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
	onCyclePermissionMode?: () => void;
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
	onCyclePermissionMode,
	pastedContents: _pastedContents,
	setPastedContents
}: Props) {
	const [cursorOffset, setCursorOffset] = React.useState(value.length);
	const lastInternalValueRef = React.useRef(value);
	const cursorOffsetRef = React.useRef(cursorOffset);
	const pendingCursorOffsetRef = React.useRef<number | null>(null);
	const nextPasteIdRef = React.useRef(-1);
	cursorOffsetRef.current = cursorOffset;

	if (nextPasteIdRef.current === -1) {
		nextPasteIdRef.current = getInitialPasteId(messages, _pastedContents);
	}

	React.useEffect(() => {
		if (pendingCursorOffsetRef.current !== null) {
			const nextOffset = Math.min(pendingCursorOffsetRef.current, value.length);
			cursorOffsetRef.current = nextOffset;
			setCursorOffset(nextOffset);
			pendingCursorOffsetRef.current = null;
			return;
		}

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

			const currentValue = lastInternalValueRef.current;
			const safeOffset = Math.min(cursorOffsetRef.current, currentValue.length);
			const nextValue =
				currentValue.slice(0, safeOffset) +
				text +
				currentValue.slice(safeOffset);
			lastInternalValueRef.current = nextValue;
			cursorOffsetRef.current = safeOffset + text.length;
			pendingCursorOffsetRef.current = cursorOffsetRef.current;
			setCursorOffset(cursorOffsetRef.current);
			onChange(nextValue);
		},
		[onChange]
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

	const onImagePaste = React.useCallback(
		(
			base64Image: string,
			mediaType?: string,
			filename?: string,
			dimensions?: ImageDimensions,
			sourcePath?: string
		) => {
			const pasteId = nextPasteIdRef.current++;
			const newContent: PastedContent = {
				id: pasteId,
				type: 'image',
				content: base64Image,
				mediaType: mediaType || 'image/png',
				filename: filename || 'Pasted image',
				dimensions,
				sourcePath
			};

			setPastedContents(prev => ({ ...prev, [pasteId]: newContent }));
			insertTextAtCursor(formatImageRef(pasteId));
		},
		[insertTextAtCursor, setPastedContents]
	);

	const terminalFocus = useTerminalFocus();
	const invert = React.useCallback(
		(text: string) =>
			terminalFocus
				? chalk
						.bgHex(FOCUSED_INPUT_CURSOR_BG)
						.hex(FOCUSED_INPUT_CURSOR_FG)(text)
				: chalk
						.bgHex(BLURRED_INPUT_CURSOR_BG)
						.hex(BLURRED_INPUT_CURSOR_FG)(text),
		[terminalFocus]
	);

	const { onInput, renderedValue, cursorLine, cursorColumn } = useTextInput({
		value,
		width,
		maxVisibleLines,
		cursorChar: isActive ? ' ' : '',
		invert,
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
		onCyclePermissionMode
	});

	const { wrappedOnInput } = usePasteHandler({
		onPaste: onTextPaste,
		onInput,
		onImagePaste
	});

	useInput(wrappedOnInput, { isActive });

	React.useEffect(() => {
		if (cursorOffset > value.length) {
			setCursorOffset(value.length);
		}
	}, [cursorOffset, value.length]);

	const cursorRef = useDeclaredCursor({
		line: cursorLine,
		column: cursorColumn,
		active: Boolean(isActive && terminalFocus)
	});

	const isEmpty = value.length === 0;
	const renderedContent = isEmpty
		? isActive
			? placeholder.length > 0
				? invert(placeholder[0]) + chalk.gray(placeholder.slice(1))
				: invert(' ')
			: chalk.gray(placeholder)
		: renderedValue
				.split('\n')
				.map(line => (line.length === 0 ? ' ' : line))
				.join('\n');

	const styledRenderedContent = isEmpty
		? renderedContent
		: renderedContent.replace(
				PASTE_TOKEN_PATTERN,
				match => chalk.bgHex(PASTE_TOKEN_BG).hex(PASTE_TOKEN_COLOR)(match)
		  );

	return (
		<Box ref={cursorRef} width={width} flexShrink={0}>
			<Text wrap="truncate-end">
				<Ansi>{styledRenderedContent}</Ansi>
			</Text>
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
