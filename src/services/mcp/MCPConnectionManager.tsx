import React, { createContext, type ReactNode, useContext, useMemo } from 'react';
import type { Command } from 'src/types/command.js';
import type { Tool } from '../../Tool.js';
import type { MCPServerConnection, ScopedMcpServerConfig, ServerResource } from './types.js';
import { useManageMCPConnections } from './useManageMCPConnections.js';
/* 根据 dynamicMcpConfig 初始化 MCP servers
连接每个 server
更新全局 app state
处理断线重连
支持手动重连
支持启用 / 禁用 server */
interface MCPConnectionContextValue {
  reconnectMcpServer: (serverName: string) => Promise<{//重新连接MCP Server
    client: MCPServerConnection;
    tools: Tool[];
    commands: Command[];
    resources?: ServerResource[];
  }>;
  toggleMcpServer: (serverName: string) => Promise<void>;//启用/禁用 MCP server
}

const MCPConnectionContext = createContext<MCPConnectionContextValue | null>(null);

export function useMcpReconnect() {//获取开关和重连函数
  const context = useContext(MCPConnectionContext);
  if (!context) {
    throw new Error('useMcpReconnect must be used within MCPConnectionManager');//如果这些 Hook 没有包在 <MCPConnectionManager> 里面使用，就会抛错
  }
  return context.reconnectMcpServer;
}

export function useMcpToggleEnabled() {
  const context = useContext(MCPConnectionContext);
  if (!context) {
    throw new Error('useMcpToggleEnabled must be used within MCPConnectionManager');
  }
  return context.toggleMcpServer;
}

interface MCPConnectionManagerProps {
  children: ReactNode;
  dynamicMcpConfig: Record<string, ScopedMcpServerConfig> | undefined;
  isStrictMcpConfig: boolean;
}

// TODO (ollie): We may be able to get rid of this context by putting these function on app state
export function MCPConnectionManager({
  children,
  dynamicMcpConfig,
  isStrictMcpConfig,
}: MCPConnectionManagerProps): React.ReactNode {
  const { reconnectMcpServer, toggleMcpServer } = useManageMCPConnections(dynamicMcpConfig, isStrictMcpConfig);//调用连接MCP钩子函数返回开关和重连服务
  const value = useMemo(() => ({ reconnectMcpServer, toggleMcpServer }), [reconnectMcpServer, toggleMcpServer]);

  return <MCPConnectionContext.Provider value={value}>{children}</MCPConnectionContext.Provider>;
}
