import type {
  ConfigScope,
  MCPServerConnection,
  ScopedMcpServerConfig,
} from '../../services/mcp/types.js';

export type ServerInfo = {
  name: string;
  client: MCPServerConnection;
  scope: ConfigScope;
  transport: string;
  config: ScopedMcpServerConfig;
};

export type MCPViewState =
  | { type: 'list' }
  | { type: 'server-detail'; server: ServerInfo }
  | { type: 'server-tools'; server: ServerInfo }
  | { type: 'tool-detail'; server: ServerInfo; toolIndex: number };
