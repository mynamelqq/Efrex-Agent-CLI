import {useEffect, useState} from 'react';
import {useInput} from '../ink.js';
import Cursor from '../utils/Cursor.js';

const SGR_MOUSE_INPUT_PATTERN = /(?:\x1B)?\[<\d+;\d+;\d+[mM]/g;

type Props = {
  value: string;
  width: number;
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
  onPasteText?: (text: string) => string | void;
};

export default function useTextInput({
  value,
  width,
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
  onPasteText,
}: Props) {
  const initialOffset = Math.min(cursorOffset ?? value.length, value.length);
  const [cursor, setCursor] = useState(() => new Cursor(value, initialOffset));

  useEffect(() => {
    setCursor(new Cursor(value, Math.min(cursorOffset ?? value.length, value.length)));
  }, [cursorSyncKey]);

  useEffect(() => {
    setCursor(previous => {
      const nextOffset = Math.min(cursorOffset ?? previous.offset, value.length);
      return previous.sync(value, nextOffset);
    });
  }, [value, cursorOffset]);

  useEffect(() => {
    onCursorOffsetChange?.(cursor.offset);
  }, [cursor.offset, onCursorOffsetChange]);

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

      if (key.tab || (key.shift && key.tab)) {
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
          setCursor(previous => previous.up(width));
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
          setCursor(previous => previous.down(width));
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
          setCursor(nextCursor);
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
        const insertedText =
          onPasteText &&
          (normalizedInput.length > 1 ||
            normalizedInput.includes('\n') ||
            normalizedInput.includes('\t'))
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
      setCursor(nextCursor);
      if (nextCursor.text !== cursor.text) {
        onChange(nextCursor.text);
      }
    },
    {isActive},
  );

  return {cursor, setCursor};
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
