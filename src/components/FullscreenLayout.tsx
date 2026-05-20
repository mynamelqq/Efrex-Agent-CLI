import React, {
	type ReactNode,
	type RefObject,
	useCallback,
	useSyncExternalStore
} from 'react';
import chalk from 'chalk';
import { Box, Text } from '../ink.js';
import type { ScrollBoxHandle } from '../ink/components/ScrollBox.js';
import ScrollBox from '../ink/components/ScrollBox.js';

type Props = {
	scrollable: ReactNode;
	bottom: ReactNode;
	scrollRef?: RefObject<ScrollBoxHandle | null>;
};

function getScrollSnapshotKey(
	scrollRef?: RefObject<ScrollBoxHandle | null>
): string {
	const handle = scrollRef?.current;
	return `${handle?.getScrollTop() ?? 0}:${handle?.getScrollHeight() ?? 0}:${handle?.getViewportHeight() ?? 0}`;
}

function useScrollSnapshot(scrollRef?: RefObject<ScrollBoxHandle | null>): void {
	const subscribe = useCallback(
		(listener: () => void) =>
			scrollRef?.current?.subscribe(listener) ?? (() => {}),
		[scrollRef]
	);
	const getSnapshot = useCallback(
		() => getScrollSnapshotKey(scrollRef),
		[scrollRef]
	);
	useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function buildScrollbarLines(
	scrollRef?: RefObject<ScrollBoxHandle | null>
): string[] {
	const handle = scrollRef?.current;
	const scrollTop = handle?.getScrollTop() ?? 0;
	const scrollHeight = handle?.getScrollHeight() ?? 0;
	const viewportHeight = handle?.getViewportHeight() ?? 0;
	const rows = Math.max(0, viewportHeight);

	if (rows === 0) {
		return [];
	}

	if (scrollHeight <= viewportHeight || viewportHeight <= 0) {
		return Array.from({ length: rows }, () => ' ');
	}

	const thumbHeight = Math.max(
		1,
		Math.min(rows, Math.round((viewportHeight / scrollHeight) * rows))
	);
	const maxScroll = Math.max(1, scrollHeight - viewportHeight);
	const maxThumbTop = Math.max(0, rows - thumbHeight);
	const thumbTop = Math.round((scrollTop / maxScroll) * maxThumbTop);

	return Array.from({ length: rows }, (_, index) =>
		index >= thumbTop && index < thumbTop + thumbHeight
			? chalk.white('█')
			: chalk.gray('│')
	);
}

function Scrollbar({
	scrollRef
}: {
	scrollRef?: RefObject<ScrollBoxHandle | null>;
}): React.ReactNode {
	useScrollSnapshot(scrollRef);
	const lines = buildScrollbarLines(scrollRef);

	return (
		<Box flexDirection="column" flexShrink={0} width={1} height="100%">
			{lines.map((line, index) => (
				<Text key={index}>{line || ' '}</Text>
			))}
		</Box>
	);
}

export function FullscreenLayout({
	scrollable,
	bottom,
	scrollRef
}: Props): React.ReactNode {
	return (
		<Box flexDirection="row" height="100%" width="100%" overflow="hidden">
			<Box flexDirection="column" flexGrow={1} overflow="hidden">
				<ScrollBox
					ref={scrollRef}
					flexGrow={1}
					flexDirection="column"
					paddingTop={1}
					stickyScroll
				>
					{scrollable}
					{bottom}
				</ScrollBox>
			</Box>
			<Scrollbar scrollRef={scrollRef} />
		</Box>
	);
}

export default FullscreenLayout;
