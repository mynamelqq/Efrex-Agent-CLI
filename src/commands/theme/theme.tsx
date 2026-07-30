import chalk from 'chalk';
import * as React from 'react';
import {
	Box,
	Text,
	THEME_SETTINGS,
	usePreviewTheme,
	useTheme,
	useThemeSetting,
} from '@anthropic/ink';
import type { ThemeSetting } from '@anthropic/ink';
import { useInput } from '../../ink.js';
import { COMMON_HELP_ARGS, COMMON_INFO_ARGS } from '../../constants/xml.js';
import { isThemeSetting } from '../../utils/themeConfig.js';
import type {
	CommandResultDisplay,
	LocalJSXCommandCall,
} from '../../types/command.js';

type OnDone = (
	result?: string,
	options?: { display?: CommandResultDisplay }
) => void;

const THEME_SUMMARIES: Record<ThemeSetting, string> = {
	auto: '跟随终端背景色自动切换明暗',
	dark: '深色背景，真彩色',
	light: '浅色背景，真彩色',
	'light-daltonized': '浅色背景，色盲友好配色',
	'dark-daltonized': '深色背景，色盲友好配色',
	'light-ansi': '浅色背景，仅使用 16 色 ANSI',
	'dark-ansi': '深色背景，仅使用 16 色 ANSI',
};

// Swatch of the palette keys a user actually notices when switching themes.
const SWATCH_KEYS = [
	'claude',
	'suggestion',
	'success',
	'warning',
	'error',
	'permission',
] as const;

// The picker keeps a fixed height so moving the selection never reflows the
// main screen and leaves stale rows in terminal scrollback.
const THEME_PICKER_HEIGHT = THEME_SETTINGS.length + 4;

function themeLabel(setting: ThemeSetting): string {
	return setting === 'auto' ? 'auto (跟随终端)' : setting;
}

function Swatch(): React.ReactNode {
	return (
		<Box flexDirection="row">
			{SWATCH_KEYS.map(key => (
				<Text key={key} color={key}>
					███
				</Text>
			))}
		</Box>
	);
}

function ShowCurrentTheme({ onDone }: { onDone: OnDone }): React.ReactNode {
	const themeSetting = useThemeSetting();
	const [resolved] = useTheme();
	const suffix = themeSetting === 'auto' ? ` (resolved: ${resolved})` : '';
	onDone(`Current theme: ${chalk.bold(themeSetting)}${suffix}`);
	return null;
}

function ShowHelp({ onDone }: { onDone: OnDone }): React.ReactNode {
	onDone(
		`Usage: /theme [${THEME_SETTINGS.join('|')}]\n\n` +
			'Run /theme without arguments to open the picker (live preview while you move).',
		{ display: 'system' }
	);
	return null;
}

