import React from 'react';
import { Box, Text } from '../ink.js';
import { OffscreenFreeze } from './OffscreenFreeze.js';

type Props = {
	lines?: string[];
};

function MessageHeader({ lines }: Props): React.ReactNode {
	if (!lines?.length) {
		return null;
	}

	return (
		<OffscreenFreeze>
			<Box flexDirection="column" flexShrink={0} width="100%">
				{lines.map((line, index) => (
					<Text key={`header-${index}`} wrap="truncate-end">
						{line || ' '}
					</Text>
				))}
			</Box>
		</OffscreenFreeze>
	);
}

function areHeaderLinesEqual(previous: Props, next: Props): boolean {
	if (previous.lines === next.lines) {
		return true;
	}

	if (previous.lines?.length !== next.lines?.length) {
		return false;
	}

	return previous.lines?.every((line, index) => line === next.lines?.[index]) ?? true;
}

// Content-based comparison for chalk strings that may differ by reference
// but have identical ANSI output. Used as a fallback when reference equality
// fails — chalk creates new string objects on each call even with the same
// input, which defeats React.memo's default === check.
function areHeaderLinesContentEqual(previous: Props, next: Props): boolean {
	if (previous.lines === next.lines) {
		return true;
	}

	if (previous.lines?.length !== next.lines?.length) {
		return false;
	}

	return previous.lines?.every((line, index) => line === next.lines?.[index]) ?? true;
}

export default React.memo(MessageHeader, areHeaderLinesEqual);
