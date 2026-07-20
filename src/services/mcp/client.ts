import type {
  Base64ImageSource,
  ContentBlockParam,
  MessageParam,
} from '@anthropic-ai/sdk/resources/index.mjs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  SSEClientTransport,
  type SSEClientTransportOptions,
} from '@modelcontextprotocol/sdk/client/sse.js'
import { memoize } from 'lodash'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { createAbortController } from 'src/utils/abortController'
import { logMCPDebug,logMCPError } from 'src/utils/log.js'
import { normalizeNameForMCP, Transport } from 'packages/mcp-client/src'
import { errorMessage } from 'src/utils/errors.js'
import { sleep } from 'bun'
import { getOriginalCwd } from 'src/bootstrap/state.js'
import { logForDebugging } from 'src/utils/debug.js'
import {
  CallToolResultSchema,
  ElicitRequestSchema,
  type ElicitRequestURLParams,
  type ElicitResult,
  ErrorCode,
  type JSONRPCMessage,
  type ListPromptsResult,
  ListPromptsResultSchema,
  ListResourcesResultSchema,
  ListRootsRequestSchema,
  type ListToolsResult,
  ListToolsResultSchema,
  McpError,
  type PromptMessage,
  type ResourceLink,
} from '@modelcontextprotocol/sdk/types.js'
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  ConnectedMCPServer,
  MCPServerConnection,
  
  McpStdioServerConfig,
  ScopedMcpServerConfig,
  ServerResource,
} from './types.js'
import {
  createMcpClient as createMcpClientFromPackage,
  captureStderr,
  isMcpSessionExpiredError as isMcpSessionExpiredErrorFromPackage,
  installConnectionMonitor,
  createCleanup as createCleanupFromPackage,
  buildConnectedServer,
  DEFAULT_CONNECTION_TIMEOUT_MS,
  MAX_MCP_DESCRIPTION_LENGTH as PKG_MAX_MCP_DESCRIPTION_LENGTH,
} from 'packages/mcp-client'
import { maybeNotifyIDEConnected } from '../../utils/ide.js'
import { registerCleanup } from 'src/utils/cleanupRegistry.js'
import { MCPProgress } from '../compact/querySource.js'
import { MCPToolResult } from 'src/utils/mcpValidation.js'
import { isPersistError, persistToolResult } from 'src/utils/toolResultStorage.js'
/**
 * Custom error class to indicate that an MCP tool call failed due to
 * authentication issues (e.g., expired OAuth token returning 401).
 * This error should be caught at the tool execution layer to update
 * the client's status to 'needs-auth'.
 */
export class McpAuthError extends Error {
  serverName: string
  constructor(serverName: string, message: string) {
    super(message)
    this.name = 'McpAuthError'
    this.serverName = serverName
  }
}
/**
 * Thrown when an MCP session has expired and the connection cache has been cleared.
 * The caller should get a fresh client via ensureConnectedClient and retry.
 */
class McpSessionExpiredError extends Error {
  constructor(serverName: string) {
    super(`MCP server "${serverName}" session expired`)
    this.name = 'McpSessionExpiredError'
  }
}
/**
 * Detects whether an error is an MCP "Session not found" error (HTTP 404 + JSON-RPC code -32001).
 * Per the MCP spec, servers return 404 when a session ID is no longer valid.
 * We check both signals to avoid false positives from generic 404s (wrong URL, server gone, etc.).
 */
export const isMcpSessionExpiredError = isMcpSessionExpiredErrorFromPackage
function getConnectionTimeoutMs(): number {
  return parseInt(process.env.MCP_TIMEOUT || '', 10) || 30000
}
/**
 * Default timeout for MCP tool calls (effectively infinite - ~27.8 hours).
 */
const DEFAULT_MCP_TOOL_TIMEOUT_MS = 100_000_000

/**
 * Cap on MCP tool descriptions and server instructions sent to the model.
 * OpenAPI-generated MCP servers have been observed dumping 15-60KB of endpoint
 * docs into tool.description; this caps the p95 tail without losing the intent.
 */
