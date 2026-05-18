import type { AnyObject, Tool, ToolUseContext } from '../../Tool.js';
import type { AssistantMessage } from 'src/package/message.js';
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs';
import type { z } from 'zod/v4';
import type {
	PermissionDecision,
	PermissionUpdate
} from 'src/types/permissions.js';
import * as React from 'react';
import { Box, Text, useInput, useWindowSize } from '../../ink.js';
import { stringWidth } from '../../ink/stringWidth.js';
import { getCwd } from 'src/utils/cwd.js';

type PermissionRequestProps<Input extends AnyObject = AnyObject> = {
	toolUseConfirm: ToolUseConfirm<Input>;
	toolUseContext: ToolUseContext;
	onDone(): void;
	onReject(): void;
	verbose: boolean;
	workerBadge?: unknown;
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
	| 'ansi:cyan'
	| 'ansi:cyanBright'
	| 'ansi:greenBright'
	| 'ansi:magenta'
	| 'ansi:magentaBright'
	| 'ansi:redBright'
	| 'ansi:yellow'
	| 'ansi:yellowBright';

type ToolPresentation = {
	toolLabel: string;
	intent: string;
	primaryLabel: string;
	primary: string;
	working: string;
	risk?: string;
	accent: PermissionColor;
	border: PermissionColor;
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

function hasPermissionSuggestions(
	permissionResult: PermissionDecision
): permissionResult is PermissionDecision & {
	suggestions: PermissionUpdate[];
} {
	return (
		'suggestions' in permissionResult &&
		Array.isArray(permissionResult.suggestions) &&
		permissionResult.suggestions.length > 0
	);
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
		return {
			toolLabel: 'Bash',
			intent: 'efrex code wants to run a shell command',
			primaryLabel: 'Command',
			primary: `$ ${command || stringifyPermissionInput(input)}`,
			working,
			risk: dangerous
				? 'Deletes files or changes state; cannot be undone'
				: description || 'Runs a shell command in this workspace',
			accent: dangerous ? 'ansi:redBright' : 'ansi:yellowBright',
			border: dangerous ? 'ansi:redBright' : 'ansi:yellow',
			isDangerous: dangerous
		};
	}

	if (toolName === 'Edit' || toolName === 'Write') {
		return {
			toolLabel: toolName,
			intent: `efrex code wants to ${
				toolName === 'Write' ? 'write a file' : 'edit a file'
			}`,
			primaryLabel: 'File',
			primary: path || stringifyPermissionInput(input),
			working,
			risk: description || 'Modifies files in this workspace',
			accent: 'ansi:magentaBright',
			border: 'ansi:magenta',
			isDangerous: false
		};
	}

	if (toolName === 'Read' || toolName === 'glob' || toolName === 'Grep') {
		return {
			toolLabel: toolName === 'glob' ? 'Glob' : toolName,
			intent: 'efrex code wants to inspect files',
			primaryLabel: toolName === 'Grep' ? 'Pattern' : 'Path',
			primary: path || stringifyPermissionInput(input),
			working,
			risk: description || 'Reads or searches workspace content',
			accent: 'ansi:cyanBright',
			border: 'ansi:cyan',
			isDangerous: false
		};
	}

	if (toolName === 'WebFetch') {
		return {
			toolLabel: 'WebFetch',
			intent: 'efrex code wants to fetch a URL',
			primaryLabel: 'URL',
			primary: path || stringifyPermissionInput(input),
			working,
			risk: description || 'Allows network access for this request',
			accent: 'ansi:cyanBright',
			border: 'ansi:cyan',
			isDangerous: false
		};
	}

	if (toolName === 'WebSearch') {
		return {
			toolLabel: 'WebSearch',
			intent: 'efrex code wants to search the web',
			primaryLabel: 'Query',
			primary: query || stringifyPermissionInput(input),
			working,
			risk: description || 'Allows a web search for this request',
			accent: 'ansi:cyanBright',
			border: 'ansi:cyan',
			isDangerous: false
		};
	}

	return {
		toolLabel: toolName,
		intent: `efrex code wants to use ${toolName}`,
		primaryLabel: 'Input',
		primary: stringifyPermissionInput(input),
		working,
		risk: description,
		accent: 'ansi:cyanBright',
		border: 'ansi:cyan',
		isDangerous: false
	};
}

function summarizeRule(update: PermissionUpdate): {
	toolName?: string;
	ruleContent?: string;
} {
	if (update.type !== 'addRules' || update.rules.length === 0) {
		return {};
	}

	return update.rules[0] ?? {};
}

function getAlwaysAllowCopy(
	updates: PermissionUpdate[],
	currentToolName: string
): Pick<PermissionOption, 'label' | 'help'> {
	const ruleSummaries = updates.map(summarizeRule);
	const firstRule = ruleSummaries[0];
	const sameTool =
		ruleSummaries.length > 0 &&
		ruleSummaries.every(rule => rule.toolName === firstRule.toolName);
	const toolName = sameTool ? firstRule?.toolName : currentToolName;
	const ruleContent =
		sameTool &&
		ruleSummaries.length === 1 &&
		typeof firstRule?.ruleContent === 'string'
			? firstRule.ruleContent
			: undefined;

	if (toolName === 'Bash') {
		return {
			label: ruleContent
				? `Always allow ${ruleContent}`
				: 'Always allow similar Bash commands',
			help: 'Applies to future matching Bash requests in this workspace.'
		};
	}

	if (toolName) {
		return {
			label: `Always allow similar ${toolName} requests`,
			help: 'Applies to future matching requests in this workspace.'
		};
	}

	return {
		label: 'Always allow matching tool calls',
		help: 'Applies to future matching requests in this workspace.'
	};
}

function Field({
	label,
	value,
	width,
	color
}: {
	label: string;
	value: string;
	width: number;
	color?: PermissionColor;
}): React.ReactNode {
	const labelWidth = 9;

	return (
		<Box flexDirection="row">
			<Text color="ansi:blackBright">
				{`${label}${' '.repeat(Math.max(1, labelWidth - label.length))}`}
			</Text>
			<Text color={color ?? 'ansi:whiteBright'}>
				{fitDisplay(value, Math.max(8, width - labelWidth))}
			</Text>
		</Box>
	);
}

export function PermissionRequest({
	toolUseConfirm,
	onDone,
	onReject
}: PermissionRequestProps): React.ReactNode {
	const { columns } = useWindowSize();
	const presentation = getToolPresentation(
		toolUseConfirm.tool.name,
		toolUseConfirm.input,
		toolUseConfirm.description
	);
	const panelWidth = Math.min(96, Math.max(44, columns - 4));
	const contentWidth = Math.max(32, panelWidth - 6);
	const allowAlwaysUpdates = hasPermissionSuggestions(
		toolUseConfirm.permissionResult
	)
		? toolUseConfirm.permissionResult.suggestions
		: [];
	const [selectedIndex, setSelectedIndex] = React.useState(
		presentation.isDangerous ? 1 : 0
	);

	const reject = React.useCallback(() => {
		onDone();
		onReject();
		toolUseConfirm.onReject();

	}, [onDone, onReject, toolUseConfirm]);

	const allow = React.useCallback(
		(permissionUpdates: PermissionUpdate[] = []) => {
			toolUseConfirm.onAllow(toolUseConfirm.input, permissionUpdates);
			onDone();
		},
		[onDone, toolUseConfirm]
	);

	const alwaysCopy = React.useMemo(
		() => getAlwaysAllowCopy(allowAlwaysUpdates, toolUseConfirm.tool.name),
		[allowAlwaysUpdates, toolUseConfirm.tool.name]
	);
	const options = React.useMemo<PermissionOption[]>(
		() => [
			{
				key: 'a',
				hotkey: 'A',
				label: 'Allow once',
				color: 'ansi:greenBright',
				action: () => allow()
			},
			{
				key: 'd',
				hotkey: 'D',
				label: 'Deny this time',
				color: 'ansi:redBright',
				action: reject
			},
			...(allowAlwaysUpdates.length > 0
				? [
						{
							key: 's',
							hotkey: 'S',
							label: alwaysCopy.label,
							help: alwaysCopy.help,
							color: 'ansi:yellowBright' as const,
							action: () => allow(allowAlwaysUpdates)
						}
					]
				: [])
		],
		[allow, allowAlwaysUpdates, alwaysCopy, reject]
	);

	React.useEffect(() => {
		setSelectedIndex(current => Math.min(current, options.length - 1));
	}, [options.length]);

	useInput(
		(input, key, event) => {
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

	const selectedOption = options[selectedIndex];

	return (
		<Box
			borderStyle="round"
			borderColor={presentation.border}
			flexDirection="column"
			alignSelf="flex-start"
			width={panelWidth}
			paddingX={2}
			paddingY={0}
			marginTop={1}
		>
			<Box flexDirection="row">
				<Text color={presentation.accent} bold>
					?{' '}
				</Text>
				<Text color="ansi:whiteBright">
					{fitDisplay('Permission required', contentWidth - 2)}
				</Text>
			</Box>

			<Text color="ansi:blackBright">
				{fitDisplay(presentation.intent, contentWidth)}
			</Text>

			<Box flexDirection="column" marginTop={1}>
				<Field label="Tool" value={presentation.toolLabel} width={contentWidth} />
				<Field
					label={presentation.primaryLabel}
					value={presentation.primary}
					width={contentWidth}
					color={presentation.accent}
				/>
				<Field
					label="Working"
					value={presentation.working}
					width={contentWidth}
				/>
				{presentation.risk ? (
					<Field
						label="Risk"
						value={presentation.risk}
						width={contentWidth}
						color={
							presentation.isDangerous
								? 'ansi:redBright'
								: 'ansi:blackBright'
						}
					/>
				) : null}
			</Box>

			<Box flexDirection="column" marginTop={1}>
				{options.map((option, index) => {
					const selected = selectedIndex === index;

					return (
						<Text
							key={option.key}
							color={selected ? option.color : 'ansi:whiteBright'}
							bold={selected}
						>
							{fitDisplay(
								`${selected ? '›' : ' '} [${option.hotkey}] ${
									option.label
								}`,
								contentWidth
							)}
						</Text>
					);
				})}
				{selectedOption?.help ? (
					<Text color="ansi:blackBright">
						{fitDisplay(`  ${selectedOption.help}`, contentWidth)}
					</Text>
				) : null}
			</Box>

			<Box marginTop={1}>
				<Text color="ansi:blackBright">
					{fitDisplay('Select A/D/S · ↑↓ navigate · Enter confirm', contentWidth)}
				</Text>
			</Box>
		</Box>
	);
}
