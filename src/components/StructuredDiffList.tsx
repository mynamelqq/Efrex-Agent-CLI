import type { StructuredPatchHunk } from 'diff';
import * as React from 'react';
import { Box, NoSelect, Text } from '@anthropic/ink';
import { StructuredDiff } from './StructuredDiff.js';

type Props = {
	hunks: StructuredPatchHunk[];
	dim: boolean;
	width: number;
	filePath: string;
	firstLine: string | null;
	fileContent?: string;
};

export function StructuredDiffList({
	hunks,
	dim,
	width,
	filePath,
	firstLine,
	fileContent
}: Props): React.ReactNode {
	return buildSeparatedList(
		hunks.map(hunk => (
			<Box flexDirection="column" key={`${hunk.newStart}-${hunk.oldStart}`}>
				<StructuredDiff
					patch={hunk}
					dim={dim}
					width={width}
					filePath={filePath}
					firstLine={firstLine}
					fileContent={fileContent}
				/>
			</Box>
		)),
		i => (
			<NoSelect fromLeftEdge key={`ellipsis-${i}`}>
				<Text dimColor>...</Text>
			</NoSelect>
		)
	);
}

function buildSeparatedList(
	items: React.ReactNode[],
	separator: (index: number) => React.ReactNode
): React.ReactNode[] {
	const result: React.ReactNode[] = [];
	for (let index = 0; index < items.length; index++) {
		if (index > 0) {
			result.push(separator(index - 1));
		}
		result.push(items[index]);
	}
	return result;
}
