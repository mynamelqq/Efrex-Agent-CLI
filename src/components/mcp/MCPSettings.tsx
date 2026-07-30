import React from 'react';
import type { CommandResultDisplay } from '../../commands.js';
import { useAppState } from '../../state/AppState.js';
import { MCPListPanel } from './MCPListPanel.js';
import type { ServerInfo } from './types.js';

type Props = {
  onComplete: (
    result?: string,
    options?: { display?: CommandResultDisplay },
  ) => void;
};

export function MCPSettings({ onComplete }: Props): React.ReactNode {
  const mcp = useAppState(s => s.mcp);
  const mcpClients = mcp.clients;



  const servers = React.useMemo<ServerInfo[]>(
    () =>
      mcpClients
        .filter(client => client.name !== 'ide')
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(client => ({
          name: client.name,
          client,
          scope: client.config.scope,
          transport: client.config.type ?? 'stdio',
          config: client.config,
        })),
    [mcpClients],
  );

  return <MCPListPanel servers={servers} onComplete={onComplete} />;
}
