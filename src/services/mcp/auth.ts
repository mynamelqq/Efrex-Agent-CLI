import { McpSSEServerConfig } from "packages/mcp-client/src"
import { McpHTTPServerConfig } from "./types"
import { getSecureStorage } from "src/utils/secureStorage"
import { createHash, randomBytes, randomUUID } from 'crypto'








/**
 * Generates a unique key for server credentials based on both name and config hash
 * This prevents credentials from being reused across different servers
 * with the same name or different configurations
 */
export function getServerKey(
  serverName: string,
  serverConfig: McpSSEServerConfig | McpHTTPServerConfig,
): string {
  const configJson = JSON.stringify({
    type: serverConfig.type,
    url: serverConfig.url,
    headers: serverConfig.headers || {},
  })

  const hash = createHash('sha256')
    .update(configJson)
    .digest('hex')
    .substring(0, 16)

  return `${serverName}|${hash}`
}




export async function readClientSecret(): Promise<string> {
  const envSecret = process.env.MCP_CLIENT_SECRET
  if (envSecret) {
    return envSecret
  }

  if (!process.stdin.isTTY) {
    throw new Error(
      'No TTY available to prompt for client secret. Set MCP_CLIENT_SECRET env var instead.',
    )
  }

  return new Promise((resolve, reject) => {
    process.stderr.write('Enter OAuth client secret: ')
    process.stdin.setRawMode?.(true)
    let secret = ''
    const onData = (ch: Buffer) => {
      const c = ch.toString()
      if (c === '\n' || c === '\r') {
        process.stdin.setRawMode?.(false)
        process.stdin.removeListener('data', onData)
        process.stderr.write('\n')
        resolve(secret)
      } else if (c === '\u0003') {
        process.stdin.setRawMode?.(false)
        process.stdin.removeListener('data', onData)
        reject(new Error('Cancelled'))
      } else if (c === '\u007F' || c === '\b') {
        secret = secret.slice(0, -1)
      } else {
        secret += c
      }
    }
    process.stdin.on('data', onData)
  })
}
export function saveMcpClientSecret(//保存MCP客户密钥
  serverName: string,
  serverConfig: McpSSEServerConfig | McpHTTPServerConfig,
  clientSecret: string,
): void {
  const storage = getSecureStorage()//先获取认证crendition文件
  const existingData = storage.read() || {}
  const serverKey = getServerKey(serverName, serverConfig)
  storage.update({
    ...existingData,
    mcpOAuthClientConfig: {
      ...existingData.mcpOAuthClientConfig,
      [serverKey]: { clientSecret },
    },
  })
}