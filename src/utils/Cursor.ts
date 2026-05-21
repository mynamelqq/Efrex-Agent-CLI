import { stringWidth } from '../ink/stringWidth.js';
import { wrapAnsi } from '../ink/wrapAnsi.js';
import { getGraphemeSegmenter, getWordSegmenter } from './intl.js';

type RenderOptions = {
	cursorChar?: string;
	mask?: string;
	invert: (text: string) => string;
	width?: number;
	maxVisibleLines?: number;
};

type PositionOptions = {
	width?: number;
	maxVisibleLines?: number;
};

type Position = {
	line: number;
	column: number;
};

type WordBoundary = {
	start: number;
	end: number;
	isWordLike: boolean;
};

class WrappedLine {
	constructor(
		readonly text: string,
		readonly startOffset: number,
		readonly isPrecededByNewline: boolean,
		readonly endsWithNewline = false
	) {}
}

class MeasuredText {
	private wrappedLinesCache?: WrappedLine[];
	private graphemeBoundaries?: number[];
	private wordBoundariesCache?: WordBoundary[];
	private readonly navigationCache = new Map<string, number>();
	readonly text: string;

	constructor(
		text: string,
		readonly columns: number
	) {
		this.text = text.normalize('NFC');
	}

	private get wrappedLines(): WrappedLine[] {
		if (!this.wrappedLinesCache) {
			this.wrappedLinesCache = this.measureWrappedText();
		}
		return this.wrappedLinesCache;
	}

	get lineCount(): number {
		return this.wrappedLines.length;
	}

	getWrappedText(): string[] {
		return this.wrappedLines.map(line =>
			line.isPrecededByNewline ? line.text : line.text.trimStart()
		);
	}

	getWrappedLines(): WrappedLine[] {
		return this.wrappedLines;
	}

	getLineLength(line: number): number {
		return stringWidth(this.getLine(line).text);
	}

	getPositionFromOffset(offset: number): Position {
		const lines = this.wrappedLines;
		for (let line = 0; line < lines.length; line++) {
			const currentLine = lines[line]!;
			const nextLine = lines[line + 1];

			if (
				offset >= currentLine.startOffset &&
				(!nextLine || offset < nextLine.startOffset)
			) {
				const stringPosInLine = offset - currentLine.startOffset;
				let displayColumn: number;

				if (currentLine.isPrecededByNewline) {
					displayColumn = this.stringIndexToDisplayWidth(
						currentLine.text,
						stringPosInLine
					);
				} else {
					const leadingWhitespace =
						currentLine.text.length -
						currentLine.text.trimStart().length;
					if (stringPosInLine < leadingWhitespace) {
						displayColumn = 0;
					} else {
						const trimmedText = currentLine.text.trimStart();
						const posInTrimmed =
							stringPosInLine - leadingWhitespace;
						displayColumn = this.stringIndexToDisplayWidth(
							trimmedText,
							posInTrimmed
						);
					}
				}

				return {
					line,
					column: Math.max(0, displayColumn)
				};
			}
		}

		const line = Math.max(0, lines.length - 1);
		const lastLine = lines[line] ?? new WrappedLine('', 0, true);
		return {
			line,
			column: stringWidth(lastLine.text)
		};
	}

	getOffsetFromPosition(position: Position): number {
		const wrappedLine = this.getLine(position.line);

		if (wrappedLine.text.length === 0 && wrappedLine.endsWithNewline) {
			return wrappedLine.startOffset;
		}

		const leadingWhitespace = wrappedLine.isPrecededByNewline
			? 0
			: wrappedLine.text.length - wrappedLine.text.trimStart().length;
		const displayColumnWithLeading = position.column + leadingWhitespace;
		const stringIndex = this.displayWidthToStringIndex(
			wrappedLine.text,
			displayColumnWithLeading
		);
		const offset = wrappedLine.startOffset + stringIndex;
		const lineEnd = wrappedLine.startOffset + wrappedLine.text.length;
		let maxOffset = lineEnd;

		if (
			wrappedLine.endsWithNewline &&
			position.column > stringWidth(wrappedLine.text)
		) {
			maxOffset = lineEnd + 1;
		}

		return Math.min(offset, maxOffset);
	}

