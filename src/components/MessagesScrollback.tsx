import React from 'react';
import chalk from 'chalk';
import { Box, Text } from '../ink.js';
import { stringWidth } from '../ink/stringWidth.js';
import type { ViewportMessage } from './MessageViewport.js';
import MarkdownText from './MarkdownText.js';
import { OffscreenFreeze } from './OffscreenFreeze.js';

type Props = {
	headerLines?: string[];
	messages: ViewportMessage[];
	width: number;
	alertMessage?: string | null;
	blinkOn?: boolean;
};

const USER_MESSAGE_BG = '#2e2f30';
const USER_MESSAGE_FG = '#f0f0ea';
const ASSISTANT_BRAND = '#23d3b6';

export default function MessagesScrollback({
	headerLines,
	messages,
	width,
	alertMessage,
	blinkOn = false
}: Props) {
	return (
		<Box flexDirection="column" flexShrink={0} width="100%">
			{headerLines?.map((line, index) => (
				<OffscreenFreeze key={`header-${index}`}>
					<Text wrap="truncate-end">{line || ' '}</Text>
				</OffscreenFreeze>
			))}
			{alertMessage ? <Text color="redBright">错误: {alertMessage}</Text> : null}
			{messages.map((message, index) => (
				<OffscreenFreeze key={`${message.id}-${index}`}>
					<Box flexDirection="column" width="100%">
						{shouldInsertSpacer(messages[index - 1], message) ? <Text>{' '}</Text> : null}
						{renderMessageRow(message, width, blinkOn)}
					</Box>
				</OffscreenFreeze>
			))}
		</Box>
	);
}

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

	if (previousMessage.role === 'meta') {
		return false;
	}

	return true;
}

function renderMessageRow(
	message: ViewportMessage,
	width: number,
	blinkOn: boolean
): React.ReactNode {
	if (isCompactBoundaryViewportMessage(message)) {
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
					<MarkdownText text={message.text} width={Math.max(1, width - 2)} />
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

function isCompactBoundaryViewportMessage(message: ViewportMessage): boolean {
	return (
		message.role === 'assistant' &&
		message.text.trim() === 'Conversation compacted'
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
