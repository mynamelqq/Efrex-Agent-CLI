import {stringWidth} from '../ink/stringWidth.js';

type RenderOptions = {
  cursorChar?: string;
  mask?: string;
  invert: (text: string) => string;
  width: number;
  maxVisibleLines?: number;
};

type VisualLine = {
  start: number;
  end: number;
  text: string;
};

type PositionOptions = {
  width: number;
  maxVisibleLines?: number;
};

const graphemeSegmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, {granularity: 'grapheme'})
    : null;

const wordSegmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, {granularity: 'word'})
    : null;

export default class Cursor {
  readonly offset: number;

  constructor(
    readonly text: string,
    offset: number = text.length,
    readonly selection: number = 0,
    readonly preferredColumn: number | null = null,
  ) {
    this.offset = clamp(offset, 0, text.length);
  }

  sync(text: string, offset: number = text.length): Cursor {
    return new Cursor(text, offset, 0, null);
  }

  insert(text: string): Cursor {
    const nextText = this.text.slice(0, this.offset) + text + this.text.slice(this.offset);
    return new Cursor(nextText, this.offset + text.length, 0, null);
  }

  backspace(): Cursor {
    if (this.offset === 0) {
      return this;
    }

    const token = this.findTokenBeforeOrAtCursor();
    if (token) {
      const nextText = this.text.slice(0, token.start) + this.text.slice(token.end);//光标左边有特殊token时，一次性删除整个token
      return new Cursor(nextText, token.start, 0, null);
    }

    const previousOffset = previousGraphemeOffset(this.text, this.offset);
    const nextText = this.text.slice(0, previousOffset) + this.text.slice(this.offset);
    return new Cursor(nextText, previousOffset, 0, null);
  }

  deleteForward(): Cursor {
    if (this.offset >= this.text.length) {
      return this;
    }

    const token = this.imageRefStartingAt(this.offset) ?? specialTokenContaining(this.text, this.offset);
    if (token) {
      const nextText = this.text.slice(0, token.start) + this.text.slice(token.end);
      return new Cursor(nextText, token.start, 0, null);
    }

    const nextOffset = nextGraphemeOffset(this.text, this.offset);
    const nextText = this.text.slice(0, this.offset) + this.text.slice(nextOffset);
    return new Cursor(nextText, this.offset, 0, null);
  }

  left(): Cursor {
    const token = this.imageRefEndingAt(this.offset) ?? specialTokenContaining(this.text, this.offset);
    if (token) {
      return new Cursor(this.text, token.start, 0, null);
    }

    return new Cursor(this.text, previousGraphemeOffset(this.text, this.offset), 0, null);
  }

  right(): Cursor {
    const token = this.imageRefStartingAt(this.offset) ?? specialTokenContaining(this.text, this.offset);
    if (token) {
      return new Cursor(this.text, token.end, 0, null);
    }

    return new Cursor(this.text, nextGraphemeOffset(this.text, this.offset), 0, null);
  }

  /**
   * If an image/paste chip ends at `offset`, return its bounds. Used by left()
   * and delete operations to hop over chips instead of stepping into them.
   */
  imageRefEndingAt(offset: number): {start: number; end: number} | null {
    return specialTokenEndingAt(this.text, offset);
  }

  imageRefStartingAt(offset: number): {start: number; end: number} | null {
    return specialTokenStartingAt(this.text, offset);
  }

  /**
   * If offset lands strictly inside an image/paste chip, snap it to the given
   * boundary. Used by word movement so Ctrl+W / Alt+D never leave a partial chip.
   */
  snapOutOfImageRef(offset: number, toward: 'start' | 'end'): number {
    return snapOutOfSpecialToken(this.text, offset, toward);
  }

  startOfLine(width: number): Cursor {
    const line = findVisualLine(this.text, this.offset, width);
    return new Cursor(this.text, line.start, 0, null);
  }

  endOfLine(width: number): Cursor {
    const line = findVisualLine(this.text, this.offset, width);
    return new Cursor(this.text, line.end, 0, null);
  }

