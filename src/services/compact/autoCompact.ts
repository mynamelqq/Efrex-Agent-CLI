import { feature } from 'bun:bundle'
import type { ToolUseContext } from '../../Tool.js'
import type { Message } from 'src/package/message.js'
import { logForDebugging } from '../../utils/debug.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { hasExactErrorMessage } from 'src/utils/errors.js'
import { getModelMaxOutputTokens } from 'src/context.js'
import { logError } from '../../utils/log.js'
import { tokenCountWithEstimation } from 'src/utils/tokens.js'
import { getContextWindowForModel } from 'src/context.js'
import { QuerySource } from './querySource.js'
import { compactConversation } from './compact.js'
import { create } from 'lodash'
import { CompactionResult,RecompactionInfo,ERROR_MESSAGE_USER_ABORT } from './compact.js'
import { createDefaultGlobalConfig } from 'src/utils/config.js'
const MAX_OUTPUT_TOKENS_FOR_SUMMARY = 20_000
export type AutoCompactTrackingState = {//自动压缩跟踪
  compacted: boolean//是否压缩
  turnCounter: number//轮次
  // Unique ID per turn
  turnId: string//第几轮
  // Consecutive autocompact failures. Reset on success.
  // Used as a circuit breaker to stop retrying when the context is
  // irrecoverably over the limit (e.g., prompt_too_long).
  consecutiveFailures?: number//连续失败次数
}
export const AUTOCOMPACT_BUFFER_TOKENS = 13_000///** 自动压缩缓冲区 Token 阈值 */
export const WARNING_THRESHOLD_BUFFER_TOKENS = 20_000/** 警告阈值缓冲区 Token 上限 */
export const ERROR_THRESHOLD_BUFFER_TOKENS = 20_000/** 错误阈值缓冲区 Token 上限 */
export const MANUAL_COMPACT_BUFFER_TOKENS = 3_000/** 手动压缩缓冲区 Token 阈值 */
// Conservative estimate for tool result growth per turn.
// Typical tool results (file reads, grep, bash) average ~5-10K tokens;
// occasional large reads can spike to 20K+.
const TOOL_RESULT_GROWTH_ESTIMATE = 15_000//每一轮工具结果预算
// Stop trying autocompact after this many consecutive failures.
// BQ 2026-03-10: 1,279 sessions had 50+ consecutive failures (up to 3,272)
// in a single session, wasting ~250K API calls/day globally.
const MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3//最大失败次数
export async function shouldAutoCompact(
  messages: Message[],
  model: string,
  querySource?: QuerySource,
  // Snip removes messages but the surviving assistant's usage still reflects
  // pre-snip context, so tokenCountWithEstimation can't see the savings.
  // Subtract the rough-delta that snip already computed.
  snipTokensFreed = 0,
): Promise<boolean> {
  // Recursion guards. session_memory and compact are forked agents that
  // would deadlock.思索
  if (querySource === 'session_memory' || querySource === 'compact') {
    return false
  }

  if (!isAutoCompactEnabled()) {
    return false
  }

  const tokenCount = tokenCountWithEstimation(messages) - snipTokensFreed//估算“下一次发给模型的完整上下文大概有多少 token”。
  const threshold = getAutoCompactThreshold(model)
  const effectiveWindow = getEffectiveContextWindowSize(model)


  const { isAboveAutoCompactThreshold } = calculateTokenWarningState(
    tokenCount,
    model,
  )

  return isAboveAutoCompactThreshold
}
export async function autoCompactIfNeeded(
  messages: Message[],
  toolUseContext: ToolUseContext,
  querySource?: QuerySource,
  tracking?: AutoCompactTrackingState,
  snipTokensFreed?: number,
): Promise<{
  wasCompacted: boolean
  compactionResult?: CompactionResult
  consecutiveFailures?: number
}> {
  if (isEnvTruthy(process.env.DISABLE_COMPACT)) {
    return { wasCompacted: false }
  }

  // Circuit breaker: stop retrying after N consecutive failures.
  // Without this, sessions where context is irrecoverably over the limit
  // hammer the API with doomed compaction attempts on every turn.
  if (//连续失败
    tracking?.consecutiveFailures !== undefined &&
    tracking.consecutiveFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES
  ) {
    return { wasCompacted: false }
  }

  const model = toolUseContext.options.mainLoopModel
  const shouldCompact = await shouldAutoCompact(
    messages,
    model,
    querySource,
    snipTokensFreed,
  )

  if (!shouldCompact) {
    return { wasCompacted: false }
  }

  const recompactionInfo: RecompactionInfo = {
    isRecompactionInChain: tracking?.compacted === true,
    turnsSincePreviousCompact: tracking?.turnCounter ?? -1,
    previousCompactTurnId: tracking?.turnId,
    autoCompactThreshold: getAutoCompactThreshold(model),
    querySource,
  }

  // EXPERIMENT: Try session memory compaction first
  const sessionMemoryResult = false;
  if (sessionMemoryResult) {
    // // Reset lastSummarizedMessageId since session memory compaction prunes messages
    // // and the old message UUID will no longer exist after the REPL replaces messages
    // setLastSummarizedMessageId(undefined)
    // runPostCompactCleanup(querySource)

    

    // markPostCompaction()
    // return {
    //   wasCompacted: true,
    //   compactionResult: sessionMemoryResult,
    // }
  }

  try {
    const compactionResult = await compactConversation(
      messages,
      toolUseContext,
      true, // Suppress user questions for autocompact
      undefined, // No custom instructions for autocompact
      true, // isAutoCompact
      recompactionInfo,
    )

    // Reset lastSummarizedMessageId since legacy compaction replaces all messages
    // and the old message UUID will no longer exist in the new messages array
    // setLastSummarizedMessageId(undefined)
    // runPostCompactCleanup(querySource)

    return {
      wasCompacted: true,
      compactionResult,
      // Reset failure count on success
      consecutiveFailures: 0,
    }
  } catch (error) {
    if (!hasExactErrorMessage(error, ERROR_MESSAGE_USER_ABORT)) {
      logError(error)
    }
    // Increment consecutive failure count for circuit breaker.
    // The caller threads this through autoCompactTracking so the
    // next query loop iteration can skip futile retry attempts.
    const prevFailures = tracking?.consecutiveFailures ?? 0
    const nextFailures = prevFailures + 1
    if (nextFailures >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES) {
      logForDebugging(
        `autocompact: circuit breaker tripped after ${nextFailures} consecutive failures — skipping future attempts this session`,
        { level: 'warn' },
      )
    }
    return { wasCompacted: false, consecutiveFailures: nextFailures }
  }
}
export function isAutoCompactEnabled(): boolean {
  if (isEnvTruthy(process.env.DISABLE_COMPACT)) {
    return false
  }
  // Allow disabling just auto-compact (keeps manual /compact working)
  if (isEnvTruthy(process.env.DISABLE_AUTO_COMPACT)) {
    return false
  }
  // Check if user has disabled auto-compact in their settings
  const userConfig = createDefaultGlobalConfig()
  return userConfig.autoCompactEnabled
}

