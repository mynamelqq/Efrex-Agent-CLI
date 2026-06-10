import type { AnyObject, Tool, ToolUseContext } from '../../Tool.js';
import type { AssistantMessage } from 'src/package/message.js';
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs';
import type { z } from 'zod/v4';
import type {
	PermissionDecision,
	PermissionUpdate
} from 'src/types/permissions.js';
import * as React from 'react';
import { basename } from 'path';
import { Box, Text, useInput, useWindowSize } from '../../ink.js';
import { stringWidth } from '../../ink/stringWidth.js';
import { getCwd } from 'src/utils/cwd.js';
import { FileToolPermissionPreview } from './FileToolPermissionPreview.js';
import { getDisplayPath } from 'src/utils/file.js';
import { BashPermissionRequest } from './BashPermissionRequest.js';
import { PowerShellPermissionRequest } from './PowerShellPermissionRequest.js';

export type PermissionRequestProps<Input extends AnyObject = AnyObject> = {
	toolUseConfirm: ToolUseConfirm<Input>;
	toolUseContext: ToolUseContext;
	onDone(): void;
	onReject(): void;
	verbose: boolean;
	workerBadge?: unknown;
	currentMessageCount?: number;
};

export type ToolUseConfirm<Input extends AnyObject = AnyObject> = {
	assistantMessage: AssistantMessage;
	tool: Tool<Input>;
	description: string;
	input: z.infer<Input>;
	toolUseContext: ToolUseContext;
	toolUseID: string;
	permissionResult: PermissionDecision;
	permissionPromptStartTimeMs: number;
	/**
	 * Called when user interacts with the permission dialog (e.g., arrow keys, tab, typing).
	 * This prevents async auto-approval mechanisms (like the bash classifier) from
	 * dismissing the dialog while the user is actively engaging with it.
	 */
	classifierCheckInProgress?: boolean;
	classifierAutoApproved?: boolean;
	classifierMatchedRule?: string;
	onUserInteraction(): void;
	onAbort(): void;
	onDismissCheckmark?(): void;
	onAllow(
		updatedInput: z.infer<Input>,
		permissionUpdates: PermissionUpdate[],
		feedback?: string,
		contentBlocks?: ContentBlockParam[]
	): void;
	onReject(feedback?: string, contentBlocks?: ContentBlockParam[]): void;
	recheckPermission(): Promise<void>;
};

type PermissionColor =
	| 'ansi:blackBright'
	| 'ansi:blue'
	| 'ansi:blueBright'
	| 'ansi:cyan'
	| 'ansi:cyanBright'
	| 'ansi:green'
	| 'ansi:greenBright'
	| 'ansi:magenta'
	| 'ansi:magentaBright'
	| 'ansi:red'
	| 'ansi:redBright'
	| 'ansi:white'
	| 'ansi:whiteBright'
	| 'ansi:yellow'
	| 'ansi:yellowBright';

type ToolPresentation = {
	toolLabel: string;
	title: string;
	intent: string;
	question?: string;
	primaryLabel: string;
	primary: string;
	working: string;
	risk?: string;
	accent: PermissionColor;
	isDangerous: boolean;
};

type PermissionOption = {
	key: string;
	hotkey: string;
	label: string;
	color: PermissionColor;
	action: () => void;
	help?: string;
};

function isFileMutationToolName(toolName: string): boolean {
	return toolName === 'Edit' || toolName === 'Write';
}

function stringifyPermissionInput(input: unknown): string {
	if (typeof input === 'string') {
		return input;
	}

	try {
		return JSON.stringify(input);
	} catch {
		return String(input);
	}
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object'
		? (value as Record<string, unknown>)
		: {};
}

function fitDisplay(text: string, width: number): string {
	if (width <= 0) {
		return '';
	}

	if (stringWidth(text) <= width) {
		return text;
	}

	let next = '';
	for (const char of Array.from(text)) {
		if (stringWidth(`${next}...`) > width) {
			break;
		}
		next += char;
	}

	return `${next}...`;
}

function isDangerousCommand(command: string): boolean {
	return /\brm\s+(-[^\s]*r[^\s]*f|-[^\s]*f[^\s]*r)\b|\b(del|erase)\b|\brmdir\b|\bgit\s+reset\s+--hard\b/i.test(
		command
	);
}

