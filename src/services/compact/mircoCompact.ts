import { feature } from 'bun:bundle'
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import type { ToolUseContext } from '../../Tool.js'
import { roughTokenCountEstimation } from '../tokenEstimation.js'
import { FILE_READ_TOOL_NAME } from 'src/tools/FileReadTool/prompt.js'
import { GLOB_TOOL_NAME } from 'src/tools/GlobTool/prompt.js'
import { GREP_TOOL_NAME } from 'src/tools/GrepTool/prompt.js'
import { WEB_FETCH_TOOL_NAME } from 'src/tools/WebFetchTool/prompt.js'
import { WEB_SEARCH_TOOL_NAME } from 'src/tools/WebSearchTool/prompt.js'
import type { Message } from 'src/package/message.js'
import { getTimeBasedMCConfig,TimeBasedMCConfig } from './timeBasedMCConfig.js'
import { logForDebugging } from '../../utils/debug.js'
import { BASH_TOOL_NAME } from 'src/tools/BashTool/toolName.js'
import { POWERSHELL_TOOL_NAME } from 'src/tools/PowerShellTool/toolName.js'
import { FILE_WRITE_TOOL_NAME } from 'src/tools/FileWriteTool/prompt.js'
import { FILE_EDIT_TOOL_NAME } from 'src/tools/FileEditTool/constants.js'
import { QuerySource } from './querySource.js'
export type PendingCacheEdits = {
  trigger: 'auto'
  deletedToolIds: string[]
  // Baseline cumulative cache_deleted_input_tokens from the previous API response,
  // used to compute the per-operation delta (the API value is sticky/cumulative)
  baselineCacheDeletedTokens: number
}
export type MicrocompactResult = {
  messages: Message[]
  compactionInfo?: {
    pendingCacheEdits?: PendingCacheEdits
  }
  // Tool use IDs whose content was replaced with the cleared message.
  // Callers should remove these from contentReplacementState.replacements
  // to release the original strings from memory.
  clearedToolUseIds?: string[]
}
export const SHELL_TOOL_NAMES: string[] = [BASH_TOOL_NAME, POWERSHELL_TOOL_NAME]
const COMPACTABLE_TOOLS = new Set<string>([//要压缩的工具
  FILE_READ_TOOL_NAME,
  ...SHELL_TOOL_NAMES,
  GREP_TOOL_NAME,
  GLOB_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME,
  WEB_FETCH_TOOL_NAME,
  FILE_EDIT_TOOL_NAME,
  FILE_WRITE_TOOL_NAME,
])
let cachedMCModule: typeof import('./cachedMicrocompact') | null = null
let cachedMCState: import('./cachedMicrocompact').CachedMCState | null = null
let pendingCacheEdits:
  | import('./cachedMicrocompact.js').CacheEditsBlock
  | null = null

// Inline from utils/toolResultStorage.ts — importing that file pulls in
// sessionStorage → utils/messages → services/api/errors, completing a
// circular-deps loop back through this file via promptCacheBreakDetection.
// Drift is caught by a test asserting equality with the source-of-truth.
export const TIME_BASED_MC_CLEARED_MESSAGE = '[Old tool result content cleared]'
const IMAGE_MAX_TOKEN_SIZE = 2000


export function resetMicrocompactState(): void {
  if (cachedMCState && cachedMCModule) {
    cachedMCModule.resetCachedMCState(cachedMCState)
  }
  pendingCacheEdits = null
}
export async function microcompactMessages(
  messages: Message[],
  toolUseContext?: ToolUseContext,
  querySource?: QuerySource,
): Promise<MicrocompactResult> {
  // Time-based trigger runs first and short-circuits. If the gap since the
  // last assistant message exceeds the threshold, the server cache has expired
  // and the full prefix will be rewritten regardless — so content-clear old
  // tool results now, before the request, to shrink what gets rewritten.
  // Cached MC (cache-editing) is skipped when this fires: editing assumes a
  // warm cache, and we just established it's cold.
  const timeBasedResult = maybeTimeBasedMicrocompact(messages, querySource)
  if (timeBasedResult) {
    return timeBasedResult
  }

  return { messages }
}
/**
 * Time-based microcompact: when the gap since the last main-loop assistant
 * message exceeds the configured threshold, content-clear all but the most
 * recent N compactable tool results.
 *
 * Returns null when the trigger doesn't fire (disabled, wrong source, gap
 * under threshold, nothing to clear) — caller falls through to other paths.
 *
 * Unlike cached MC, this mutates message content directly. The cache is cold,
 * so there's no cached prefix to preserve via cache_edits.
 */
/**
 * Check whether the time-based trigger should fire for this request.
 *
 * Returns the measured gap (minutes since last assistant message) when the
 * trigger fires, or null when it doesn't (disabled, wrong source, under
 * threshold, no prior assistant, unparseable timestamp).
 *
 * Extracted so other pre-request paths (e.g. snip force-apply) can consult
 * the same predicate without coupling to the tool-result clearing action.
 */
