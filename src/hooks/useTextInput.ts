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
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  onHistoryPrev?: () => void;
  onHistoryNext?: () => void;
  onCtrlC?: () => void;
  onPasteText?: (text: string) => string;
};

export default function useTextInput({
  value,
  width,
  cursorSyncKey = 0,
  isActive = true,
  suspendSubmit = false,
  suspendVerticalArrows = false,
  onChange,
  onSubmit,
  onHistoryPrev,
  onHistoryNext,
  onCtrlC,
  onPasteText,
}: Props) {
  const [cursor, setCursor] = useState(() => new Cursor(value, value.length));

  useEffect(() => {
    setCursor(new Cursor(value, value.length));
  }, [cursorSyncKey]);

  useEffect(() => {
    setCursor(previous => previous.sync(value, Math.min(previous.offset, value.length)));
  }, [value]);

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
          event.keypress.isPasted && onPasteText
            ? onPasteText(normalizedInput)
            : normalizedInput;
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

  return {cursor};
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
