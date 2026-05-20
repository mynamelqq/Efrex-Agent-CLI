import chalk from 'chalk';
import * as React from 'react';

import { useAppState, useSetAppState } from '../../state/AppState.js';
import type { LocalJSXCommandCall } from '../../types/command.js';
import { fa } from 'zod/v4/locales';
import { CommandResultDisplay } from '../../types/command.js';

function ModelPickerWrapper({
  onDone,
}: {
  onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void;
}): React.ReactNode {
  const mainLoopModel = useAppState(s => s.mainLoopModel);
  const setAppState = useSetAppState();

  function handleCancel(): void {

    const displayModel = mainLoopModel;
    onDone(`Kept model as ${chalk.bold(displayModel)}`, {
      display: 'system',
    });
  }

  function handleSelect(model: string | null): void {

    setAppState(prev => ({
      ...prev,
      mainLoopModel: model,
    }));

    let message = `Set model to ${chalk.bold(model)}`;

    // Turn off fast mode if switching to unsupported model
    let wasFastModeToggledOn;


    if (wasFastModeToggledOn === false) {
      // Fast mode was toggled off, show suffix after extra usage billing
      message += ` · Fast mode OFF`;
    }

    onDone(message);
  }

  return (
    <ModelPicker
      initial={mainLoopModel}
      onSelect={handleSelect}
      onCancel={handleCancel}
      isStandaloneCommand
    />
  );
}

function SetModelAndClose({
  args,
  onDone,
}: {
  args: string;
  onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void;
}): React.ReactNode {
  const isFastMode = false
  const setAppState = useSetAppState();
  const model = args === 'default' ? null : args;

  React.useEffect(() => {
    async function handleModelChange(): Promise<void> {
      if (model) {
        onDone(`Model '${model}' is not available. Your organization restricts model selection.`, {
          display: 'system',
        });
        return;
      }

      // Skip validation for default model
      if (!model) {
        setModel(null);
        return;
      }

      // Validate and set custom model
      try {
        // Don't use parseUserSpecifiedModel for non-aliases since it lowercases the input
        // and model names are case-sensitive
        const { valid, error } = await validateModel(model);

        if (valid) {
          setModel(model);
        } else {
          onDone(error || `Model '${model}' not found`, {
            display: 'system',
          });
        }
      } catch (error) {
        onDone(`Failed to validate model: ${(error as Error).message}`, {
          display: 'system',
        });
      }
    }

    function setModel(modelValue: string | null): void {
      setAppState(prev => ({
        ...prev,
        mainLoopModel: modelValue,
      }));
      let message = `Set model to ${chalk.bold(renderModelLabel(modelValue))}`;



      onDone(message);
    }

    void handleModelChange();
  }, [model, onDone, setAppState]);

  return null;
}


function ShowModelAndClose({ onDone }: { onDone: (result?: string) => void }): React.ReactNode {
  const mainLoopModel = useAppState(s => s.mainLoopModel);
  const effortValue = useAppState(s => s.effortValue);
  // const displayModel = renderModelLabel(mainLoopModel);
  const effortInfo = effortValue !== undefined ? ` (effort: ${effortValue})` : '';
  onDone(`Current model: ${mainLoopModel}${effortInfo}`);

  return null;
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  args = args?.trim() || '';

  if (args) {
    return <SetModelAndClose args={args} onDone={onDone} />;
  }

  return <ModelPickerWrapper onDone={onDone} />;
};

// function renderModelLabel(model: string | null): string {
//   const rendered = renderDefaultModelSetting(model ?? getDefaultMainLoopModelSetting());
//   return model === null ? `${rendered} (default)` : rendered;
// }
