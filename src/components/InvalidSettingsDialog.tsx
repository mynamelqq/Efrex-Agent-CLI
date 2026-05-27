import React from 'react';
import { Box, Text, useInput } from '../ink.js';
import type { ValidationError } from '../utils/settings/validation.js';

type InvalidSettingsDialogProps = {
	settingsErrors: ValidationError[];
	onExit: () => void;
	onContinue: () => void;
};

type DialogOption = {
	label: string;
	description: string;
	action: () => void;
	color: 'ansi:redBright' | 'ansi:yellowBright';
};

type ErrorTone = {
	color:
		| 'ansi:redBright'
		| 'ansi:yellowBright'
		| 'ansi:cyanBright'
		| 'ansi:magentaBright';
	label: string;
};

function getErrorLocation(error: ValidationError): string {
	const file = error.file ?? 'settings';
	const location = error.path ? ` (${error.path})` : '';
	return `${file}${location}`;
}

function getErrorTone(error: ValidationError): ErrorTone {
	const message = error.message.toLowerCase();

	if (
		message.includes('invalid or malformed json') ||
		message.includes('invalid json')
	) {
		return {
			color: 'ansi:redBright',
			label: 'JSON',
		};
	}

	if (
		message.includes('expected ') ||
		message.includes('invalid value') ||
		message.includes('unrecognized field') ||
		message.includes('unrecognized fields') ||
		message.includes('number must be greater than or equal')
	) {
		return {
			color: 'ansi:yellowBright',
			label: 'Schema',
		};
	}

	if (message.includes('permission')) {
		return {
			color: 'ansi:magentaBright',
			label: 'Permission',
		};
	}

	return {
		color: 'ansi:cyanBright',
		label: 'Config',
	};
}

export function InvalidSettingsDialog({
	settingsErrors,
	onExit,
	onContinue,
}: InvalidSettingsDialogProps): React.ReactNode {
	const [selectedIndex, setSelectedIndex] = React.useState(0);
	const options: DialogOption[] = [
		{
			label: 'Exit and fix manually',
			description: 'Stop here and fix the invalid settings files yourself.',
			action: onExit,
			color: 'ansi:redBright',
		},
		{
			label: 'Continue without these settings',
			description: 'Ignore invalid settings files and continue startup.',
			action: onContinue,
			color: 'ansi:yellowBright',
		},
	];

	useInput((input, key) => {
		if (key.upArrow || key.leftArrow) {
			setSelectedIndex(current =>
				current === 0 ? options.length - 1 : current - 1,
			);
			return;
		}

		if (key.downArrow || key.rightArrow || key.tab) {
			setSelectedIndex(current => (current + 1) % options.length);
			return;
		}

		if (key.return) {
			options[selectedIndex]?.action();
			return;
		}

		if (key.escape || (key.ctrl && input === 'c')) {
			onExit();
		}
	});

	return (
		<Box
			borderStyle="round"
			borderColor="ansi:redBright"
			flexDirection="column"
			paddingX={2}
			paddingY={1}
			marginTop={1}
		>
			<Text bold color="ansi:redBright">
				Settings Error
			</Text>
			<Box marginTop={1} flexDirection="column">
				<Text color="ansi:yellowBright">
					One or more settings files are invalid and were not loaded.
				</Text>
				{settingsErrors.map((error, index) => {
					const tone = getErrorTone(error);
					const location = getErrorLocation(error);
					return (
						<Box
							key={`${error.file ?? 'settings'}:${error.path}:${index}`}
							flexDirection="row"
						>
							<Text color={tone.color}>
								{`${index + 1}. [${tone.label}] `}
							</Text>
							<Text color="ansi:cyanBright">{`${location}: `}</Text>
							<Text color={tone.color}>{error.message}</Text>
						</Box>
					);
				})}
			</Box>
			<Box marginTop={1} flexDirection="column">
				{options.map((option, index) => {
					const selected = index === selectedIndex;
					return (
						<Box key={option.label} flexDirection="column" marginBottom={1}>
							<Text
								color={selected ? option.color : 'ansi:blackBright'}
								bold={selected}
							>
								{`${selected ? '›' : ' '} ${option.label}`}
							</Text>
							<Text color={selected ? 'ansi:whiteBright' : 'ansi:blackBright'}>
								{option.description}
							</Text>
						</Box>
					);
				})}
			</Box>
			<Text dimColor>↑/↓ 选择 · Enter 确认 · Esc/Ctrl+C 退出</Text>
		</Box>
	);
}
