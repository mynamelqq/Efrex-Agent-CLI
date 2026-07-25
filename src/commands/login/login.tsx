import { feature } from 'bun:bundle';
import * as React from 'react';
import { resetCostState } from '../../bootstrap/state.js';
import type { LocalJSXCommandContext } from '../../types/command.js';
import { ConsoleOAuthFlow } from '../../components/ConsoleOAuthFlow.js';
import { PermissionDialog } from '../../components/permissions/PermissionDialog.js';
import { Box, Text } from '../../ink.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { stripSignatureBlocks } from 'src/utils/messages.js';

export async function call(onDone: LocalJSXCommandOnDone, context: LocalJSXCommandContext): Promise<React.ReactNode> {
  return (
    <Login
      onDone={async success => {
        context.onChangeAPIKey();
        // Signature-bearing blocks (thinking, connector_text) are bound to the API key —
        // strip them so the new key doesn't reject stale signatures.
        context.setMessages(stripSignatureBlocks);
        if (success) {
          // Post-login refresh logic. Keep in sync with onboarding in src/interactiveHelpers.tsx
          // Reset cost state when switching accounts
          resetCostState();
          const appState = context.getAppState();
          // Increment authVersion to trigger re-fetching of auth-dependent data in hooks (e.g., MCP servers)
          context.setAppState(prev => ({
            ...prev,
            authVersion: prev.authVersion + 1,
          }));
        }
        onDone(success ? 'Login successful' : 'Login interrupted');
      }}
      onSettingsChanged={context.onChangeAPIKey}
    />
  );
}

export function Login(props: {
  onDone: (success: boolean) => void;
  onSettingsChanged?: () => void;
  startingMessage?: string;
}): React.ReactNode {
  const completed = React.useRef(false);
  const [closing, setClosing] = React.useState<'success' | 'cancelled' | null>(null);

  const finish = (success: boolean) => {
    if (completed.current) return;
    completed.current = true;
    setClosing(success ? 'success' : 'cancelled');
    // Give the renderer one commit with the dialog's height preserved before
    // the command result replaces the JSX subtree.
    setTimeout(() => props.onDone(success), 0);
  };

  if (closing) {
    return (
      <PermissionDialog title="Login" color="ansi:cyanBright">
        <Box flexDirection="column" minHeight={6}>
          <Text dimColor>
            {closing === 'cancelled' ? 'Closing login…' : 'Applying login…'}
          </Text>
        </Box>
      </PermissionDialog>
    );
  }

  return (
    <PermissionDialog
      title="Login"
      color="ansi:cyanBright"
    >
      <ConsoleOAuthFlow
        onDone={() => finish(true)}
        onCancel={() => finish(false)}
        onSettingsChanged={props.onSettingsChanged}
        startingMessage={props.startingMessage}
      />
    </PermissionDialog>
  );
}
