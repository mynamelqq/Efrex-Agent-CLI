import React from 'react';
import { Text } from "src/ink.js"
import { formatDuration } from '../../utils/format.js';

type Props = {
  elapsedTimeSeconds?: number;
  timeoutMs?: number;
};

export function ShellTimeDisplay({ elapsedTimeSeconds, timeoutMs }: Props): React.ReactNode {
  if (elapsedTimeSeconds === undefined && !timeoutMs) {
    return null;
  }
  const timeout = timeoutMs ? formatDuration(timeoutMs, { hideTrailingZeros: true }) : undefined;
  if (elapsedTimeSeconds === undefined) {
    return <Text color="ansi:blackBright">{`(timeout ${timeout})`}</Text>;
  }
  const elapsed = formatDuration(elapsedTimeSeconds * 1000);
  const color =
    elapsedTimeSeconds >= 180
      ? 'yellowBright'
      : elapsedTimeSeconds >= 60
        ? 'blueBright'
        : 'ansi:blackBright';
  if (timeout) {
    return <Text color={color}>{`(${elapsed} · timeout ${timeout})`}</Text>;
  }
  return <Text color={color}>{`(${elapsed})`}</Text>;
}
