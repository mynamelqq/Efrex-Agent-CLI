import React from 'react';
import { Ansi, Box } from '../ink.js';
import chalk from 'chalk';
import useTextInput from '../hooks/useTextInput.js';
import {useDeclaredCursor} from '../ink/hooks/use-declared-cursor.js';

const INPUT_CURSOR_BG = '#3a3a35';
const INPUT_CURSOR_FG = '#f0f0ea';

type Props = {
  value: string;
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
  onPasteText?: (text: string) => string;
};

export default function PromptInput({
  value,
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
  onPasteText,
}: Props) {
  const {cursor} = useTextInput({
    value,
    width,
    cursorSyncKey,
    isActive,
    suspendSubmit,
    suspendVerticalArrows,
    onChange,
    onSubmit,
    onHistoryPrev,
    onHistoryNext,
    onCtrlC,
    onPasteText,
  });
  const cursorPosition = cursor.getPosition({
    width,
    maxVisibleLines,
  });
  const cursorRef = useDeclaredCursor({
    line: cursorPosition.line,
    column: cursorPosition.column,
    active: isActive,
  });

  if (value.length === 0) {
    const renderedPlaceholder = isActive
      ? placeholder.length > 0
        ? chalk.bgHex(INPUT_CURSOR_BG).hex(INPUT_CURSOR_FG)(placeholder[0]) + chalk.gray(placeholder.slice(1))
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
    invert: text => chalk.bgHex(INPUT_CURSOR_BG).hex(INPUT_CURSOR_FG)(text),
  });

  return (
    <Box ref={cursorRef} flexDirection="column" width={width} flexShrink={0}>
      {lines.map((line, index) => (
        <Ansi key={index}>{line.length === 0 ? ' ' : line}</Ansi>
      ))}
    </Box>
  );
}
