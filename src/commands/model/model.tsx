import chalk from 'chalk';
import * as React from 'react';
import { Box, Text, useInput } from '../../ink.js';
import { COMMON_HELP_ARGS, COMMON_INFO_ARGS } from '../../constants/xml.js';
import { useAppState, useSetAppState } from '../../state/AppState.js';
import { getInitialSettings } from '../../utils/settings/settings.js';
import { validateModel } from '../../utils/model/validateModel.js';
import type {
	CommandResultDisplay,
	LocalJSXCommandCall,
} from '../../types/command.js';

const MODEL_OPTIONS = [
	'kimi-k2.6',
	'gpt-5.4',
	'gpt-5.4-mini',
	'gpt-4.1',
	'gpt-4o',
] as const;

const MODEL_ACCENTS: Record<(typeof MODEL_OPTIONS)[number], string> = {
	'kimi-k2.6': 'yellowBright',
	'gpt-5.4': 'cyanBright',
	'gpt-5.4-mini': 'greenBright',
	'gpt-4.1': 'blueBright',
	'gpt-4o': 'magentaBright',
};

const MODEL_SUMMARIES: Record<(typeof MODEL_OPTIONS)[number], string> = {
	'kimi-k2.6': 'Kimi line, suitable when you want this provider explicitly.',
	'gpt-5.4': 'Primary general-purpose model with stronger capability.',
	'gpt-5.4-mini': 'Faster, lighter-weight GPT-5.4 variant.',
	'gpt-4.1': 'Stable GPT-4.1 line for broader compatibility.',
	'gpt-4o': 'Multimodal GPT-4o line with balanced responsiveness.',
};

function getDefaultModel(): string {
	return getInitialSettings().model as string;
}

function renderModelLabel(model: string | null): string {
	if (!model || model === getDefaultModel()) {
		return `${model ?? getDefaultModel()} (default)`;
	}
	return model;
}

function ShowCurrentModel({
	onDone,
}: {
	onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void;
}): React.ReactNode {
	const model = useAppState(s => s.mainLoopModel);
	onDone(`Current model: ${chalk.bold(renderModelLabel(model))}`);
	return null;
}

function ModelPicker({
	onDone,
}: {
	onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void;
}): React.ReactNode {
	const mainLoopModel = useAppState(s => s.mainLoopModel);
	const setAppState = useSetAppState();
	const currentIndex = Math.max(
		0,
		MODEL_OPTIONS.findIndex(option => option === mainLoopModel)
	);
	const [selectedIndex, setSelectedIndex] = React.useState(currentIndex);
	const [submitted, setSubmitted] = React.useState(false);

	useInput((input, key) => {
		if (submitted) {
			return;
		}

		if (key.leftArrow || key.upArrow) {
			setSelectedIndex(index =>
				index <= 0 ? MODEL_OPTIONS.length - 1 : index - 1
			);
			return;
		}

		if (key.rightArrow || key.downArrow || key.tab) {
			setSelectedIndex(index =>
				index >= MODEL_OPTIONS.length - 1 ? 0 : index + 1
			);
			return;
		}

		if (key.escape || (key.ctrl && input === 'c')) {
			onDone(`Kept model as ${chalk.bold(renderModelLabel(mainLoopModel))}`, {
				display: 'system',
			});
			return;
		}

		if (key.return) {
			const nextModel = MODEL_OPTIONS[selectedIndex] ?? MODEL_OPTIONS[0];
			setSubmitted(true);
			setAppState(prev => ({
				...prev,
				mainLoopModel: nextModel,
			}));
			onDone(`Set model to ${chalk.bold(nextModel)}`);
			return;
		}

		if (input === 'q') {
			onDone(`Kept model as ${chalk.bold(renderModelLabel(mainLoopModel))}`, {
				display: 'system',
			});
		}
	});

	const selectedModel = MODEL_OPTIONS[selectedIndex] ?? MODEL_OPTIONS[0];

	return (
		<Box paddingX={1} flexDirection="column" marginTop={1}>
			<Box flexDirection="row">
				<Text color="cyanBright">◉ </Text>
				<Text bold color="cyanBright">
					Select model
				</Text>
			</Box>
			<Text dimColor>
				↑/↓ 选择，Enter 确认，Esc 取消
			</Text>
			<Box flexDirection="column" marginTop={1}>
				{MODEL_OPTIONS.map((option, index) => {
					const isSelected = index === selectedIndex;
					const isCurrent = option === mainLoopModel;
					const accent = MODEL_ACCENTS[option];
					return (
						<Box key={option} flexDirection="column">
							<Box>
								<Text color={isSelected ? accent : 'gray'}>
									{isSelected ? '› ' : '  '}
								</Text>
								<Text color={accent}>● </Text>
								<Text color={isSelected ? accent : undefined} bold={isSelected}>
									{option}
								</Text>
								{isCurrent ? (
									<Text color="gray">
										{isSelected ? ' current' : ' · current'}
									</Text>
								) : null}
							</Box>
							{isSelected ? (
								<Text dimColor>{MODEL_SUMMARIES[option]}</Text>
							) : null}
						</Box>
					);
				})}
			</Box>
			<Text dimColor>
				Selected: {chalk.bold(selectedModel)}
			</Text>
		</Box>
	);
}

