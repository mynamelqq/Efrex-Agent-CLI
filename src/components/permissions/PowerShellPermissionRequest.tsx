import * as React from 'react';
import { Text, useInput, useWindowSize } from '../../ink.js';
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

export function PowerShellPermissionRequest({
	toolUseConfirm,
	toolUseContext,
	onDone,
	onReject,
	currentMessageCount = 0
}: PermissionRequestProps): React.ReactNode {
	const { columns } = useWindowSize();
	const contentWidth = Math.max(32, columns - 8);
	const description = String(
		(toolUseConfirm.input as Record<string, unknown>).description ??
			toolUseConfirm.description ??
			''
	);
	const [selectedIndex, setSelectedIndex] = React.useState(0);
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
		(
			permissionUpdates: PermissionUpdate[] = []
		) => {
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
				label: '允许这一次',
				color: 'ansi:green',
				action: () => allow()
			},
			...(bypassAvailable
				? [
					{
						key: 'b',
						hotkey: 'B',
						label: '信任本次会话',
						color: 'ansi:yellow' as const,
						action: allowAllCommands
					}
				]
				: []),
			{
				key: 'd',
				hotkey: 'D',
				label: '不允许',
				color: 'ansi:whiteBright',
				action: reject
			}
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

	const divider = '─'.repeat(contentWidth);

	return (
		<React.Fragment>
			<Text> </Text>
			<Text color="ansi:cyan" bold>
				{fitDisplay('Efrex 想要调用 PowerShell', contentWidth)}
			</Text>
			<Text color="ansi:blackBright">{divider}</Text>
			<Text>
				{fitDisplay(`意图：${description || '执行 PowerShell 命令'}`, contentWidth)}
			</Text>
			{options.map((option, index) => {
				const selected = selectedIndex === index;
				return (
					<Text
						key={option.key}
						color={selected ? option.color : 'ansi:blackBright'}
						bold={selected}
					>
						{fitDisplay(
							`${selected ? '›' : ' '}[${option.hotkey}] ${option.label}`,
							contentWidth
						)}
					</Text>
				);
			})}
		</React.Fragment>
	);
}
