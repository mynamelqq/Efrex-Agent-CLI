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
