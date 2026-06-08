import * as React from 'react';
import { Box, Text, useInput, useWindowSize } from '../../ink.js';
import { stringWidth } from '../../ink/stringWidth.js';
import type { PermissionUpdate } from 'src/types/permissions.js';
import type { PermissionRequestProps } from './PermissionRequest.js';

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

type PermissionOption = {
	key: string;
	hotkey: string;
	label: string;
	color: PermissionColor;
	action: () => void;
};

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
	return /\b(remove-item|clear-content|set-content|add-content|new-item|copy-item|move-item|rename-item)\b|\b(del|erase|rmdir)\b|\bgit\s+reset\s+--hard\b/i.test(
		command
	);
}

function getRiskLabel(command: string, description: string): string {
	if (isDangerousCommand(command)) {
		return 'High — may modify or remove files in a way that is hard to undo.';
	}

	return `${description || 'runs a PowerShell command in the current workspace.'}`;
}

export function PowerShellPermissionRequest({
	toolUseConfirm,
	toolUseContext,
	onDone,
	onReject,
	currentMessageCount = 0
}: PermissionRequestProps): React.ReactNode {
	const { columns } = useWindowSize();
	const panelWidth = Math.min(120, Math.max(60, columns - 4));
	const contentWidth = Math.max(32, panelWidth - 6);
	const command = String(
		(toolUseConfirm.input as Record<string, unknown>).command ?? ''
	);
	const description = String(
		(toolUseConfirm.input as Record<string, unknown>).description ??
			toolUseConfirm.description ??
			''
	);
	const [selectedIndex, setSelectedIndex] = React.useState(0);
	const didResolveRef = React.useRef(false);
	const startResolution = React.useCallback(
		async (action: () => void | Promise<void>) => {
			if (didResolveRef.current) {
				return;
			}

			didResolveRef.current = true;
			await action();
			onDone();
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
		(
			permissionUpdates: PermissionUpdate[] = []
		) => {
			if (didResolveRef.current) {
				return;
			}

			didResolveRef.current = true;
			void toolUseConfirm
				.onAllow(toolUseConfirm.input, permissionUpdates)
				.finally(() => {
					onDone();
				});
		},
		[onDone, toolUseConfirm]
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
	const shortcutHint = bypassAvailable ? 'A/D/B' : 'A/D';

	return (
		<Box
			borderStyle="round"
			borderColor="ansi:yellow"
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
						<Text color="ansi:yellow" bold>
							?{' '}
						</Text>
						<Text color="ansi:whiteBright">
							{fitDisplay(
								'efrex code wants to run the following command:',
								bodyWidth - 2
							)}
						</Text>
					</Box>
					<Box flexDirection="column">
						{wrapDisplay(command, Math.max(1, bodyWidth - 2)).map(
							(line, index) => (
								<Text
									key={`command-${index}`}
									color={
										isDangerousCommand(command)
											? 'ansi:redBright'
											: 'ansi:cyan'
									}
								>
									{line.length > 0 ? `$ ${line}` : ' '}
								</Text>
							)
						)}
					</Box>
					<Text color="ansi:white">
						{fitDisplay(getRiskLabel(command, description), bodyWidth)}
					</Text>
				</Box>
				<Text color="ansi:blackBright">│</Text>
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
			<Text color="ansi:yellow">{divider}</Text>
			<Box>
				<Text color="ansi:whiteBright">
					{fitDisplay(`Select an option (${shortcutHint}):`, contentWidth)}
				</Text>
			</Box>
		</Box>
	);
}