function getWorkingDirectory(): string {
	try {
		return getCwd();
	} catch {
		return process.cwd();
	}
}

function getShellLabel(): string {
	return process.platform === 'win32' ? 'PowerShell command' : 'shell command';
}

function wrapDisplay(text: string, width: number): string[] {
	const safeWidth = Math.max(1, width);
	const result: string[] = [];

	for (const logicalLine of text.split('\n')) {
		if (logicalLine.length === 0) {
			result.push('');
			continue;
		}

		let current = '';
		for (const char of Array.from(logicalLine)) {
			const next = current + char;
			if (stringWidth(next) > safeWidth) {
				result.push(current);
				current = char;
			} else {
				current = next;
			}
		}
		result.push(current);
	}

	return result;
}

function getNaturalRisk(
	toolName: string,
	description: string,
	record: Record<string, unknown>,
	working: string
): string {
	const command = String(record.command ?? '');

	if (toolName === 'Bash') {
		if (isDangerousCommand(command)) {
			return 'Deletes files or changes state in a way that may be hard to undo.';
		}
		if (/\bGet-ChildItem\b/i.test(command)) {
			return `Reads the list of files and folders in ${working}.`;
		}
		return 'Runs a shell command in the current workspace.';
	}

	if (toolName === 'Edit' || toolName === 'Write') {
		return 'Modifies files in the current workspace.';
	}

	if (toolName === 'Read' || toolName === 'glob' || toolName === 'Grep') {
		return 'Reads or searches files in the current workspace.';
	}

	if (toolName === 'WebFetch') {
		return 'Allows network access to fetch a remote URL.';
	}

	if (toolName === 'WebSearch') {
		return 'Allows a web search for this request.';
	}

	return description || 'Allows this tool call to continue.';
}

function getRiskLabel(presentation: ToolPresentation): string {
	if (presentation.isDangerous) {
		return `High — ${presentation.risk ?? 'may make destructive changes.'}`;
	}

	return `Low — ${presentation.risk ?? 'allows this tool call to continue.'}`;
}

type PermissionInputKey = {
	wheelUp?: boolean;
	wheelDown?: boolean;
	pageUp?: boolean;
	pageDown?: boolean;
	home?: boolean;
	end?: boolean;
	ctrl?: boolean;
};

function isScrollNavigationKey(input: string, key: PermissionInputKey): boolean {
	return (
		key.wheelUp ||
		key.wheelDown ||
		key.pageUp ||
		key.pageDown ||
		key.home ||
		key.end ||
		(key.ctrl && ['b', 'f', 'u', 'd'].includes(input))
	);
}

