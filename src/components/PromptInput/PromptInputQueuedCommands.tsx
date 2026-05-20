import * as React from 'react';
import { Box, Text } from '../../ink.js';
import { useAppState } from '../../state/AppState.js';
import { STATUS_TAG, SUMMARY_TAG, TASK_NOTIFICATION_TAG } from '../../constants/xml.js';
import { QueuedMessageProvider } from '../../context/QueuedMessageContext.js';
import { useCommandQueue } from '../../hooks/useCommandQueue.js';
import type { QueuedCommand } from '../../types/textInputTypes.js';
import { isQueuedCommandVisible } from '../../utils/messageQueueManager.js';
import { createUserMessage } from '../../utils/messages.js';
import { extractTextContent } from '../../utils/messages.js';

const MAX_VISIBLE_NOTIFICATIONS = 3;
const USER_MESSAGE_BG = '#2e2f30';
const USER_MESSAGE_FG = '#f0f0ea';
const NOTIFICATION_BG = '#20262c';
const NOTIFICATION_FG = '#d7e3ef';
const SUMMARY_RE = new RegExp(
	`<${SUMMARY_TAG}>([\\s\\S]*?)</${SUMMARY_TAG}>`
);
const STATUS_RE = new RegExp(
	`<${STATUS_TAG}>([\\s\\S]*?)</${STATUS_TAG}>`
);

function isIdleNotification(value: string): boolean {
	try {
		const parsed = JSON.parse(value) as { type?: string };
		return parsed?.type === 'idle_notification';
	} catch {
		return false;
	}
}

function createOverflowNotificationText(count: number): string {
	return `<${TASK_NOTIFICATION_TAG}>
<${SUMMARY_TAG}>+${count} more tasks completed</${SUMMARY_TAG}>
<${STATUS_TAG}>completed</${STATUS_TAG}>
</${TASK_NOTIFICATION_TAG}>`;
}

function processQueuedCommands(
	queuedCommands: readonly QueuedCommand[]
): { commands: QueuedCommand[]; totalVisibleCount: number } {
	const visibleCommands = queuedCommands.filter(
		cmd => typeof cmd.value !== 'string' || !isIdleNotification(cmd.value)
	);
	const taskNotifications = visibleCommands.filter(
		cmd => cmd.mode === 'task-notification'
	);
	const otherCommands = visibleCommands.filter(
		cmd => cmd.mode !== 'task-notification'
	);

	if (taskNotifications.length <= MAX_VISIBLE_NOTIFICATIONS) {
		return {
			commands: [...otherCommands, ...taskNotifications],
			totalVisibleCount: visibleCommands.length
		};
	}

	const keptNotifications = taskNotifications.slice(
		0,
		MAX_VISIBLE_NOTIFICATIONS - 1
	);
	const overflowCount =
		taskNotifications.length - (MAX_VISIBLE_NOTIFICATIONS - 1);

	return {
		commands: [
			...otherCommands,
			...keptNotifications,
			{
				value: createOverflowNotificationText(overflowCount),
				mode: 'task-notification'
			}
		],
		totalVisibleCount: visibleCommands.length
	};
}

function truncateDisplay(text: string, width: number): string {
	if (text.length <= width) {
		return text;
	}

	return `${text.slice(0, Math.max(0, width - 1))}...`;
}

function parseTaskNotification(value: string): {
	summary: string;
	status: string;
} {
	const summary = value.match(SUMMARY_RE)?.[1]?.trim() ?? '任务通知';
	const status = value.match(STATUS_RE)?.[1]?.trim() ?? 'completed';
	return { summary, status };
}

type Props = {
	width: number;
};

type QueuedPreviewItem =
	| {
			kind: 'message';
			text: string;
	  }
	| {
			kind: 'notification';
			summary: string;
			status: string;
	  };

function PromptInputQueuedCommandsImpl({
	width
}: Props): React.ReactNode {
	const queuedCommands = useCommandQueue();
	const viewingAgentTaskId = useAppState(s => s.viewingAgentTaskId);

	const queueState = React.useMemo(() => {
		const visibleCommands = queuedCommands.filter(isQueuedCommandVisible);
		return processQueuedCommands(visibleCommands);
	}, [queuedCommands]);

	const previewItems = React.useMemo<QueuedPreviewItem[]>(() => {
		return queueState.commands.map(command => {
			if (
				command.mode === 'task-notification' &&
				typeof command.value === 'string'
			) {
				const parsed = parseTaskNotification(command.value);
				return {
					kind: 'notification',
					summary: parsed.summary,
					status: parsed.status
				};
			}

			const message = createUserMessage({
				content:
					command.mode === 'bash' &&
					typeof command.value === 'string'
						? `<bash-input>${command.value}</bash-input>`
						: command.value
			});
			const content = message.message.content;
			const text =
				typeof content === 'string'
					? content
					: extractTextContent(content, '\n');

			return {
				kind: 'message',
				text: text.trim()
			};
		});
	}, [queueState.commands]);

	if (viewingAgentTaskId || previewItems.length === 0) {
		return null;
	}

	return (
		<Box flexDirection="column">
			{previewItems.map((item, index) => (
				<QueuedMessageProvider
					key={`${item.kind}-${index}`}
					isFirst={index === 0}
				>
					{item.kind === 'notification' ? (
						<Box
							flexDirection="column"
							width={Math.max(12, width - 4)}
						>
							<Text
								color={NOTIFICATION_FG}
								backgroundColor={NOTIFICATION_BG}
								wrap="truncate-end"
							>
								{`↳ ${truncateDisplay(
									item.summary,
									Math.max(12, width - 10)
								)}`}
							</Text>
							<Text color="gray">{`status: ${item.status}`}</Text>
						</Box>
					) : (
						<Box
							flexDirection="column"
							width={Math.max(12, width - 4)}
						>
							<Text
								color={USER_MESSAGE_FG}
								backgroundColor={USER_MESSAGE_BG}
								wrap="truncate-end"
							>
								{`> ${truncateDisplay(
									item.text || '[empty command]',
									Math.max(12, width - 10)
								)}`}
							</Text>
						</Box>
					)}
				</QueuedMessageProvider>
			))}
		</Box>
	);
}

export const PromptInputQueuedCommands = React.memo(
	PromptInputQueuedCommandsImpl
);
