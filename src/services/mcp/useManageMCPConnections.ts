import { useCallback, useEffect, useRef } from 'react'
import type { Command } from 'src/types/command.js'
import type { Tool } from '../../Tool.js'
import { getSessionId } from '../../bootstrap/state.js'
import reject from 'lodash/reject.js'
import omit from 'lodash/omit.js'
import {
  isMcpServerDisabled,
} from 'src/services/mcp/config.js'
import {
  clearServerCache,
  connectToServer,
  getMcpToolsCommandsAndResources,
} from './client.js'
import type {
  MCPServerConnection,
  ScopedMcpServerConfig,
  ServerResource,
} from './types.js'
import { AppState, useAppStateStore, useSetAppState } from '../../state/AppState.js'
import { errorMessage } from '../../utils/errors.js'
import { logMCPDebug, logMCPError } from '../../utils/log.js'
import { PluginError } from 'src/types/plugin.js'
import { getMcpPrefix } from 'src/utils/mcpStringUtils.js'
import { commandBelongsToServer } from './utils.js'
import { getClaudeCodeMcpConfigs } from './config.js'
import { logForDebugging } from '../../utils/debug.js'

const MAX_RECONNECT_ATTEMPTS = 5
const INITIAL_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 30000
/**
 * Create a unique key for a plugin error to enable deduplication
 */
function getErrorKey(error: PluginError): string {
  const plugin = 'plugin' in error ? error.plugin : 'no-plugin'
  return `${error.type}:${error.source}:${plugin}`
}

/**
 * 向 AppState 添加错误，消除重复以避免多次显示相同的错误
 */
