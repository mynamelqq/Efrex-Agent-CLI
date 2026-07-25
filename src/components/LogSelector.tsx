import figures from 'figures';
import * as React from 'react';
import { Box, Text, useInput, useWindowSize } from '../ink.js';
import { stringWidth } from '../ink/stringWidth.js';
import type { LogOption } from '../types/logs.js';
import { formatLogMetadata } from '../utils/format.js';
import { getLogDisplayTitle } from '../utils/log.js';
import { truncateToWidth } from '../utils/truncate.js';

const CARD_BORDER_COLOR = '#8758d8';
const CARD_ACCENT_COLOR = '#bd7cff';
const SESSION_TITLE_COLOR = '#c4cad3';
const SESSION_METADATA_COLOR = '#7f8999';
const MAX_VISIBLE_SESSIONS = 5;

export type LogSelectorProps = {
	logs: LogOption[];
	maxHeight?: number;
	onCancel?: () => void;
	onSelect: (log: LogOption) => void;
	showAllProjects?: boolean;
	onToggleAllProjects?: () => void;
};

export function LogSelector({
	logs,
	maxHeight = Infinity,
	onCancel,
	onSelect,
	showAllProjects = false,
	onToggleAllProjects,
}: LogSelectorProps): React.ReactNode {
	const { columns } = useWindowSize();
	const [selectedIndex, setSelectedIndex] = React.useState(0);

	React.useEffect(() => {
		setSelectedIndex(index =>
			logs.length === 0 ? 0 : Math.min(index, logs.length - 1)
		);
	}, [logs]);

	// The card stays at a stable height while its contents change. This lets Ink
	// update the selector in place instead of leaving old rows in scrollback.
	const reservedRows = 7;
	const cardHeight = Math.min(maxHeight, reservedRows + MAX_VISIBLE_SESSIONS);
	const visibleCount = Math.max(
		1,
		Math.min(
			logs.length,
			MAX_VISIBLE_SESSIONS,
			Math.floor(cardHeight - reservedRows)
		)
	);
	const windowStart = Math.max(
		0,
		Math.min(
			selectedIndex - Math.floor(visibleCount / 2),
			Math.max(0, logs.length - visibleCount)
		)
	);
	const visibleLogs = logs.slice(windowStart, windowStart + visibleCount);
	const selectedLog = logs[selectedIndex];
	const contentWidth = Math.max(20, columns - 6);

	useInput((input, key) => {
		if (key.upArrow) {
			if (logs.length === 0) {
				return;
			}
			setSelectedIndex(index => (index <= 0 ? logs.length - 1 : index - 1));
			return;
		}

		if (key.downArrow || key.tab) {
			if (logs.length === 0) {
				return;
			}
			setSelectedIndex(index => (index >= logs.length - 1 ? 0 : index + 1));
			return;
		}

		if (key.return && selectedLog) {
			onSelect(selectedLog);
			return;
		}

		if (key.escape || (key.ctrl && input === 'c')) {
			onCancel?.();
			return;
		}

		if (onToggleAllProjects && key.ctrl && input.toLowerCase() === 'a') {
			onToggleAllProjects();
		}
	});

	return (
		<Box
			borderColor={CARD_BORDER_COLOR}
			borderStyle="round"
			flexDirection="column"
			height={cardHeight}
			paddingX={2}
			paddingY={1}
			width="100%"
		>
			<Box flexShrink={0}>
				<Text bold color={CARD_ACCENT_COLOR}>
					◷  Recent Sessions
					{logs.length > visibleCount ? (
						<Text color={SESSION_METADATA_COLOR}>
							{' '}
							({selectedIndex + 1} of {logs.length})
						</Text>
					) : null}
				</Text>
			</Box>

			<Box flexShrink={0}>
				<Text> </Text>
			</Box>

			<Box flexDirection="column" flexShrink={0}>
				{visibleLogs.map((log, index) => {
					const absoluteIndex = windowStart + index;
					const isSelected = absoluteIndex === selectedIndex;

					return (
						<SessionRow
							key={`${log.sessionId ?? log.fullPath ?? absoluteIndex}`}
							title={getLogDisplayTitle(log)}
							metadata={formatLogMetadata(log)}
							isSelected={isSelected}
							width={contentWidth}
						/>
					);
				})}
			</Box>

			<Box flexGrow={1} />

			<Box flexShrink={0}>
				<Text color={SESSION_METADATA_COLOR}>
					<Text color={CARD_ACCENT_COLOR}>↑/↓</Text> navigate ·{' '}
					<Text color={CARD_ACCENT_COLOR}>Enter</Text> resume
					{onToggleAllProjects
						? ` · Ctrl+A ${
								showAllProjects ? 'current project' : 'all projects'
							}`
						: ''}
					{' · Esc cancel'}
				</Text>
			</Box>
		</Box>
	);
}

function SessionRow({
	title,
	metadata,
	isSelected,
	width,
}: {
	title: string;
	metadata: string;
	isSelected: boolean;
	width: number;
}): React.ReactNode {
	const marker = isSelected ? figures.pointer : '•';
	const metadataWidth = Math.min(
		Math.max(8, Math.floor(width * 0.4)),
		stringWidth(metadata)
	);
	const titleWidth = Math.max(1, width - metadataWidth - 4);

	return (
		<Box flexShrink={0} justifyContent="space-between" width={width}>
			<Text
				bold={isSelected}
				color={isSelected ? CARD_ACCENT_COLOR : SESSION_TITLE_COLOR}
			>
				<Text color={CARD_ACCENT_COLOR}>{marker}</Text>{'  '}
				{truncateToWidth(title, titleWidth)}
			</Text>
			<Text color={SESSION_METADATA_COLOR}>
				{truncateToWidth(metadata, metadataWidth)}
			</Text>
		</Box>
	);
}
