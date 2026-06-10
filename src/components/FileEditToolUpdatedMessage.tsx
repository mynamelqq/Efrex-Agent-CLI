import * as React from 'react';
import type { StructuredPatchHunk } from 'diff';
import { Box, Text } from '../ink.js';
import { StructuredDiffList } from './StructuredDiffList.js';
import { firstLineOf } from '../utils/stringUtils.js';
import { useWindowSize } from '../ink.js';
export function count<T>(arr: readonly T[], pred: (x: T) => unknown): number {
  let n = 0
  for (const x of arr) n += +!!pred(x)
  return n
}

type Props = {
  filePath: string;
  structuredPatch: StructuredPatchHunk[];
  style?: 'condensed';
  verbose: boolean;
  previewHint?: string;
  originalFile?: string;
};

const MAX_COLLAPSED_DIFF_LINES = 8;

export function FileEditToolUpdatedMessage({
  filePath,
  structuredPatch,
  style,
  verbose,
  previewHint,
  originalFile,
}: Props): React.ReactNode {
  const { columns } = useWindowSize();
  const numAdditions = structuredPatch.reduce((acc, hunk) => acc + count(hunk.lines, _ => _.startsWith('+')), 0);
  const numRemovals = structuredPatch.reduce((acc, hunk) => acc + count(hunk.lines, _ => _.startsWith('-')), 0);
  // This message is often rendered inside prefixed containers (tree bullets,
  // permission flow rows, etc.). Using near-full terminal width can overflow
  // those containers and smear border glyphs across nearby UI.
  const diffWidth = Math.max(20, columns - 8);
  const firstLine = originalFile ? firstLineOf(originalFile) : null;
  const { hunks, omitted } = verbose
    ? { hunks: structuredPatch, omitted: 0 }
    : truncatePatchLines(structuredPatch, MAX_COLLAPSED_DIFF_LINES);

  const text = (
    <Text>
      {numAdditions > 0 ? (
        <>
          Added <Text bold>{numAdditions}</Text> {numAdditions > 1 ? 'lines' : 'line'}
        </>
      ) : null}
      {numAdditions > 0 && numRemovals > 0 ? ', ' : null}
      {numRemovals > 0 ? (
        <>
          {numAdditions === 0 ? 'R' : 'r'}emoved <Text bold>{numRemovals}</Text> {numRemovals > 1 ? 'lines' : 'line'}
        </>
      ) : null}
    </Text>
  );

  // Plan files: invert condensed behavior
  // - Regular mode: just show the hint (user can type /plan to see full content)
  // - Condensed mode (subagent view): show the text
  if (previewHint) {
    if (style !== 'condensed' && !verbose) {
      return (
        <Text dimColor>── {previewHint}</Text>
      );
    }
  } else if (style === 'condensed' && !verbose) {
    return text;
  }

  return (
    <Box flexDirection="column">
      <Text dimColor>── {text}</Text>
      {hunks.length > 0 ? (
        <StructuredDiffList
          hunks={hunks}
          dim={false}
          width={diffWidth}
          filePath={filePath}
          firstLine={firstLine}
          fileContent={originalFile}
        />
      ) : null}
      {omitted > 0 ? (
        <Text color="ansi:blackBright">
          ... +{omitted} more patch {omitted === 1 ? 'line' : 'lines'}
        </Text>
      ) : null}
    </Box>
  );
}

function truncatePatchLines(
  hunks: readonly StructuredPatchHunk[],
  maxLines: number,
): { hunks: StructuredPatchHunk[]; omitted: number } {
  let remaining = maxLines;
  let omitted = 0;
  const result: StructuredPatchHunk[] = [];

  for (const hunk of hunks) {
    if (remaining <= 0) {
      omitted += hunk.lines.length;
      continue;
    }

    if (hunk.lines.length <= remaining) {
      result.push(hunk);
      remaining -= hunk.lines.length;
      continue;
    }

    result.push({
      ...hunk,
      lines: hunk.lines.slice(0, remaining),
    });
    omitted += hunk.lines.length - remaining;
    remaining = 0;
  }

  return { hunks: result, omitted };
}
