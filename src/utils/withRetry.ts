import OpenAI from 'openai'
import { APIConnectionError, APIError, APIUserAbortError } from 'openai/error'
import type { QuerySource } from 'src/services/compact/querySource.js'
import { logForDebugging } from 'src/utils/debug.js'
import { logError } from 'src/utils/log.js'
import { createSystemAPIErrorMessage } from 'src/utils/messages.js'
import { isEnvTruthy } from './envUtils.js'
import { errorMessage } from './errors.js'
import { sleep } from './sleep.js'
import type { ThinkingConfig } from './effort.js'
import { SystemAPIErrorMessage } from 'src/package/message.js'
const abortError = () => new APIUserAbortError()

export interface RetryContext {
  maxTokensOverride?: number
  model: string
  thinkingConfig: ThinkingConfig
}

interface RetryOptions {
  maxRetries?: number
  model: string
  fallbackModel?: string
  thinkingConfig: ThinkingConfig
  signal?: AbortSignal
  querySource?: QuerySource
  /**
   * Pre-seed the consecutive 529 counter. Used when this retry loop is a
   * non-streaming fallback after a streaming 529 — the streaming 529 should
   * count toward MAX_529_RETRIES so total 529s-before-fallback is consistent
   * regardless of which request mode hit the overload.
   */
  initialConsecutive529Errors?: number
}
export class CannotRetryError extends Error {
  constructor(
    public readonly originalError: unknown,
    public readonly retryContext: RetryContext,
  ) {
    const message = errorMessage(originalError)
    super(message)
    this.name = 'RetryError'

    // Preserve the original stack trace if available
    if (originalError instanceof Error && originalError.stack) {
      this.stack = originalError.stack
    }
  }
}
const PERSISTENT_MAX_BACKOFF_MS = 5 * 60 * 1000
const PERSISTENT_RESET_CAP_MS = 6 * 60 * 60 * 1000
const HEARTBEAT_INTERVAL_MS = 30_000
const DEFAULT_MAX_RETRIES = 5
const FLOOR_OUTPUT_TOKENS = 3000
const MAX_529_RETRIES = 3

export const BASE_DELAY_MS = 500
function shouldRetry529(querySource: QuerySource | undefined): boolean {
  // undefined → retry (conservative for untagged call paths)
  return (
    querySource === undefined 
  )
}

