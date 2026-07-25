import { OAuthTokens } from "src/services/oauth/types"
import memoize from "lodash/memoize"
import { clearAuthRelatedCaches, performLogout } from "src/commands/logout/logout"
import { createAndStoreApiKey, shouldUseClaudeAIAuth, storeOAuthAccountInfo } from "src/services/oauth/client"
import { logForDebugging } from "src/utils/debug"
import { logError } from "src/utils/log"
import { getSecureStorage } from "src/utils/secureStorage"
import { clearKeychainCache } from "src/utils/secureStorage/macOsKeychainHelpers"
import { clearToolSchemaCache } from "src/utils/toolSchemaCache"




/**
 * 共享令牌获取后逻辑。保存令牌，获取个人资料/角色，
 * 并设置本地身份验证状态。
 */
export async function installOAuthTokens(tokens: OAuthTokens): Promise<void> {
  // Clear old state before saving new credentials
  await performLogout({ clearOnboarding: false })//先保证注销状态重置cache

  // Reuse pre-fetched profile if available, otherwise fetch fresh
  const profile:any =null
    // tokens.profile ?? (await getOauthProfileFromOauthToken(tokens.accessToken))
//   if (profile) {
//     storeOAuthAccountInfo({
//       accountUuid: profile.account.uuid,
//       emailAddress: profile.account.email,
//       organizationUuid: profile.organization.uuid,
//       displayName: profile.account.display_name || undefined,
//       hasExtraUsageEnabled:
//         profile.organization.has_extra_usage_enabled ?? undefined,
//       billingType: profile.organization.billing_type ?? undefined,
//       subscriptionCreatedAt:
//         profile.organization.subscription_created_at ?? undefined,
//       accountCreatedAt: profile.account.created_at,
//     })
//   } else if (tokens.tokenAccount) {
//     // Fallback to token exchange account data when profile endpoint fails
//     storeOAuthAccountInfo({
//       accountUuid: tokens.tokenAccount.uuid,
//       emailAddress: tokens.tokenAccount.emailAddress,
//       organizationUuid: tokens.tokenAccount.organizationUuid,
//     })
//   }

  const storageResult = saveOAuthTokensIfNeeded(tokens)
  clearOAuthTokenCache()

  // Roles and first-token-date may fail for limited-scope tokens (e.g.
  // inference-only from setup-token). They're not required for core auth.
//   await fetchAndStoreUserRoles(tokens.access_token).catch(err =>
//     logForDebugging(String(err), { level: 'error' }),
//   )

  if (shouldUseClaudeAIAuth(tokens.scopes)) {
    // await fetchAndStoreClaudeCodeFirstTokenDate().catch(err =>
    //   logForDebugging(String(err), { level: 'error' }),
    // )
  } else {
    // API key creation is critical for Console users — let it throw.
    const apiKey = await createAndStoreApiKey(tokens.accessToken)
    if (!apiKey) {
      throw new Error(
        'Unable to create API key. The server accepted the request but did not return a key.',
      )
    }
  }

  await clearAuthRelatedCaches()
}
// Function to store OAuth tokens in secure storage
export function saveOAuthTokensIfNeeded(tokens: OAuthTokens): {//存储oauth token的函数 重要
  success: boolean
  warning?: string
} {
  if (!shouldUseClaudeAIAuth(tokens.scopes)) {
    return { success: true }
  }
  const secureStorage = getSecureStorage()
  try {
    const storageData = secureStorage.read() || {}
    const existingOauth = storageData.claudeAiOauth
    storageData.claudeAiOauth = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      scopes:tokens.scopes
      // Profile fetch in refreshOAuthToken swallows errors and returns null on
      // transient failures (network, 5xx, rate limit). Don't clobber a valid
      // stored subscription with null — fall back to the existing value.
    //   subscriptionType:
    //     tokens.subscriptionType ?? existingOauth?.subscriptionType ?? null,
    //   rateLimitTier:
    //     tokens.rateLimitTier ?? existingOauth?.rateLimitTier ?? null,
    }

    const updateStatus = secureStorage.update(storageData)
    // getClaudeAIOAuthTokens.cache?.clear?.()
    // clearBetasCaches()
    clearToolSchemaCache()
    return updateStatus
  } catch (error) {
    logError(error)

    return { success: false, warning: 'Failed to save OAuth tokens' }
  }
}
/**
 * Clears all OAuth token caches. Call this on 401 errors to ensure
 * the next token read comes from secure storage, not stale in-memory caches.
 * This handles the case where the local expiration check disagrees with the
 * server (e.g., due to clock corrections after token was issued).
 */
export function clearOAuthTokenCache(): void {
  getClaudeAIOAuthTokens.cache?.clear?.()
  clearKeychainCache()
}
export const getClaudeAIOAuthTokens = memoize((): OAuthTokens | null => {

  // Check for force-set OAuth token from environment variable
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {//如果环境变量中设置了CLAUDE_CODE_OAUTH_TOKEN，则直接返回一个推理专用的令牌对象
    // Return an inference-only token (unknown refresh and expiry)
    return {
      accessToken: process.env.CLAUDE_CODE_OAUTH_TOKEN,
      refreshToken: undefined,
      expiresAt: undefined,
      tokenType: "",
      scopes:[]
    }
  }
    // access_token: z.ZodString;
    // id_token: z.ZodOptional<z.ZodString>;
    // token_type: z.ZodString;
    // expires_in: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
    // scope: z.ZodOptional<z.ZodString>;
    // refresh_token: z.ZodOptional<z.ZodString>;
  // Check for OAuth token from file descriptor
//   const oauthTokenFromFd = getOAuthTokenFromFileDescriptor()
//   if (oauthTokenFromFd) {
//     // Return an inference-only token (unknown refresh and expiry)
//     return {
//       access_token: oauthTokenFromFd,
//       refresh_token: undefined,
//       expires_in: undefined,
//       token_type: "",

//     }
//   }

  try {
    const secureStorage = getSecureStorage()//读取
    const storageData = secureStorage.read()
    const oauthData = storageData?.claudeAiOauth

    if (!oauthData?.accessToken) {
      return null
    }

    return oauthData
  } catch (error) {
    logError(error)
    return null
  }
})
