import * as React from 'react';
import chalk from 'chalk';
import { Box, Text, useInput } from '../../ink.js';
import { useAppState, useSetAppState } from '../../state/AppState.js';
import type {
	CommandResultDisplay,
	LocalJSXCommandCall,
} from '../../types/command.js';
import {
	type EffortLevel,
	type EffortValue,
	EFFORT_LEVELS,
	getEffortEnvOverride,
	getEffortValueDescription,
	isEffortLevel,
	toPersistableEffort,
} from '../../utils/effort.js';
import { updateSettingsForSource } from '../../utils/settings/settings.js';

const COMMON_HELP_ARGS = ['help', '-h', '--help'];

type EffortCommandResult = {
  message: string;
  effortUpdate?: { value: EffortValue | undefined };
};

type EffortOnDone = (
	result?: string,
	options?: { display?: CommandResultDisplay }
) => void;

const EFFORT_OPTIONS = [
	'auto',
	...EFFORT_LEVELS,
] as const;

type EffortOption = (typeof EFFORT_OPTIONS)[number];

const EFFORT_ACCENTS: Record<EffortOption, string> = {
	auto: 'gray',
	low: 'greenBright',
	medium: 'cyanBright',
	high: 'yellowBright',
	xhigh: 'magentaBright',
};

function setEffortValue(effortValue: EffortValue): EffortCommandResult {
  const persistable = toPersistableEffort(effortValue);
  if (persistable !== undefined) {
    const result = updateSettingsForSource('userSettings', {
      effortLevel: persistable,
    });
    if (result.error) {
      return {
        message: `Failed to set effort level: ${result.error.message}`,
      };
    }
  }

  const envOverride = getEffortEnvOverride();
  if (envOverride !== undefined && envOverride !== effortValue) {
    const envRaw = process.env.CLAUDE_CODE_EFFORT_LEVEL;
    if (persistable === undefined) {
      return {
        message: `Not applied: CLAUDE_CODE_EFFORT_LEVEL=${envRaw} overrides effort this session, and ${effortValue} is session-only (nothing saved)`,
        effortUpdate: { value: effortValue },
      };
    }
    return {
      message: `CLAUDE_CODE_EFFORT_LEVEL=${envRaw} overrides this session — clear it and ${effortValue} takes over`,
      effortUpdate: { value: effortValue },
    };
  }

  const description = getEffortValueDescription(effortValue);
  const suffix = persistable !== undefined ? '' : ' (this session only)';
  return {
    message: `Set effort level to ${effortValue}${suffix}: ${description}`,
    effortUpdate: { value: effortValue },
  };
}

export function showCurrentEffort(appStateEffort: EffortValue | undefined): EffortCommandResult {
  const envOverride = getEffortEnvOverride();
  const effectiveValue = envOverride === null ? undefined : (envOverride ?? appStateEffort);
  if (effectiveValue === undefined) {
    return { message: `Effort level: auto` };
  }
  const description = getEffortValueDescription(effectiveValue);
  return {
    message: `Current effort level: ${effectiveValue} (${description})`,
  };
}

function unsetEffortLevel(): EffortCommandResult {
  const result = updateSettingsForSource('userSettings', {
    effortLevel: undefined,
  });
  if (result.error) {
    return {
      message: `Failed to set effort level: ${result.error.message}`,
    };
  }

  const envOverride = getEffortEnvOverride();
  if (envOverride !== undefined && envOverride !== null) {
    const envRaw = process.env.CLAUDE_CODE_EFFORT_LEVEL;
    return {
      message: `Cleared effort from settings, but CLAUDE_CODE_EFFORT_LEVEL=${envRaw} still controls this session`,
      effortUpdate: { value: undefined },
    };
  }
  return {
    message: 'Effort level set to auto',
    effortUpdate: { value: undefined },
  };
}

export function executeEffort(args: string): EffortCommandResult {
  const normalized = args.toLowerCase();
  if (normalized === 'auto' || normalized === 'unset') {
    return unsetEffortLevel();
  }

  if (!isEffortLevel(normalized)) {
    return {
      message: `Invalid argument: ${args}. Valid options are: low, medium, high, xhigh, auto`,
    };
  }

  return setEffortValue(normalized);
}

function getEffectiveEffortOption(
	appStateEffort: EffortValue | undefined
): EffortOption {
	const envOverride = getEffortEnvOverride();
	const effectiveValue =
		envOverride === null ? undefined : (envOverride ?? appStateEffort);
	if (effectiveValue === undefined || typeof effectiveValue === 'number') {
		return 'auto';
	}

	return effectiveValue as EffortLevel;
}

function ShowCurrentEffort({
	onDone,
}: {
	onDone: EffortOnDone;
}): React.ReactNode {
  const effortValue = useAppState(s => s.effortValue);
  const { message } = showCurrentEffort(effortValue);
  onDone(message);
  return null;
}

