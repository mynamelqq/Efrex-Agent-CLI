import figures from 'figures';
import React, { useCallback, useEffect, useState } from 'react';
import type { CommandResultDisplay } from '../../commands.js';
import { Box, Link, Text, useInput } from '../../ink.js';
import type { ConfigScope } from '../../services/mcp/types.js';
import { describeMcpConfigFilePath } from '../../services/mcp/utils.js';
import { plural } from '../../utils/stringUtils.js';
import type { ServerInfo } from './types.js';

type Props = {
  servers: ServerInfo[];
  onSelectServer: (server: ServerInfo) => void;
  onComplete: (result?: string, options?: { display?: CommandResultDisplay }) => void;
};


type StatusPresentation = {
  icon: string;
  label: string;
  color:
    | 'ansi:blackBright'
    | 'ansi:greenBright'
    | 'ansi:yellowBright'
    | 'ansi:redBright';
};

const SCOPE_ORDER: ConfigScope[] = [
  'project',
  'local',
  'user',
  'enterprise',
  'managed',
];

function getScopeHeading(scope: ConfigScope): {
  label: string;
  path?: string;
} {
  switch (scope) {
    case 'project':
      return {
        label: 'Project',
        path: describeMcpConfigFilePath(scope),
      };
    case 'local':
      return {
        label: 'Local',
        path: describeMcpConfigFilePath(scope),
      };
    case 'user':
      return {
        label: 'User',
        path: describeMcpConfigFilePath(scope),
      };
    case 'enterprise':
    case 'managed':
      return { label: 'Managed' };
    case 'dynamic':
      return { label: 'Built-in', path: 'always available' };
    default:
      return { label: scope };
  }
}

function groupServersByScope(
  serverList: ServerInfo[],
): Map<ConfigScope, ServerInfo[]> {
  const groups = new Map<ConfigScope, ServerInfo[]>();

  for (const server of serverList) {
    const group = groups.get(server.scope);
    if (group) {
      group.push(server);
    } else {
      groups.set(server.scope, [server]);
    }
  }

  for (const group of groups.values()) {
    group.sort((a, b) => a.name.localeCompare(b.name));
  }

  return groups;
}

function getStatusPresentation(server: ServerInfo): StatusPresentation {
  switch (server.client.type) {
    case 'connected':
      return {
        icon: figures.tick,
        label: 'connected',
        color: 'ansi:greenBright',
      };
    case 'pending': {
      const { reconnectAttempt, maxReconnectAttempts } = server.client;
      return {
        icon: figures.ellipsis,
        label:
          reconnectAttempt && maxReconnectAttempts
            ? `reconnecting ${reconnectAttempt}/${maxReconnectAttempts}`
            : 'connecting',
        color: 'ansi:yellowBright',
      };
    }
    case 'needs-auth':
      return {
        icon: figures.warning,
        label: 'authentication required',
        color: 'ansi:yellowBright',
      };
    case 'disabled':
      return {
        icon: figures.radioOff,
        label: 'disabled',
        color: 'ansi:blackBright',
      };
    case 'failed':
      return {
        icon: figures.cross,
        label: 'failed',
        color: 'ansi:redBright',
      };
  }
}

function getTransportLabel(transport: string): string {
  switch (transport) {
    case 'stdio':
      return 'STDIO';
    case 'sse':
      return 'SSE';
    case 'http':
      return 'HTTP';
    case 'ws':
    case 'ws-ide':
      return 'WebSocket';
    case 'sdk':
      return 'SDK';
    default:
      return transport.toUpperCase();
  }
}