  startOfInput(): Cursor {
    return new Cursor(this.text, 0, 0, null);
  }

  endOfInput(): Cursor {
    return new Cursor(this.text, this.text.length, 0, null);
  }

  killToLineEnd(width: number): Cursor {
    const line = findVisualLine(this.text, this.offset, width);
    if (line.end === this.offset) {
      return this;
    }

    const nextText = this.text.slice(0, this.offset) + this.text.slice(line.end);
    return new Cursor(nextText, this.offset, 0, null);
  }

  clearToStart(): Cursor {
    if (this.offset === 0) {
      return this;
    }

    return new Cursor(this.text.slice(this.offset), 0, 0, null);
  }

  prevWord(): Cursor {
    return new Cursor(this.text, this.snapOutOfImageRef(previousWordOffset(this.text, this.offset), 'start'), 0, null);
  }

  nextWord(): Cursor {
    return new Cursor(this.text, this.snapOutOfImageRef(nextWordOffset(this.text, this.offset), 'end'), 0, null);
  }

  up(width: number): Cursor {
    return this.moveVertical(width, -1);
  }

  down(width: number): Cursor {
    return this.moveVertical(width, 1);
  }

  deleteTokenBefore(): Cursor | null {
    const token = this.findTokenBeforeOrAtCursor();
    if (!token) {
      return null;
    }

    const nextText = this.text.slice(0, token.start) + this.text.slice(token.end);
    return new Cursor(nextText, token.start, 0, null);
  }

  render({
    cursorChar = ' ',
    mask,
    invert,
    width,
    maxVisibleLines,
  }: RenderOptions): string[] {
    const sourceText = mask ? mask.repeat(this.text.length) : this.text;
    const lines = buildVisualLines(sourceText, width);
    const currentLineIndex = findVisualLineIndex(lines, this.offset);
    const rendered = lines.map((line, index) =>
      renderLine(line, this.offset, index === currentLineIndex, cursorChar, invert),
    );

    if (!maxVisibleLines || rendered.length <= maxVisibleLines) {
      return rendered;
    }

    const start = getViewportStartLine(lines, currentLineIndex, maxVisibleLines);
    return rendered.slice(start, start + maxVisibleLines);
  }

  getPosition({width, maxVisibleLines}: PositionOptions): {line: number; column: number} {
    const lines = buildVisualLines(this.text, width);
    const lineIndex = findVisualLineIndex(lines, this.offset);
    const line = lines[lineIndex] ?? {start: 0, end: 0, text: ''};
    const localOffset = clamp(this.offset - line.start, 0, line.end - line.start);
    const viewportStartLine =
      maxVisibleLines && lines.length > maxVisibleLines
        ? getViewportStartLine(lines, lineIndex, maxVisibleLines)
        : 0;

    return {
      line: Math.max(0, lineIndex - viewportStartLine),
      column: stringWidth(line.text.slice(0, localOffset)),
    };
  }

  private moveVertical(width: number, direction: -1 | 1): Cursor {
    const lines = buildVisualLines(this.text, width);
    const currentLineIndex = findVisualLineIndex(lines, this.offset);
    const targetLineIndex = currentLineIndex + direction;
    if (targetLineIndex < 0 || targetLineIndex >= lines.length) {
      return this;
    }

    const currentLine = lines[currentLineIndex]!;
    const currentColumn =
      this.preferredColumn ??
      stringWidth(currentLine.text.slice(0, clamp(this.offset - currentLine.start, 0, currentLine.end - currentLine.start)));
    const targetLine = lines[targetLineIndex]!;
    const targetOffset = this.snapOutOfImageRef(
      offsetAtDisplayColumn(targetLine, currentColumn),
      direction === -1 ? 'start' : 'end',
    );
    return new Cursor(this.text, targetOffset, 0, currentColumn);
  }

