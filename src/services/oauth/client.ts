// OAuth client for handling authentication flows with Claude services
import axios from 'axios'
import { CLAUDE_AI_INFERENCE_SCOPE, getOauthConfig } from 'src/constants/oauth'
import { BillingType, OAuthProfileResponse, OAuthTokenExchangeResponse, OAuthTokens, RateLimitTier, SubscriptionType } from './types'
import { AccountInfo, getGlobalConfig, saveGlobalConfig } from 'src/utils/config'
import { saveApiKey } from 'src/utils/auth'
import { getOauthProfileFromOauthToken } from './getOauthProfile'


/**
 * Check if the user has Claude.ai authentication scope
 * @private Only call this if you're OAuth / auth related code!
 */
export function shouldUseClaudeAIAuth(scopes?: string[]): boolean {
  return Boolean(scopes?.includes(CLAUDE_AI_INFERENCE_SCOPE))
}
export function parseScopes(scopeString?: string): string[] {
  return scopeString?.split(' ').filter(Boolean) ?? []
}

export function buildAuthUrl({
  codeChallenge,
  state,
  port,
  isManual,
  loginWithClaudeAi,
  inferenceOnly,
  orgUUID,
  loginHint,
  loginMethod,
}: {
  codeChallenge: string
  state: string
  port: number
  isManual: boolean
  loginWithClaudeAi?: boolean
  inferenceOnly?: boolean
  orgUUID?: string
  loginHint?: string
  loginMethod?: string
}): string {
  const authUrlBase = 
   getOauthConfig().CLAUDE_AI_AUTHORIZE_URL
   

  const authUrl = new URL(authUrlBase)
  authUrl.searchParams.append('code', 'true') // this tells the login page to show Claude Max upsell
  authUrl.searchParams.append('client_id', getOauthConfig().CLIENT_ID)
  authUrl.searchParams.append('response_type', 'code')
  authUrl.searchParams.append(
    'redirect_uri',
    isManual
      ? getOauthConfig().MANUAL_REDIRECT_URL
      : `http://localhost:${port}/callback`,
  )
  authUrl.searchParams.append('code_challenge', codeChallenge)
  authUrl.searchParams.append('code_challenge_method', 'S256')
  authUrl.searchParams.append('state', state)

  // Add orgUUID as URL param if provided
  if (orgUUID) {
    authUrl.searchParams.append('orgUUID', orgUUID)
  }

  // Pre-populate email on the login form (standard OIDC parameter)
  if (loginHint) {
    authUrl.searchParams.append('login_hint', loginHint)
  }

  // Request a specific login method (e.g. 'sso', 'magic_link', 'google')
  if (loginMethod) {
    authUrl.searchParams.append('login_method', loginMethod)
  }

  return authUrl.toString()
}
export async function exchangeCodeForTokens(
  authorizationCode: string,
  state: string,
  codeVerifier: string,
  port: number,
  useManualRedirect: boolean = false,
  expiresIn?: number,
): Promise<OAuthTokenExchangeResponse> {
  const requestBody: Record<string, string | number> = {
    grant_type: 'authorization_code',
    code: authorizationCode,
    redirect_uri: useManualRedirect//如果使用手动重定向的地址
      ? getOauthConfig().MANUAL_REDIRECT_URL
      : `http://localhost:${port}/callback`,
    client_id: getOauthConfig().CLIENT_ID,
    code_verifier: codeVerifier,
    state,
  }

  if (expiresIn !== undefined) {
    requestBody.expires_in = expiresIn
  }

  const response = await axios.post(getOauthConfig().TOKEN_URL, requestBody, {//发送POST请求到TOKEN_URL
    headers: { 'Content-Type': 'application/json' },
    timeout: 15000,
  })

  if (response.status !== 200) {
    throw new Error(
      response.status === 401
        ? 'Authentication failed: Invalid authorization code'
        : `Token exchange failed (${response.status}): ${response.statusText}`,
    )
  }
  return response.data
}
export function isOAuthTokenExpired(expiresAt: number | null): boolean {//判断是否过期
  if (expiresAt === null) {
    return false
  }

  const bufferTime = 5 * 60 * 1000
  const now = Date.now()
  const expiresWithBuffer = now + bufferTime
  return expiresWithBuffer >= expiresAt
}
export async function fetchProfileInfo(accessToken: string): Promise<{
  subscriptionType: SubscriptionType | null
  displayName?: string
  rateLimitTier: RateLimitTier | null
  accountCreatedAt?: string
  subscriptionCreatedAt?: string
  rawProfile?: OAuthProfileResponse
}> {
  const profile = await getOauthProfileFromOauthToken(accessToken)
  const planCode = profile?.plan?.code?.toLowerCase()

  // Reuse the logic from fetchSubscriptionType
  let subscriptionType: SubscriptionType | null = null
  switch (planCode) {
    case 'max':
      subscriptionType = 'max'
      break
    case 'pro':
      subscriptionType = 'pro'
      break
    case 'free':
      subscriptionType = 'free'
      break
    case 'ultra':
      subscriptionType = 'ultra'
      break
    case 'lite':
      subscriptionType = 'lite'
      break
    default:
      // Return null for unknown plan codes.
      subscriptionType = null
      break
  }

  const result: {
    subscriptionType: SubscriptionType | null
    rateLimitTier: RateLimitTier | null
    billingType: BillingType | null
  } = {
    subscriptionType,
    // The new /profile response does not expose these legacy account fields.
    rateLimitTier: null,
    billingType: null,
  }
  return { ...result, rawProfile: profile }
}
export async function refreshOAuthToken(
  refreshToken: string,
  { scopes: requestedScopes }: { scopes?: string[] } = {},
): Promise<OAuthTokens> {
  const requestBody = {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: getOauthConfig().CLIENT_ID,

  }

  try {
    const response = await axios.post(getOauthConfig().TOKEN_URL, requestBody, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
    })

    if (response.status !== 200) {
      throw new Error(`Token refresh failed: ${response.statusText}`)
    }

    const data = response.data as OAuthTokenExchangeResponse
    const {
      access_token: accessToken,
      refresh_token: newRefreshToken = refreshToken,
      expires_in: expiresIn,
    } = data

    const expiresAt = Date.now() + expiresIn * 1000
    const scopes = parseScopes(data.scope)
    const config = getGlobalConfig()
    const account = config.oauthAccount
    const haveProfileAlready = Boolean(
      account &&
        account.id !== undefined &&
        account.email?.trim() &&
        account.plan?.code &&
        Array.isArray(account.availableModels),
    )

    // Reuse the cached profile. Fetch it only for old/incomplete configs.
    const profileInfo = haveProfileAlready
      ? undefined
      : await fetchProfileInfo(accessToken)
    const profile = profileInfo?.rawProfile

    if (profile) {
      const updates: Partial<AccountInfo> = {
        id: profile.id,
        email: profile.email,
      }
      if (profile.plan) {
        updates.plan = {
          code: profile.plan.code,
          name: profile.plan.name,
          monthlyPriceCents: profile.plan.monthly_price_cents,
          monthlyStandardTokens: profile.plan.monthly_standard_tokens,
          rpmLimit: profile.plan.rpm_limit,
          periodStart: profile.plan.period_start,
          periodEnd: profile.plan.period_end,
        }
      }
      if (profile.used_standard_tokens !== undefined) {
        updates.usedStandardTokens = profile.used_standard_tokens
      }
      if (profile.remaining_standard_tokens !== undefined) {
        updates.remainingStandardTokens = profile.remaining_standard_tokens
      }
      if (Array.isArray(profile.available_models)) {
        updates.availableModels = profile.available_models
      }

      saveGlobalConfig(current => {
        const nextAccount = current.oauthAccount
          ? { ...current.oauthAccount, ...updates }
          : (updates as AccountInfo)
        return JSON.stringify(current.oauthAccount) === JSON.stringify(nextAccount)
          ? current
          : { ...current, oauthAccount: nextAccount }
      })
    }

    return {
      accessToken,
      refreshToken: newRefreshToken,
      expiresAt,
      scopes,
      tokenAccount: data.account
        ? {
            uuid: data.account.uuid,
            emailAddress: data.account.email_address,
            organizationUuid: data.organization?.uuid,
          }
        : undefined,
    }
  } catch (error) {
    const responseBody =
      axios.isAxiosError(error) && error.response?.data
        ? JSON.stringify(error.response.data)
        : undefined
    throw error
  }
}
export async function createAndStoreApiKey(
  accessToken: string,
): Promise<string | null> {
  try {
    const response = await axios.post(getOauthConfig().API_KEY_URL, null, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    const apiKey = response.data?.raw_key
    if (apiKey) {
      await saveApiKey(apiKey)
      return apiKey
    }
    return null
  } catch (error) {
    throw error
  }
}

export function storeOAuthAccountInfo({
  id,
  email,
  plan,
  usedStandardTokens,
  remainingStandardTokens,
  availableModels,
}: {
  id: string | number
  email: string
  plan?: AccountInfo['plan']
  usedStandardTokens?: number
  remainingStandardTokens?: number
  availableModels?: string[]
}): void {
  const accountInfo: AccountInfo = {
    id,
    email,
    plan,
    usedStandardTokens,
    remainingStandardTokens,
    availableModels,
  }
  saveGlobalConfig(current => {
    // A profile refresh must not reset the model selected locally by the user.
    const nextAccount = { ...current.oauthAccount, ...accountInfo }
    if (JSON.stringify(current.oauthAccount) === JSON.stringify(nextAccount)) {
      return current
    }
    return { ...current, oauthAccount: nextAccount }
  })
}
