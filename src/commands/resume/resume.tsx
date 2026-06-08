import chalk from 'chalk';
import type { UUID } from 'crypto';
import figures from 'figures';
import * as React from 'react';
import { getOriginalCwd, getSessionId } from '../../bootstrap/state.js';
import { LogSelector } from '../../components/LogSelector.js';
import { MessageResponse } from '../../components/MessageResponse.js';
import { Box, Text, useWindowSize } from '../../ink.js';
import type {
	CommandResultDisplay,
	LocalJSXCommandCall,
	ResumeEntrypoint,
} from '../../types/command.js';
import type { LogOption } from '../../types/logs.js';
import { formatLogMetadata } from '../../utils/format.js';
import { getLogDisplayTitle } from '../../utils/logger.js';
import { logError } from '../../utils/log.js';
import { validateUuid } from '../../utils/sessionStoragePortable.js';
import {
	getLastSessionLog,
	getSessionIdFromLog,
	isLiteLog,
	loadAllProjectsMessageLogs,
	loadFullLog,
	loadSameRepoMessageLogs,
} from '../../utils/sessionStorage.js';

type ResumeResult =
	| { resultType: 'sessionNotFound'; arg: string }
	| { resultType: 'multipleMatches'; arg: string; count: number };

function resumeHelpMessage(result: ResumeResult): string {
	switch (result.resultType) {
		case 'sessionNotFound':
			return `Session ${chalk.bold(result.arg)} was not found.`;
		case 'multipleMatches':
			return `Found ${result.count} sessions matching ${chalk.bold(result.arg)}. Please use /resume to pick a specific session.`;
	}
}

function ResumeError({
	message,
	args,
	onDone,
}: {
	message: string;
	args: string;
	onDone: () => void;
}): React.ReactNode {
	React.useEffect(() => {
		const timer = setTimeout(onDone, 0);
		return () => clearTimeout(timer);
	}, [onDone]);

	return (
		<Box flexDirection="column">
			<Text dimColor>
				{figures.pointer} /resume {args}
			</Text>
			<MessageResponse>
				<Text>{message}</Text>
			</MessageResponse>
		</Box>
	);
}

function ResumePicker({
	initialLogs,
	onDone,
	onResume,
}: {
	initialLogs: LogOption[];
	onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void;
	onResume: (
		sessionId: UUID,
		log: LogOption,
		entrypoint: ResumeEntrypoint
	) => Promise<void>;
}): React.ReactNode {
	const { rows } = useWindowSize();
	const [logs, setLogs] = React.useState(initialLogs);
	const [showAllProjects, setShowAllProjects] = React.useState(false);

	const reloadLogs = React.useCallback(async (allProjects: boolean) => {
		const nextLogs = allProjects
			? await loadAllProjectsMessageLogs()
			: await loadSameRepoMessageLogs([getOriginalCwd()]);
		return filterResumableSessions(nextLogs, getSessionId());
	}, []);

	const handleToggleAllProjects = React.useCallback(() => {
		const nextShowAllProjects = !showAllProjects;
		setShowAllProjects(nextShowAllProjects);
		void reloadLogs(nextShowAllProjects)
			.then(nextLogs => {
				if (nextLogs.length === 0) {
					onDone('No conversations found to resume');
					return;
				}
				setLogs(nextLogs);
			})
			.catch(error => {
				logError(error);
				onDone('Failed to load conversations');
			});
	}, [onDone, reloadLogs, showAllProjects]);

	const handleSelect = React.useCallback(
		async (log: LogOption) => {
			const sessionId = validateUuid(getSessionIdFromLog(log));
			if (!sessionId) {
				onDone('Failed to resume conversation');
				return;
			}

			try {
				const fullLog = isLiteLog(log) ? await loadFullLog(log) : log;
				await onResume(sessionId, fullLog, 'slash_command_picker');
			} catch (error) {
				logError(error as Error);
				onDone(`Failed to resume: ${(error as Error).message}`);
			}
		},
		[onDone, onResume]
	);

	return (
		<LogSelector
			logs={logs}
			maxHeight={rows - 2}
			onCancel={() => onDone('Resume cancelled', { display: 'system' })}
			onSelect={log => {
				void handleSelect(log);
			}}
			showAllProjects={showAllProjects}
			onToggleAllProjects={handleToggleAllProjects}
		/>
	);
}