const MAX_MCP_DESCRIPTION_LENGTH = PKG_MAX_MCP_DESCRIPTION_LENGTH
/**
 * Gets the timeout for MCP tool calls in milliseconds.
 * Uses MCP_TOOL_TIMEOUT environment variable if set, otherwise defaults to ~27.8 hours.
 */
function getMcpToolTimeoutMs(): number {
  return (
    parseInt(process.env.MCP_TOOL_TIMEOUT || '', 10) ||
    DEFAULT_MCP_TOOL_TIMEOUT_MS
  )
}
/**
 * Thrown when an MCP tool returns `isError: true`. Carries the result's `_meta`
 * so SDK consumers can still receive it — per the MCP spec, `_meta` is on the
 * base Result type and is valid on error results.
 */
export class McpToolCallError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS extends Error {
  constructor(
    message: string,
    telemetryMessage: string,
    readonly mcpMeta?: { _meta?: Record<string, unknown> },
  ) {
    super(message)
    this.name = 'McpToolCallError'
  }
}
/**
 * Generates the cache key for a server connection
 * @param name Server name
 * @param serverRef Server configuration
 * @returns Cache key string
 */
export function getServerCacheKey(
  name: string,
  serverRef: ScopedMcpServerConfig,
): string {
  return `${name}-${JSON.stringify(serverRef)}`
}
/**
 * TODO (ollie): The memoization here increases complexity by a lot, and im not sure it really improves performance
 * Attempts to connect to a single MCP server
 * @param name Server name
 * @param serverRef Scoped server configuration
 * @returns A wrapped client (either connected or failed)
 */
