import figures from 'figures';
import * as React from 'react';
import { Box, Text, useInput, useWindowSize } from '../ink.js';
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

	const visibleCount = Math.max(
		1,
		Math.min(logs.length, Math.floor((maxHeight - 5) / 2) || logs.length)
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
	const titleWidth = Math.max(20, columns - 6);

	useInput((input, key) => {
		if (key.upArrow) {
			setSelectedIndex(index => (index <= 0 ? logs.length - 1 : index - 1));
			return;
		}

		if (key.downArrow || key.tab) {
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
		<Box paddingX={1} flexDirection="column" marginTop={1}>
			<Text bold color="cyanBright">
				Resume Session
				{logs.length > visibleCount ? (
					<Text dimColor>
						{' '}
						({selectedIndex + 1}/{logs.length})
					</Text>
				) : null}
			</Text>
			<Text dimColor>
				↑/↓ 选择，Enter 恢复，Esc 取消
				{onToggleAllProjects
					? `，Ctrl+A ${showAllProjects ? '仅当前项目' : '全部项目'}`
					: ''}
			</Text>
			<Box flexDirection="column" marginTop={1}>
				{visibleLogs.map((log, index) => {
					const absoluteIndex = windowStart + index;
					const isSelected = absoluteIndex === selectedIndex;
					const title = truncateToWidth(
						getLogDisplayTitle(log),
						titleWidth
					);

					return (
						<Box key={`${log.sessionId ?? log.fullPath ?? absoluteIndex}`} flexDirection="column">
							<Box>
								<Text color={isSelected ? 'cyanBright' : 'gray'}>
									{isSelected ? `${figures.pointer} ` : '  '}
								</Text>
								<Text bold={isSelected} color={isSelected ? 'cyanBright' : undefined}>
									{title}
								</Text>
							</Box>
							<Text dimColor>{formatLogMetadata(log)}</Text>
						</Box>
					);
				})}
			</Box>
		</Box>
	);
}