	nextOffset(offset: number): number {
		return this.withCache(`next:${offset}`, () => {
			const boundaries = this.getGraphemeBoundaries();
			return this.binarySearchBoundary(boundaries, offset, true);
		});
	}

	prevOffset(offset: number): number {
		if (offset <= 0) {
			return 0;
		}

		return this.withCache(`prev:${offset}`, () => {
			const boundaries = this.getGraphemeBoundaries();
			return this.binarySearchBoundary(boundaries, offset, false);
		});
	}

	getWordBoundaries(): WordBoundary[] {
		if (!this.wordBoundariesCache) {
			this.wordBoundariesCache = [];
			for (const segment of getWordSegmenter().segment(this.text)) {
				this.wordBoundariesCache.push({
					start: segment.index,
					end: segment.index + segment.segment.length,
					isWordLike: segment.isWordLike ?? false
				});
			}
		}
		return this.wordBoundariesCache;
	}

	snapToGraphemeBoundary(offset: number): number {
		if (offset <= 0) {
			return 0;
		}
		if (offset >= this.text.length) {
			return this.text.length;
		}

		const boundaries = this.getGraphemeBoundaries();
		let lo = 0;
		let hi = boundaries.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (boundaries[mid]! <= offset) {
				lo = mid;
			} else {
				hi = mid - 1;
			}
		}
		return boundaries[lo]!;
	}

	private getLine(line: number): WrappedLine {
		const lines = this.wrappedLines;
		return lines[Math.max(0, Math.min(line, lines.length - 1))]!;
	}

	private getGraphemeBoundaries(): number[] {
		if (!this.graphemeBoundaries) {
			this.graphemeBoundaries = [];
			for (const { index } of getGraphemeSegmenter().segment(this.text)) {
				this.graphemeBoundaries.push(index);
			}
			this.graphemeBoundaries.push(this.text.length);
		}
		return this.graphemeBoundaries;
	}

	private stringIndexToDisplayWidth(text: string, index: number): number {
		if (index <= 0) {
			return 0;
		}
		if (index >= text.length) {
			return stringWidth(text);
		}
		return stringWidth(text.substring(0, index));
	}

	private displayWidthToStringIndex(text: string, targetWidth: number): number {
		if (targetWidth <= 0 || !text) {
			return 0;
		}

		let currentWidth = 0;
		let currentOffset = 0;
		for (const { segment, index } of getGraphemeSegmenter().segment(text)) {
			const segmentWidth = stringWidth(segment);
			if (currentWidth + segmentWidth > targetWidth) {
				break;
			}
			currentWidth += segmentWidth;
			currentOffset = index + segment.length;
		}
		return currentOffset;
	}

	private measureWrappedText(): WrappedLine[] {
		const wrappedText = wrapAnsi(this.text, Math.max(1, this.columns), {
			hard: true,
			trim: false
		});
		const wrappedLines: WrappedLine[] = [];
		let searchOffset = 0;
		let lastNewLinePos = -1;

		const lines = wrappedText.split('\n');
		for (let i = 0; i < lines.length; i++) {
			const text = lines[i]!;
			const isPrecededByNewline = (startOffset: number) =>
				i === 0 ||
				(startOffset > 0 && this.text[startOffset - 1] === '\n');

			if (text.length === 0) {
				lastNewLinePos = this.text.indexOf('\n', lastNewLinePos + 1);
				const startOffset =
					lastNewLinePos !== -1 ? lastNewLinePos : this.text.length;
				wrappedLines.push(
					new WrappedLine(
						text,
						startOffset,
						isPrecededByNewline(startOffset),
						lastNewLinePos !== -1
					)
				);
				continue;
			}

			const startOffset = this.text.indexOf(text, searchOffset);
			if (startOffset === -1) {
				throw new Error('Failed to find wrapped line in text');
			}

			searchOffset = startOffset + text.length;
			const potentialNewlinePos = startOffset + text.length;
			const endsWithNewline =
				potentialNewlinePos < this.text.length &&
				this.text[potentialNewlinePos] === '\n';
			if (endsWithNewline) {
				lastNewLinePos = potentialNewlinePos;
			}

			wrappedLines.push(
				new WrappedLine(
					text,
					startOffset,
					isPrecededByNewline(startOffset),
					endsWithNewline
				)
			);
		}

		return wrappedLines;
	}

	private withCache<T>(key: string, compute: () => T): T {
		const cached = this.navigationCache.get(key);
		if (cached !== undefined) {
			return cached as T;
		}
		const result = compute();
		this.navigationCache.set(key, result as number);
		return result;
	}

	private binarySearchBoundary(
		boundaries: number[],
		target: number,
		findNext: boolean
	): number {
		let left = 0;
		let right = boundaries.length - 1;
		let result = findNext ? this.text.length : 0;

		while (left <= right) {
			const mid = Math.floor((left + right) / 2);
			const boundary = boundaries[mid];
			if (boundary === undefined) {
				break;
			}

			if (findNext) {
				if (boundary > target) {
					result = boundary;
					right = mid - 1;
				} else {
					left = mid + 1;
				}
			} else if (boundary < target) {
				result = boundary;
				left = mid + 1;
			} else {
				right = mid - 1;
			}
		}

		return result;
	}
}