export const connectToServer = memoize(
  async (
    name: string,
    serverRef: ScopedMcpServerConfig,
    serverStats?: {
      totalServers: number
      stdioCount: number
      sseCount: number
      httpCount: number
      sseIdeCount: number
      wsIdeCount: number
    },
  ): Promise<MCPServerConnection> => {
    const connectStartTime = Date.now()
    let inProcessServer:
      | { connect(t: Transport): Promise<void>; close(): Promise<void> }
      | undefined
    try {
        let transport:any
        if (serverRef.type === 'sse-ide') {
            logMCPDebug(name, `Setting up SSE-IDE transport to ${serverRef.url}`)
            // IDE servers don't need authentication
            
            const transportOptions: SSEClientTransportOptions = {}//无代理

            transport = new SSEClientTransport(
            new URL(serverRef.url),
            Object.keys(transportOptions).length > 0
                ? transportOptions
                : undefined,
            )
        }

      // Set up stderr logging for stdio transport before connecting in case there are any stderr
      // outputs emitted during the connection start (this can be useful for debugging failed connections).
      // Store handler reference for cleanup to prevent memory leaks
      let stderrHandler: ((data: Buffer) => void) | undefined
      let stderrOutput = ''

      const client = new Client(
        {
          name: 'efrex-code',
          title: 'Efrex Code',
          version: MACRO.VERSION ?? 'unknown',
          description: "Anthropic's agentic coding tool",
        },
        {
          capabilities: {
            roots: {},
            // Empty object declares the capability. Sending {form:{},url:{}}
            // breaks Java MCP SDK servers (Spring AI) whose Elicitation class
            // has zero fields and fails on unknown properties.
            elicitation: {},
          },
        },
      )



      client.setRequestHandler(ListRootsRequestSchema, async () => {
        return {
          roots: [
            {
              uri: `file://${getOriginalCwd()}`,
            },
          ],
        }
      })

      // Add a timeout to connection attempts to prevent tests from hanging indefinitely
      logMCPDebug(
        name,
        `Starting connection with timeout of ${getConnectionTimeoutMs()}ms`,
      )



      const connectPromise = client.connect(transport)
      const timeoutPromise = new Promise<never>((_, reject) => {
        const timeoutId = setTimeout(() => {
          const elapsed = Date.now() - connectStartTime

          if (inProcessServer) {
            inProcessServer.close().catch(() => {})
          }
          transport.close().catch(() => {})
          reject(

          )
        }, getConnectionTimeoutMs())

        // Clean up timeout if connect resolves or rejects
        connectPromise.then(
          () => {
            clearTimeout(timeoutId)
          },
          _error => {
            clearTimeout(timeoutId)
          },
        )
      })

      try {
        await Promise.race([connectPromise, timeoutPromise])
        logMCPDebug(
          name,
          `Transport connect promise resolved for ${serverRef.type || 'stdio'}`,
        )
        if (stderrOutput) {
          logMCPError(name, `Server stderr: ${stderrOutput}`)
          stderrOutput = '' // Release accumulated string to prevent memory growth
        }
        const elapsed = Date.now() - connectStartTime
        logMCPDebug(
          name,
          `Successfully connected (transport: ${serverRef.type || 'stdio'}) in ${elapsed}ms`,
        )
      } catch (error) {
        const elapsed = Date.now() - connectStartTime
        // SSE-specific error logging
        if (
          serverRef.type === 'sse-ide' ||
          serverRef.type === 'ws-ide'
        ) {
        }
        if (inProcessServer) {
          inProcessServer.close().catch(() => {})
        }
        transport.close().catch(() => {})
        if (stderrOutput) {
          logMCPError(name, `Server stderr: ${stderrOutput}`)
        }
        throw error
      }

      const capabilities = client.getServerCapabilities()
      const serverVersion = client.getServerVersion()
      const rawInstructions = client.getInstructions()
      let instructions = rawInstructions
      if (
        rawInstructions &&
        rawInstructions.length > MAX_MCP_DESCRIPTION_LENGTH
      ) {
        instructions =
          rawInstructions.slice(0, MAX_MCP_DESCRIPTION_LENGTH) + '… [truncated]'
        logMCPDebug(
          name,
          `Server instructions truncated from ${rawInstructions.length} to ${MAX_MCP_DESCRIPTION_LENGTH} chars`,
        )
      }

      // Log successful connection details


      // Register default elicitation handler that returns cancel during the
      // window before registerElicitationHandler overwrites it in
      // onConnectionAttempt (useManageMCPConnections).
      client.setRequestHandler(ElicitRequestSchema, async request => {

        return { action: 'cancel' as const }
      })

      if (serverRef.type === 'sse-ide' || serverRef.type === 'ws-ide') {
        const ideConnectionDurationMs = Date.now() - connectStartTime
        try {
        
          void maybeNotifyIDEConnected(client)
        } catch (error) {
          logMCPError(
            name,
            `Failed to send ide_connected notification: ${error}`,
          )
        }
      }

      // Enhanced connection drop detection and logging for all transport types
      const connectionStartTime = Date.now()
      let hasErrorOccurred = false

      // Store original handlers
      const originalOnerror = client.onerror
      const originalOnclose = client.onclose

      // The SDK's transport calls onerror on connection failures but doesn't call onclose,
      // which CC uses to trigger reconnection. We bridge this gap by tracking consecutive
      // terminal errors and manually closing after MAX_ERRORS_BEFORE_RECONNECT failures.
      let consecutiveConnectionErrors = 0
      const MAX_ERRORS_BEFORE_RECONNECT = 3

      // Guard against re-entry: close() aborts in-flight streams which may fire
      // onerror again before the close chain completes.
      let hasTriggeredClose = false

      // client.close() → transport.close() → transport.onclose → SDK's _onclose():
      // rejects all pending request handlers (so hung callTool() promises fail with
      // McpError -32000 "Connection closed") and then invokes our client.onclose
      // handler below (which clears the memo cache so the next call reconnects).
      // Calling client.onclose?.() directly would only clear the cache — pending
      // tool calls would stay hung.
      const closeTransportAndRejectPending = (reason: string) => {
        if (hasTriggeredClose) return
        hasTriggeredClose = true
        void client.close().catch(e => {
          logMCPDebug(name, `Error during close: ${errorMessage(e)}`)
        })
      }

      const isTerminalConnectionError = (msg: string): boolean => {
        return (
          msg.includes('ECONNRESET') ||
          msg.includes('ETIMEDOUT') ||
          msg.includes('EPIPE') ||
          msg.includes('EHOSTUNREACH') ||
          msg.includes('ECONNREFUSED') ||
          msg.includes('Body Timeout Error') ||
          msg.includes('terminated') ||
          // SDK SSE reconnection intermediate errors — may be wrapped around the
          // actual network error, so the substrings above won't match
          msg.includes('SSE stream disconnected') ||
          msg.includes('Failed to reconnect SSE stream')
        )
      }

      // Enhanced error handler with detailed logging
      client.onerror = (error: Error) => {
        const uptime = Date.now() - connectionStartTime
        hasErrorOccurred = true
        const transportType = serverRef.type || 'stdio'

        // Log the connection drop with context

        // Log specific error details for debugging
        if (error.message) {
          if (error.message.includes('ECONNRESET')) {
            logMCPDebug(
              name,
              `Connection reset - server may have crashed or restarted`,
            )
          } else if (error.message.includes('ETIMEDOUT')) {
            logMCPDebug(
              name,
              `Connection timeout - network issue or server unresponsive`,
            )
          } else if (error.message.includes('ECONNREFUSED')) {
            logMCPDebug(name, `Connection refused - server may be down`)
          } else if (error.message.includes('EPIPE')) {
            logMCPDebug(
              name,
              `Broken pipe - server closed connection unexpectedly`,
            )
          } else if (error.message.includes('EHOSTUNREACH')) {
            logMCPDebug(name, `Host unreachable - network connectivity issue`)
          } else if (error.message.includes('ESRCH')) {
            logMCPDebug(
              name,
              `Process not found - stdio server process terminated`,
            )
          } else if (error.message.includes('spawn')) {
            logMCPDebug(
              name,
              `Failed to spawn process - check command and permissions`,
            )
          } else {
            logMCPDebug(name, `Connection error: ${error.message}`)
          }
        }

        // Call original handler
        if (originalOnerror) {
          originalOnerror(error)
        }
      }

      // Enhanced close handler with connection drop context
      client.onclose = () => {
        const uptime = Date.now() - connectionStartTime
        const transportType = serverRef.type ?? 'unknown'


        // Clear the memoization cache so next operation reconnects
        const key = getServerCacheKey(name, serverRef)

        // Also clear fetch caches (keyed by server name). Reconnection
        // creates a new connection object; without clearing, the next
        // fetch would return stale tools/resources from the old connection.
        // fetchToolsForClient.cache.delete(name)
        // fetchResourcesForClient.cache.delete(name)
        // fetchCommandsForClient.cache.delete(name)


        connectToServer.cache.delete(key)
        logMCPDebug(name, `Cleared connection cache for reconnection`)

        if (originalOnclose) {
          originalOnclose()
        }
      }

      const cleanup = async () => {
        // In-process servers (e.g. Chrome MCP) don't have child processes or stderr
        if (inProcessServer) {
          try {
            await inProcessServer.close()
          } catch (error) {
            logMCPDebug(name, `Error closing in-process server: ${error}`)
          }
          try {
            await client.close()
          } catch (error) {
            logMCPDebug(name, `Error closing client: ${error}`)
          }
          return
        }

        // Close the client connection (which also closes the transport)
        try {
          await client.close()
        } catch (error) {
          logMCPDebug(name, `Error closing client: ${error}`)
        }
      }

      // Register cleanup for all transport types - even network transports might need cleanup
      // This ensures all MCP servers get properly terminated, not just stdio ones
      const cleanupUnregister = registerCleanup(cleanup)

      // Create the wrapped cleanup that includes unregistering
      const wrappedCleanup = async () => {
        cleanupUnregister?.()
        await cleanup()
      }

      const connectionDurationMs = Date.now() - connectStartTime

      return {
        name,
        client,
        type: 'connected' as const,
        capabilities: capabilities ?? {},
        serverInfo: serverVersion,
        instructions,
        config: serverRef,
        cleanup: wrappedCleanup,
      }
    } catch (error) {
      const connectionDurationMs = Date.now() - connectStartTime
      
    
      if (inProcessServer) {
        inProcessServer.close().catch(() => {})
      }
      return {
        name,
        type: 'failed' as const,
        config: serverRef,
        error: errorMessage(error),
      }
    }
  },
  getServerCacheKey,
)
/**
 * Clears the memoize cache for a specific server
 * @param name Server name
 * @param serverRef Server configuration
 */
