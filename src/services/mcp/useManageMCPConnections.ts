import { useCallback, useEffect, useRef } from 'react'
import type { Command } from 'src/types/command.js'
import type { Tool } from '../../Tool.js'
import { getSessionId } from '../../bootstrap/state.js'
import {
  clearServerCache,
  connectToServer,
} from './client.js'
import type {
  MCPServerConnection,
  ScopedMcpServerConfig,
  ServerResource,
} from './types.js'
import { useAppStateStore, useSetAppState } from '../../state/AppState.js'
import { errorMessage } from '../../utils/errors.js'
import { logMCPDebug, logMCPError } from '../../utils/log.js'

const MAX_RECONNECT_ATTEMPTS = 5
const INITIAL_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 30000

type PendingUpdate = MCPServerConnection & {
  tools?: Tool[]
  commands?: Command[]
  resources?: ServerResource[]
}

async function connectServer(
  name: string,
  config: ScopedMcpServerConfig,
): Promise<{
  client: MCPServerConnection
  tools: Tool[]
  commands: Command[]
  resources?: ServerResource[]
}> {
  const client = await connectToServer(name, config)
  return {
    client,
    tools: [],
    commands: [],
    resources: undefined,
  }
}

export function useManageMCPConnections(
  dynamicMcpConfig: Record<string, ScopedMcpServerConfig> | undefined,
  _isStrictMcpConfig = false,
) {
  const store = useAppStateStore()
  const setAppState = useSetAppState()
  const reconnectTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map())

  const updateServer = useCallback(
    (update: PendingUpdate) => {
      setAppState(prevState => {
        const { tools: rawTools, commands: rawCommands, resources, ...client } =//拿出工具命令资源
          update

        const nextClients = [//把剩下的字段都放进 client。就是MCPServerConnection状态
          ...prevState.mcp.clients.filter(existing => existing.name !== client.name),
          client,
        ]

        return {
          ...prevState,
          mcp: {
            ...prevState.mcp,
            clients: nextClients,
            tools: rawTools ?? prevState.mcp.tools,
            commands: rawCommands ?? prevState.mcp.commands,
            resources:
              resources === undefined
                ? prevState.mcp.resources
                : {
                    ...prevState.mcp.resources,
                    [client.name]: resources,
                  },
          },
        }
      })
    },
    [setAppState],
  )

  const onConnectionAttempt = useCallback(
    ({
      client,
      tools,
      commands,
      resources,
    }: {
      client: MCPServerConnection
      tools: Tool[]
      commands: Command[]
      resources?: ServerResource[]
    }) => {
      updateServer({ ...client, tools, commands, resources })

      if (client.type !== 'connected') {
        return
      }

      client.client.onclose = () => {
        const configType = client.config.type ?? 'stdio'

        void clearServerCache(client.name, client.config).catch(() => {
          logMCPDebug(
            client.name,
            `Failed to invalidate the server cache: ${client.name}`,
          )
        })

        if (configType === 'stdio' || configType === 'sdk') {
          updateServer({ ...client, type: 'failed' })
          return
        }

        const existingTimer = reconnectTimersRef.current.get(client.name)
        if (existingTimer) {
          clearTimeout(existingTimer)
          reconnectTimersRef.current.delete(client.name)
        }

        const transportType = getTransportDisplayName(configType)
        logMCPDebug(
          client.name,
          `${transportType} transport closed, attempting automatic reconnection`,
        )

        const reconnectWithBackoff = async () => {
          for (let attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS; attempt++) {
            updateServer({
              ...client,
              type: 'pending',
              reconnectAttempt: attempt,
              maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS,
            })

            try {
              const result = await connectServer(client.name, client.config)
              if (result.client.type === 'connected') {
                reconnectTimersRef.current.delete(client.name)
                onConnectionAttempt(result)
                return
              }

              if (attempt === MAX_RECONNECT_ATTEMPTS) {
                reconnectTimersRef.current.delete(client.name)
                onConnectionAttempt(result)
                return
              }
            } catch (error) {
              if (attempt === MAX_RECONNECT_ATTEMPTS) {
                reconnectTimersRef.current.delete(client.name)
                updateServer({
                  name: client.name,
                  type: 'failed',
                  config: client.config,
                  error: errorMessage(error),
                })
                return
              }
            }

            const backoffMs = Math.min(
              INITIAL_BACKOFF_MS * 2 ** (attempt - 1),
              MAX_BACKOFF_MS,
            )

            await new Promise<void>(resolve => {
              const timer = setTimeout(resolve, backoffMs)
              reconnectTimersRef.current.set(client.name, timer)
            })
          }
        }

        void reconnectWithBackoff()
      }
    },
    [updateServer],
  )

  const sessionId = getSessionId()

  useEffect(() => {
    let cancelled = false

    async function initializeAndConnectServers() {//初始化连接
      const configs: Record<string, ScopedMcpServerConfig> = dynamicMcpConfig ?? {}

      const nextClients = Object.entries(configs).map(([name, config]) => ({//把所有 server 先标记为 pending
        name,
        type: 'pending' as const,
        config,
      }))

      setAppState(prevState => ({//更新状态
        ...prevState,
        mcp: {
          ...prevState.mcp,
        
          clients: nextClients,
        },
      }))

      for (const [name, config] of Object.entries(configs)) {//对每一个MCP server config
        if (cancelled) {//如果取消了 就全部不要
          continue
        }

        try {
          const result = await connectServer(name, config)//连接服务器
          if (!cancelled) {//如果没有取消尝试重连
            onConnectionAttempt(result)
          }
        } catch (error) {
          if (!cancelled) {
            updateServer({
              name,
              type: 'failed',//失败
              config,
              error: errorMessage(error),
              tools: [],
              commands: [],
            })
          }
        }
      }
    }

    void initializeAndConnectServers().catch(error => {
      logMCPError(
        'useManageMCPConnections',
        `Failed to initialize MCP servers: ${errorMessage(error)}`,
      )
    })

    return () => {
      cancelled = true
    }
  }, [
    dynamicMcpConfig,
    onConnectionAttempt,
    setAppState,
    sessionId,
  ])

  useEffect(() => {
    const timers = reconnectTimersRef.current
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer)
      }
      timers.clear()
    }
  }, [])

  const reconnectMcpServer = useCallback(
    async (serverName: string) => {
      const client = store.getState().mcp.clients.find(c => c.name === serverName)
      if (!client) {
        throw new Error(`MCP server ${serverName} not found`)
      }

      const existingTimer = reconnectTimersRef.current.get(serverName)
      if (existingTimer) {
        clearTimeout(existingTimer)
        reconnectTimersRef.current.delete(serverName)
      }

      updateServer({
        name: serverName,
        type: 'pending',
        config: client.config,
      })

      const result = await connectServer(serverName, client.config)
      onConnectionAttempt(result)
      return result
    },
    [store, onConnectionAttempt, updateServer],
  )

  const toggleMcpServer = useCallback(
    async (serverName: string): Promise<void> => {
      const client = store.getState().mcp.clients.find(c => c.name === serverName)
      if (!client) {
        throw new Error(`MCP server ${serverName} not found`)
      }

      const isCurrentlyDisabled = client.type === 'disabled'

      if (!isCurrentlyDisabled) {
        const existingTimer = reconnectTimersRef.current.get(serverName)
        if (existingTimer) {
          clearTimeout(existingTimer)
          reconnectTimersRef.current.delete(serverName)
        }

        if (client.type === 'connected') {
          await clearServerCache(serverName, client.config)
        }

        updateServer({
          name: serverName,
          type: 'disabled',
          config: client.config,
          tools: [],
          commands: [],
          resources: [],
        })
        return
      }

      updateServer({
        name: serverName,
        type: 'pending',
        config: client.config,
      })

      const result = await connectServer(serverName, client.config)
      onConnectionAttempt(result)
    },
    [store, updateServer, onConnectionAttempt],
  )

  return { reconnectMcpServer, toggleMcpServer }
}

function getTransportDisplayName(type: string): string {
  switch (type) {
    case 'http':
      return 'HTTP'
    case 'ws':
    case 'ws-ide':
      return 'WebSocket'
    default:
      return 'SSE'
  }
}
