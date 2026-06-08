import React from 'react';
import { Box, Text } from '../ink.js';
import { useAnimationFrame } from '../ink/hooks/use-animation-frame.js';
import { stringWidth } from '../ink/stringWidth.js';
import { formatDuration, formatNumber } from '../utils/format.js';

type Props = {
	statusText: string;
	statusMode: 'requesting' | 'default' | null;
	startedAtMs: number | null;
	toolCount?: number;
};

const GLIMMER_PAD_COLUMNS = 10;
const GLIMMER_WIDTH_COLUMNS = 8;
const BREATHING_CYCLE = 24;

const statusSegmenter =
	typeof Intl !== 'undefined' && 'Segmenter' in Intl
		? new Intl.Segmenter('zh-Hans', { granularity: 'grapheme' })
		: null;

function splitGraphemes(text: string): string[] {
	if (statusSegmenter) {
		return Array.from(
			statusSegmenter.segment(text),
			segment => segment.segment
		);
	}
	return Array.from(text);
}

function getShimmerSegments(
	text: string,
	glimmerIndex: number
): { before: string; shimmer: string; after: string } {
	const graphemes = splitGraphemes(text);
	const shimmerStart = glimmerIndex;
	const shimmerEnd = glimmerIndex + GLIMMER_WIDTH_COLUMNS;

	let cursor = 0;
	const before: string[] = [];
	const shimmer: string[] = [];
	const after: string[] = [];

	for (const grapheme of graphemes) {
		const width = stringWidth(grapheme);
		const nextCursor = cursor + width;
		const intersects = nextCursor > shimmerStart && cursor < shimmerEnd;

		if (intersects) {
			shimmer.push(grapheme);
		} else if (nextCursor <= shimmerStart) {
			before.push(grapheme);
		} else {
			after.push(grapheme);
		}

		cursor = nextCursor;
	}

	return {
		before: before.join(''),
		shimmer: shimmer.join(''),
		after: after.join('')
	};
}

export function StatusAnimationRow({
	statusText,
	statusMode,
	startedAtMs,
	toolCount
}: Props): React.ReactNode {
	const [viewportRef, time] = useAnimationFrame(startedAtMs === null ? null : 50);

	// Breathing animation for the prefix dot
	const tick = Math.floor(time / 50);
	const breathingPhase = tick % BREATHING_CYCLE;
	const breathingStrength =
		breathingPhase <= BREATHING_CYCLE / 2
			? breathingPhase / (BREATHING_CYCLE / 2)
			: (BREATHING_CYCLE - breathingPhase) / (BREATHING_CYCLE / 2);
	const prefixDim = breathingStrength < 0.35;
	const prefixBold = breathingStrength > 0.7;

	// Glimmer/shimmer animation for the status text
	const statusMessageWidth = stringWidth(statusText);
	const glimmerSpeed = statusMode === 'requesting' ? 55 : 50;
	const elapsedMs = startedAtMs === null ? 0 : Math.max(0, Date.now() - startedAtMs);
	const longRunning = elapsedMs >= 60_000;
	const veryLongRunning = elapsedMs >= 180_000;
	const accentColor = veryLongRunning
		? 'yellowBright'
		: longRunning
			? 'blueBright'
			: statusMode === 'requesting'
				? 'cyanBright'
				: 'greenBright';
	const textColor = statusMode === 'requesting' ? 'ansi:blueBright' : 'gray';
	const glimmerCycleLength = statusMessageWidth + GLIMMER_PAD_COLUMNS * 2;
	const cyclePosition =
		glimmerCycleLength > 0 ? Math.floor(elapsedMs / glimmerSpeed) : 0;
	const glimmerIndex =
		(cyclePosition % glimmerCycleLength) - GLIMMER_PAD_COLUMNS;
	const segments = getShimmerSegments(statusText, glimmerIndex);

	// Elapsed time display
	const elapsedText = formatDuration(elapsedMs, { hideTrailingZeros: true });
	const toolCountText =
		toolCount && toolCount > 0
			? `${formatNumber(toolCount)} ${toolCount === 1 ? 'tool' : 'tools'}`
			: null;

	return (
		<Box
			ref={viewportRef}
			flexDirection="row"
			flexWrap="nowrap"
			flexShrink={0}
			height={1}
			marginTop={1}
			width="100%"
			overflow="hidden"
		>
			<Box flexShrink={0} width={3}>
				<Text color={accentColor} dim={prefixDim} bold={prefixBold}>
					{'• '}
				</Text>
			</Box>
			<Box flexDirection="row" flexWrap="nowrap" flexGrow={1} flexShrink={0} overflow="hidden">
				<Text color={textColor}>{segments.before}</Text>
				{segments.shimmer ? (
					<Text color={accentColor} bold>
						{segments.shimmer}
					</Text>
				) : null}
				<Text color={textColor}>{segments.after}</Text>
				<Text color="ansi:blackBright">{' ('}</Text>
				<Text color={veryLongRunning ? 'yellowBright' : longRunning ? 'blueBright' : 'ansi:blackBright'}>
					{elapsedText}
				</Text>
				{toolCountText ? (
					<>
						<Text color="ansi:blackBright"> · </Text>
						<Text color="magentaBright">{toolCountText}</Text>
					</>
				) : null}
				<Text color="ansi:blackBright">{')'}</Text>
			</Box>
		</Box>
	);
}

export default StatusAnimationRow;
