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

const EFFORT_ACCENTS = {
	auto: 'ansi:blackBright',
	low: 'ansi:greenBright',
	medium: 'ansi:cyanBright',
	high: 'ansi:yellowBright',
	xhigh: 'ansi:magentaBright',
} as const;

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
    const envRaw = process.env.EFFORT_LEVEL;
    if (persistable === undefined) {
      return {
        message: `Not applied: EFFORT_LEVEL=${envRaw} overrides effort this session, and ${effortValue} is session-only (nothing saved)`,
        effortUpdate: { value: effortValue },
      };
    }
    return {
      message: `EFFORT_LEVEL=${envRaw} overrides this session — clear it and ${effortValue} takes over`,
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
	const labels: Record<EffortOption, string> = {
		auto: 'Auto',
		low: 'Low',
		medium: 'Medium',
		high: 'High',
		xhigh: 'Extra high',
	};

	return labels[option];
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
				<Text color="ansi:cyanBright">◉ </Text>
				<Text bold color="ansi:cyanBright">
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
							<Text
								color={isSelected ? accent : 'ansi:blackBright'}
							>
								{isSelected ? '› ' : '  '}
							</Text>
							<Text color={accent}>● </Text>
							<Text color={accent} bold={isSelected}>
								{renderOptionLabel(option)}
							</Text>
							{option === 'low' ? (
								<Text color="ansi:green"> (default)</Text>
							) : null}
							{isCurrent ? (
								<Text color="ansi:whiteBright">
									{' · current'}
								</Text>
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
