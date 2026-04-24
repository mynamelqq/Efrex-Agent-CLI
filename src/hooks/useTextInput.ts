import {useEffect, useState} from 'react';
import {useInput} from 'ink';
import Cursor from '../utils/Cursor.js';

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
}: Props) {
  const [cursor, setCursor] = useState(() => new Cursor(value, value.length));

  useEffect(() => {
    setCursor(new Cursor(value, value.length));
  }, [cursorSyncKey, value]);

  useEffect(() => {
    setCursor(previous => previous.sync(value, Math.min(previous.offset, value.length)));
  }, [value]);

  useInput(
    (input, key) => {
      if (key.ctrl && input === 'c') {
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
        onSubmit?.(cursor.text);
        return;
      }

      if (key.upArrow) {
        if (suspendVerticalArrows) {
          return;
        }
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
        if (cursor.text.includes('\n')) {
          setCursor(previous => previous.down(width));
        } else {
          onHistoryNext?.();
        }
        return;
      }

      if (key.ctrl) {
        if (input === 'p') {
          onHistoryPrev?.();
          return;
        }

        if (input === 'n') {
          onHistoryNext?.();
          return;
        }

        const nextCursor = handleCtrl(input, cursor, width);
        if (nextCursor !== cursor) {
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
        nextCursor = cursor.backspace();
      } else if (key.delete) {
        nextCursor = cursor.deleteForward();
      } else if (input) {
        nextCursor = cursor.insert(input);
      }

      if (nextCursor === cursor) {
        return;
      }

      setCursor(nextCursor);
      if (nextCursor.text !== cursor.text) {
        onChange(nextCursor.text);
      }
    },
    {isActive},
  );

  return {cursor};
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
    case 'k':
      return cursor.killToLineEnd(width);
    case 'u':
      return cursor.clearToStart();
    default:
      return cursor;
  }
}
