import {useInput} from '../ink.js';
import Cursor from '../utils/Cursor.js';
import { PASTE_THRESHOLD } from '../utils/paste.js';

const SGR_MOUSE_INPUT_PATTERN = /(?:\x1B)?\[<\d+;\d+;\d+[mM]/g;

type Props = {
  value: string;
  width: number;
  maxVisibleLines?: number;
  cursorChar?: string;
  invert?: (text: string) => string;
  cursorSyncKey?: number;
  isActive?: boolean;
  suspendSubmit?: boolean;
  suspendVerticalArrows?: boolean;
  cursorOffset?: number;
  onChange: (value: string) => void;
  onCursorOffsetChange?: (offset: number) => void;
  onSubmit?: (value: string) => void;
  onHistoryPrev?: () => void;
  onHistoryNext?: () => void;
  onCtrlC?: () => void;
  onCyclePermissionMode?: () => void;
  onPasteText?: (text: string) => string | void;
};

export default function useTextInput({
  value,
  width,
  maxVisibleLines,
  cursorChar = ' ',
  invert = text => text,
  cursorSyncKey = 0,
  isActive = true,
  suspendSubmit = false,
  suspendVerticalArrows = false,
  cursorOffset,
  onChange,
  onCursorOffsetChange,
  onSubmit,
  onHistoryPrev,
  onHistoryNext,
  onCtrlC,
  onCyclePermissionMode,
  onPasteText,
}: Props) {
  const effectiveOffset = Math.min(cursorOffset ?? value.length, value.length);
  const cursor = Cursor.fromText(value, width, effectiveOffset);

  const applyCursor = (nextCursor: Cursor) => {
    onCursorOffsetChange?.(nextCursor.offset);
  };

  useInput(
    (input, key, event) => {
      const textInput = stripMouseInput(input);
      if (textInput.length === 0 && textInput !== input) {
        return;
      }

      if (key.ctrl && textInput === 'c') {
        event.stopImmediatePropagation();
        onCtrlC?.();
        return;
      }

      if ((key.shift && key.tab) || (key.ctrl && textInput === 'g')) {
        event.stopImmediatePropagation();
        onCyclePermissionMode?.();
        return;
      }

      if (key.tab) {
        return;
      }

      if (key.return) {
        if (suspendSubmit) {
          return;
        }
        event.stopImmediatePropagation();
        onSubmit?.(cursor.text);
        return;
      }

      if (key.upArrow) {
        if (suspendVerticalArrows) {
          return;
        }
        event.stopImmediatePropagation();
        if (cursor.text.includes('\n')) {
          applyCursor(cursor.up(width));
        } else {
          onHistoryPrev?.();
        }
        return;
      }

      if (key.downArrow) {
        if (suspendVerticalArrows) {
          return;
        }
        event.stopImmediatePropagation();
        if (cursor.text.includes('\n')) {
          applyCursor(cursor.down(width));
        } else {
          onHistoryNext?.();
        }
        return;
      }

      if (key.ctrl) {
        if (textInput === 'p') {
          event.stopImmediatePropagation();
          onHistoryPrev?.();
          return;
        }

        if (textInput === 'n') {
          event.stopImmediatePropagation();
          onHistoryNext?.();
          return;
        }

        const nextCursor = handleCtrl(textInput, cursor, width);
        if (nextCursor !== cursor) {
          event.stopImmediatePropagation();
          applyCursor(nextCursor);
          if (nextCursor.text !== cursor.text) {
            onChange(nextCursor.text);
          }
        }
        return;
      }

      if (key.escape) {
        return;
      }

      let nextCursor = cursor;
      if (key.leftArrow) {
        nextCursor = cursor.left();
      } else if (key.rightArrow) {
        nextCursor = cursor.right();
      } else if (key.backspace) {
        nextCursor = cursor.deleteTokenBefore() ?? cursor.backspace();
      } else if (key.delete) {
        nextCursor = cursor.deleteForward();
      } else if (textInput) {
        const normalizedInput = textInput.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        const shouldHandleAsPaste =
          normalizedInput.includes('\n') ||
          normalizedInput.includes('\t') ||
          normalizedInput.length > PASTE_THRESHOLD;
        const insertedText =
          onPasteText && shouldHandleAsPaste
            ? onPasteText(normalizedInput)
            : normalizedInput;
        if (insertedText === undefined) {
          event.stopImmediatePropagation();
          return;
        }
        nextCursor = cursor.insert(insertedText);
      }

      if (nextCursor === cursor) {
        return;
      }

      event.stopImmediatePropagation();
      applyCursor(nextCursor);
      if (nextCursor.text !== cursor.text) {
        onChange(nextCursor.text);
      }
    },
    {isActive},
  );

  const cursorPos = cursor.getPosition();

  return {
    cursor,
    renderedValue: cursor
      .render({
        cursorChar,
        width,
        maxVisibleLines,
        invert
      })
      .join('\n'),
    cursorLine: cursorPos.line - cursor.getViewportStartLine(maxVisibleLines),
    cursorColumn: cursorPos.column,
    offset: cursor.offset,
    setOffset: onCursorOffsetChange
  };
}

function stripMouseInput(input: string): string {
  return input.replace(SGR_MOUSE_INPUT_PATTERN, '');
}

function handleCtrl(input: string, cursor: Cursor, width: number): Cursor {
  switch (input) {
    case 'a':
      return cursor.startOfLine(width);
    case 'b':
      return cursor.left();
    case 'd':
      return cursor.deleteForward();
    case 'e':
      return cursor.endOfLine(width);
    case 'f':
      return cursor.right();
    case 'h':
      return cursor.deleteTokenBefore() ?? cursor.backspace();
    case 'k':
      return cursor.killToLineEnd(width);
    case 'u':
      return cursor.clearToStart();
    default:
      return cursor;
  }
}
