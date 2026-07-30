// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import * as React from 'react';
import { useState } from 'react';
import { LocalJSXCommandContext } from 'src/types/command';
import { CommandResultDisplay } from 'src/commands';
import { Box, Text, useInput } from 'src/ink.js';
import { Status, buildDiagnostics } from './Status.js';
import { refreshAccountProfile, Usage } from './usage.js';

type Props = {
  onClose: (result?: string, options?: { display?: CommandResultDisplay }) => void;
  context: LocalJSXCommandContext;
  defaultTab: 'Status' |'Usage';
};

export function Settings({ onClose, context, defaultTab }: Props): React.ReactNode {
  const [selectedTab, setSelectedTab] = useState<string>(defaultTab);
  // Refresh the account profile once per Settings session. Both tabs consume
  // this same promise so switching tabs never produces a second request.
  const [profileRefresh] = useState(() => refreshAccountProfile());
  // Kick off diagnostics once when the pane opens. Status use()s this so
  // it resolves once per /config invocation — no re-fetch flash when
  // tabbing back to Status (Tab unmounts children when not selected).
  const [diagnosticsPromise] = useState(() => buildDiagnostics().catch(() => []));//暂时没用这个

  useInput((_input, key) => {
    if (key.escape) {
      onClose('Status dialog dismissed', { display: 'system' });
      return;
    }
    if (key.leftArrow || key.rightArrow || key.tab) {
      setSelectedTab(tab => (tab === 'Status' ? 'Usage' : 'Status'));
    }
  });

  return (
    <Box flexDirection="column" minHeight={9} paddingX={1}>
      <Box borderStyle="round" borderColor="#B784FF" paddingX={1}>
        <Text color={selectedTab === 'Status' ? '#D9A6FF' : 'gray'} bold={selectedTab === 'Status'}>
          Status
        </Text>
        <Text dimColor>  │  </Text>
        <Text color={selectedTab === 'Usage' ? '#D9A6FF' : 'gray'} bold={selectedTab === 'Usage'}>
          Usage
        </Text>
        <Text dimColor>   ←/→ or Tab switch · Esc close</Text>
      </Box>
      <Box flexDirection="column" paddingX={1} paddingTop={1}>
        {selectedTab === 'Status' ? (
          <Status context={context} diagnosticsPromise={diagnosticsPromise} profileRefresh={profileRefresh} />
        ) : (
          <Usage profileRefresh={profileRefresh} />
        )}
      </Box>
    </Box>
  );
}
