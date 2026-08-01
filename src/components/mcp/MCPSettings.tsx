import figures from 'figures';
import React from 'react';
import type { CommandResultDisplay } from '../../commands.js';
import { Box, Text, useInput } from '../../ink.js';
import { useAppState } from '../../state/AppState.js';
import {
  useMcpReconnect,
  useMcpToggleEnabled,
} from '../../services/mcp/MCPConnectionManager.js';
import { describeMcpConfigFilePath, filterToolsByServer } from '../../services/mcp/utils.js';
import type { Tool } from '../../Tool.js';
import { MCPListPanel } from './MCPListPanel.js';
import type { MCPViewState, ServerInfo } from './types.js';

type Props = {
  onComplete: (
    result?: string,
    options?: { display?: CommandResultDisplay },
  ) => void;
};

function MCPServerDetail({
  server,
  onViewTools,
  onBack,
}: {
  server: ServerInfo;
  onViewTools: () => void;
  onBack: () => void;
}): React.ReactNode {
  const mcp = useAppState(state => state.mcp);
  const tools = filterToolsByServer(mcp.tools, server.name);
  const reconnectMcpServer = useMcpReconnect();
  const toggleMcpServer = useMcpToggleEnabled();
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [pendingAction, setPendingAction] = React.useState<
    'reconnect' | 'enable' | 'disable' | null
  >(null);
  const [actionMessage, setActionMessage] = React.useState<string | null>(null);

  const menuOptions = React.useMemo(() => {
    const options: Array<{
      label: string;
      value: 'tools' | 'reconnect' | 'toggle';
    }> = [];

    if (server.client.type !== 'disabled' && tools.length > 0) {
      options.push({ label: `View tools (${tools.length})`, value: 'tools' });
    }
    if (server.client.type !== 'disabled') {
      options.push({ label: 'Reconnect', value: 'reconnect' });
    }
    options.push({
      label: server.client.type === 'disabled' ? 'Enable' : 'Disable',
      value: 'toggle',
    });

    return options;
  }, [server.client.type, tools.length]);

  React.useEffect(() => {
    setSelectedIndex(index => Math.min(index, menuOptions.length - 1));
  }, [menuOptions.length]);

  const runSelectedAction = React.useCallback(async (): Promise<void> => {
    const option = menuOptions[selectedIndex];
    if (!option || pendingAction) return;

    setActionMessage(null);
    if (option.value === 'tools') {
      onViewTools();
      return;
    }

    if (option.value === 'reconnect') {
      setPendingAction('reconnect');
      try {
        const result = await reconnectMcpServer(server.name);
        setActionMessage(
          result.client.type === 'connected'
            ? `${figures.tick} Reconnected successfully`
            : `${figures.warning} Reconnect finished with status: ${result.client.type}`,
        );
      } catch (error) {
        setActionMessage(
          `${figures.cross} Reconnect failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        setPendingAction(null);
      }
      return;
    }

    const toggleAction =
      server.client.type === 'disabled' ? 'enable' : 'disable';
    setPendingAction(toggleAction);
    try {
      await toggleMcpServer(server.name);
      onBack();
    } catch (error) {
      setActionMessage(
        `${figures.cross} ${toggleAction === 'enable' ? 'Enable' : 'Disable'} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      setPendingAction(null);
    }
  }, [
    menuOptions,
    onBack,
    onViewTools,
    pendingAction,
    reconnectMcpServer,
    selectedIndex,
    server.client.type,
    server.name,
    toggleMcpServer,
  ]);

  useInput((input, key) => {
    if (pendingAction) return;

    if (key.upArrow || input === 'k') {
      setSelectedIndex(index =>
        index === 0 ? menuOptions.length - 1 : index - 1,
      );
    } else if (key.downArrow || input === 'j' || key.tab) {
      setSelectedIndex(index =>
        index === menuOptions.length - 1 ? 0 : index + 1,
      );
    } else if (key.return) {
      void runSelectedAction();
    } else if (key.escape || (key.ctrl && input === 'c')) {
      onBack();
    }
  });

  const status =
    server.client.type === 'connected'
      ? `${figures.tick} connected`
      : server.client.type === 'pending'
        ? `${figures.ellipsis} connecting`
        : server.client.type === 'needs-auth'
          ? `${figures.warning} authentication required`
          : server.client.type === 'disabled'
            ? `${figures.radioOff} disabled`
            : `${figures.cross} failed`;
  const config = server.config;
  const endpoint =
    'command' in config
      ? [config.command, ...(config.args ?? [])].join(' ')
      : 'url' in config
        ? config.url
        : undefined;

  return (
    <Box flexDirection="column" minHeight={10} paddingX={1}>
      <Box borderStyle="round" borderColor="#B784FF" paddingX={1}>
        <Text bold color="#D9A6FF">
          {server.name} MCP server
        </Text>
      </Box>
      <Box flexDirection="column" paddingX={1} paddingTop={1}>
        <Text>
          <Text bold>Status: </Text>
          {status}
        </Text>
        <Text>
          <Text bold>Transport: </Text>
          {server.transport.toUpperCase()}
        </Text>
        {endpoint && (
          <Text>
            <Text bold>{'command' in config ? 'Command: ' : 'URL: '}</Text>
            {endpoint}
          </Text>
        )}
        <Text>
          <Text bold>Scope: </Text>
          {server.scope} · {describeMcpConfigFilePath(server.scope)}
        </Text>
        {server.client.type === 'failed' && server.client.error && (
          <Text color="ansi:redBright">
            <Text bold>Error: </Text>
            {server.client.error}
          </Text>
        )}
        <Box flexDirection="column" marginTop={1} minHeight={3}>
          {pendingAction ? (
            <Text color="ansi:yellowBright">
              {figures.ellipsis}{' '}
              {pendingAction === 'reconnect'
                ? `Reconnecting ${server.name}...`
                : `${pendingAction === 'enable' ? 'Enabling' : 'Disabling'} ${server.name}...`}
            </Text>
          ) : (
            menuOptions.map((option, index) => {
              const selected = index === selectedIndex;
              return (
                <Text
                  key={option.value}
                  color={selected ? 'suggestion' : 'ansi:blackBright'}
                  bold={selected}
                >
                  {selected ? `${figures.pointer} ` : '  '}
                  {option.label}
                </Text>
              );
            })
          )}
        </Box>
        <Box height={1}>
          {actionMessage ? (
            <Text
              color={
                actionMessage.startsWith(figures.tick)
                  ? 'ansi:greenBright'
                  : actionMessage.startsWith(figures.warning)
                    ? 'ansi:yellowBright'
                    : 'ansi:redBright'
              }
            >
              {actionMessage}
            </Text>
          ) : (
            <Text> </Text>
          )}
        </Box>
        <Text color="ansi:blackBright">
          {pendingAction ? 'Please wait' : '↑↓ navigate · Enter select · Esc back'}
        </Text>
      </Box>
    </Box>
  );
}

function getToolDisplayName(tool: Tool): string {
  return tool.mcpInfo?.toolName ?? tool.name.split('__').at(-1) ?? tool.name;
}

const TOOL_VISIBLE_COUNT = 6;

function getVisibleToolWindow(
  tools: Tool[],
  selectedIndex: number,
): { tools: Tool[]; startIndex: number } {
  if (tools.length <= TOOL_VISIBLE_COUNT) {
    return { tools, startIndex: 0 };
  }

  const centeredStart = selectedIndex - Math.floor(TOOL_VISIBLE_COUNT / 2);
  const startIndex = Math.max(
    0,
    Math.min(centeredStart, tools.length - TOOL_VISIBLE_COUNT),
  );
  return {
    tools: tools.slice(startIndex, startIndex + TOOL_VISIBLE_COUNT),
    startIndex,
  };
}

function MCPToolList({
  server,
  onSelectTool,
  onBack,
}: {
  server: ServerInfo;
  onSelectTool: (index: number) => void;
  onBack: () => void;
}): React.ReactNode {
  const allTools = useAppState(state => state.mcp.tools);
  const tools = filterToolsByServer(allTools, server.name);
  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const visibleWindow = getVisibleToolWindow(tools, selectedIndex);

  useInput((input, key) => {
    if (key.upArrow || input === 'k') {
      setSelectedIndex(index => (index === 0 ? tools.length - 1 : index - 1));
    } else if (key.downArrow || input === 'j') {
      setSelectedIndex(index => (index === tools.length - 1 ? 0 : index + 1));
    } else if (key.return && tools[selectedIndex]) {
      onSelectTool(selectedIndex);
    } else if (key.escape || (key.ctrl && input === 'c')) {
      onBack();
    }
  });

  return (
    <Box flexDirection="column" minHeight={10} paddingX={1}>
      <Box borderStyle="round" borderColor="#B784FF" paddingX={1}>
        <Text bold color="#D9A6FF">
          Tools for {server.name}
        </Text>
        <Text color="ansi:blackBright"> · {tools.length}</Text>
      </Box>
      <Box flexDirection="column" paddingX={1} paddingTop={1}>
        {tools.length === 0 ? (
          <Text color="ansi:blackBright">No tools available</Text>
        ) : (
          visibleWindow.tools.map((tool, visibleIndex) => {
            const absoluteIndex = visibleWindow.startIndex + visibleIndex;
            const selected = absoluteIndex === selectedIndex;
            const readOnly = tool.isReadOnly?.({} as never) ?? false;
            return (
              <Box key={tool.name}>
                <Text color={selected ? 'suggestion' : undefined}>
                  {selected ? `${figures.pointer} ` : '  '}
                  {getToolDisplayName(tool)}
                </Text>
                {readOnly && (
                  <Text color="ansi:greenBright"> · read-only</Text>
                )}
              </Box>
            );
          })
        )}
        {tools.length > TOOL_VISIBLE_COUNT && (
          <Text color="ansi:blackBright">
            Showing {visibleWindow.startIndex + 1}–
            {visibleWindow.startIndex + visibleWindow.tools.length} of{' '}
            {tools.length} · selected {selectedIndex + 1}
          </Text>
        )}
        <Text color="ansi:blackBright">
          ↑↓ navigate · Enter details · Esc back
        </Text>
      </Box>
    </Box>
  );
}

function MCPToolDetail({
  tool,
  server,
  onBack,
}: {
  tool: Tool;
  server: ServerInfo;
  onBack: () => void;
}): React.ReactNode {
  const [description, setDescription] = React.useState('');

  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === 'c')) onBack();
  });

  React.useEffect(() => {
    void tool
      .description({} as never, {
        isNonInteractiveSession: false,
        toolPermissionContext: {
          mode: 'default',
          alwaysAllowRules: {},
          alwaysDenyRules: {},
          alwaysAskRules: {},
          isBypassPermissionsModeAvailable: false,
        },
        tools: [],
      })
      .then(setDescription)
      .catch(() => setDescription('Failed to load description'));
  }, [tool]);

  const properties = tool.inputJSONSchema?.properties ?? {};
  const required = (tool.inputJSONSchema?.required as string[] | undefined) ?? [];

  return (
    <Box flexDirection="column" minHeight={10} paddingX={1}>
      <Box borderStyle="round" borderColor="#B784FF" paddingX={1}>
        <Text bold color="#D9A6FF">
          {getToolDisplayName(tool)}
        </Text>
        <Text color="ansi:blackBright"> · {server.name}</Text>
      </Box>
      <Box flexDirection="column" paddingX={1} paddingTop={1}>
        <Text>
          <Text bold>Full name: </Text>
          {tool.name}
        </Text>
        {description && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Description:</Text>
            <Text wrap="wrap">{description}</Text>
          </Box>
        )}
        {Object.keys(properties).length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Parameters:</Text>
            {Object.entries(properties).map(([name, schema]) => {
              const value = schema as Record<string, unknown>;
              return (
                <Text key={name}>
                  {'  '}
                  {figures.bullet} {name}
                  {required.includes(name) ? ' (required)' : ''}: {String(value.type ?? 'unknown')}
                  {value.description ? ` · ${String(value.description)}` : ''}
                </Text>
              );
            })}
          </Box>
        )}
        <Text color="ansi:blackBright">Esc back</Text>
      </Box>
    </Box>
  );
}

