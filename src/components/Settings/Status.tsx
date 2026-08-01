import * as React from 'react';
import { useEffect, useState } from 'react';
import { getSessionId } from '../../bootstrap/state.js';
import type { LocalJSXCommandContext } from 'src/types/command.js';
import { Box, Text } from '@anthropic/ink';
import { useAppState } from '../../state/AppState.js';
import { getCwd } from '../../utils/cwd.js';
import { getCurrentSessionTitle } from '../../utils/sessionStorage.js';
import { getOauthAccountInfo } from '../../utils/auth.js';
import { getPlanPresentation } from './usage.js';
import { getContextWindowForModel } from '../../context.js';
import { roughTokenCountEstimationForMessages } from '../../services/tokenEstimation.js';
export type Diagnostic = React.ReactNode;

export type Property = {
  label?: string;
  value: React.ReactNode | Array<string>;
};
type Props = {
  context: LocalJSXCommandContext;
  diagnosticsPromise: Promise<Diagnostic[]>;
  profileRefresh: Promise<boolean>;
};

function buildPrimarySection(model: string): Property[] {
  const sessionId = getSessionId();
  const customTitle = getCurrentSessionTitle(sessionId);
  const nameValue = customTitle ?? <Text dimColor>/rename to add a name</Text>;

  return [
    { label: 'Version', value: MACRO.VERSION },
    { label: 'Active model', value: model },
    { label: 'Session name', value: nameValue },
    { label: 'Session ID', value: sessionId },
    { label: 'cwd', value: getCwd() },
  ];
}

function buildAccountSection(account: ReturnType<typeof getOauthAccountInfo>): Property[] {
  if (!account) {
    return [{ label: 'Status', value: <Text dimColor>Not logged in · use /login to connect your account</Text> }];
  }

  const plan = getPlanPresentation(account.plan);
  return [
    { label: 'Status', value: <Text color="success">Logged in</Text> },
    { label: 'Email', value: account.email },
    { label: 'User ID', value: String(account.id) },
    ...(plan ? [{ label: 'Plan', value: plan.label }] : []),
    ...(account.availableModels?.length
      ? [{ label: 'Models', value: account.availableModels }]
      : []),
  ];
}

export async function buildDiagnostics(): Promise<Diagnostic[]> {
  return [
  ];
}

function PropertyValue({ value }: { value: Property['value'] }): React.ReactNode {
  if (Array.isArray(value)) {
    return (
      <Box flexWrap="wrap" columnGap={1} flexShrink={99}>
        {value.map((item, i) => {
          return (
            <Text key={i}>
              {item}
              {i < value.length - 1 ? ',' : ''}
            </Text>
          );
        })}
      </Box>
    );
  }

  if (typeof value === 'string') {
    return <Text>{value}</Text>;
  }

  return value;
}

export function Status({ context, diagnosticsPromise, profileRefresh }: Props): React.ReactNode {
  const mainLoopModel = useAppState(s => s.mainLoopModel);
  const [account, setAccount] = useState(() => getOauthAccountInfo());
	const contextWindow = getContextWindowForModel(mainLoopModel);
	const currentContextTokens = roughTokenCountEstimationForMessages(context.messages);
	const contextWindowText = `${(currentContextTokens / 1000).toFixed(1)}k / ${(contextWindow / 1000).toFixed(1)}k tokens`;

  useEffect(() => {
    void profileRefresh.then(refreshed => {
      if (refreshed) setAccount(getOauthAccountInfo());
    });
  }, [profileRefresh]);

  // Sections are synchronous — compute in render so they're never empty.
  // diagnosticsPromise is created once in Settings.tsx so it resolves once
  // per pane invocation instead of re-fetching on every tab switch (Tab
  // unmounts children when not selected, which was causing the flash).
  const sections = React.useMemo(
    () => [
      {
        title: 'Session',
        properties: [
          ...buildPrimarySection(mainLoopModel),
          { label: 'Context window', value: contextWindowText },
        ],
      },
      { title: 'Account & usage', properties: buildAccountSection(account) },
    ],
    [mainLoopModel, account, contextWindowText],
  );

  // flexGrow so the "Esc to cancel" footer pins to the bottom of the
  // Modal's inner ScrollBox when content is short. The ScrollBox content
  // wrapper has flexGrow:1 (fills at least the viewport), so this stretches
  // to match. Without it, short Status content floats at the top and the
  // footer sits mid-modal with 2-3 trailing blank rows below. Outside a
  // Modal (non-fullscreen), leave layout alone — no ScrollBox to fill.
  return (
    <Box flexDirection="column">
      <Box flexDirection="column" gap={1}>
        {sections.map(
          ({ title, properties }) =>
            properties.length > 0 && (
              <Box key={title} flexDirection="column">
                <Text bold color="permission">{title}</Text>
                {properties.map(({ label, value }, j) => (
                  <Box key={j} flexDirection="row" gap={1} flexShrink={0} paddingLeft={1}>
                    {label !== undefined && (
                      <Box width={16} flexShrink={0}>
                        <Text dimColor>{label}</Text>
                      </Box>
                    )}
                    <PropertyValue value={value} />
                  </Box>
                ))}
              </Box>
            ),
        )}

      </Box>
    </Box>
  );
}
