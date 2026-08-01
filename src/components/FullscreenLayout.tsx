import React, {
	type ReactNode,
	type RefObject
} from 'react';
import { Box } from '../ink.js';
import type { ScrollBoxHandle } from '../ink/components/ScrollBox.js';
import ScrollBox from '../ink/components/ScrollBox.js';
import { isFullscreenEnvEnabled } from '../utils/fullscreen.js';

type Props = {
	top?: ReactNode;
	scrollable: ReactNode;
	bottom: ReactNode;
	overlay?: ReactNode;
	scrollRef?: RefObject<ScrollBoxHandle | null>;
	forceViewportLayout?: boolean;
};

export function FullscreenLayout({
	top,
	scrollable,
	bottom,
	overlay,
	scrollRef,
	forceViewportLayout = false
}: Props): React.ReactNode {
	if (!forceViewportLayout && !isFullscreenEnvEnabled()) {
		return (
			<>
				{top}
				{scrollable}
				{overlay}
				{bottom}
			</>
		);
	}

	return (
		<Box flexDirection="column" height="100%" width="100%" overflow="hidden">
			{top ? (
				<Box flexDirection="column" flexShrink={0} width="100%">
					{top}
				</Box>
			) : null}
			<Box
				flexDirection="row"
				flexGrow={1}
				flexShrink={1}
				overflow="hidden"
			>
				<Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
					<ScrollBox
						ref={scrollRef}
						flexGrow={1}
						flexShrink={1}
						flexDirection="column"
						paddingTop={1}
						stickyScroll
					>
						{scrollable}
						{overlay}
					</ScrollBox>
				</Box>
			</Box>
			<Box flexDirection="column" flexShrink={0}>
				{bottom}
			</Box>
		</Box>
	);
}

export default FullscreenLayout;