function getToolPresentation(
	toolName: string,
	input: unknown,
	description: string
): ToolPresentation {
	const record = asRecord(input);
	const command = String(record.command ?? '');
	const path = String(
		record.file_path ?? record.path ?? record.pattern ?? record.url ?? ''
	);
	const query = String(record.query ?? record.pattern ?? '');
	const working = getWorkingDirectory();

	if (toolName === 'Bash') {
		const dangerous = isDangerousCommand(command);
		const shellName = process.platform === 'win32' ? 'PowerShell' : 'Shell';
		return {
			toolLabel: 'Bash',
			title: 'Permission required',
			intent: `${shellName} command`,
			primaryLabel: 'Command',
			primary: command || stringifyPermissionInput(input),
			working,
			risk: getNaturalRisk(toolName, description, record, working),
			accent: 'ansi:yellow',
			isDangerous: dangerous
		};
	}

	if (toolName === 'Edit' || toolName === 'Write') {
		const displayPath = path ? getDisplayPath(path) : stringifyPermissionInput(input);
		const fileName = path ? basename(path) : 'this file';
		return {
			toolLabel: toolName,
			title: toolName === 'Write' ? 'Write file' : 'Edit file',
			intent:
				toolName === 'Write'
					? 'Review the file change before continuing'
					: 'Review the proposed edit before continuing',
			question:
				toolName === 'Write'
					? `Do you want to write to ${fileName}?`
					: `Do you want to make this edit to ${fileName}?`,
			primaryLabel: 'File',
			primary: displayPath,
			working,
			risk: getNaturalRisk(toolName, description, record, working),
			accent: 'ansi:yellow',
			isDangerous: false
		};
	}

	if (toolName === 'Read' || toolName === 'glob' || toolName === 'Grep') {
		return {
			toolLabel: toolName === 'glob' ? 'Glob' : toolName,
			title: 'Inspect files',
			intent: 'Inspect files',
			primaryLabel: toolName === 'Grep' ? 'Pattern' : 'Path',
			primary: path || stringifyPermissionInput(input),
			working,
			risk: getNaturalRisk(toolName, description, record, working),
			accent: 'ansi:yellow',
			isDangerous: false
		};
	}

	if (toolName === 'WebFetch') {
		return {
			toolLabel: 'WebFetch',
			title: 'Fetch URL',
			intent: 'Fetch URL',
			primaryLabel: 'URL',
			primary: path || stringifyPermissionInput(input),
			working,
			risk: getNaturalRisk(toolName, description, record, working),
			accent: 'ansi:yellow',
			isDangerous: false
		};
	}

	if (toolName === 'WebSearch') {
		return {
			toolLabel: 'WebSearch',
			title: 'Search the web',
			intent: 'Search the web',
			primaryLabel: 'Query',
			primary: query || stringifyPermissionInput(input),
			working,
			risk: getNaturalRisk(toolName, description, record, working),
			accent: 'ansi:yellow',
			isDangerous: false
		};
	}

	return {
		toolLabel: toolName,
		title: `Use ${toolName}`,
		intent: `Use ${toolName}`,
		primaryLabel: 'Input',
		primary: stringifyPermissionInput(input),
		working,
		risk: getNaturalRisk(toolName, description, record, working),
		accent: 'ansi:yellow',
		isDangerous: false
	};
}

function InlineField({
	label,
	value,
	width,
	color,
	labelColor = 'ansi:blackBright'
}: {
	label: string;
	value: string;
	width: number;
	color?: PermissionColor;
	labelColor?: PermissionColor;
}): React.ReactNode {
	const labelText = `${label}: `;
	const labelWidth = stringWidth(labelText);

	return (
		<Box width={width} flexDirection="row">
			<Text color={labelColor}>{labelText}</Text>
			<Text color={color ?? 'ansi:whiteBright'}>
				{fitDisplay(value, Math.max(4, width - labelWidth))}
			</Text>
		</Box>
	);
}

type FileMutationPermissionPanelProps = {
	toolUseConfirm: ToolUseConfirm;
	selectedIndex?: number;
	options?: PermissionOption[];
	shortcutHint?: string;
	statusText?: string;
	maxPreviewLines?: number | null;
};

export function FileMutationPermissionPanel({
	toolUseConfirm,
	selectedIndex,
	options,
	shortcutHint,
	statusText,
	maxPreviewLines = null
}: FileMutationPermissionPanelProps): React.ReactNode {
	const { columns } = useWindowSize();
	const presentation = getToolPresentation(
		toolUseConfirm.tool.name,
		toolUseConfirm.input,
		toolUseConfirm.description
	);
	const panelWidth = Math.min(120, Math.max(60, columns - 4));
	const contentWidth = Math.max(32, panelWidth - 6);
	const divider = '─'.repeat(contentWidth);
	const fileName = basename(presentation.primary) || presentation.primary;
	const action = toolUseConfirm.tool.name === 'Write' ? 'Write' : 'Edit';
	const titleText = `${action} ${fileName}`;
	const pathText = getDisplayPath(presentation.primary);

	return (
		<Box
			flexDirection="column"
			alignSelf="flex-start"
			width={panelWidth}
			marginTop={1}
		>
			<Text color={presentation.accent}>{divider}</Text>
			<Box flexDirection="row">
				<Text color={presentation.accent} bold>
					?{' '}
				</Text>
				<Text color="ansi:whiteBright">
					{fitDisplay(titleText, contentWidth - 2)}
				</Text>
			</Box>
			{pathText !== fileName ? (
				<Text color="ansi:blackBright">
					{fitDisplay(pathText, contentWidth)}
				</Text>
			) : null}
			<FileToolPermissionPreview
				toolName={toolUseConfirm.tool.name}
				input={toolUseConfirm.input}
				width={contentWidth}
				maxLines={maxPreviewLines}
				showOmitted
				compact
			/>
			<Box flexDirection="column" marginTop={1}>
				{statusText ? (
					<Text color="ansi:blackBright">
						{fitDisplay(statusText, contentWidth)}
					</Text>
				) : (
					options?.map((option, index) => {
						const selected = selectedIndex === index;

						return (
							<Text
								key={option.key}
								color={selected ? option.color : 'ansi:blackBright'}
								bold={selected}
								inverse={selected}
							>
								{fitDisplay(
									`${selected ? '›' : ' '}[${option.hotkey}] ${option.label}`,
									contentWidth
								)}
							</Text>
						);
					})
				)}
				{statusText ? null : (
					<Text color="ansi:blackBright">
						{fitDisplay(
							`Enter confirm · Esc cancel · ${shortcutHint ?? 'A/D'}`,
							contentWidth
						)}
					</Text>
				)}
			</Box>
		</Box>
	);
}