export default class Cursor {
	readonly offset: number;

	static fromText(
		text: string,
		columns: number,
		offset: number = text.length,
		selection: number = 0
	): Cursor {
		return new Cursor(
			new MeasuredText(text, Math.max(1, columns - 1)),
			offset,
			selection
		);
	}

	constructor(
		readonly measuredText: MeasuredText,
		offset: number = measuredText.text.length,
		readonly selection: number = 0,
		readonly preferredColumn: number | null = null
	) {
		this.offset = Math.max(0, Math.min(this.text.length, offset));
	}

	get text(): string {
		return this.measuredText.text;
	}

	private get columns(): number {
		return this.measuredText.columns + 1;
	}

	render({
		cursorChar = ' ',
		mask = '',
		invert,
		maxVisibleLines
	}: RenderOptions): string[] {
		const { line, column } = this.getPosition();
		const allLines = this.measuredText.getWrappedText();
		const startLine = this.getViewportStartLine(maxVisibleLines);
		const endLine =
			maxVisibleLines !== undefined && maxVisibleLines > 0
				? Math.min(allLines.length, startLine + maxVisibleLines)
				: allLines.length;

		return allLines.slice(startLine, endLine).map((text, index) => {
			const currentLine = index + startLine;
			let displayText = text;
			if (mask) {
				displayText = mask.repeat(
					Array.from(getGraphemeSegmenter().segment(text)).length
				);
			}

			if (line !== currentLine) {
				return displayText.trimEnd();
			}

			let beforeCursor = '';
			let atCursor = cursorChar;
			let afterCursor = '';
			let currentWidth = 0;
			let cursorFound = false;

			for (const { segment } of getGraphemeSegmenter().segment(displayText)) {
				if (cursorFound) {
					afterCursor += segment;
					continue;
				}

				const nextWidth = currentWidth + stringWidth(segment);
				if (nextWidth > column) {
					atCursor = segment;
					cursorFound = true;
				} else {
					currentWidth = nextWidth;
					beforeCursor += segment;
				}
			}

			return beforeCursor + invert(atCursor) + afterCursor.trimEnd();
		});
	}

	getPosition(options: PositionOptions = {}): Position {
		const position = this.measuredText.getPositionFromOffset(this.offset);
		return {
			line:
				position.line -
				this.getViewportStartLine(options.maxVisibleLines),
			column: position.column
		};
	}

	getViewportStartLine(maxVisibleLines?: number): number {
		if (maxVisibleLines === undefined || maxVisibleLines <= 0) {
			return 0;
		}

		const { line } = this.measuredText.getPositionFromOffset(this.offset);
		const allLines = this.measuredText.getWrappedText();
		if (allLines.length <= maxVisibleLines) {
			return 0;
		}

		const half = Math.floor(maxVisibleLines / 2);
		let startLine = Math.max(0, line - half);
		const endLine = Math.min(allLines.length, startLine + maxVisibleLines);
		if (endLine - startLine < maxVisibleLines) {
			startLine = Math.max(0, endLine - maxVisibleLines);
		}
		return startLine;
	}

	insert(text: string): Cursor {
		return this.modifyText(this, text);
	}

	backspace(): Cursor {
		const token = this.findTokenBeforeOrAtCursor();
		if (token) {
			return this.modifyRange(token.start, token.end, '');
		}

		if (this.offset === 0) {
			return this;
		}

		return this.left().modifyText(this);
	}

