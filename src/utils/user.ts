import { execa } from 'execa'
import memoize from 'lodash/memoize.js'
import { getSessionId } from '../bootstrap/state.js'

import { getGlobalConfig } from './config.js'
import { getCwd } from './cwd.js'
import { env } from './env.js'
import { isEnvTruthy } from './envUtils.js'
import { getOauthAccountInfo } from './auth.js'

// Cache for email fetched asynchronously at startup
let cachedEmail: string | undefined | null = null // null means not fetched yet
let emailFetchPromise: Promise<string | undefined> | null = null

/**
 * GitHub Actions metadata when running in CI
 */
export type GitHubActionsMetadata = {
  actor?: string
  actorId?: string
  repository?: string
  repositoryId?: string
  repositoryOwner?: string
  repositoryOwnerId?: string
}

/**
 * Core user data used as base for all analytics providers.
 * This is also the format used by GrowthBook.
 */
export type CoreUserData = {
  deviceId?: string
  sessionId: string
  /** Stable user id returned by the platform /profile endpoint. */
  id?: string | number
  email?: string
  appVersion: string
  platform: typeof env.platform
  plan?: {
    code?: string
    name?: string
    monthlyPriceCents?: number
    monthlyStandardTokens?: number
    rpmLimit?: number
    periodStart?: string
    periodEnd?: string
  }
  usedStandardTokens?: number
  remainingStandardTokens?: number
  firstTokenTime?: number
  githubActionsMetadata?: GitHubActionsMetadata
}

/**
 * Initialize user data asynchronously. Should be called early in startup.
 * This pre-fetches the email so getUser() can remain synchronous.
 */
export async function initUser(): Promise<void> {
  if (cachedEmail === null && !emailFetchPromise) {
    emailFetchPromise = getEmailAsync()
    cachedEmail = await emailFetchPromise
    emailFetchPromise = null
    // Clear memoization cache so next call picks up the email
    getCoreUserData.cache.clear?.()
  }
}

/**
 * Reset all user data caches. Call on auth changes (login/logout/account switch)
 * so the next getCoreUserData() call picks up fresh credentials and email.
 */
export function resetUserCache(): void {
  cachedEmail = null
  emailFetchPromise = null
  getCoreUserData.cache.clear?.()
  getGitEmail.cache.clear?.()
}

/**
 * Get core user data.
 * This is the base representation that gets transformed for different analytics providers.
 */
export const getCoreUserData = memoize(
  (includeAnalyticsMetadata?: boolean): CoreUserData => {
    let firstTokenTime: number | undefined

    // Only include OAuth account data when actively using OAuth authentication
    const oauthAccount = getOauthAccountInfo()

    return {
      sessionId: getSessionId(),
      email: getEmail(),
      id: oauthAccount?.id,
      appVersion: MACRO.VERSION,
      platform: env.platform,
      plan: oauthAccount?.plan,
      usedStandardTokens: oauthAccount?.usedStandardTokens,
      remainingStandardTokens: oauthAccount?.remainingStandardTokens,
      firstTokenTime,
      ...(isEnvTruthy(process.env.GITHUB_ACTIONS) && {
        githubActionsMetadata: {
          actor: process.env.GITHUB_ACTOR,
          actorId: process.env.GITHUB_ACTOR_ID,
          repository: process.env.GITHUB_REPOSITORY,
          repositoryId: process.env.GITHUB_REPOSITORY_ID,
          repositoryOwner: process.env.GITHUB_REPOSITORY_OWNER,
          repositoryOwnerId: process.env.GITHUB_REPOSITORY_OWNER_ID,
        },
      }),
    }
  },
)

/**
 * Get user data for GrowthBook (same as core data with analytics metadata).
 */
export function getUserForGrowthBook(): CoreUserData {
  return getCoreUserData(true)
}

function getEmail(): string | undefined {
  // Return cached email if available (from async initialization)
  if (cachedEmail !== null) {
    return cachedEmail
  }

  // Only include OAuth email when actively using OAuth authentication
  const oauthAccount = getOauthAccountInfo()
  if (oauthAccount?.email?.trim()) {
    return oauthAccount.email
  }
  
  // Ant-only fallbacks below (no execSync)
  if (process.env.USER_TYPE !== 'ant') {
    return undefined
  }

  if (process.env.COO_CREATOR) {
    return `${process.env.COO_CREATOR}@anthropic.com`
  }

  // If initUser() wasn't called, we return undefined instead of blocking
  return undefined
}

async function getEmailAsync(): Promise<string | undefined> {
  // Only include OAuth email when actively using OAuth authentication
  const oauthAccount = getOauthAccountInfo()
  if (oauthAccount?.email?.trim()) {
    return oauthAccount.email
  }
  // Ant-only fallbacks below
  if (process.env.USER_TYPE !== 'ant') {
    return undefined
  }

  if (process.env.COO_CREATOR) {
    return `${process.env.COO_CREATOR}@anthropic.com`
  }

  return getGitEmail()
}

/**
 * Get the user's git email from `git config user.email`.
 * Memoized so the subprocess only spawns once per process.
 */
export const getGitEmail = memoize(async (): Promise<string | undefined> => {
  const result = await execa('git config --get user.email', {
    shell: true,
    reject: false,
    cwd: getCwd(),
  })
  return result.exitCode === 0 && result.stdout
    ? result.stdout.trim()
    : undefined
})