export function MCPSettings({ onComplete }: Props): React.ReactNode {
  const mcp = useAppState(state => state.mcp);
  const mcpClients = mcp.clients;
  const [viewState, setViewState] = React.useState<MCPViewState>({
    type: 'list',
  });
  const servers = React.useMemo<ServerInfo[]>(
    () =>
      mcpClients
        .filter(client => client.name !== 'ide')
        .map(client => ({
          name: client.name,
          client,
          scope: client.config.scope,
          transport: client.config.type ?? 'stdio',
          config: client.config,
        })),
    [mcpClients],
  );

  if (viewState.type === 'server-detail') {
    const currentServer =
      servers.find(server => server.name === viewState.server.name) ??
      viewState.server;
    return (
      <MCPServerDetail
        server={currentServer}
        onViewTools={() =>
          setViewState({ type: 'server-tools', server: currentServer })
        }
        onBack={() => setViewState({ type: 'list' })}
      />
    );
  }

  if (viewState.type === 'server-tools') {
    return (
      <MCPToolList
        server={viewState.server}
        onSelectTool={toolIndex =>
          setViewState({
            type: 'tool-detail',
            server: viewState.server,
            toolIndex,
          })
        }
        onBack={() =>
          setViewState({ type: 'server-detail', server: viewState.server })
        }
      />
    );
  }

  if (viewState.type === 'tool-detail') {
    const tools = filterToolsByServer(
      mcp.tools,
      viewState.server.name,
    );
    const tool = tools[viewState.toolIndex];
    if (!tool) {
      return (
        <MCPToolList
          server={viewState.server}
          onSelectTool={toolIndex =>
            setViewState({
              type: 'tool-detail',
              server: viewState.server,
              toolIndex,
            })
          }
          onBack={() =>
            setViewState({ type: 'server-detail', server: viewState.server })
          }
        />
      );
    }
    return (
      <MCPToolDetail
        tool={tool}
        server={viewState.server}
        onBack={() =>
          setViewState({ type: 'server-tools', server: viewState.server })
        }
      />
    );
  }

  return (
    <MCPListPanel
      servers={servers}
      onSelectServer={server =>
        setViewState({ type: 'server-detail', server })
      }
      onComplete={onComplete}
    />
  );
}