function SetModelAndClose({
	args,
	onDone,
}: {
	args: string;
	onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void;
}): React.ReactNode {
	const setAppState = useSetAppState();
	const [phase, setPhase] = React.useState<'checking' | 'done' | 'error'>(
		'checking'
	);
	const [message, setMessage] = React.useState<string>(
		`Checking model ${chalk.bold(args.trim() || '...')}...`
	);

	React.useEffect(() => {
		async function handleModelChange(): Promise<void> {
			const model = args.trim();
			if (!model) {
				setPhase('error');
				setMessage('Missing model name.');
				onDone('Missing model name.', { display: 'system' });
				return;
			}

			const normalized = model.toLowerCase();
			if (normalized === 'default' || normalized === 'auto') {
				const defaultModel = getDefaultModel();
				setAppState(prev => ({
					...prev,
					mainLoopModel: defaultModel,
				}));
				setPhase('done');
				setMessage(`Model switched to ${chalk.bold(renderModelLabel(defaultModel))}`);
				onDone(`Model switched to ${chalk.bold(renderModelLabel(defaultModel))}`);
				return;
			}

			try {
				const { valid, error } = await validateModel(model);
				if (!valid) {
					setPhase('error');
					setMessage(error || `Model '${model}' not found`);
					onDone(error || `Model '${model}' not found`, {
						display: 'system',
					});
					return;
				}

				setAppState(prev => ({
					...prev,
					mainLoopModel: model,
				}));
				setPhase('done');
				setMessage(`Model switched to ${chalk.bold(model)}`);
				onDone(`Model switched to ${chalk.bold(model)}`);
			} catch (error) {
				const errorMessage = `Failed to validate model: ${(error as Error).message}`;
				setPhase('error');
				setMessage(errorMessage);
				onDone(errorMessage, {
					display: 'system',
				});
			}
		}

		void handleModelChange();
	}, [args, onDone, setAppState]);

	return (
		<Box marginTop={1} paddingX={1} flexDirection="column">
			<Text color={phase === 'error' ? 'redBright' : 'cyanBright'}>
				{phase === 'checking'
					? 'Checking model…'
					: phase === 'done'
						? 'Done'
						: 'Unable to switch model'}
			</Text>
			<Text dimColor>{message}</Text>
		</Box>
	);
}

function ShowHelp({
	onDone,
}: {
	onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void;
}): React.ReactNode {
	onDone(
		'Usage: /model [modelName]\n\nUse /model without arguments to open the picker. Supported quick values: default, auto.',
		{
			display: 'system',
		}
	);
	return null;
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
	const trimmedArgs = args?.trim() || '';

	if (COMMON_HELP_ARGS.includes(trimmedArgs)) {
		return <ShowHelp onDone={onDone} />;
	}

	if (COMMON_INFO_ARGS.includes(trimmedArgs)) {
		return <ShowCurrentModel onDone={onDone} />;
	}

	if (trimmedArgs) {
		return <SetModelAndClose args={trimmedArgs} onDone={onDone} />;
	}

	return <ModelPicker onDone={onDone} />;
};