export async function* withRetry<T>(
  getClient: () => Promise<OpenAI>,
  operation: (
    client: OpenAI,
    attempt: number,
    context: RetryContext,
  ) => Promise<T>,
  options: RetryOptions,
): AsyncGenerator<SystemAPIErrorMessage, T> {
  const maxRetries = getMaxRetries(options)
  const retryContext: RetryContext = {
    model: options.model,
    thinkingConfig: options.thinkingConfig,
  }
  let client: OpenAI | null = null
  let consecutive529Errors = options.initialConsecutive529Errors ?? 0
  let lastError: unknown
  let persistentAttempt = 0
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    if (options.signal?.aborted) {
      throw new APIUserAbortError()
    }

    try {
      if(client ==null){
        client = await getClient()
      }
      return await operation(client, attempt, retryContext)
    } catch (error) {
      lastError = error
      logForDebugging(
        `API error (attempt ${attempt}/${maxRetries + 1}): ${error instanceof APIError ? `${error.status} ${error.message}` : errorMessage(error)}`,
        { level: 'error' },
      )
      if (!(error instanceof APIError)) {
        throw error
      }
      // Non-foreground sources bail immediately on 529 — no retry amplification
      // during capacity cascades. User never sees these fail.
      if (is529Error(error) && !shouldRetry529(options.querySource)) {
        throw new CannotRetryError(error, retryContext)
      }
      // Handle max tokens context overflow errors by adjusting max_tokens for the next attempt
      // NOTE: With extended-context-window beta, this 400 error should not occur.
      // The API now returns 'model_context_window_exceeded' stop_reason instead.
      // Keeping for backward compatibility.
      if (error instanceof APIError) {
        const overflowData = parseMaxTokensContextOverflowError(error)
        if (overflowData) {
          const { inputTokens, contextLimit } = overflowData

          const safetyBuffer = 1000
          const availableContext = Math.max(
            0,
            contextLimit - inputTokens - safetyBuffer,
          )
          if (availableContext < FLOOR_OUTPUT_TOKENS) {
            logError(
              new Error(
                `availableContext ${availableContext} is less than FLOOR_OUTPUT_TOKENS ${FLOOR_OUTPUT_TOKENS}`,
              ),
            )
            throw error
          }
          // Ensure we have enough tokens for thinking + at least 1 output token
          const minRequired =
            (retryContext.thinkingConfig.type === 'enabled'
              ? retryContext.thinkingConfig.budgetTokens
              : 0) + 1
          const adjustedMaxTokens = Math.max(
            FLOOR_OUTPUT_TOKENS,
            availableContext,
            minRequired,
          )
          retryContext.maxTokensOverride = adjustedMaxTokens
          continue
        }
      }
      const persistent = isTransientCapacityError(error)
      if (!persistent && !shouldRetry(error)) {
        throw new CannotRetryError(error, retryContext)
      }
      if (!persistent && attempt > maxRetries) {
        throw new CannotRetryError(error, retryContext)
      }
      // For other errors, proceed with normal retry logic
      // Get retry-after header if available
      const retryAfter = getRetryAfter(error)
      let delayMs: number
      if (persistent && error instanceof APIError && error.status === 429) {
        persistentAttempt++
        // Window-based limits (e.g. 5hr Max/Pro) include a reset timestamp.
        // Wait until reset rather than polling every 5 min uselessly.
        const resetDelay = getRateLimitResetDelayMs(error)
        delayMs =
          resetDelay ??
          Math.min(
            getRetryDelay(
              persistentAttempt,
              retryAfter,
              PERSISTENT_MAX_BACKOFF_MS,
            ),
            PERSISTENT_RESET_CAP_MS,
          )
      } else if (persistent) {
        persistentAttempt++
        // Retry-After is a server directive and bypasses maxDelayMs inside
        // getRetryDelay (intentional — honoring it is correct). Cap at the
        // 6hr reset-cap here so a pathological header can't wait unbounded.
        delayMs = Math.min(
          getRetryDelay(
            persistentAttempt,
            retryAfter,
            PERSISTENT_MAX_BACKOFF_MS,
          ),
          PERSISTENT_RESET_CAP_MS,
        )
      } else {
        delayMs = getRetryDelay(attempt, retryAfter)
      }

      // In persistent mode the for-loop `attempt` is clamped at maxRetries+1;
      // use persistentAttempt for telemetry/yields so they show the true count.
      const reportedAttempt = persistent ? persistentAttempt : attempt
    

      if (persistent) {
        if (delayMs > 60_000) {
          
        }
        // Chunk long sleeps so the host sees periodic stdout activity and
        // does not mark the session idle. Each yield surfaces as
        // {type:'system', subtype:'api_retry'} on stdout via QueryEngine.
        let remaining = delayMs
        while (remaining > 0) {
          if (options.signal?.aborted) throw new APIUserAbortError()
          yield createSystemAPIErrorMessage(
            error as never,
            remaining,
            reportedAttempt,
            maxRetries,
          )
          const chunk = Math.min(remaining, HEARTBEAT_INTERVAL_MS)
          await sleep(chunk, options.signal, { abortError })
          remaining -= chunk
        }
        // Clamp so the for-loop never terminates. Backoff uses the separate
        // persistentAttempt counter which keeps growing to the 5-min cap.
        if (attempt >= maxRetries) attempt = maxRetries
      } else {
        yield createSystemAPIErrorMessage(
          error as never,
          delayMs,
          attempt,
          maxRetries,
        )
        await sleep(delayMs, options.signal, { abortError })
      }
    }
  }

  throw new CannotRetryError(lastError, retryContext)
}
function isTransientCapacityError(error: unknown): boolean {
  return (
    is529Error(error) || (error instanceof APIError && error.status === 429)
  )
}

export function getDefaultMaxRetries(): number {
  if (process.env.MAX_RETRIES) {
    return parseInt(process.env.MAX_RETRIES, 5)
  }
  return DEFAULT_MAX_RETRIES
}
function getMaxRetries(options: RetryOptions): number {
  return options.maxRetries ?? getDefaultMaxRetries()
}
export function is529Error(error: unknown): boolean {
  if (!(error instanceof APIError)) {
    return false
  }

  // Check for 529 status code or overloaded error in message
  return (
    error.status === 529 ||
    // See below: the SDK sometimes fails to properly pass the 529 status code during streaming
    (error.message?.includes('"type":"overloaded_error"') ?? false)
  )
}
export function getRetryDelay(
  attempt: number,
  retryAfterHeader?: string | null,
  maxDelayMs = 32000,
): number {
  if (retryAfterHeader) {
    const seconds = parseInt(retryAfterHeader, 10)
    if (!isNaN(seconds)) {
      return seconds * 1000
    }
  }

  const baseDelay = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), maxDelayMs)
  const jitter = Math.random() * 0.25 * baseDelay
  return baseDelay + jitter
}

