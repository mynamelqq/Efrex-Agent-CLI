import React from 'react';
import { Box, Text } from '../ink.js';
import { stringWidth } from '../ink/stringWidth.js';
import { OffscreenFreeze } from './OffscreenFreeze.js';

type Props = {
	brand: string;
	version: string;
	cwd: string;
	model: string | null;
	effort: string;
	width: number;
};

const BRAND_COLOR = '#4da3ff';
const ACCENT_COLOR = '#23d3b6';
const BORDER_COLOR = '#2f6f89';
const DIVIDER_COLOR = '#2b9c8c';

function truncateDisplay(text: string, width: number): string {
	if (stringWidth(text) <= width) {
		return text;
	}

	let next = '';
	for (const char of Array.from(text)) {
		if (stringWidth(`${next}${char}…`) > width) {
			break;
		}
		next += char;
	}

	return `${next}…`;
}

function WelcomeHeader({
	brand,
	version,
	cwd,
	model,
	effort,
	width
}: Props): React.ReactNode {
	const boxWidth = Math.max(40, width);
	const innerWidth = Math.max(1, boxWidth - 2);
	const leftWidth = Math.max(28, Math.min(52, Math.floor(innerWidth * 0.42)));
	const rightWidth = Math.max(20, innerWidth - leftWidth - 1);
	const displayModel = truncateDisplay(model ?? '', 21);
	const displayCwd = truncateDisplay(cwd, leftWidth);

	return (
		<OffscreenFreeze>
			<Box flexDirection="column" flexShrink={0} width="100%">
				<Box flexDirection="row" width={boxWidth}>
					<Text bold color={ACCENT_COLOR}>
						»{' '}
					</Text>
					<Text bold color={BRAND_COLOR}>
						{brand}
					</Text>
					<Text color="gray"> {version}</Text>
					<Text color="gray">
						{' '}
						{'─'.repeat(
							Math.max(
								0,
								boxWidth - stringWidth(`» ${brand} ${version}`) - 2
							)
						)}
					</Text>
				</Box>
				<Box flexDirection="row" width={boxWidth}>
					<Text color={BORDER_COLOR}>╭{'─'.repeat(leftWidth)}</Text>
					<Text color={DIVIDER_COLOR}>┬{'─'.repeat(rightWidth)}╮</Text>
				</Box>
				<WelcomeRow
					left="efrex code"
					right="✦  Getting Started"
					leftWidth={leftWidth}
					rightWidth={rightWidth}
					leftColor={BRAND_COLOR}
					rightColor={ACCENT_COLOR}
					bold
				/>
				<WelcomeRow
					left="AI Coding Assistant"
					right="Ask anything, edit code, run commands."
					leftWidth={leftWidth}
					rightWidth={rightWidth}
				/>
				<WelcomeRow
					left="Power your ideas with code."
					right="Let efrex code handle the rest."
					leftWidth={leftWidth}
					rightWidth={rightWidth}
				/>
				<WelcomeRow
					left="╭ ────── ╮"
					right="✦  Tips"
					leftWidth={leftWidth}
					rightWidth={rightWidth}
					leftColor={BRAND_COLOR}
					rightColor={ACCENT_COLOR}
					boldRight
				/>
				<WelcomeRow
					left="│  •  •  │"
					right="→  Ask questions about your codebase"
					leftWidth={leftWidth}
					rightWidth={rightWidth}
					leftColor={BRAND_COLOR}
					highlightArrow
				/>
				<WelcomeRow
					left="╰─┬──┬─╯"
					right="→  Generate or refactor code"
					leftWidth={leftWidth}
					rightWidth={rightWidth}
					leftColor={BRAND_COLOR}
					highlightArrow
				/>
				<WelcomeRow
					left={`model: ${displayModel} | effort: ${effort}`}
					right="→  Run shell commands and analyze results"
					leftWidth={leftWidth}
					rightWidth={rightWidth}
					highlightArrow
				/>
				<WelcomeRow
					left={displayCwd}
					right=""
					leftWidth={leftWidth}
					rightWidth={rightWidth}
					leftColor={BRAND_COLOR}
					bold
				/>
				<Box flexDirection="row" width={boxWidth}>
					<Text color={BORDER_COLOR}>╰{'─'.repeat(leftWidth)}</Text>
					<Text color={DIVIDER_COLOR}>┴{'─'.repeat(rightWidth)}╯</Text>
				</Box>
				<Text> </Text>
			</Box>
		</OffscreenFreeze>
	);
}

function WelcomeRow({
	left,
	right,
	leftWidth,
	rightWidth,
	leftColor,
	rightColor,
	bold = false,
	boldRight = false,
	highlightArrow = false
}: {
	left: string;
	right: string;
	leftWidth: number;
	rightWidth: number;
	leftColor?: string;
	rightColor?: string;
	bold?: boolean;
	boldRight?: boolean;
	highlightArrow?: boolean;
}): React.ReactNode {
	const leftText = centerDisplay(truncateDisplay(left, leftWidth), leftWidth);
	const rightText = padDisplay(truncateDisplay(right, rightWidth), rightWidth);

	return (
		<Box flexDirection="row" width={leftWidth + rightWidth + 3}>
			<Text color={BORDER_COLOR}>│</Text>
			<Text color={leftColor ?? 'gray'} bold={bold}>
				{leftText}
			</Text>
			<Text color={DIVIDER_COLOR}>│</Text>
			{highlightArrow && rightText.startsWith('→') ? (
				<>
					<Text color={ACCENT_COLOR} bold>
						→
					</Text>
					<Text color="gray">{rightText.slice(1)}</Text>
				</>
			) : (
				<Text color={rightColor ?? 'gray'} bold={boldRight || bold}>
					{rightText}
				</Text>
			)}
			<Text color={DIVIDER_COLOR}>│</Text>
		</Box>
	);
}

function centerDisplay(text: string, width: number): string {
	const padding = Math.max(0, width - stringWidth(text));
	const left = Math.floor(padding / 2);
	const right = padding - left;
	return `${' '.repeat(left)}${text}${' '.repeat(right)}`;
}

function padDisplay(text: string, width: number): string {
	const padding = Math.max(0, width - stringWidth(text));
	return `${text}${' '.repeat(padding)}`;
}

export default React.memo(WelcomeHeader, (previous, next) => {
	return (
		previous.brand === next.brand &&
		previous.version === next.version &&
		previous.cwd === next.cwd &&
		previous.model === next.model &&
		previous.effort === next.effort &&
		previous.width === next.width
	);
});