export function filterResumableSessions(
	logs: LogOption[],
	currentSessionId: string
): LogOption[] {
	return logs.filter(
		log => !log.isSidechain && getSessionIdFromLog(log) !== currentSessionId
	);
}

function findMatchingLogs(logs: LogOption[], arg: string): LogOption[] {
	const query = arg.toLowerCase();
	return logs.filter(log => {
		const sessionId = getSessionIdFromLog(log)?.toLowerCase() ?? '';
		const title = getLogDisplayTitle(log).toLowerCase();
		const metadata = formatLogMetadata(log).toLowerCase();
		return (
			sessionId.startsWith(query) ||
			title.includes(query) ||
			metadata.includes(query)
		);
	});
}

async function loadFullLogIfNeeded(log: LogOption): Promise<LogOption> {
	return isLiteLog(log) ? await loadFullLog(log) : log;
}

export const call: LocalJSXCommandCall = async (onDone, context, args) => {
	const onResume = async (
		sessionId: UUID,
		log: LogOption,
		entrypoint: ResumeEntrypoint
	) => {
		try {
			await context.resume?.(sessionId, log, entrypoint);
			onDone(undefined, { display: 'skip' });
		} catch (error) {
			logError(error as Error);
			onDone(`Failed to resume: ${(error as Error).message}`);
		}
	};

	const arg = args?.trim();

	if (!arg) {
		try {
			const logs = filterResumableSessions(
				await loadSameRepoMessageLogs([getOriginalCwd()]),
				getSessionId()
			);
			if (logs.length === 0) {
				onDone('No conversations found to resume');
				return null;
			}
			return (
				<ResumePicker
					initialLogs={logs}
					onDone={onDone}
					onResume={onResume}
				/>
			);
		} catch (error) {
			logError(error as Error);
			onDone('Failed to load conversations');
			return null;
		}
	}

	const sameRepoLogs = filterResumableSessions(
		await loadSameRepoMessageLogs([getOriginalCwd()]),
		getSessionId()
	);
	if (sameRepoLogs.length === 0) {
		const message = 'No conversations found to resume.';
		return <ResumeError message={message} args={arg} onDone={() => onDone(message)} />;
	}

	const maybeSessionId = validateUuid(arg);
	if (maybeSessionId) {
		const exactLog = sameRepoLogs
			.filter(log => getSessionIdFromLog(log) === maybeSessionId)
			.sort((a, b) => b.modified.getTime() - a.modified.getTime())[0];
		if (exactLog) {
			const fullLog = await loadFullLogIfNeeded(exactLog);
			void onResume(maybeSessionId, fullLog, 'slash_command_session_id');
			return null;
		}

		const directLog = await getLastSessionLog(maybeSessionId);
		if (directLog) {
			const fullLog = await loadFullLogIfNeeded(directLog);
			void onResume(maybeSessionId, fullLog, 'slash_command_session_id');
			return null;
		}
	}

	const matches = findMatchingLogs(sameRepoLogs, arg);
	if (matches.length === 1) {
		const log = matches[0]!;
		const sessionId = getSessionIdFromLog(log);
		if (sessionId) {
			const fullLog = await loadFullLogIfNeeded(log);
			void onResume(sessionId, fullLog, 'slash_command_title');
			return null;
		}
	}

	if (matches.length > 1) {
		const message = resumeHelpMessage({
			resultType: 'multipleMatches',
			arg,
			count: matches.length,
		});
		return <ResumeError message={message} args={arg} onDone={() => onDone(message)} />;
	}

	const message = resumeHelpMessage({ resultType: 'sessionNotFound', arg });
	return <ResumeError message={message} args={arg} onDone={() => onDone(message)} />;
};