  private findTokenBeforeOrAtCursor(): {start: number; end: number} | null {
    const tokenAfter = this.imageRefStartingAt(this.offset);
    if (tokenAfter) {
      const end =
        this.text[tokenAfter.end] === ' ' ? tokenAfter.end + 1 : tokenAfter.end;
      return {start: tokenAfter.start, end};
    }

    if (this.offset === 0) {
      return null;
    }

    const charAfter = this.text[this.offset];
    if (charAfter !== undefined && !/\s/.test(charAfter)) {
      return specialTokenContaining(this.text, this.offset);
    }

    return this.imageRefEndingAt(this.offset) ?? specialTokenContaining(this.text, this.offset);
  }
}

function renderLine(
  line: VisualLine,
  offset: number,
  showCursor: boolean,
  cursorChar: string,
  invert: (text: string) => string,
): string {
  if (!showCursor) {
    return line.text;
  }

  if (line.text.length === 0) {
    return offset <= line.start ? invert(cursorChar) : cursorChar;
  }

  let rendered = '';
  let insertedCursor = false;
  for (const grapheme of iterGraphemes(line.text)) {
    const start = line.start + grapheme.index;
    const end = start + grapheme.segment.length;

    if (!insertedCursor && offset >= start && offset < end) {
      rendered += invert(grapheme.segment);
      insertedCursor = true;
      continue;
    }

    if (!insertedCursor && offset <= start) {
      rendered += invert(grapheme.segment);
      insertedCursor = true;
      continue;
    }

    rendered += grapheme.segment;
  }

  if (!insertedCursor) {
    rendered += invert(cursorChar);
  }

  return rendered;
}

function findVisualLine(text: string, offset: number, width: number): VisualLine {
  return buildVisualLines(text, width)[findVisualLineIndex(buildVisualLines(text, width), offset)]!;
}

function findVisualLineIndex(lines: VisualLine[], offset: number): number {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (offset <= line.end) {
      return i;
    }
  }

  return Math.max(0, lines.length - 1);
}

function buildVisualLines(text: string, width: number): VisualLine[] {
  const safeWidth = Math.max(1, width);
  const logicalLines = text.split('\n');
  const lines: VisualLine[] = [];
  let offset = 0;

  for (let lineIndex = 0; lineIndex < logicalLines.length; lineIndex++) {
    const logicalLine = logicalLines[lineIndex]!;
    if (logicalLine.length === 0) {
      lines.push({start: offset, end: offset, text: ''});
      offset += lineIndex < logicalLines.length - 1 ? 1 : 0;
      continue;
    }

    let visualText = '';
    let visualWidth = 0;
    let visualStart = 0;

    for (const grapheme of iterGraphemes(logicalLine)) {
      const graphemeWidth = Math.max(1, stringWidth(grapheme.segment));
      if (visualText.length > 0 && visualWidth + graphemeWidth > safeWidth) {
        lines.push({
          start: offset + visualStart,
          end: offset + grapheme.index,
          text: visualText,
        });
        visualText = '';
        visualWidth = 0;
        visualStart = grapheme.index;
      }

      visualText += grapheme.segment;
      visualWidth += graphemeWidth;
    }

    lines.push({
      start: offset + visualStart,
      end: offset + logicalLine.length,
      text: visualText,
    });

    offset += logicalLine.length + (lineIndex < logicalLines.length - 1 ? 1 : 0);
  }

  if (text.length === 0) {
    return [{start: 0, end: 0, text: ''}];
  }

  return lines;
}

function iterGraphemes(text: string): Array<{segment: string; index: number}> {
  if (!graphemeSegmenter) {
    const segments: Array<{segment: string; index: number}> = [];
    let index = 0;
    for (const segment of Array.from(text)) {
      segments.push({segment, index});
      index += segment.length;
    }
    return segments;
  }

  return Array.from(graphemeSegmenter.segment(text), segment => ({
    segment: segment.segment,
    index: segment.index,
  }));
}

