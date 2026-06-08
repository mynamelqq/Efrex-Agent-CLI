import figures from 'figures';
import * as React from 'react';
import { Box, Text, useInput, useWindowSize } from '../ink.js';
import { stringWidth } from '../ink/stringWidth.js';
import type { LogOption } from '../types/logs.js';
import { formatLogMetadata } from '../utils/format.js';
import { getLogDisplayTitle } from '../utils/logger.js';
import { truncateToWidth } from '../utils/truncate.js';

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

	const reservedRows = logs.length > 0 ? 7 : 5;
	const visibleCount = Math.max(
		1,
		Math.min(
			logs.length,
			Math.floor((maxHeight - reservedRows) / 2) || logs.length
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
	const contentWidth = Math.max(32, columns - 4);
	const rowWidth = Math.max(20, contentWidth - 1);
	const dividerWidth = Math.max(1, Math.min(columns, 100));

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
		<Box flexDirection="column" height={maxHeight}>
			<Box flexShrink={0}>
				<Text color="ansi:blackBright">{'─'.repeat(dividerWidth)}</Text>
			</Box>
			<Box flexShrink={0}>
				<Text> </Text>
			</Box>

			<Box flexShrink={0}>
				<Text bold color="cyanBright">
					Resume Session
					{logs.length > visibleCount ? (
						<Text color="ansi:blackBright">
							{' '}
							({selectedIndex + 1} of {logs.length})
						</Text>
					) : null}
				</Text>
			</Box>

			<Box flexShrink={0} paddingLeft={2}>
				<Text color="ansi:blackBright">scope </Text>
				<Text color={showAllProjects ? 'yellowBright' : 'greenBright'}>
					{showAllProjects ? 'all projects' : 'current project'}
				</Text>
				<Text color="ansi:blackBright"> · </Text>
				<Text color="cyanBright">{logs.length}</Text>
				<Text color="ansi:blackBright">
					{' '}
					resumable {logs.length === 1 ? 'session' : 'sessions'}
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
							index={absoluteIndex}
							width={rowWidth}
						/>
					);
				})}
			</Box>

			{logs.length > visibleCount ? (
				<Box flexShrink={0} paddingLeft={2}>
					<Text color="ansi:blackBright">
						Showing {windowStart + 1}-{windowStart + visibleLogs.length}
					</Text>
				</Box>
			) : null}

			<Box paddingLeft={2} flexShrink={0}>
				<Text color="ansi:blackBright">
					<Text color="cyanBright">↑/↓</Text> navigate ·{' '}
					<Text color="greenBright">Enter</Text> resume
					{onToggleAllProjects
						? ` · Ctrl+A show ${
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
	index,
	width,
}: {
	title: string;
	metadata: string;
	isSelected: boolean;
	index: number;
	width: number;
}): React.ReactNode {
	const marker = isSelected ? figures.pointer : ' ';
	const number = String(index + 1);
	const numberPrefix = `${number}. `;
	const titleColor = isSelected ? 'cyanBright' : undefined;
	const metadataColor = isSelected ? 'ansi:cyan' : 'ansi:blackBright';
	const titlePrefixWidth = stringWidth(`${marker} ${numberPrefix}`);
	const titleWidth = Math.max(1, width - titlePrefixWidth);
	const metadataPrefixWidth = 4;
	const metadataWidth = Math.max(1, width - metadataPrefixWidth);
	const titleLine = padToWidth(
		`${marker} ${numberPrefix}${truncateToWidth(title, titleWidth)}`,
		width
	);
	const metadataLine = padToWidth(
		`${' '.repeat(metadataPrefixWidth)}${truncateToWidth(
			metadata,
			metadataWidth
		)}`,
		width
	);

	return (
		<Box flexDirection="column" paddingLeft={1} width={width + 1}>
			<Text bold={isSelected} color={titleColor}>
				{titleLine}
			</Text>
			<Text color={metadataColor}>{metadataLine}</Text>
		</Box>
	);
}

function padToWidth(text: string, width: number): string {
	const padding = Math.max(0, width - stringWidth(text));
	return padding === 0 ? text : `${text}${' '.repeat(padding)}`;
}