export function PermissionRequest({
	toolUseConfirm,
	toolUseContext,
	onDone,
	onReject,
	currentMessageCount
}: PermissionRequestProps): React.ReactNode {
	if (toolUseConfirm.tool.name === 'Bash') {
		return (
			<BashPermissionRequest
				toolUseConfirm={toolUseConfirm}
				toolUseContext={toolUseContext}
				onDone={onDone}
				onReject={onReject}
				verbose={false}
				currentMessageCount={currentMessageCount}
			/>
		);
	}

	if (
		toolUseConfirm.tool.name === 'PowerShell' ||
		toolUseConfirm.tool.name === 'powershell'
	) {
		return (
			<PowerShellPermissionRequest
				toolUseConfirm={toolUseConfirm}
				toolUseContext={toolUseContext}
				onDone={onDone}
				onReject={onReject}
				verbose={false}
				currentMessageCount={currentMessageCount}
			/>
		);
	}

	const { columns, rows } = useWindowSize();
	const presentation = getToolPresentation(
		toolUseConfirm.tool.name,
		toolUseConfirm.input,
		toolUseConfirm.description
	);
	const panelWidth = Math.min(120, Math.max(60, columns - 4));
	const contentWidth = Math.max(32, panelWidth - 6);
	const [selectedIndex, setSelectedIndex] = React.useState(
		presentation.isDangerous ? 1 : 0
	);
	const didResolveRef = React.useRef(false);

	const startResolution = React.useCallback(
		(action: () => void | Promise<void>) => {
			if (didResolveRef.current) {
				return;
			}

			didResolveRef.current = true;
			onDone();
			void Promise.resolve().then(action);
		},
		[onDone]
	);

	const reject = React.useCallback(() => {
		onReject();
		void startResolution(() => {
			toolUseConfirm.onReject();
		});
	}, [onReject, startResolution, toolUseConfirm]);

	const allow = React.useCallback(
		(permissionUpdates: PermissionUpdate[] = []) => {
			void startResolution(() => {
				toolUseConfirm.onAllow(
					toolUseConfirm.input,
					permissionUpdates
				);
			});
		},
		[startResolution, toolUseConfirm]
	);

	const allowAllCommands = React.useCallback(() => {
		toolUseContext.setAppState(prev => ({
			...prev,
			toolPermissionContext: {
				...prev.toolPermissionContext,
				mode: 'bypassPermissions'
			}
		}));
		allow();
	}, [allow, toolUseContext]);

	const bypassAvailable =
		toolUseContext.getAppState().toolPermissionContext
			.isBypassPermissionsModeAvailable;
	const options = React.useMemo<PermissionOption[]>(
		() => [
			{
				key: 'a',
				hotkey: 'A',
				label: 'Allow once',
				color: 'ansi:green',
				action: () => allow()
			},
			{
				key: 'd',
				hotkey: 'D',
				label: 'Deny this time',
				color: 'ansi:redBright',
				action: reject
			},
			...(bypassAvailable
				? [
					{
						key: 'b',
						hotkey: 'B',
						label: 'Trust this session',
						help: 'Allows later commands in this session without prompting.',
						color: 'ansi:yellow' as const,
						action: allowAllCommands
					}
				]
				: [])
		],
		[allow, allowAllCommands, bypassAvailable, reject]
	);

	React.useEffect(() => {
		setSelectedIndex(current => Math.min(current, options.length - 1));
	}, [options.length]);

	useInput(
		(input, key, event) => {
			if (isScrollNavigationKey(input, key)) {
				return;
			}

			if (didResolveRef.current) {
				event.stopImmediatePropagation();
				return;
			}

			event.stopImmediatePropagation();
			toolUseConfirm.onUserInteraction();

			if (key.leftArrow || key.upArrow) {
				setSelectedIndex(current =>
					current === 0 ? options.length - 1 : current - 1
				);
				return;
			}

			if (key.rightArrow || key.downArrow || key.tab) {
				setSelectedIndex(current => (current + 1) % options.length);
				return;
			}

			if (key.escape || (key.ctrl && input === 'c')) {
				reject();
				return;
			}

			if (key.return) {
				options[selectedIndex]?.action();
				return;
			}

			const option = options.find(item => item.key === input.toLowerCase());
			if (option) {
				option.action();
			}
		},
		{ isActive: true }
	);

	const optionColumnWidth = Math.min(
		30,
		Math.max(24, Math.floor(contentWidth * 0.24))
	);
	const bodyWidth = Math.max(24, contentWidth - optionColumnWidth - 3);
	const divider = '─'.repeat(contentWidth);
	const verticalDivider = '│';
	const shortcutHint = bypassAvailable ? 'A/D/B' : 'A/D';
	const isFileMutationTool = isFileMutationToolName(toolUseConfirm.tool.name);

	if (isFileMutationTool) {
		return (
			<FileMutationPermissionPanel
				toolUseConfirm={toolUseConfirm}
				selectedIndex={selectedIndex}
				options={options}
				shortcutHint={shortcutHint}
			/>
		);
	}

	const content = (
		<Box
			borderStyle="round"
			borderColor={presentation.accent}
			flexDirection="column"
			alignSelf="flex-start"
			width={panelWidth}
			paddingX={2}
			paddingY={0}
			marginTop={1}
		>
			<Box flexDirection="row">
				<Box width={bodyWidth} flexDirection="column" paddingRight={2}>
					<Box flexDirection="row">
						<Text color={presentation.accent} bold>
							?{' '}
						</Text>
						<Text color="ansi:whiteBright">
							{fitDisplay(presentation.question ?? presentation.intent, bodyWidth - 2)}
						</Text>
					</Box>
					<Text color={presentation.isDangerous ? 'ansi:redBright' : 'ansi:cyan'}>
						{fitDisplay(
							presentation.primaryLabel === 'Command'
								? `$ ${presentation.primary}`
								: `${presentation.primaryLabel}: ${presentation.primary}`,
							bodyWidth
						)}
					</Text>
					{presentation.risk ? (
						<Text color="ansi:white">
							{fitDisplay(getRiskLabel(presentation), bodyWidth)}
						</Text>
					) : null}
					<InlineField
						label="Cwd"
						value={presentation.working}
						width={bodyWidth}
						color="ansi:white"
						labelColor="ansi:blackBright"
					/>
					<FileToolPermissionPreview
						toolName={toolUseConfirm.tool.name}
						input={toolUseConfirm.input}
						width={bodyWidth}
					/>
				</Box>
				<Text color="ansi:blackBright">{verticalDivider}</Text>
				<Box width={optionColumnWidth} flexDirection="column" paddingLeft={2}>
					{options.map((option, index) => {
						const selected = selectedIndex === index;

						return (
							<Text
								key={option.key}
								color={selected ? option.color : 'ansi:blackBright'}
								bold={selected}
								inverse={selected}
							>
								{fitDisplay(
									`${selected ? '›' : ' '}[${option.hotkey}] ${option.label}`,
									optionColumnWidth - 2
								)}
							</Text>
						);
					})}
				</Box>
			</Box>
			<Text color={presentation.accent}>{divider}</Text>
			<Box>
				<Text color="ansi:whiteBright">
					{fitDisplay(`Select an option (${shortcutHint}):`, contentWidth)}
				</Text>
			</Box>
		</Box>
	);

	return content;
}
