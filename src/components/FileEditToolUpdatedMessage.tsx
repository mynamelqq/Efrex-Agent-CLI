import * as React from 'react';
import type { StructuredPatchHunk } from 'diff';
import { Box, Text } from '@anthropic/ink';
import { MessageResponse } from './MessageResponse.js';
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
        <MessageResponse>
          <Text dimColor>{previewHint}</Text>
        </MessageResponse>
      );
    }
  } else if (style === 'condensed' && !verbose) {
    return text;
  }

  return (
    <MessageResponse>
      <Box flexDirection="column">
        {text}
        {structuredPatch.length > 0 ? (
          <StructuredDiffList
            hunks={structuredPatch}
            dim={false}
            width={diffWidth}
            filePath={filePath}
            firstLine={firstLine}
            fileContent={originalFile}
          />
        ) : null}
      </Box>
    </MessageResponse>
  );
}