export async function clearServerCache(
  name: string,
  serverRef: ScopedMcpServerConfig,
): Promise<void> {
  const key = getServerCacheKey(name, serverRef)

  try {
    const wrappedClient = await connectToServer(name, serverRef)

    if (wrappedClient.type === 'connected') {
      await wrappedClient.cleanup()
    }
  } catch {
    // Ignore errors - server might have failed to connect
  }

  // Clear from cache (both connection and fetch caches so reconnect
  // fetches fresh tools/resources/commands instead of stale ones)
  connectToServer.cache.delete(key)
//   fetchToolsForClient.cache.delete(name)
//   fetchResourcesForClient.cache.delete(name)
//   fetchCommandsForClient.cache.delete(name)
}


/**
 * Call an IDE tool directly as an RPC
 * @param toolName The name of the tool to call
 * @param args The arguments to pass to the tool
 * @param client The IDE client to use for the RPC call
 * @returns The result of the tool call
 */
export async function callIdeRpc(
  toolName: string,
  args: Record<string, unknown>,
  client: ConnectedMCPServer,
): Promise<string | ContentBlockParam[] | undefined> {
  const result = await callMCPTool({
    client,
    tool: toolName,
    args,
    signal: createAbortController().signal,
  })
  return result.content
}













async function callMCPTool({
  client: { client, name, config },
  tool,
  args,
  meta,
  signal,
  onProgress,
}: {
  client: ConnectedMCPServer
  tool: string
  args: Record<string, unknown>
  meta?: Record<string, unknown>
  signal: AbortSignal
  onProgress?: (data: MCPProgress) => void
}): Promise<{
  content: MCPToolResult
  _meta?: Record<string, unknown>
  structuredContent?: Record<string, unknown>
}> {
  const toolStartTime = Date.now()
  let progressInterval: NodeJS.Timeout | undefined

  try {
    logMCPDebug(name, `Calling MCP tool: ${tool}`)

    // Set up progress logging for long-running tools (every 30 seconds)
    progressInterval = setInterval(
      (startTime, name, tool) => {
        const elapsed = Date.now() - startTime
        const elapsedSeconds = Math.floor(elapsed / 1000)
        const duration = `${elapsedSeconds}s`
        logMCPDebug(name, `Tool '${tool}' still running (${duration} elapsed)`)
      },
      30000, // Log every 30 seconds
      toolStartTime,
      name,
      tool,
    )

    // Use Promise.race with our own timeout to handle cases where SDK's
    // internal timeout doesn't work (e.g., SSE stream breaks mid-request)
    const timeoutMs = getMcpToolTimeoutMs()//默认MCP调用工具时间
    let timeoutId: NodeJS.Timeout | undefined

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        (reject, name, tool, timeoutMs) => {
          reject(
            
          )
        },
        timeoutMs,
        reject,
        name,
        tool,
        timeoutMs,
      )
    })

    const result = await Promise.race([
      client.callTool(//调用工具
        {
          name: tool,
          arguments: args,
          _meta: meta,
        },
        CallToolResultSchema,
        {
          signal,
          timeout: timeoutMs,
          onprogress: onProgress
            ? sdkProgress => {
                onProgress({
                  type: 'mcp_progress',
                  status: 'progress',
                  serverName: name,
                  toolName: tool,
                  progress: sdkProgress.progress,
                  total: sdkProgress.total,
                  progressMessage: sdkProgress.message,
                })
              }
            : undefined,
        },
      ),
      timeoutPromise,
    ]).finally(() => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    })

    if ('isError' in result && result.isError) {
      let errorDetails = 'Unknown error'
      if (
        'content' in result &&
        Array.isArray(result.content) &&
        result.content.length > 0
      ) {
        const firstContent = result.content[0]
        if (
          firstContent &&
          typeof firstContent === 'object' &&
          'text' in firstContent
        ) {
          errorDetails = firstContent.text
        }
      } else if ('error' in result) {
        // Fallback for legacy error format
        errorDetails = String(result.error)
      }
      logMCPError(name, errorDetails)
      throw new McpToolCallError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
        errorDetails,
        'MCP tool returned error',
        '_meta' in result && result._meta ? { _meta: result._meta } : undefined,
      )
    }
    const elapsed = Date.now() - toolStartTime
    const duration =
      elapsed < 1000
        ? `${elapsed}ms`
        : elapsed < 60000
          ? `${Math.floor(elapsed / 1000)}s`
          : `${Math.floor(elapsed / 60000)}m ${Math.floor((elapsed % 60000) / 1000)}s`

    logMCPDebug(name, `Tool '${tool}' completed successfully in ${duration}`)

    // Log code indexing tool usage
    // const codeIndexingTool = detectCodeIndexingFromMcpServerName(name)
    // if (codeIndexingTool) {
      
    // }

    const content = await processMCPResult(result, tool, name)
    return {
      content,
      _meta: result._meta as Record<string, unknown> | undefined,
      structuredContent: result.structuredContent as
        | Record<string, unknown>
        | undefined,
    }
  } catch (e) {
    // Clear intervals on error
    if (progressInterval !== undefined) {
      clearInterval(progressInterval)
    }

    const elapsed = Date.now() - toolStartTime

    if (e instanceof Error && e.name !== 'AbortError') {
      logMCPDebug(
        name,
        `Tool '${tool}' failed after ${Math.floor(elapsed / 1000)}s: ${e.message}`,
      )
    }

    // Check for 401 errors indicating expired/invalid OAuth tokens
    // The MCP SDK's StreamableHTTPError has a `code` property with the HTTP status
    if (e instanceof Error) {
      const errorCode = 'code' in e ? (e.code as number | undefined) : undefined
      if (errorCode === 401 || e instanceof UnauthorizedError) {
        logMCPDebug(
          name,
          `Tool call returned 401 Unauthorized - token may have expired`,
        )
        
        throw new McpAuthError(
          name,
          `MCP server "${name}" requires re-authorization (token expired)`,
        )
      }

      // Check for session expiry — two error shapes can surface here:
      // 1. Direct 404 + JSON-RPC -32001 from the server (StreamableHTTPError)
      // 2. -32000 "Connection closed" (McpError) — the SDK closes the transport
      //    after the onerror handler fires, so the pending callTool() rejects
      //    with this derived error instead of the original 404.
      // In both cases, clear the connection cache so the next tool call
      // creates a fresh session.
      const isSessionExpired = isMcpSessionExpiredError(e)
      const isConnectionClosedOnHttp =
        'code' in e &&
        (e as Error & { code?: number }).code === -32000 &&
        e.message.includes('Connection closed') &&
        (config.type === 'http' )
      if (isSessionExpired || isConnectionClosedOnHttp) {
        logMCPDebug(
          name,
          `MCP session expired during tool call (${isSessionExpired ? '404/-32001' : 'connection closed'}), clearing connection cache for re-initialization`,
        )
        
        await clearServerCache(name, config)
        throw new McpSessionExpiredError(name)
      }
    }

    // When the users hits esc, avoid logspew
    if (!(e instanceof Error) || e.name !== 'AbortError') {
      throw e
    }
    return { content: undefined }
  } finally {
    // Always clear intervals
    if (progressInterval !== undefined) {
      clearInterval(progressInterval)
    }
  }
}
export async function processMCPResult(
  result: unknown,
  tool: string, // Tool name for validation (e.g., "search")
  name: string, // Server name for IDE check and transformation (e.g., "slack")
): Promise<MCPToolResult> {
  const { content, type, schema } = await transformMCPResult(result, tool, name)

  // IDE tools are not going to the model directly, so we don't need to
  // handle large output.
  if (name === 'ide') {//ide不用处理大结果
    return content
  }

  // Check if content needs truncation (i.e., is too large)
  if (!(await mcpContentNeedsTruncation(content))) {
    return content
  }

  const sizeEstimateTokens = getContentSizeEstimate(content)

  // If large output files feature is disabled, fall back to old truncation behavior
  if (isEnvDefinedFalsy(process.env.ENABLE_MCP_LARGE_OUTPUT_FILES)) {
    return await truncateMcpContentIfNeeded(content)
  }

  // Save large output to file and return instructions for reading it
  // Content is guaranteed to exist at this point (we checked mcpContentNeedsTruncation)
  if (!content) {
    return content
  }

  // If content contains images, fall back to truncation - persisting images as JSON
  // defeats the image compression logic and makes them non-viewable
  if (contentContainsImages(content)) {
    return await truncateMcpContentIfNeeded(content)
  }

  // Generate a unique ID for the persisted file (server__tool-timestamp)
  const timestamp = Date.now()
  const persistId = `mcp-${normalizeNameForMCP(name)}-${normalizeNameForMCP(tool)}-${timestamp}`
  // Convert to string for persistence (persistToolResult expects string or specific block types)
  const contentStr =
    typeof content === 'string' ? content : JSON.stringify(content, null, 2)
  const persistResult = await persistToolResult(contentStr, persistId)

  if (isPersistError(persistResult)) {
    // If file save failed, fall back to returning truncated content info
    const contentLength = contentStr.length
    return `Error: result (${contentLength.toLocaleString()} characters) exceeds maximum allowed tokens. Failed to save output to file: ${persistResult.error}. If this MCP server provides pagination or filtering tools, use them to retrieve specific portions of the data.`
  }


  const formatDescription = getFormatDescription(type, schema)
  return getLargeOutputInstructions(
    persistResult.filepath,
    persistResult.originalSize,
    formatDescription,
  )
}
/**
 * Processes MCP tool result into a normalized format.
 */
