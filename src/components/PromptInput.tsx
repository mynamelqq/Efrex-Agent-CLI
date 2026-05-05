import React from 'react';
import {Box, Text} from 'ink';
import chalk from 'chalk';
import useTextInput from '../hooks/useTextInput.js';

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
  });

  if (value.length === 0) {
    const renderedPlaceholder = isActive
      ? placeholder.length > 0
        ? chalk.inverse(placeholder[0]) + chalk.gray(placeholder.slice(1))
        : chalk.inverse(' ')
      : chalk.gray(placeholder);

    return <Text>{renderedPlaceholder}</Text>;
  }

  const lines = cursor.render({
    width,
    maxVisibleLines,
    invert: text => chalk.inverse(text),
  });

  return (
    <Box flexDirection="column">
      {lines.map((line, index) => (
        <Text key={`${index}-${line.length}`}>{line}</Text>
      ))}
    </Box>
  );
}