function ThemePicker({ onDone }: { onDone: OnDone }): React.ReactNode {
	const themeSetting = useThemeSetting();
	const [, setThemeSetting] = useTheme();
	const { setPreviewTheme, cancelPreview } = usePreviewTheme();
	const options = React.useMemo(() => [...THEME_SETTINGS], []);
	const [selectedIndex, setSelectedIndex] = React.useState(() =>
		Math.max(
			0,
			options.findIndex(option => option === themeSetting)
		)
	);
	const [submitted, setSubmitted] = React.useState(false);

	// Drop the preview if the picker goes away without a decision (e.g. the
	// command region is torn down), so a previewed theme can never stick
	// without being saved.
	const submittedRef = React.useRef(false);
	const cancelPreviewRef = React.useRef(cancelPreview);
	cancelPreviewRef.current = cancelPreview;
	React.useEffect(
		() => () => {
			if (!submittedRef.current) {
				cancelPreviewRef.current();
			}
		},
		[]
	);

	// Moving the selection previews the theme immediately; the preview is only
	// persisted on Enter. Kept out of the setState updater so the updater stays
	// pure (it can run more than once per commit).
	const move = (delta: number): void => {
		const nextIndex =
			(selectedIndex + delta + options.length) % options.length;
		setSelectedIndex(nextIndex);
		const option = options[nextIndex];
		if (option) {
			setPreviewTheme(option);
		}
	};

	useInput((input, key) => {
		if (submitted) {
			return;
		}

		if (key.leftArrow || key.upArrow) {
			move(-1);
			return;
		}

		if (key.rightArrow || key.downArrow || key.tab) {
			move(1);
			return;
		}

		if (key.escape || (key.ctrl && input === 'c') || input === 'q') {
			setSubmitted(true);
			submittedRef.current = true;
			cancelPreview();
			onDone(undefined, { display: 'skip' });
			return;
		}

		if (key.return) {
			const nextTheme = options[selectedIndex] ?? options[0]!;
			setSubmitted(true);
			submittedRef.current = true;
			// setThemeSetting clears the preview and persists through the
			// config callbacks wired in initThemeConfig().
			setThemeSetting(nextTheme);
			onDone(`Set theme to ${chalk.bold(themeLabel(nextTheme))}`);
		}
	});

	return (
		<Box paddingX={1} flexDirection="column" minHeight={THEME_PICKER_HEIGHT}>
			<Box flexDirection="row">
				<Text color="suggestion">◎ </Text>
				<Text bold>Select theme</Text>
				<Text color="inactive"> · </Text>
				<Swatch />
			</Box>
			<Text>
				<Text color="warning">↑/↓</Text>
				<Text color="inactive"> 预览 · </Text>
				<Text color="warning">Enter</Text>
				<Text color="inactive"> 确认 · </Text>
				<Text color="warning">Esc</Text>
				<Text color="inactive"> 取消</Text>
			</Text>
			<Box flexDirection="column" marginTop={1}>
				{options.map((option, index) => {
					const isSelected = index === selectedIndex;
					const isCurrent = option === themeSetting;
					return (
						<Box key={option} height={1} overflow="hidden">
							<Text color={isSelected ? 'suggestion' : 'inactive'}>
								{isSelected ? '› ' : '  '}
							</Text>
							<Text
								color={isSelected ? 'suggestion' : 'text'}
								dimColor={!isSelected}
								bold={isSelected}
							>
								{themeLabel(option)}
							</Text>
							{isCurrent ? (
								<>
									<Text color="inactive"> · </Text>
									<Text color="warning" bold>
										current
									</Text>
								</>
							) : null}
							<Text color="inactive" wrap="truncate-end">
								{' · '}
								{THEME_SUMMARIES[option]}
							</Text>
						</Box>
					);
				})}
			</Box>
		</Box>
	);
}

function SetThemeAndClose({
	args,
	onDone,
}: {
	args: string;
	onDone: OnDone;
}): React.ReactNode {
	const [, setThemeSetting] = useTheme();
	const [message, setMessage] = React.useState('');
	const [failed, setFailed] = React.useState(false);

	React.useEffect(() => {
		const requested = args.trim().toLowerCase();
		if (!isThemeSetting(requested)) {
			const error = `Unknown theme '${args.trim()}'. Available: ${THEME_SETTINGS.join(', ')}`;
			setFailed(true);
			setMessage(error);
			onDone(error, { display: 'system' });
			return;
		}

		setThemeSetting(requested);
		const result = `Set theme to ${chalk.bold(themeLabel(requested))}`;
		setMessage(result);
		onDone(result);
	}, [args, onDone, setThemeSetting]);

	return (
		<Box marginTop={1} paddingX={1} flexDirection="column">
			<Text color={failed ? 'error' : 'success'}>
				{failed ? 'Unable to switch theme' : 'Done'}
			</Text>
			<Text color="inactive">{message}</Text>
		</Box>
	);
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
	const trimmedArgs = args?.trim() || '';

	if (COMMON_HELP_ARGS.includes(trimmedArgs)) {
		return <ShowHelp onDone={onDone} />;
	}

	if (COMMON_INFO_ARGS.includes(trimmedArgs)) {
		return <ShowCurrentTheme onDone={onDone} />;
	}

	if (trimmedArgs) {
		return <SetThemeAndClose args={trimmedArgs} onDone={onDone} />;
	}

	return <ThemePicker onDone={onDone} />;
};