	deleteForward(): Cursor {
		if (this.offset >= this.text.length) {
			return this;
		}

		const token =
			this.imageRefStartingAt(this.offset) ??
			specialTokenContaining(this.text, this.offset);
		if (token) {
			return this.modifyRange(token.start, token.end, '');
		}

		return this.modifyText(this.right());
	}

	left(): Cursor {
		const token =
			this.imageRefEndingAt(this.offset) ??
			specialTokenContaining(this.text, this.offset);
		if (token) {
			return new Cursor(this.measuredText, token.start);
		}

		if (this.offset === 0) {
			return this;
		}

		return new Cursor(this.measuredText, this.measuredText.prevOffset(this.offset));
	}

	right(): Cursor {
		const token =
			this.imageRefStartingAt(this.offset) ??
			specialTokenContaining(this.text, this.offset);
		if (token) {
			return new Cursor(this.measuredText, token.end);
		}

		if (this.offset >= this.text.length) {
			return this;
		}

		return new Cursor(
			this.measuredText,
			Math.min(this.measuredText.nextOffset(this.offset), this.text.length)
		);
	}

	up(_width?: number): Cursor {
		return this.moveVertical(-1);
	}

	down(_width?: number): Cursor {
		return this.moveVertical(1);
	}

	startOfLine(_width?: number): Cursor {
		const { line, column } = this.measuredText.getPositionFromOffset(
			this.offset
		);
		if (column === 0 && line > 0) {
			return new Cursor(
				this.measuredText,
				this.measuredText.getOffsetFromPosition({
					line: line - 1,
					column: 0
				})
			);
		}

		return new Cursor(
			this.measuredText,
			this.measuredText.getOffsetFromPosition({ line, column: 0 })
		);
	}

	endOfLine(_width?: number): Cursor {
		const { line } = this.measuredText.getPositionFromOffset(this.offset);
		return new Cursor(
			this.measuredText,
			this.measuredText.getOffsetFromPosition({
				line,
				column: this.measuredText.getLineLength(line)
			})
		);
	}

	startOfInput(): Cursor {
		return new Cursor(this.measuredText, 0);
	}

	endOfInput(): Cursor {
		return new Cursor(this.measuredText, this.text.length);
	}

	killToLineEnd(_width?: number): Cursor {
		if (this.text[this.offset] === '\n') {
			return this.modifyText(this.right());
		}

		return this.modifyText(this.endOfLine());
	}

	clearToStart(): Cursor {
		if (this.offset === 0) {
			return this;
		}

		return Cursor.fromText(this.text.slice(this.offset), this.columns, 0);
	}

	prevWord(): Cursor {
		const wordBoundaries = this.measuredText.getWordBoundaries();
		let prevWordStart: number | null = null;

		for (const boundary of wordBoundaries) {
			if (!boundary.isWordLike) {
				continue;
			}
			if (boundary.start < this.offset) {
				if (this.offset > boundary.start && this.offset <= boundary.end) {
					return new Cursor(this.measuredText, boundary.start);
				}
				prevWordStart = boundary.start;
			}
		}

		return new Cursor(this.measuredText, prevWordStart ?? 0);
	}

	nextWord(): Cursor {
		for (const boundary of this.measuredText.getWordBoundaries()) {
			if (boundary.isWordLike && boundary.start > this.offset) {
				return new Cursor(this.measuredText, boundary.start);
			}
		}

		return new Cursor(this.measuredText, this.text.length);
	}