export type MCPResultType = 'toolResult' | 'structuredContent' | 'contentArray'

export type TransformedMCPResult = {
  content: MCPToolResult
  type: MCPResultType
  schema?: string
}

export async function transformMCPResult(
  result: unknown,
  tool: string, // Tool name for validation (e.g., "search")
  name: string, // Server name for transformation (e.g., "slack")
): Promise<TransformedMCPResult> {
  if (result && typeof result === 'object') {
    if ('toolResult' in result) {
      return {
        content: String(result.toolResult),
        type: 'toolResult',
      }
    }

    if (
      'structuredContent' in result &&
      result.structuredContent !== undefined
    ) {
      return {
        content: JSON.stringify(result.structuredContent),
        type: 'structuredContent',
        schema: inferCompactSchema(result.structuredContent),
      }
    }

    if ('content' in result && Array.isArray(result.content)) {
      const transformedContent = (
        await Promise.all(
          result.content.map(item => transformResultContent(item, name)),
        )
      ).flat()
      return {
        content: transformedContent,
        type: 'contentArray',
        schema: inferCompactSchema(transformedContent),
      }
    }
  }

  const errorMessage = `MCP server "${name}" tool "${tool}": unexpected response format`
  logMCPError(name, errorMessage)
  throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
    errorMessage,
    'MCP tool unexpected response format',
  )
}