function ApplyEffortAndClose({
  result,
  onDone,
}: {
  result: EffortCommandResult;
  onDone: EffortOnDone;
}): React.ReactNode {
  const setAppState = useSetAppState();
  const { effortUpdate, message } = result;
  React.useEffect(() => {
    if (effortUpdate) {
      setAppState(prev => ({
        ...prev,
        effortValue: effortUpdate.value,
      }));
    }
    onDone(message);
  }, [setAppState, effortUpdate, message, onDone]);
  return null;
}

function ApplySelectedEffortAndClose({
	value,
	onDone,
}: {
	value: EffortOption;
	onDone: EffortOnDone;
}): React.ReactNode {
	const result = React.useMemo(
		() => (value === 'auto' ? unsetEffortLevel() : setEffortValue(value)),
		[value]
	);
	return <ApplyEffortAndClose result={result} onDone={onDone} />;
}

function renderOptionLabel(option: EffortOption): string {
	return option === 'auto' ? 'AUTO' : option.toUpperCase();
}

function getOptionSummary(option: EffortOption): string {
	return option === 'auto'
		? 'Use the model default effort level'
		: getEffortValueDescription(option);
}

function EffortPicker({
	onDone,
}: {
	onDone: EffortOnDone;
}): React.ReactNode {
	const effortValue = useAppState(s => s.effortValue);
	const currentValue = getEffectiveEffortOption(effortValue);
	const currentIndex = Math.max(
		0,
		EFFORT_OPTIONS.findIndex(option => option === currentValue)
	);
	const [selectedIndex, setSelectedIndex] = React.useState(currentIndex);
	const [submittedValue, setSubmittedValue] = React.useState<EffortOption | null>(
		null
	);

	useInput((input, key) => {
		if (submittedValue !== null) {
			return;
		}

		if (key.leftArrow) {
			setSelectedIndex(index =>
				index <= 0 ? EFFORT_OPTIONS.length - 1 : index - 1
			);
			return;
		}

		if (key.rightArrow || key.tab) {
			setSelectedIndex(index =>
				index >= EFFORT_OPTIONS.length - 1 ? 0 : index + 1
			);
			return;
		}

		if (key.escape || (key.ctrl && input === 'c')) {
			onDone(
				`Kept effort level as ${chalk.bold(currentValue === 'auto' ? 'auto' : currentValue)}`,
				{ display: 'system' }
			);
			return;
		}

		if (key.return) {
			const nextValue = EFFORT_OPTIONS[selectedIndex] ?? 'auto';
			setSubmittedValue(nextValue);
			return;
		}

		if (input === 'q') {
			onDone(
				`Kept effort level as ${chalk.bold(currentValue === 'auto' ? 'auto' : currentValue)}`,
				{ display: 'system' }
			);
		}
	});

	const selectedValue = EFFORT_OPTIONS[selectedIndex] ?? 'auto';
	const selectedDescription = getOptionSummary(selectedValue);
	const envOverride = getEffortEnvOverride();
	const envNote =
		envOverride !== undefined
			? `Env override: ${envOverride === null ? 'auto' : envOverride}`
			: null;

	if (submittedValue !== null) {
		return (
			<ApplySelectedEffortAndClose
				value={submittedValue}
				onDone={onDone}
			/>
		);
	}

	return (
		<Box paddingX={1} flexDirection="column" marginTop={1}>
			<Box flexDirection="row">
				<Text color="cyanBright">◉ </Text>
				<Text bold color="cyanBright">
					Select effort
				</Text>
			</Box>
			<Text dimColor>
				←/→ 选择，Enter 确认，Esc 取消
			</Text>
			<Box flexDirection="row" marginTop={1} flexWrap="wrap">
				{EFFORT_OPTIONS.map((option, index) => {
					const isSelected = index === selectedIndex;
					const isCurrent = option === currentValue;
					const accent = EFFORT_ACCENTS[option];
					return (
						<Box key={option} marginRight={2}>
							<Text color={isSelected ? accent : 'gray'}>
								{isSelected ? '› ' : '  '}
							</Text>
							<Text color={accent}>● </Text>
							<Text color={isSelected ? accent : undefined} bold={isSelected}>
								{renderOptionLabel(option)}
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

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  args = args?.trim() || '';

  if (COMMON_HELP_ARGS.includes(args)) {
    onDone(
      'Usage: /effort [low|medium|high|xhigh|auto]\n\nEffort levels:\n- low: Quick, straightforward implementation\n- medium: Balanced approach with standard testing\n- high: Comprehensive implementation with extensive testing\n- xhigh: Extended reasoning beyond high\n- auto: Use the default effort level',
    );
    return;
  }

  if (!args) {
    return <EffortPicker onDone={onDone} />;
  }

  if (args === 'current' || args === 'status') {
    return <ShowCurrentEffort onDone={onDone} />;
  }

  const result = executeEffort(args);
  return <ApplyEffortAndClose result={result} onDone={onDone} />;
};
