import React from 'react';
import { Box, Text } from '../ink.js';
import { useAnimationFrame } from '../ink/hooks/use-animation-frame.js';
import { formatDuration, formatNumber } from '../utils/format.js';

type Props = {
	prefix: string;
	prefixDim: boolean;
	prefixBold: boolean;
	before: string;
	shimmer: string;
	after: string;
	startedAtMs: number | null;
	toolCount?: number;
};

export function StatusAnimationRow({
	prefix,
	prefixDim,
	prefixBold,
	before,
	shimmer,
	after,
	startedAtMs,
	toolCount
}: Props): React.ReactNode {
	const [viewportRef] = useAnimationFrame(startedAtMs === null ? null : 50);
	const elapsedMs =
		startedAtMs === null ? 0 : Math.max(0, Date.now() - startedAtMs);
	const elapsedText = formatDuration(elapsedMs, { hideTrailingZeros: true });
	const toolCountText =
		toolCount && toolCount > 0
			? `${formatNumber(toolCount)} ${toolCount === 1 ? 'tool' : 'tools'}`
			: null;

	return (
		<Box
			ref={viewportRef}
			flexDirection="row"
			flexWrap="wrap"
			flexShrink={0}
			marginTop={1}
			width="100%"
		>
			<Box flexShrink={0} width={3}>
				<Text color="yellowBright" dim={prefixDim} bold={prefixBold}>
					{prefix}{' '}
				</Text>
			</Box>
			<Box flexDirection="row" flexWrap="nowrap" flexShrink={1}>
				<Text color="gray">{before}</Text>
				{shimmer ? (
					<Text color="cyanBright" bold>
						{shimmer}
					</Text>
				) : null}
				<Text color="gray">{after}</Text>
				<Text dimColor>
					{` (${elapsedText}${toolCountText ? ` · ${toolCountText}` : ''})`}
				</Text>
			</Box>
		</Box>
	);
}

export default StatusAnimationRow;
