import chalk from 'chalk';
import * as React from 'react';
import { Box, Text, useInput } from '../../ink.js';
import { useAppState, useSetAppState } from '../../state/AppState.js';
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

function renderModelLabel(model: string | null): string {
	return model ?? 'default';
}

function ModelPicker({
	onDone
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

	useInput((input, key) => {
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

		if (key.escape||(key.ctrl&&input=='c')) {
			onDone(`Kept model as ${chalk.bold(renderModelLabel(mainLoopModel))}`, {
				display: 'system'
			});
			return;
		}

		if (key.return) {
			const nextModel = MODEL_OPTIONS[selectedIndex] ?? MODEL_OPTIONS[0];
			setAppState(prev => ({
				...prev,
				mainLoopModel: nextModel
			}));
			onDone(`Set model to ${chalk.bold(nextModel)}`);
			return;
		}

		if (input === 'q') {
			onDone(`Kept model as ${chalk.bold(renderModelLabel(mainLoopModel))}`, {
				display: 'system'
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
						<Box key={option}>
							<Text color={isSelected ? accent : 'gray'}>
								{isSelected ? '› ' : '  '}
							</Text>
							<Text color={accent}>● </Text>
							<Text color={isSelected ? accent : undefined} bold={isSelected}>
								{option}
							</Text>
							{isCurrent ? (
								<Text color="gray">{isSelected ? ' current' : ' · current'}</Text>
							) : null}
						</Box>
					);
				})}
			</Box>
		</Box>
	);
}

function SetModelAndClose({
	args,
	onDone
}: {
	args: string;
	onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void;
}): React.ReactNode {
	const setAppState = useSetAppState();

	React.useEffect(() => {
		const model = args.trim();
		if (!model) {
			onDone('Missing model name.', { display: 'system' });
			return;
		}

		setAppState(prev => ({
			...prev,
			mainLoopModel: model === 'default' ? "" : model
		}));
		onDone(
			`Set model to ${chalk.bold(
				renderModelLabel(model === 'default' ? null : model)
			)}`
		);
	}, [args, onDone, setAppState]);

	return null;
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
	const trimmedArgs = args?.trim() || '';

	if (trimmedArgs) {
		return <SetModelAndClose args={trimmedArgs} onDone={onDone} />;
	}

	return <ModelPicker onDone={onDone} />;
};
