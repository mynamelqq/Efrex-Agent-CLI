import chalk from 'chalk';
import * as React from 'react';
import { Box, Text, useInput } from '../../ink.js';
import { COMMON_HELP_ARGS, COMMON_INFO_ARGS } from '../../constants/xml.js';
import { useAppState, useSetAppState } from '../../state/AppState.js';
import { getInitialSettings } from '../../utils/settings/settings.js';
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js';
import { isClaudeAISubscriber } from '../../utils/auth.js';
import { validateModel } from '../../utils/model/validateModel.js';
import type {
	CommandResultDisplay,
	LocalJSXCommandCall,
} from '../../types/command.js';

const DEFAULT_MODEL_OPTIONS = [
	'kimi-k2.6',
	'gpt-5.4',
	'gpt-5.4-mini',
	'gpt-4.1',
	'gpt-4o',
] as const;

const ACCENT_PURPLE = '#B784FF';
const ACCENT_PURPLE_HI = '#D9A6FF';
const PRIMARY_GREEN = '#66D9A3';
const CURRENT_YELLOW = '#FFD166';
const TEXT_PRIMARY = '#E6EAF2';
const TEXT_SECONDARY = '#9EA8B8';
const TEXT_MUTED = '#687184';

const MODEL_SUMMARIES: Record<string, string> = {
	'kimi-k2.6': 'Kimi line, suitable when you want this provider explicitly.',
	'gpt-5.4': 'Primary general-purpose model with stronger capability.',
	'gpt-5.4-mini': 'Faster, lighter-weight GPT-5.4 variant.',
	'gpt-4.1': 'Stable GPT-4.1 line for broader compatibility.',
	'gpt-4o': 'Multimodal GPT-4o line with balanced responsiveness.',
};

// Keep the local command at a stable height while the focused row changes.
// Without this, adding/removing the focused model description can make Ink
// reflow the main screen and leave stale rows in terminal scrollback.
// Four one-line model rows plus the two header rows and list gap make seven
// content rows. Together with marginTop this matches the slash menu's frame
// height, keeping the main screen below the terminal scrollback threshold.
const MODEL_PICKER_MIN_HEIGHT = 7;
const MODEL_VISIBLE_COUNT = 4;


function getPlatformModelOptions(): string[] {
	const availableModels = getGlobalConfig().oauthAccount?.availableModels;
	if (!Array.isArray(availableModels)) {
		return [];
	}
	return [...new Set(availableModels.filter(model => model.trim()))];
}

function getThirdPartyModel(): string | undefined {
	const configuredModel = process.env.MODEL?.trim();
	return configuredModel || (getInitialSettings().model as string | undefined);
}

function getModelOptions(): string[] {
	if (isClaudeAISubscriber()) {
		const platformModels = getPlatformModelOptions();
		if (platformModels.length > 0) {
			return platformModels;
		}
		return [
			(getInitialSettings().model as string | undefined) ??
			DEFAULT_MODEL_OPTIONS[0],
		];
	}
	const thirdPartyModel = getThirdPartyModel();
	return thirdPartyModel ? [thirdPartyModel] : [...DEFAULT_MODEL_OPTIONS];
}

function getModelSummary(model: string): string {
	return MODEL_SUMMARIES[model] ?? 'Available model for the current account.';
}

function isPrimaryModel(model: string): boolean {
	return model === 'gpt-5.4';
}

function getVisibleModelWindow(
	models: string[],
	selectedIndex: number
): { items: string[]; startIndex: number } {
	if (models.length <= MODEL_VISIBLE_COUNT) {
		return { items: models, startIndex: 0 };
	}

	const maxStart = models.length - MODEL_VISIBLE_COUNT;
	const centeredStart = selectedIndex - Math.floor(MODEL_VISIBLE_COUNT / 2);
	const startIndex = Math.max(0, Math.min(centeredStart, maxStart));
	return {
		items: models.slice(startIndex, startIndex + MODEL_VISIBLE_COUNT),
		startIndex,
	};
}

function getDefaultModel(): string {
	if (isClaudeAISubscriber()) {
		const models = getPlatformModelOptions();
		const selectedModel = getGlobalConfig().oauthAccount?.selectedModel;
		return (selectedModel && models.includes(selectedModel)
			? selectedModel
			: models[0]) ?? (getInitialSettings().model as string);
	}
	return getThirdPartyModel() ?? DEFAULT_MODEL_OPTIONS[0];
}