export function evaluateTimeBasedTrigger(
  messages: Message[],
  querySource: QuerySource | undefined,
): { gapMinutes: number; config: TimeBasedMCConfig } | null {
  const config = getTimeBasedMCConfig()
  // Require an explicit main-thread querySource. isMainThreadSource treats
  // undefined as main-thread (for cached-MC backward-compat), but several
  // callers (/context, /compact, analyzeContext) invoke microcompactMessages
  // without a source for analysis-only purposes — they should not trigger.
  if (!config.enabled || !querySource ) {
    return null
  }
  const lastAssistant = messages.findLast(m => m.type === 'assistant')
  if (!lastAssistant) {
    return null
  }
  const gapMinutes =
    (Date.now() -
      new Date(lastAssistant.timestamp as string | number).getTime()) /
    60_000
  if (!Number.isFinite(gapMinutes) || gapMinutes < config.gapThresholdMinutes) {
    return null
  }
  return { gapMinutes, config }
}
function maybeTimeBasedMicrocompact(
  messages: Message[],
  querySource: QuerySource | undefined,
): MicrocompactResult | null {
  const trigger = evaluateTimeBasedTrigger(messages, querySource)
  if (!trigger) {
    return null
  }
  const { gapMinutes, config } = trigger//获取是否触发

  const compactableIds = collectCompactableToolIds(messages)//取出所有要压缩的工具块

// 第一层：调用 slice(-0) 会返回整个数组（看似有些奇怪，但实际上会保留所有内容），而清空所有内容会使模型的可用上下文变为零。这两种情况都不合理——始终至少保留最后一个内容。
  const keepRecent = Math.max(1, config.keepRecent)//至少保留 1 条
  const keepSet = new Set(compactableIds.slice(-keepRecent))//slice(-keepRecent) 从数组末尾取最近 keepRecent 个元素放进 Set 里，用于快速判断某个 ID 是否属于“要保留的”
  const clearSet = new Set(compactableIds.filter(id => !keepSet.has(id)))//遍历所有 ID，过滤出不在保留集合中的 ID

  if (clearSet.size === 0) {
    return null
  }

  let tokensSaved = 0
  const result: Message[] = messages.map(message => {
    if (message.type !== 'user' || !Array.isArray(message.message!.content)) {
      return message
    }
    let touched = false
    const newContent = message.message!.content.map(block => {//便利所有消息的内部工具块
      if (
        block.type === 'tool_result' &&
        clearSet.has(block.tool_use_id) &&//如果是要清理的工具
        block.content !== TIME_BASED_MC_CLEARED_MESSAGE//不是已经清理过的
      ) {
        tokensSaved += calculateToolResultTokens(block)//估算可能的token
        touched = true//发生更改
        return { ...block, content: TIME_BASED_MC_CLEARED_MESSAGE }//找到符合的然后更改内容
      }
      return block
    })
    if (!touched) return message
    return {
      ...message,
      message: { ...message.message, content: newContent },
    }
  })

  if (tokensSaved === 0) {
    return null
  }


  logForDebugging(
    `[TIME-BASED MC] gap ${Math.round(gapMinutes)}min > ${config.gapThresholdMinutes}min, cleared ${clearSet.size} tool results (~${tokensSaved} tokens), kept last ${keepSet.size}`,
  )

// 缓存式多轮对话（Cached-MC）状态（模块级别）保存了之前轮次中注册的工具 ID。
// 我们刚刚对其中部分工具进行了内容清除，并且通过修改提示内容使得服务器端缓存失效。
// 如果在下一轮对话中，缓存式多轮对话使用了这个已过时的状态，它会尝试对服务器端已不存在的条目执行 cache_edit 操作。
// 因此需要将其重置。
  resetMicrocompactState()//重置
  // We just changed the prompt content — the next response's cache read will
  // be low, but that's us, not a break. Tell the detector to expect a drop.
  // notifyCacheDeletion (not notifyCompaction) because it's already imported
  // here and achieves the same false-positive suppression — adding the second
  // symbol to the import was flagged by the circular-deps check.
  // Pass the actual querySource: getTrackingKey returns the full source string
  // (e.g. 'repl_main_thread:outputStyle:custom'), not just the prefix.

  return { messages: result, clearedToolUseIds: [...clearSet] }
}



/**
 * Walk messages and collect tool_use IDs whose tool name is in
 * COMPACTABLE_TOOLS, in encounter order. Shared by both microcompact paths.
 */
function collectCompactableToolIds(messages: Message[]): string[] {//收集要压缩的所有工具
  const ids: string[] = []
  for (const message of messages) {
    if (
      message.type === 'assistant' &&
      Array.isArray(message.message!.content)
    ) {
      for (const block of message.message!.content) {
        if (block.type === 'tool_use' && COMPACTABLE_TOOLS.has(block.name)) {//如果是要压缩的目标工具
          ids.push(block.id)
        }
      }
    }
  }
  return ids
}

// Helper to calculate tool result tokens
function calculateToolResultTokens(block: ToolResultBlockParam): number {
  if (!block.content) {
    return 0
  }

  if (typeof block.content === 'string') {
    return roughTokenCountEstimation(block.content)
  }

  // Array of TextBlockParam | ImageBlockParam | DocumentBlockParam
  return block.content.reduce((sum, item) => {
    if (item.type === 'text') {
      return sum + roughTokenCountEstimation(item.text)
    } else if (item.type === 'image' || item.type === 'document') {
      // Images/documents are approximately 2000 tokens regardless of format
      return sum + IMAGE_MAX_TOKEN_SIZE
    }
    return sum
  }, 0)
}