function getRetryAfter(error: unknown): string | null {
  return (
    ((error as { headers?: { 'retry-after'?: string } }).headers?.[
      'retry-after'
    ] ||
      // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
      ((error as APIError).headers as Headers)?.get?.('retry-after')) ??
    null
  )
}
export function parseMaxTokensContextOverflowError(error: APIError):
  | {
      inputTokens: number
      maxTokens: number
      contextLimit: number
    }
  | undefined {
  if (error.status !== 400 || !error.message) {
    return undefined
  }

  if (
    !error.message.includes(
      'input length and `max_tokens` exceed context limit',
    )
  ) {
    return undefined
  }

  // Example format: "input length and `max_tokens` exceed context limit: 188059 + 20000 > 200000"
  const regex =
    /input length and `max_tokens` exceed context limit: (\d+) \+ (\d+) > (\d+)/
  const match = error.message.match(regex)

  if (!match || match.length !== 4) {
    return undefined
  }

  if (!match[1] || !match[2] || !match[3]) {
    logError(
      new Error(
        'Unable to parse max_tokens from max_tokens exceed context limit error message',
      ),
    )
    return undefined
  }
  const inputTokens = parseInt(match[1], 10)
  const maxTokens = parseInt(match[2], 10)
  const contextLimit = parseInt(match[3], 10)

  if (isNaN(inputTokens) || isNaN(maxTokens) || isNaN(contextLimit)) {
    return undefined
  }

  return { inputTokens, maxTokens, contextLimit }
}
function getRateLimitResetDelayMs(error: APIError): number | null {
  const resetHeader = error.headers?.get?.('anthropic-ratelimit-unified-reset')
  if (!resetHeader) return null
  const resetUnixSec = Number(resetHeader)
  if (!Number.isFinite(resetUnixSec)) return null
  const delayMs = resetUnixSec * 1000 - Date.now()
  if (delayMs <= 0) return null
  return Math.min(delayMs, PERSISTENT_RESET_CAP_MS)
}
function shouldRetry(error: APIError): boolean {

  // Persistent mode: 429/529 always retryable, bypass subscriber gates and
  // x-should-retry header.
  if ( isTransientCapacityError(error)) {
    return true
  }

  // CCR mode: auth is via infrastructure-provided JWTs, so a 401/403 is a
  // transient blip (auth service flap, network hiccup) rather than bad
  // credentials. Bypass x-should-retry:false — the server assumes we'd retry
  // the same bad key, but our key is fine.
  if (
    isEnvTruthy(process.env.CLAUDE_CODE_REMOTE) &&
    (error.status === 401 || error.status === 403)
  ) {
    return true
  }

  // Check for overloaded errors first by examining the message content
  // The SDK sometimes fails to properly pass the 529 status code during streaming,
  // so we need to check the error message directly
  if (error.message?.includes('"type":"overloaded_error"')) {
    return true
  }

  // Check for max tokens context overflow errors that we can handle
  if (parseMaxTokensContextOverflowError(error)) {
    return true
  }

  // Note this is not a standard header.
  const shouldRetryHeader = error.headers?.get('x-should-retry')


  // Ants can ignore x-should-retry: false for 5xx server errors only.
  // For other status codes (401, 403, 400, 429, etc.), respect the header.
  if (shouldRetryHeader === 'false') {
    const is5xxError = error.status !== undefined && error.status >= 500
    if (!(process.env.USER_TYPE === 'ant' && is5xxError)) {
      return false
    }
  }

  if (error instanceof APIConnectionError) {
    return true
  }

  if (!error.status) return false

  // Retry on request timeouts.
  if (error.status === 408) return true

  // Retry on lock timeouts.
  if (error.status === 409) return true

  // Retry on rate limits, but not for ClaudeAI Subscription users
  // Enterprise users can retry because they typically use PAYG instead of rate limits
  if (error.status === 429) {
    return true
  }

  // Clear API key cache on 401 and allow retry.
  // OAuth token handling is done in the main retry loop via handleOAuth401Error.
  if (error.status === 401) {
    return true
  }

  // Retry on 403 "token revoked" (same refresh logic as 401, see above)
  if (error.status===403) {
    return true
  }

  // Retry internal errors.
  if (error.status && error.status >= 500) return true

  return false
}
