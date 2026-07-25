import type { IncomingMessage, ServerResponse } from 'http'
import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import { getOauthConfig } from 'src/constants/oauth.js'
import { logError } from '../../utils/log.js'
import { shouldUseClaudeAIAuth } from './client.js'

/**
 * 侦听 OAuth 授权代码重定向的临时本地主机 HTTP 服务器。
 *
 * 当用户在浏览器中授权时，OAuth 提供程序会重定向到：
 * http://localhost:[port]/callback?code=AUTH_CODE&state=STATE
 *
 * 该服务器捕获该重定向并提取身份验证代码。
 * 注意：这不是 OAuth 服务器 -它只是一个重定向捕获机制。
 */
export class AuthCodeListener {
  private localServer: Server
  private port: number = 0
  private promiseResolver: ((authorizationCode: string) => void) | null = null
  private promiseRejecter: ((error: Error) => void) | null = null
  private expectedState: string | null = null // State parameter for CSRF protection
  private pendingResponse: ServerResponse | null = null // 最终重定向的响应对象
  private callbackPath: string // 可配置的回调路径

  constructor(callbackPath: string = '/callback') {//回调地址callback
    this.localServer = createServer()
    this.callbackPath = callbackPath
  }

  /**
   * Starts listening on an OS-assigned port and returns the port number.操作系统分配的端口号
   * This avoids race conditions by keeping the server open until it's used. 避免了竞争条件，直到使用它之前保持服务器打开
   * @param port Optional specific port to use. If not provided, uses OS-assigned port.
   */
  async start(port?: number): Promise<number> {
    return new Promise((resolve, reject) => {
      this.localServer.once('error', err => {
        reject(
          new Error(`Failed to start OAuth callback server: ${err.message}`),
        )
      })

      // Listen on specified port or 0 to let the OS assign an available port
      this.localServer.listen(port ?? 0, 'localhost', () => {
        const address = this.localServer.address() as AddressInfo
        this.port = address.port
        resolve(this.port)
      })
    })
  }

  getPort(): number {
    return this.port
  }

  hasPendingResponse(): boolean {
    return this.pendingResponse !== null
  }

  async waitForAuthorization(
    state: string,
    onReady: () => Promise<void>,
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.promiseResolver = resolve
      this.promiseRejecter = reject
      this.expectedState = state
      this.startLocalListener(onReady)
    })
  }

  /**
   * Completes the OAuth flow by redirecting the user's browser to a success page.
   * Different success pages are shown based on the granted scopes.
   * @param scopes The OAuth scopes that were granted
   * @param customHandler Optional custom handler to serve response instead of redirecting
   */
  handleSuccessRedirect(
    scopes: string[],
    customHandler?: (res: ServerResponse, scopes: string[]) => void,
  ): void {
    if (!this.pendingResponse) return

    // If custom handler provided, use it instead of default redirect
    if (customHandler) {
      customHandler(this.pendingResponse, scopes)
      this.pendingResponse = null
      return
    }

    // Default behavior: Choose success page based on granted permissions
    const successUrl = shouldUseClaudeAIAuth(scopes)
      ? getOauthConfig().CLAUDEAI_SUCCESS_URL
      : getOauthConfig().CONSOLE_SUCCESS_URL

    // Send browser to success page
    this.pendingResponse.writeHead(302, { Location: successUrl })
    this.pendingResponse.end()
    this.pendingResponse = null

  }

  /**
   * Handles error case by sending a redirect to the appropriate success page with an error indicator,
   * ensuring the browser flow is completed properly.
   */
  handleErrorRedirect(): void {
    if (!this.pendingResponse) return

    // TODO: swap to a different url once we have an error page
    const errorUrl = getOauthConfig().CLAUDEAI_SUCCESS_URL

    // Send browser to error page
    this.pendingResponse.writeHead(302, { Location: errorUrl })
    this.pendingResponse.end()
    this.pendingResponse = null

  }

  private startLocalListener(onReady: () => Promise<void>): void {
    // Server is already created and listening, just set up handlers
    this.localServer.on('request', this.handleRedirect.bind(this))
    this.localServer.on('error', this.handleError.bind(this))

    // Server is already listening, so we can call onReady immediately
    void onReady()
  }

  private handleRedirect(req: IncomingMessage, res: ServerResponse): void {//从重定向的请求中提取授权码和状态参数
    const parsedUrl = new URL(
      req.url || '',
      `http://${req.headers.host || 'localhost'}`,
    )

    if (parsedUrl.pathname !== this.callbackPath) {
      res.writeHead(404)
      res.end()
      return
    }

    const authCode = parsedUrl.searchParams.get('code') ?? undefined
    const state = parsedUrl.searchParams.get('state') ?? undefined

    this.validateAndRespond(authCode, state, res)
  }

  private validateAndRespond(
    authCode: string | undefined,
    state: string | undefined,
    res: ServerResponse,
  ): void {
    if (!authCode) {
      res.writeHead(400)
      res.end('Authorization code not found')
      this.reject(new Error('No authorization code received'))
      return
    }

    if (state !== this.expectedState) {
      res.writeHead(400)
      res.end('Invalid state parameter')
      this.reject(new Error('Invalid state parameter'))
      return
    }

    // Store the response for later redirect
    this.pendingResponse = res

    this.resolve(authCode)
  }

  private handleError(err: Error): void {
    logError(err)
    this.close()
    this.reject(err)
  }

  private resolve(authorizationCode: string): void {
    if (this.promiseResolver) {
      this.promiseResolver(authorizationCode)
      this.promiseResolver = null
      this.promiseRejecter = null
    }
  }

  private reject(error: Error): void {
    if (this.promiseRejecter) {
      this.promiseRejecter(error)
      this.promiseResolver = null
      this.promiseRejecter = null
    }
  }

  close(): void {
    // If we have a pending response, send a redirect before closing
    if (this.pendingResponse) {
      this.handleErrorRedirect()
    }

    if (this.localServer) {
      // Remove all listeners to prevent memory leaks
      this.localServer.removeAllListeners()
      this.localServer.close()
    }
  }
}