export function getAutoCompactThreshold(model: string): number {
  const effectiveContextWindow = getEffectiveContextWindowSize(model)//有效的上下文窗口：扣除最大输出 Token 后的【有效上下文窗口】

  const autocompactThreshold =
    effectiveContextWindow - getAutocompactBufferTokens(model)//减去基于情景压缩的缓冲区token

  // Override for easier testing of autocompact
  const envPercent = process.env.AUTOCOMPACT_PCT_OVERRIDE
  if (envPercent) {
    const parsed = parseFloat(envPercent)
    if (!isNaN(parsed) && parsed > 0 && parsed <= 100) {
      const percentageThreshold = Math.floor(
        effectiveContextWindow * (parsed / 100),
      )
      return Math.min(percentageThreshold, autocompactThreshold)
    }
  }

  return autocompactThreshold
}
/**
 * Context-aware autocompact buffer. Larger context windows need more
 * headroom because a single turn can produce proportionally more tokens
 * (longer model outputs + larger tool results).基于情境的自动压缩缓冲区
 * 更大的上下文需要更多缓冲区空间：模型输出可能更长
 */
export function getAutocompactBufferTokens(model: string): number {
  const effectiveWindow = getEffectiveContextWindowSize(model)
  if (effectiveWindow >= 800_000) return 50_000
  if (effectiveWindow >= 400_000) return 30_000
  return AUTOCOMPACT_BUFFER_TOKENS
}
// 返回：扣除最大输出 Token 后的【有效上下文窗口】
export function getEffectiveContextWindowSize(model: string): number {
  // 1. 计算需要预留的输出 Token（取较小值，避免预留过多）
  // 取：模型最大输出Token 和 固定上限值 里的较小者
  const reservedTokensForSummary = Math.min(//保留的摘要用的
    getModelMaxOutputTokens(model).default, // 模型支持的最大回答长度
    MAX_OUTPUT_TOKENS_FOR_SUMMARY,    // 代码写死的安全上限（比如 4096）
  )

  // 2. 获取模型的总上下文窗口（上一个函数的作用）
  let contextWindow = getContextWindowForModel(model)

  // 3. 环境变量额外限制（可选）：手动缩小窗口用于自动压缩
  const autoCompactWindow = process.env.AUTO_COMPACT_WINDOW
  if (autoCompactWindow) {
    const parsed = parseInt(autoCompactWindow, 10)
    if (!isNaN(parsed) && parsed > 0) {
      contextWindow = Math.min(contextWindow, parsed)
    }
  }

  // 4. 最终结果：总窗口 - 预留回答空间
  return contextWindow - reservedTokensForSummary
}
export function calculateTokenWarningState(
  tokenUsage: number,
  model: string,
): {
  percentLeft: number
  isAboveWarningThreshold: boolean
  isAboveErrorThreshold: boolean
  isAboveAutoCompactThreshold: boolean
  isAtBlockingLimit: boolean
} {
  const autoCompactThreshold = getAutoCompactThreshold(model)//确定基准阈值
  const threshold = isAutoCompactEnabled()
    ? autoCompactThreshold
    : getEffectiveContextWindowSize(model)

  const percentLeft = Math.max(
    0,
    Math.round(((threshold - tokenUsage) / threshold) * 100),
  )

  const warningThreshold = threshold - WARNING_THRESHOLD_BUFFER_TOKENS//计算警告阈值 基准阈值减去一个警告缓冲 Token 数
  const errorThreshold = threshold - ERROR_THRESHOLD_BUFFER_TOKENS

  const isAboveWarningThreshold = tokenUsage >= warningThreshold//判断是否达到警戒：
  const isAboveErrorThreshold = tokenUsage >= errorThreshold

  const isAboveAutoCompactThreshold =
    isAutoCompactEnabled() && tokenUsage >= autoCompactThreshold

  const actualContextWindow = getEffectiveContextWindowSize(model)
  const defaultBlockingLimit =
    actualContextWindow - MANUAL_COMPACT_BUFFER_TOKENS

  // Allow override for testing
  const blockingLimitOverride = process.env.CLAUDE_CODE_BLOCKING_LIMIT_OVERRIDE
  const parsedOverride = blockingLimitOverride
    ? parseInt(blockingLimitOverride, 10)
    : NaN
  const blockingLimit =
    !isNaN(parsedOverride) && parsedOverride > 0
      ? parsedOverride
      : defaultBlockingLimit

  const isAtBlockingLimit = tokenUsage >= blockingLimit

  return {
    percentLeft,
    isAboveWarningThreshold,//到警告的阈值了？
    isAboveErrorThreshold,
    isAboveAutoCompactThreshold,
    isAtBlockingLimit,
  }
}