function previousGraphemeOffset(text: string, offset: number): number {
  if (offset <= 0) {
    return 0;
  }

  const segmenter = graphemeSegmenter;
  if (!segmenter) {
    return Array.from(text.slice(0, offset)).slice(0, -1).join('').length;
  }

  let previous = 0;
  for (const segment of segmenter.segment(text)) {
    if (segment.index >= offset) {
      break;
    }
    previous = segment.index;
  }

  return previous;
}

function nextGraphemeOffset(text: string, offset: number): number {
  if (offset >= text.length) {
    return text.length;
  }

  const segmenter = graphemeSegmenter;
  if (!segmenter) {
    return text.slice(0, Array.from(text.slice(offset))[0]?.length ? offset + Array.from(text.slice(offset))[0]!.length : offset + 1).length;
  }

  for (const segment of segmenter.segment(text)) {
    if (segment.index > offset) {
      return segment.index;
    }
  }

  return text.length;
}

function previousWordOffset(text: string, offset: number): number {
  if (!wordSegmenter) {
    return previousGraphemeOffset(text, offset);
  }

  let previous = 0;
  for (const segment of wordSegmenter.segment(text)) {
    if (segment.index >= offset) {
      break;
    }
    if (segment.isWordLike) {
      previous = segment.index;
    }
  }

  return previous;
}

function nextWordOffset(text: string, offset: number): number {
  if (!wordSegmenter) {
    return nextGraphemeOffset(text, offset);
  }

  for (const segment of wordSegmenter.segment(text)) {
    if (segment.index <= offset) {
      continue;
    }
    if (segment.isWordLike) {
      return segment.index;
    }
  }

  return text.length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function offsetAtDisplayColumn(line: VisualLine, targetColumn: number): number {
  if (targetColumn <= 0) {
    return line.start;
  }

  let column = 0;
  for (const grapheme of iterGraphemes(line.text)) {
    const nextColumn = column + Math.max(1, stringWidth(grapheme.segment));
    if (nextColumn > targetColumn) {
      return line.start + grapheme.index;
    }
    column = nextColumn;
  }

  return line.end;
}

function getViewportStartLine(lines: VisualLine[], currentLineIndex: number, maxVisibleLines: number): number {
  if (lines.length <= maxVisibleLines) {
    return 0;
  }

  const half = Math.floor(maxVisibleLines / 2);
  let start = Math.max(0, currentLineIndex - half);
  const end = Math.min(lines.length, start + maxVisibleLines);
  if (end - start < maxVisibleLines) {
    start = Math.max(0, end - maxVisibleLines);
  }

  return start;
}

const SPECIAL_TOKEN_PATTERN =
  /\[(?:Pasted text #\d+(?: \+\d+ lines)?|Pasted #\d+ (?:\d+ lines|\d+ characters)|Image #\d+|\.\.\.Truncated text #\d+ \+\d+ lines\.\.\.)\]/g;

function specialTokenEndingAt(text: string, offset: number): {start: number; end: number} | null {
  for (const token of findSpecialTokens(text)) {
    if (token.end === offset) {
      return token;
    }
  }

  return null;
}

function specialTokenStartingAt(text: string, offset: number): {start: number; end: number} | null {
  for (const token of findSpecialTokens(text)) {
    if (token.start === offset) {
      return token;
    }
  }

  return null;
}

function specialTokenContaining(text: string, offset: number): {start: number; end: number} | null {
  for (const token of findSpecialTokens(text)) {
    if (offset > token.start && offset < token.end) {
      return token;
    }
  }

  return null;
}

function snapOutOfSpecialToken(text: string, offset: number, toward: 'start' | 'end'): number {
  const token = specialTokenContaining(text, offset);
  if (!token) {
    return offset;
  }

  return toward === 'start' ? token.start : token.end;
}

function findSpecialTokens(text: string): Array<{start: number; end: number}> {
  const tokens: Array<{start: number; end: number}> = [];
  SPECIAL_TOKEN_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SPECIAL_TOKEN_PATTERN.exec(text)) !== null) {
    tokens.push({start: match.index, end: match.index + match[0].length});
  }

  return tokens;
}
