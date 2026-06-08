import React from 'react';
import { Box, Text } from '../ink.js';
import type { ScrollBoxHandle } from '../ink/components/ScrollBox.js';
import type { ViewportMessage } from './MessageViewport.js';
import { InVirtualListContext } from './messageActions.js';
import { useVirtualScroll } from '../hooks/useVirtualScroll.js';
import { OffscreenFreeze } from './OffscreenFreeze.js';
import { stringWidth } from '../ink/stringWidth.js';
import chalk from 'chalk';
import MarkdownText from './MarkdownText.js';

type Props = {
	messages: ViewportMessage[];
	width: number;
	scrollRef: React.RefObject<ScrollBoxHandle | null>;
	blinkOn?: boolean;
};

const USER_MESSAGE_BG = '#2e2f30';
const USER_MESSAGE_FG = '#f0f0ea';
const ASSISTANT_BRAND = '#23d3b6';

export default React.memo(function VirtualViewportMessageList({
	messages,
	width,
	scrollRef,
	blinkOn = false
}: Props): React.ReactNode {
	const itemKeys = React.useMemo(
		() => messages.map((message, index) => `${message.id}-${index}`),
		[messages]
	);
	const { range, topSpacer, bottomSpacer, measureRef, spacerRef } =
		useVirtualScroll(scrollRef, itemKeys, width);
	const [start, end] = range;

	return (
		<InVirtualListContext.Provider value={true}>
			<Box flexDirection="column" flexShrink={0} width="100%">
				<Box ref={spacerRef} flexDirection="column" flexShrink={0} height={topSpacer} />
				{messages.slice(start, end).map((message, offset) => {
					const index = start + offset;
					const previous = messages[index - 1];
					return (
						<Box
							key={itemKeys[index]}
							ref={measureRef(itemKeys[index]!)}
							flexDirection="column"
							width="100%"
						>
							{shouldInsertSpacer(previous, message) ? <Text>{' '}</Text> : null}
							<OffscreenFreeze>
								<Box flexDirection="column" width="100%">
									{renderMessageRow(message, width, blinkOn)}
								</Box>
							</OffscreenFreeze>
						</Box>
					);
				})}
				<Box flexDirection="column" flexShrink={0} height={bottomSpacer} />
			</Box>
		</InVirtualListContext.Provider>
	);
});

function shouldInsertSpacer(
	previousMessage: ViewportMessage | undefined,
	currentMessage: ViewportMessage
): boolean {
	if (!previousMessage) {
		return false;
	}

	if (
		currentMessage.role === 'tool' &&
		currentMessage.toolDisplayStyle &&
		currentMessage.toolDisplayStyle !== 'use'
	) {
		return false;
	}

	return previousMessage.role !== 'meta';
}

function renderMessageRow(
	message: ViewportMessage,
	width: number,
	blinkOn: boolean
): React.ReactNode {
	if (
		message.role === 'assistant' &&
		message.text.trim() === 'Conversation compacted'
	) {
		return (
			<Box marginY={1}>
				<Text dimColor>✻ Conversation compacted (Ctrl+O for history)</Text>
			</Box>
		);
	}

	if (message.role === 'meta') {
		if (message.content) {
			return message.content;
		}

		return (
			<Text color="gray" dimColor wrap="truncate-end">
				{message.text ? padMetaLine(message.text, width) : ' '}
			</Text>
		);
	}

	if (message.role === 'user') {
		return (
			<Box flexDirection="row" width={width}>
				<Box backgroundColor={USER_MESSAGE_BG} flexShrink={0} width={2}>
					<Text color={USER_MESSAGE_FG}>{'> '}</Text>
				</Box>
				<Box
					backgroundColor={USER_MESSAGE_BG}
					flexDirection="column"
					flexGrow={1}
					flexShrink={1}
					width={Math.max(1, width - 2)}
				>
					{message.content ? (
						message.content
					) : (
						<MarkdownText text={message.text} width={Math.max(1, width - 2)} />
					)}
				</Box>
			</Box>
		);
	}

	if (message.role === 'assistant') {
		const prefix =
			message.animatePrefix === 'blink'
				? blinkOn
					? '✦  '
					: '   '
				: '✦  ';

		return (
			<Box flexDirection="row" flexWrap="nowrap" width={width}>
				<Box flexShrink={0} width={3}>
					<Text bold color={ASSISTANT_BRAND}>
						{prefix}
					</Text>
				</Box>
				<Box
					flexDirection="column"
					flexGrow={1}
					flexShrink={1}
					width={Math.max(1, width - 3)}
				>
					{message.content ? (
						message.content
					) : (
						<MarkdownText text={message.text || ' '} width={Math.max(8, width - 3)} />
					)}
				</Box>
			</Box>
		);
	}

	const { toolPrefix, prefixColor } = getToolPrefix(message, blinkOn);
	return (
		<Box flexDirection="row" flexWrap="nowrap" width={width}>
			<Box flexShrink={0} width={3}>
				<Text color={prefixColor}>{toolPrefix}</Text>
			</Box>
			<Box
				flexDirection="column"
				flexGrow={1}
				flexShrink={1}
				width={Math.max(1, width - 3)}
			>
				{message.content ? (
					message.content
				) : (
					<MarkdownText text={message.text || ' '} width={Math.max(8, width - 3)} />
				)}
			</Box>
		</Box>
	);
}

function padMetaLine(text: string, width: number): string {
	const safeWidth = Math.max(1, width);
	const visibleText = truncatePlain(text, safeWidth);
	const padding = Math.max(0, safeWidth - stringWidth(visibleText));
	return `${' '.repeat(padding)}${visibleText}`;
}

function truncatePlain(text: string, width: number): string {
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

function getToolPrefix(
	message: ViewportMessage,
	blinkOn: boolean
): { toolPrefix: string; prefixColor: 'redBright' | 'cyanBright' | 'gray' } {
	const prefixColor =
		message.toolDisplayStyle === 'use'
			? message.toolPhase === 'error'
				? 'redBright'
				: 'cyanBright'
			: 'gray';

	if (message.toolDisplayStyle === 'use') {
		if (message.toolPhase === 'call' && message.animatePrefix === 'blink') {
			return {
				toolPrefix: blinkOn ? chalk.cyanBright('•  ') : '   ',
				prefixColor
			};
		}

		return {
			toolPrefix:
				message.toolPhase === 'error'
					? chalk.redBright('●  ')
					: chalk.cyanBright('●  '),
			prefixColor
		};
	}

	return {
		toolPrefix: chalk.gray('↳  '),
		prefixColor
	};
}
