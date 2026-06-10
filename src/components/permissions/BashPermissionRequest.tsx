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
	return /\brm\s+(-[^\s]*r[^\s]*f|-[^\s]*f[^\s]*r)\b|\b(shred|mkfs|dd)\b|\bchmod\s+-R\b|\bchown\s+-R\b|\bgit\s+reset\s+--hard\b/i.test(
		command
	);
}

function getRiskLabel(command: string, description: string): string {
	if (isDangerousCommand(command)) {
		return 'High — may delete, overwrite, or recursively change files.';
	}

	return description || 'Runs a Bash command in the current workspace.';
}

export function BashPermissionRequest({
	toolUseConfirm,
	toolUseContext,
	onDone,
	onReject,
	currentMessageCount = 0
}: PermissionRequestProps): React.ReactNode {
	void currentMessageCount;

	const { columns } = useWindowSize();
	const panelWidth = Math.min(118, Math.max(58, columns - 4));
	const contentWidth = Math.max(32, panelWidth - 6);
	const command = String(
		(toolUseConfirm.input as Record<string, unknown>).command ?? ''
	);
	const description = String(
		(toolUseConfirm.input as Record<string, unknown>).description ??
			toolUseConfirm.description ??
			''
	);
	const [selectedIndex, setSelectedIndex] = React.useState(
		isDangerousCommand(command) ? 1 : 0
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
			startResolution(() => {
				toolUseConfirm.onAllow(toolUseConfirm.input, permissionUpdates);
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
			...(bypassAvailable
				? [
					{
						key: 'b',
						hotkey: 'B',
						label: 'Trust this session',
						color: 'ansi:yellowBright' as const,
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
		28,
		Math.max(22, Math.floor(contentWidth * 0.25))
	);
	const bodyWidth = Math.max(24, contentWidth - optionColumnWidth - 3);
	const divider = '─'.repeat(contentWidth);
	const shortcutHint = bypassAvailable ? 'A/D/B' : 'A/D';
	const dangerous = isDangerousCommand(command);

	return (
		<Box
			borderStyle="round"
			borderColor={dangerous ? 'ansi:redBright' : 'ansi:cyan'}
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
						<Text color={dangerous ? 'ansi:redBright' : 'ansi:cyan'} bold>
							$ {' '}
						</Text>
						<Text color="ansi:whiteBright">
							{fitDisplay(
								'efrex code wants to run the following shell command:',
								bodyWidth - 2
							)}
						</Text>
					</Box>
					<Box flexDirection="column">
						{wrapDisplay(command, Math.max(1, bodyWidth - 2)).map(
							(line, index) => (
								<Text
									key={`command-${index}`}
									color={dangerous ? 'ansi:redBright' : 'ansi:greenBright'}
								>
									{line.length > 0 ? `$ ${line}` : ' '}
								</Text>
							)
						)}
					</Box>
					<Text color={dangerous ? 'ansi:redBright' : 'ansi:white'}>
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
			<Text color={dangerous ? 'ansi:redBright' : 'ansi:cyan'}>{divider}</Text>
			<Box>
				<Text color="ansi:whiteBright">
					{fitDisplay(`Select an option (${shortcutHint}):`, contentWidth)}
				</Text>
			</Box>
		</Box>
	);
}