function saveSelectedPlatformModel(model: string): void {
	if (!isClaudeAISubscriber()) {
		return;
	}
	saveGlobalConfig(current => {
		if (!current.oauthAccount || current.oauthAccount.selectedModel === model) {
			return current;
		}
		return {
			...current,
			oauthAccount: {
				...current.oauthAccount,
				selectedModel: model,
			},
		};
	});
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
	const modelOptions = getModelOptions();
	const currentIndex = Math.max(
		0,
		modelOptions.findIndex(option => option === mainLoopModel)
	);
	const [selectedIndex, setSelectedIndex] = React.useState(currentIndex);
	const [submitted, setSubmitted] = React.useState(false);

	useInput((input, key) => {
		if (submitted) {
			return;
		}

		if (key.leftArrow || key.upArrow) {
			setSelectedIndex(index =>
				index <= 0 ? modelOptions.length - 1 : index - 1
			);
			return;
		}

		if (key.rightArrow || key.downArrow || key.tab) {
			setSelectedIndex(index =>
				index >= modelOptions.length - 1 ? 0 : index + 1
			);
			return;
		}

		if (key.escape || (key.ctrl && input === 'c')) {
			setSubmitted(true);
			onDone(undefined, { display: 'skip' });
			return;
		}

		if (key.return) {
			const nextModel = modelOptions[selectedIndex] ?? modelOptions[0];
			setSubmitted(true);
			saveSelectedPlatformModel(nextModel);
			setAppState(prev => ({
				...prev,
				mainLoopModel: nextModel,
			}));
			onDone(`Set model to ${chalk.bold(nextModel)}`);
			return;
		}

		if (input === 'q') {
			setSubmitted(true);
			onDone(undefined, { display: 'skip' });
		}
	});

	const visibleModelWindow = getVisibleModelWindow(modelOptions, selectedIndex);
	const pickerHeight = Math.max(
		MODEL_PICKER_MIN_HEIGHT,
		Math.min(modelOptions.length, MODEL_VISIBLE_COUNT) + 3
	);

	return (
		<Box
			paddingX={1}
			flexDirection="column"
			minHeight={pickerHeight}
		>
			<Box flexDirection="row">
				<Text color={ACCENT_PURPLE}>◎ </Text>
				<Text bold color={TEXT_PRIMARY}>
					Select model
				</Text>
			</Box>
			<Text>
				<Text color={CURRENT_YELLOW}>↑/↓</Text>
				<Text color={TEXT_SECONDARY}> 选择 · </Text>
				<Text color={CURRENT_YELLOW}>Enter</Text>
				<Text color={TEXT_SECONDARY}> 确认 · </Text>
				<Text color={CURRENT_YELLOW}>Esc</Text>
				<Text color={TEXT_SECONDARY}> 取消</Text>
			</Text>
			<Box flexDirection="column" marginTop={1}>
				{visibleModelWindow.items.map((option, visibleIndex) => {
					const index = visibleModelWindow.startIndex + visibleIndex;
					const isSelected = index === selectedIndex;
					const isCurrent = option === mainLoopModel;
					const isPrimary = isPrimaryModel(option);
					return (
						<Box
							key={option}
							flexDirection="column"
							height={1}
							overflow="hidden"
						>
							<Box width="100%" flexWrap="nowrap">
								<Text color={isSelected ? ACCENT_PURPLE_HI : TEXT_MUTED}>
									{isSelected ? '› ' : '  '}
								</Text>
								<Text color={isSelected ? ACCENT_PURPLE : TEXT_MUTED}>●</Text>
								<Text
									color={isSelected ? ACCENT_PURPLE_HI : TEXT_PRIMARY}
									dimColor={!isSelected}
									bold={isSelected}
								>
									{' '}
									{option}
								</Text>
								{isPrimary ? (
									<>
										<Text color={TEXT_MUTED}> · </Text>
										<Text color={PRIMARY_GREEN} bold>
											Primary
										</Text>
									</>
								) : null}
								{isCurrent ? (
									<>
										<Text color={TEXT_MUTED}> · </Text>
										<Text color={CURRENT_YELLOW} bold>
											current
										</Text>
									</>
								) : null}
								<Text
									color={TEXT_MUTED}
									wrap="truncate-end"
									flexGrow={1}
									flexShrink={1}
								>
									{' · '}
									<Text color={TEXT_SECONDARY}>
										{getModelSummary(option)}
									</Text>
								</Text>
							</Box>
						</Box>
					);
				})}
			</Box>
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
				saveSelectedPlatformModel(defaultModel);
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
				saveSelectedPlatformModel(model);
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
