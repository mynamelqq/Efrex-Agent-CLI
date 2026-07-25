import { AuthCodeListener } from "./auth-code-listener"
import { OAuthTokenExchangeResponse, OAuthTokens } from "./types"
import * as client from './client.js'
import * as crypto from './crypto'
import { openBrowser } from "src/utils/browser"


/**
 * 使用 PKCE 处理 OAuth 2.0 授权代码流的 OAuth 服务。
 *
 * 支持两种方式获取授权码：
 * 1. 自动：打开浏览器，重定向到我们捕获代码的本地主机
 * 2.手动：用户手动复制粘贴代码（非浏览器环境下使用）
 */
export class OAuthService {
  private codeVerifier: string
  private authCodeListener: AuthCodeListener | null = null
  private port: number | null = null
  private manualAuthCodeResolver: ((authorizationCode: string) => void) | null =
    null

  constructor() {
    this.codeVerifier = crypto.generateCodeVerifier()//生成原始校验串 code_verifier 本地保存，授权码换 token 时传给服务端做校验
  }

  async startOAuthFlow(//开始登录认证工作流
    authURLHandler: (url: string, automaticUrl?: string) => Promise<void>,
    options?: {
      loginWithClaudeAi?: boolean
      inferenceOnly?: boolean
      expiresIn?: number
      orgUUID?: string
      loginHint?: string
      loginMethod?: string
      /**
       * Don't call openBrowser(). Caller takes both URLs via authURLHandler
       * and decides how/where to open them. Used by the SDK control protocol
       * (claude_authenticate) where the SDK client owns the user's display,
       * not this process.
       */
      skipBrowserOpen?: boolean
    },
  ): Promise<OAuthTokens> {
    // Create OAuth callback listener and start it
    this.authCodeListener = new AuthCodeListener()//创建监听器监听验证码
    this.port = await this.authCodeListener.start()//启动监听器，获取端口号

    // Generate PKCE values and state 产生PKCE值和状态
    const codeChallenge = crypto.generateCodeChallenge(this.codeVerifier)//根据 verifier 算出挑战码 code_challenge 传给服务端
    const state = crypto.generateState()//生成随机状态码，防止CSRF攻击

    // Build auth URLs for both automatic and manual flows
    const opts = {
      codeChallenge,
      state,
      port: this.port,//传给服务端的回调端口号
      loginWithClaudeAi: options?.loginWithClaudeAi,//传给服务端的登录方式
      inferenceOnly: options?.inferenceOnly,
      orgUUID: options?.orgUUID,
      loginHint: options?.loginHint,
      loginMethod: options?.loginMethod,
    }
    const manualFlowUrl = client.buildAuthUrl({ ...opts, isManual: true })//生成手动登录认证URL
    const automaticFlowUrl = client.buildAuthUrl({ ...opts, isManual: false })//生成自动登录认证URL

    // Wait for either automatic or manual auth code 
    const authorizationCode = await this.waitForAuthorizationCode(//等待授权码
      state,
      async () => {
        if (options?.skipBrowserOpen) {
          // Hand both URLs to the caller. The automatic one still works
          // if the caller opens it on the same host (localhost listener
          // is running); the manual one works from anywhere.
          await authURLHandler(manualFlowUrl, automaticFlowUrl)
        } else {
          await authURLHandler(manualFlowUrl) // Show manual option to user
          await openBrowser(automaticFlowUrl) // Try automatic flow
        }
      },
    )

    // Check if the automatic flow is still active (has a pending response)
    const isAutomaticFlow = this.authCodeListener?.hasPendingResponse() ?? false

    try {
      // Exchange authorization code for tokens兑换令牌的授权码
      const tokenResponse = await client.exchangeCodeForTokens(//post到TOKEN_URL，获取access_token和refresh_token
        authorizationCode,
        state,
        this.codeVerifier,
        this.port!,
        !isAutomaticFlow, // Pass isManual=true if it's NOT automatic flow
        options?.expiresIn,
      )

      // Handle success redirect for automatic flow
      if (isAutomaticFlow) {
        const scopes = client.parseScopes(tokenResponse.scope)
        this.authCodeListener?.handleSuccessRedirect(scopes)
      }

      return this.formatTokens(
        tokenResponse,
      )
    } catch (error) {
      // If we have a pending response, send an error redirect before closing
      if (isAutomaticFlow) {
        this.authCodeListener?.handleErrorRedirect()
      }
      throw error
    } finally {
      // Always cleanup
      this.authCodeListener?.close()
    }
  }

  private async waitForAuthorizationCode(
    state: string,
    onReady: () => Promise<void>,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      // Set up manual auth code resolver
      this.manualAuthCodeResolver = resolve

      // Start automatic flow
      this.authCodeListener
        ?.waitForAuthorization(state, onReady)
        .then(authorizationCode => {
          this.manualAuthCodeResolver = null
          resolve(authorizationCode)
        })
        .catch(error => {
          this.manualAuthCodeResolver = null
          reject(error)
        })
    })
  }

  // Handle manual flow callback when user pastes the auth code
  handleManualAuthCodeInput(params: {
    authorizationCode: string
    state: string
  }): void {
    if (this.manualAuthCodeResolver) {
      this.manualAuthCodeResolver(params.authorizationCode)
      this.manualAuthCodeResolver = null
      // Close the auth code listener since manual input was used
      this.authCodeListener?.close()
    }
  }

  private formatTokens(
    response: OAuthTokenExchangeResponse,
  ): OAuthTokens {
    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      expiresAt: Date.now() + response.expires_in * 1000,
      scopes: client.parseScopes(response.scope),
      tokenAccount: response.account
        ? {
            uuid: response.account.uuid,
            emailAddress: response.account.email_address,
            organizationUuid: response.organization?.uuid,
          }
        : undefined,
    }
  }

  // Clean up any resources (like the local server)
  cleanup(): void {
    this.authCodeListener?.close()
    this.manualAuthCodeResolver = null
  }
}
