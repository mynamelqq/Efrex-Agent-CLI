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

    const previousOffset = previousGraphemeOffset(this.text, this.offset);
    const nextText = this.text.slice(0, previousOffset) + this.text.slice(this.offset);
    return new Cursor(nextText, previousOffset, 0, null);
  }

  deleteForward(): Cursor {
    if (this.offset >= this.text.length) {
      return this;
    }

    const nextOffset = nextGraphemeOffset(this.text, this.offset);
    const nextText = this.text.slice(0, this.offset) + this.text.slice(nextOffset);
    return new Cursor(nextText, this.offset, 0, null);
  }

  left(): Cursor {
    return new Cursor(this.text, previousGraphemeOffset(this.text, this.offset), 0, null);
  }

  right(): Cursor {
    return new Cursor(this.text, nextGraphemeOffset(this.text, this.offset), 0, null);
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
    return new Cursor(this.text, previousWordOffset(this.text, this.offset), 0, null);
  }

  nextWord(): Cursor {
    return new Cursor(this.text, nextWordOffset(this.text, this.offset), 0, null);
  }

  up(width: number): Cursor {
    return this.moveVertical(width, -1);
  }

  down(width: number): Cursor {
    return this.moveVertical(width, 1);
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
    const rendered = lines.map(line => renderLine(line, this.offset, cursorChar, invert));

    if (!maxVisibleLines || rendered.length <= maxVisibleLines) {
      return rendered;
    }

    const currentLineIndex = findVisualLineIndex(lines, this.offset);
    const start = Math.max(0, currentLineIndex - maxVisibleLines + 1);
    return rendered.slice(start, start + maxVisibleLines);
  }

  private moveVertical(width: number, direction: -1 | 1): Cursor {
    const lines = buildVisualLines(this.text, width);
    const currentLineIndex = findVisualLineIndex(lines, this.offset);
    const targetLineIndex = currentLineIndex + direction;
    if (targetLineIndex < 0 || targetLineIndex >= lines.length) {
      return this;
    }

    const currentLine = lines[currentLineIndex]!;
    const currentColumn = this.preferredColumn ?? this.offset - currentLine.start;
    const targetLine = lines[targetLineIndex]!;
    const targetOffset = targetLine.start + Math.min(currentColumn, targetLine.end - targetLine.start);
    return new Cursor(this.text, targetOffset, 0, currentColumn);
  }
}

function renderLine(line: VisualLine, offset: number, cursorChar: string, invert: (text: string) => string): string {
  const column = clamp(offset - line.start, 0, line.end - line.start);
  if (line.text.length === 0) {
    return column === 0 ? invert(cursorChar) : cursorChar;
  }

  let rendered = '';
  for (let i = 0; i < line.text.length; i++) {
    rendered += i === column ? invert(line.text[i]!) : line.text[i]!;
  }

  if (column === line.text.length) {
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

  for (const logicalLine of logicalLines) {
    const graphemes = splitGraphemes(logicalLine);
    if (graphemes.length === 0) {
      lines.push({start: offset, end: offset, text: ''});
      offset += 1;
      continue;
    }

    let localOffset = 0;
    while (localOffset < graphemes.length) {
      const chunk = graphemes.slice(localOffset, localOffset + safeWidth).join('');
      lines.push({
        start: offset + localOffset,
        end: offset + localOffset + chunk.length,
        text: chunk,
      });
      localOffset += safeWidth;
    }

    offset += logicalLine.length + 1;
  }

  if (text.length === 0) {
    return [{start: 0, end: 0, text: ''}];
  }

  return lines;
}

function splitGraphemes(text: string): string[] {
  if (!graphemeSegmenter) {
    return Array.from(text);
  }

  return Array.from(graphemeSegmenter.segment(text), segment => segment.segment);
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
