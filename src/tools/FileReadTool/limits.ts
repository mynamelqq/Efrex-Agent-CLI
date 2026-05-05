/**
 * Read tool output limits.  Two caps apply to text reads:
 *
 *   | limit         | default | checks                    | cost          | on overflow     |
 *   |---------------|---------|---------------------------|---------------|-----------------|
 *   | maxSizeBytes  | 256 KB  | TOTAL FILE SIZE (not out) | 1 stat        | throws pre-read |
 *   | maxTokens     | 25000   | actual output tokens      | API roundtrip | throws post-read|
 *
 * Known mismatch: maxSizeBytes gates on total file size, not the slice.
 * Tested truncating instead of throwing for explicit-limit reads that
 * exceed the byte cap (#21841, Mar 2026).  Reverted: tool error rate
 * dropped but mean tokens rose — the throw path yields a ~100-byte error
 * tool-result while truncation yields ~25K tokens of content at the cap.
 */
import memoize from 'lodash/memoize'
export const MAX_OUTPUT_SIZE = 0.25 * 1024 * 1024 // 0.25MB in bytes
export const DEFAULT_MAX_OUTPUT_TOKENS = 25000

/**
 * Env var override for max output tokens. Returns undefined when unset/invalid
 * so the caller can fall through to the next precedence tier.
 */
function getEnvMaxTokens(): number | undefined {
  const override = process.env.FILE_READ_MAX_OUTPUT_TOKENS
  if (override) {
    const parsed = parseInt(override, 10)
    if (!isNaN(parsed) && parsed > 0) {
      return parsed
    }
  }
  return undefined
}

export type FileReadingLimits = {
  maxTokens: number
  maxSizeBytes: number
  includeMaxSizeInPrompt?: boolean
  targetedRangeNudge?: boolean
}

/**
 * Default limits for Read tool when the ToolUseContext doesn't supply an
 * override. Memoized so the GrowthBook value is fixed at first call — avoids
 * the cap changing mid-session as the flag refreshes in the background.
 *
 * Precedence for maxTokens: env var > GrowthBook > DEFAULT_MAX_OUTPUT_TOKENS.
 * (Env var is a user-set override, should beat experiment infrastructure.)
 *
 * Defensive: each field is individually validated; invalid values fall
 * through to the hardcoded defaults (no route to cap=0).
 */
export const getDefaultFileReadingLimits = memoize((): FileReadingLimits => {

  const maxSizeBytes =MAX_OUTPUT_SIZE

  const envMaxTokens = getEnvMaxTokens()
  const maxTokens =DEFAULT_MAX_OUTPUT_TOKENS

  const includeMaxSizeInPrompt = undefined

  const targetedRangeNudge = undefined

  return {
    maxSizeBytes,
    maxTokens,
    includeMaxSizeInPrompt,//要不要微调输出长度
    targetedRangeNudge,// 输出长度微调提示
  }
})