function addErrorsToAppState(
  setAppState: (updater: (prev: AppState) => AppState) => void,
  newErrors: PluginError[],
): void {
  if (newErrors.length === 0) return

  setAppState(prevState => {
    // Build set of existing error keys
    const existingKeys = new Set(
      prevState.plugins.errors.map(e => getErrorKey(e)),
    )

    // Only add errors that don't already exist
    const uniqueNewErrors = newErrors.filter(
      error => !existingKeys.has(getErrorKey(error)),
    )

    if (uniqueNewErrors.length === 0) {
      return prevState
    }

    return {
      ...prevState,
      plugins: {
        ...prevState.plugins,
        errors: [...prevState.plugins.errors, ...uniqueNewErrors],
      },
    }
  })
}

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
  const MCP_BATCH_FLUSH_MS = 16
  const pendingUpdatesRef = useRef<PendingUpdate[]>([])
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flushPendingUpdates = useCallback(() => {
    flushTimerRef.current = null
    const updates = pendingUpdatesRef.current
    if (updates.length === 0) return
    pendingUpdatesRef.current = []

    setAppState(prevState => {
      let mcp = prevState.mcp

      for (const update of updates) {
        const {
          tools: rawTools,
          commands: rawCmds,
          resources: rawRes,
          ...client
        } = update
        const tools =
          client.type === 'disabled' || client.type === 'failed'
            ? (rawTools ?? [])
            : rawTools
        const commands =
          client.type === 'disabled' || client.type === 'failed'
            ? (rawCmds ?? [])
            : rawCmds
        const resources =
          client.type === 'disabled' || client.type === 'failed'
            ? (rawRes ?? [])
            : rawRes

        logForDebugging('mcp: applying connection update', {
          level: 'debug',
          server: client.name,
          status: client.type,
          toolCount: tools?.length ?? 0,
          toolNames: tools?.map(tool => tool.name) ?? [],
          previousToolCount: mcp.tools.length,
        })

        const prefix = getMcpPrefix(client.name)
        const existingClientIndex = mcp.clients.findIndex(
          c => c.name === client.name,
        )

        const updatedClients =
          existingClientIndex === -1
            ? [...mcp.clients, client]
            : mcp.clients.map(c => (c.name === client.name ? client : c))

        const updatedTools =
          tools === undefined
            ? mcp.tools
            : [...reject(mcp.tools, t => t.name?.startsWith(prefix)), ...tools]

        const updatedCommands =
          commands === undefined
            ? mcp.commands
            : [
                ...reject(mcp.commands, c =>
                  commandBelongsToServer(c, client.name),
                ),
                ...commands,
              ]

        const updatedResources =
          resources === undefined
            ? mcp.resources
            : {
                ...mcp.resources,
                ...(resources.length > 0
                  ? { [client.name]: resources }
                  : omit(mcp.resources, client.name)),
              }

        mcp = {
          ...mcp,
          clients: updatedClients,
          tools: updatedTools,
          commands: updatedCommands,
          resources: updatedResources,
        }
      }

      logForDebugging('mcp: state tools after connection updates', {
        level: 'debug',
        toolCount: mcp.tools.length,
        toolNames: mcp.tools.map(tool => tool.name),
      })

      return { ...prevState, mcp }
    })
  }, [setAppState])
    // 更新服务器状态、工具、命令和资源。
  // 当工具、命令或资源未定义时，现有值将被保留。
  // 当类型为“禁用”或“失败”时，工具/命令/资源将自动清除。
  // 通过 setTimeout 对更新进行批处理，以合并在 MCP_BATCH_FLUSH_MS 内到达的更新。
  const updateServer = useCallback(
    (update: PendingUpdate) => {
      pendingUpdatesRef.current.push(update)
      if (flushTimerRef.current === null) {
        flushTimerRef.current = setTimeout(
          flushPendingUpdates,
          MCP_BATCH_FLUSH_MS,
        )
      }
    },
    [flushPendingUpdates],
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
    async function initializeServersAsPending() {
      const { servers: existingConfigs, errors: mcpErrors } =
        await getClaudeCodeMcpConfigs(dynamicMcpConfig)
      const configs = { ...existingConfigs, ...dynamicMcpConfig }

      // Add MCP errors to plugin errors for UI visibility (deduplicated)
      addErrorsToAppState(setAppState, mcpErrors)

      setAppState(prevState => {
        const existingServerNames = new Set(
          prevState.mcp.clients.map(c => c.name),
        )
        const newClients = Object.entries(configs)
          .filter(([name]) => !existingServerNames.has(name))
          .map(([name, config]) => ({
            name,
            type: isMcpServerDisabled(name)
              ? ('disabled' as const)
              : ('pending' as const),
            config,
          }))

        if (newClients.length === 0) {
          return prevState
        }

        return {
          ...prevState,
          mcp: {
            ...prevState.mcp,
            clients: [...prevState.mcp.clients, ...newClients],
          },
        }
      })
    }

    void initializeServersAsPending().catch(error => {
      logMCPError(
        'useManageMCPConnections',
        `Failed to initialize servers as pending: ${errorMessage(error)}`,
      )
    })
  }, [
    dynamicMcpConfig,
    setAppState,
    sessionId,
  ])
  useEffect(() => {
    let cancelled = false

    async function loadAndConnectMcpConfigs() {
      const { servers: claudeCodeConfigs, errors: mcpErrors } =
        await getClaudeCodeMcpConfigs(dynamicMcpConfig)
      if (cancelled) return

      // Add MCP errors to plugin errors for UI visibility (deduplicated)
      addErrorsToAppState(setAppState, mcpErrors)

      const configs = { ...claudeCodeConfigs, ...dynamicMcpConfig }

      const enabledConfigs = Object.fromEntries(
        Object.entries(configs).filter(([name]) => !isMcpServerDisabled(name)),
      )
      getMcpToolsCommandsAndResources(
        onConnectionAttempt,
        enabledConfigs,
      ).catch(error => {
        logMCPError(
          'useManageMcpConnections',
          `Failed to get MCP resources: ${errorMessage(error)}`,
        )
      })

    }

    void loadAndConnectMcpConfigs()

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
      if (flushTimerRef.current !== null) {
        clearTimeout(flushTimerRef.current)
        flushTimerRef.current = null
        flushPendingUpdates()
      }
    }
  }, [flushPendingUpdates])

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