export function MCPListPanel({
  servers,
  onSelectServer,
  onComplete,
}: Props): React.ReactNode {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const selectableServers = React.useMemo(() => {
    const grouped = groupServersByScope(servers);
    return [
      ...SCOPE_ORDER.flatMap(scope => grouped.get(scope) ?? []),
      ...(grouped.get('dynamic') ?? []),
    ];
  }, [servers]);

  useEffect(() => {
    setSelectedIndex(index =>
      Math.min(index, Math.max(0, selectableServers.length - 1)),
    );
  }, [selectableServers.length]);

  const handleClose = useCallback((): void => {
    onComplete('MCP dialog dismissed', {
      display: 'system',
    });
  }, [onComplete]);

  useInput((input, key) => {
    if (key.upArrow || input === 'k') {
      setSelectedIndex(index =>
        index === 0 ? selectableServers.length - 1 : index - 1,
      );
    } else if (key.downArrow || input === 'j') {
      setSelectedIndex(index =>
        index === selectableServers.length - 1 ? 0 : index + 1,
      );
    } else if (key.return) {
      const server = selectableServers[selectedIndex];
      if (server) onSelectServer(server);
    } else if (key.escape || (key.ctrl && input === 'c')) {
      handleClose();
    }
  });

  const serversByScope = React.useMemo(
    () => groupServersByScope(servers),
    [servers],
  );
  const dynamicServers = serversByScope.get('dynamic') ?? [];
  const visibleScopeCount =
    SCOPE_ORDER.filter(scope => (serversByScope.get(scope)?.length ?? 0) > 0)
      .length + (dynamicServers.length > 0 ? 1 : 0);
  const connectedCount = servers.filter(
    server => server.client.type === 'connected',
  ).length;
  const pendingCount = servers.filter(
    server => server.client.type === 'pending',
  ).length;
  const problemCount = servers.filter(
    server =>
      server.client.type === 'failed' ||
      server.client.type === 'needs-auth',
  ).length;
  const disabledCount = servers.filter(
    server => server.client.type === 'disabled',
  ).length;
  const panelMinHeight = Math.max(
    10,
    servers.length + visibleScopeCount + 7,
  );

  const renderServerItem = (server: ServerInfo): React.ReactNode => {
    const status = getStatusPresentation(server);
    const index = selectableServers.indexOf(server);
    const isSelected = index === selectedIndex;

    return (
      <Box key={server.name}>
        <Text color={isSelected ? 'suggestion' : undefined}>
          {isSelected ? `${figures.pointer} ` : '  '}
        </Text>
        <Text color={status.color}>{status.icon}</Text>
        <Text color={isSelected ? 'suggestion' : undefined}>
          {' '}
          {server.name}
        </Text>
        <Text color="ansi:blackBright">
          {' '}
          · {getTransportLabel(server.transport)}
        </Text>
        <Text color={status.color}> · {status.label}</Text>
      </Box>
    );
  };

  const renderScope = (
    scope: ConfigScope,
    scopeServers: ServerInfo[],
  ): React.ReactNode => {
    if (scopeServers.length === 0) return null;

    const heading = getScopeHeading(scope);
    return (
      <Box key={scope} flexDirection="column" marginBottom={1}>
        <Box>
          <Text bold color="ansi:cyanBright">
            {heading.label}
          </Text>
          <Text color="ansi:blackBright">
            {' '}
            · {scopeServers.length}{' '}
            {plural(scopeServers.length, 'server')}
          </Text>
          {heading.path && (
            <Text color="ansi:blackBright"> · {heading.path}</Text>
          )}
        </Box>
        {scopeServers.map(renderServerItem)}
      </Box>
    );
  };

  return (
    <Box
      flexDirection="column"
      minHeight={panelMinHeight}
      paddingX={1}
    >
      <Box
        borderStyle="round"
        borderColor="#B784FF"
        paddingX={1}
      >
        <Text bold color="#D9A6FF">
          MCP servers
        </Text>
        <Text color="ansi:blackBright">
          {' '}
          · {servers.length} total
        </Text>
        {connectedCount > 0 && (
          <Text color="ansi:greenBright">
            {' '}
            · {connectedCount} connected
          </Text>
        )}
        {pendingCount > 0 && (
          <Text color="ansi:yellowBright">
            {' '}
            · {pendingCount} connecting
          </Text>
        )}
        {problemCount > 0 && (
          <Text color="ansi:redBright">
            {' '}
            · {problemCount} attention
          </Text>
        )}
        {disabledCount > 0 && (
          <Text color="ansi:blackBright">
            {' '}
            · {disabledCount} disabled
          </Text>
        )}
      </Box>

      <Box flexDirection="column" paddingX={1} paddingTop={1}>
        {servers.length === 0 ? (
          <Box flexDirection="column" marginBottom={1}>
            <Text bold>No MCP servers configured</Text>
            <Text color="ansi:blackBright">
              Add a server to your MCP configuration, then restart or reload
              the session.
            </Text>
          </Box>
        ) : (
          <>
            {SCOPE_ORDER.map(scope =>
              renderScope(scope, serversByScope.get(scope) ?? []),
            )}
            {renderScope('dynamic', dynamicServers)}
          </>
        )}

        {problemCount > 0 && (
          <Text color="ansi:yellowBright">
            {figures.warning} Run with debug logging to inspect connection
            errors.
          </Text>
        )}

        <Box>
          <Link url="https://code.claude.com/docs/en/mcp">
            MCP documentation
          </Link>
          <Text color="ansi:blackBright">
            {' '}
            · ↑↓ navigate · Enter details · Esc close
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