	deleteTokenBefore(): Cursor | null {
		const tokenAfter = this.imageRefStartingAt(this.offset);
		if (tokenAfter) {
			const end =
				this.text[tokenAfter.end] === ' '
					? tokenAfter.end + 1
					: tokenAfter.end;
			return this.modifyRange(tokenAfter.start, end, '');
		}

		if (this.offset === 0) {
			return null;
		}

		const charAfter = this.text[this.offset];
		if (charAfter !== undefined && !/\s/.test(charAfter)) {
			return specialTokenContaining(this.text, this.offset)
				? this.modifyRange(
						specialTokenContaining(this.text, this.offset)!.start,
						specialTokenContaining(this.text, this.offset)!.end,
						''
					)
				: null;
		}

		const token = this.imageRefEndingAt(this.offset);
		if (token) {
			return this.modifyRange(token.start, token.end, '');
		}

		const textBefore = this.text.slice(0, this.offset);
		const pasteMatch = textBefore.match(
			/(^|\s)\[(Pasted text #\d+(?: \+\d+ lines)?|Pasted #\d+ (?:\d+ lines|\d+ characters)|Image #\d+|\.\.\.Truncated text #\d+ \+\d+ lines\.\.\.)\]$/
		);
		if (!pasteMatch) {
			return null;
		}

		const matchStart = pasteMatch.index! + pasteMatch[1]!.length;
		return this.modifyRange(matchStart, this.offset, '');
	}

	imageRefEndingAt(offset: number): { start: number; end: number } | null {
		return specialTokenEndingAt(this.text, offset);
	}

	imageRefStartingAt(offset: number): { start: number; end: number } | null {
		return specialTokenStartingAt(this.text, offset);
	}

	snapOutOfImageRef(offset: number, toward: 'start' | 'end'): number {
		const token = specialTokenContaining(this.text, offset);
		if (!token) {
			return offset;
		}

		return toward === 'start' ? token.start : token.end;
	}

	private moveVertical(direction: -1 | 1): Cursor {
		const { line, column } = this.measuredText.getPositionFromOffset(
			this.offset
		);
		const targetLine = line + direction;
		if (targetLine < 0 || targetLine >= this.measuredText.lineCount) {
			return this;
		}

		const targetLineText = this.measuredText.getWrappedText()[targetLine];
		if (targetLineText === undefined) {
			return this;
		}

		const targetColumn = Math.min(column, stringWidth(targetLineText));
		return new Cursor(
			this.measuredText,
			this.measuredText.getOffsetFromPosition({
				line: targetLine,
				column: this.preferredColumn ?? targetColumn
			}),
			0,
			this.preferredColumn ?? column
		);
	}

	private modifyText(end: Cursor, insertString = ''): Cursor {
		return this.modifyRange(this.offset, end.offset, insertString);
	}

	private modifyRange(start: number, end: number, insertString: string): Cursor {
		const nextText =
			this.text.slice(0, start) +
			insertString.normalize('NFC') +
			this.text.slice(end);
		return Cursor.fromText(
			nextText,
			this.columns,
			start + insertString.normalize('NFC').length
		);
	}

	private findTokenBeforeOrAtCursor(): { start: number; end: number } | null {
		const tokenAfter = this.imageRefStartingAt(this.offset);
		if (tokenAfter) {
			const end =
				this.text[tokenAfter.end] === ' '
					? tokenAfter.end + 1
					: tokenAfter.end;
			return { start: tokenAfter.start, end };
		}

		if (this.offset === 0) {
			return null;
		}

		const charAfter = this.text[this.offset];
		if (charAfter !== undefined && !/\s/.test(charAfter)) {
			return specialTokenContaining(this.text, this.offset);
		}

		return (
			this.imageRefEndingAt(this.offset) ??
			specialTokenContaining(this.text, this.offset)
		);
	}
}

const SPECIAL_TOKEN_PATTERN =
	/\[(?:Pasted text #\d+(?: \+\d+ lines)?|Pasted #\d+ (?:\d+ lines|\d+ characters)|Image #\d+|\.\.\.Truncated text #\d+ \+\d+ lines\.\.\.)\]/g;

function specialTokenEndingAt(
	text: string,
	offset: number
): { start: number; end: number } | null {
	for (const token of findSpecialTokens(text)) {
		if (token.end === offset) {
			return token;
		}
	}

	return null;
}

function specialTokenStartingAt(
	text: string,
	offset: number
): { start: number; end: number } | null {
	for (const token of findSpecialTokens(text)) {
		if (token.start === offset) {
			return token;
		}
	}

	return null;
}

function specialTokenContaining(
	text: string,
	offset: number
): { start: number; end: number } | null {
	for (const token of findSpecialTokens(text)) {
		if (offset > token.start && offset < token.end) {
			return token;
		}
	}

	return null;
}

function findSpecialTokens(text: string): Array<{ start: number; end: number }> {
	const tokens: Array<{ start: number; end: number }> = [];
	SPECIAL_TOKEN_PATTERN.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = SPECIAL_TOKEN_PATTERN.exec(text)) !== null) {
		tokens.push({
			start: match.index,
			end: match.index + match[0].length
		});
	}

	return tokens;
}
