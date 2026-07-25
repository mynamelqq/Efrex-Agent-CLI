import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from '../ink.js';
import { ConsoleOAuthFlow } from './ConsoleOAuthFlow.js';
import { WelcomeV2 } from './WelcomeV2.js';
//这个文件主要用于在命令行界面中处理用户的引导流程，包括OAuth认证和欢迎界面。
type StepId = 'oauth';

type OnboardingStep = {
  id: StepId;
  component: React.ReactNode;
};

type Props = {
  onDone(): void;
};

export function Onboarding({ onDone }: Props): React.ReactNode {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const exitState = useExitOnCtrlCConfirm();

  function goToNextStep() {
    if (currentStepIndex < steps.length - 1) {
      setCurrentStepIndex(currentStepIndex + 1);
      return;
    }
    onDone();
  }

  const steps: OnboardingStep[] = [
    {
      id: 'oauth',
      component: <ConsoleOAuthFlow onDone={goToNextStep} />,
    },
  ];

  const currentStep = steps[currentStepIndex];

  return (
    <Box flexDirection="column">
      <WelcomeV2 />
      <Box flexDirection="column" marginTop={1}>
        {currentStep?.component}
        {exitState.pending && (
          <Box padding={1}>
            <Text dimColor>Press {exitState.keyName} again to exit</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}

export function SkippableStep({
  skip,
  onSkip,
  children,
}: {
  skip: boolean;
  onSkip(): void;
  children: React.ReactNode;
}): React.ReactNode {
  useEffect(() => {
    if (skip) {
      onSkip();
    }
  }, [skip, onSkip]);

  if (skip) return null;
  return children;
}

function useExitOnCtrlCConfirm(): { pending: boolean; keyName: string } {
  const [pending, setPending] = useState(false);

  useInput((input, key) => {
    if (!key.ctrl || input.toLowerCase() !== 'c') return;

    if (pending) {
      process.exit(0);
    }

    setPending(true);
    setTimeout(() => setPending(false), 1500);
  });

  return { pending, keyName: 'Ctrl+C' };
}
