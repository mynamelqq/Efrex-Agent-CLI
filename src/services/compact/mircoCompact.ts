// import { feature } from 'bun:bundle'
// import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
// import type { ToolUseContext } from '../../Tool.js'
// import { FILE_READ_TOOL_NAME } from 'src/tools/FileReadTool/prompt.js'
// import { GLOB_TOOL_NAME } from 'src/tools/GlobTool/prompt.js'
// import { GREP_TOOL_NAME } from 'src/tools/GrepTool/prompt.js'
// import { WEB_FETCH_TOOL_NAME } from 'src/tools/WebFetchTool/prompt.js'
// import { WEB_SEARCH_TOOL_NAME } from 'src/tools/WebSearchTool/prompt.js'
// import type { Message } from 'src/package/message.js'
// import { logForDebugging } from '../../utils/debug.js'
// import { QuerySource } from './querySource.js'
// export type PendingCacheEdits = {
//   trigger: 'auto'
//   deletedToolIds: string[]
//   // Baseline cumulative cache_deleted_input_tokens from the previous API response,
//   // used to compute the per-operation delta (the API value is sticky/cumulative)
//   baselineCacheDeletedTokens: number
// }
// export type MicrocompactResult = {
//   messages: Message[]
//   compactionInfo?: {
//     pendingCacheEdits?: PendingCacheEdits
//   }
//   // Tool use IDs whose content was replaced with the cleared message.
//   // Callers should remove these from contentReplacementState.replacements
//   // to release the original strings from memory.
//   clearedToolUseIds?: string[]
// }
// const COMPACTABLE_TOOLS = new Set<string>([//要压缩的工具
//   FILE_READ_TOOL_NAME,
// //   ...SHELL_TOOL_NAMES,
//   GREP_TOOL_NAME,
//   GLOB_TOOL_NAME,
//   WEB_SEARCH_TOOL_NAME,
//   WEB_FETCH_TOOL_NAME,
// //   FILE_EDIT_TOOL_NAME,
// //   FILE_WRITE_TOOL_NAME,
// ])

// // Inline from utils/toolResultStorage.ts — importing that file pulls in
// // sessionStorage → utils/messages → services/api/errors, completing a
// // circular-deps loop back through this file via promptCacheBreakDetection.
// // Drift is caught by a test asserting equality with the source-of-truth.
// export const TIME_BASED_MC_CLEARED_MESSAGE = '[Old tool result content cleared]'
// const IMAGE_MAX_TOKEN_SIZE = 2000

// export async function microcompactMessages(
//   messages: Message[],
//   toolUseContext?: ToolUseContext,
//   querySource?: QuerySource,
// ): Promise<MicrocompactResult> {
//   // Time-based trigger runs first and short-circuits. If the gap since the
//   // last assistant message exceeds the threshold, the server cache has expired
//   // and the full prefix will be rewritten regardless — so content-clear old
//   // tool results now, before the request, to shrink what gets rewritten.
//   // Cached MC (cache-editing) is skipped when this fires: editing assumes a
//   // warm cache, and we just established it's cold.
//   const timeBasedResult = maybeTimeBasedMicrocompact(messages, querySource)
//   if (timeBasedResult) {
//     return timeBasedResult
//   }

// //   // Only run cached MC for the main thread to prevent forked agents
// //   // (session_memory, prompt_suggestion, etc.) from registering their
// //   // tool_results in the global cachedMCState, which would cause the main
// //   // thread to try deleting tools that don't exist in its own conversation.
// //   if (feature('CACHED_MICROCOMPACT')) {
// //     const mod = await getCachedMCModule()
// //     const model = toolUseContext?.options.mainLoopModel ?? getMainLoopModel()
// //     if (
// //       mod.isCachedMicrocompactEnabled() &&
// //       mod.isModelSupportedForCacheEditing(model) &&
// //       isMainThreadSource(querySource)
// //     ) {
// //       return await cachedMicrocompactPath(messages, querySource)
// //     }
// //   }

//   return { messages }
// }
// /**
//  * Time-based microcompact: when the gap since the last main-loop assistant
//  * message exceeds the configured threshold, content-clear all but the most
//  * recent N compactable tool results.
//  *
//  * Returns null when the trigger doesn't fire (disabled, wrong source, gap
//  * under threshold, nothing to clear) — caller falls through to other paths.
//  *
//  * Unlike cached MC, this mutates message content directly. The cache is cold,
//  * so there's no cached prefix to preserve via cache_edits.
//  */
// /**
//  * Check whether the time-based trigger should fire for this request.
//  *
//  * Returns the measured gap (minutes since last assistant message) when the
//  * trigger fires, or null when it doesn't (disabled, wrong source, under
//  * threshold, no prior assistant, unparseable timestamp).
//  *
//  * Extracted so other pre-request paths (e.g. snip force-apply) can consult
//  * the same predicate without coupling to the tool-result clearing action.
//  */
// export function evaluateTimeBasedTrigger(
//   messages: Message[],
//   querySource: QuerySource | undefined,
// ): { gapMinutes: number; config: TimeBasedMCConfig } | null {
//   const config = getTimeBasedMCConfig()
//   // Require an explicit main-thread querySource. isMainThreadSource treats
//   // undefined as main-thread (for cached-MC backward-compat), but several
//   // callers (/context, /compact, analyzeContext) invoke microcompactMessages
//   // without a source for analysis-only purposes — they should not trigger.
//   if (!config.enabled || !querySource || !isMainThreadSource(querySource)) {
//     return null
//   }
//   const lastAssistant = messages.findLast(m => m.type === 'assistant')
//   if (!lastAssistant) {
//     return null
//   }
//   const gapMinutes =
//     (Date.now() -
//       new Date(lastAssistant.timestamp as string | number).getTime()) /
//     60_000
//   if (!Number.isFinite(gapMinutes) || gapMinutes < config.gapThresholdMinutes) {
//     return null
//   }
//   return { gapMinutes, config }
// }
// function maybeTimeBasedMicrocompact(
//   messages: Message[],
//   querySource: QuerySource | undefined,
// ): MicrocompactResult | null {
//   const trigger = evaluateTimeBasedTrigger(messages, querySource)
//   if (!trigger) {
//     return null
//   }
//   const { gapMinutes, config } = trigger

//   const compactableIds = collectCompactableToolIds(messages)

//   // Floor at 1: slice(-0) returns the full array (paradoxically keeps
//   // everything), and clearing ALL results leaves the model with zero working
//   // context. Neither degenerate is sensible — always keep at least the last.
//   const keepRecent = Math.max(1, config.keepRecent)
//   const keepSet = new Set(compactableIds.slice(-keepRecent))
//   const clearSet = new Set(compactableIds.filter(id => !keepSet.has(id)))

//   if (clearSet.size === 0) {
//     return null
//   }

//   let tokensSaved = 0
//   const result: Message[] = messages.map(message => {
//     if (message.type !== 'user' || !Array.isArray(message.message!.content)) {
//       return message
//     }
//     let touched = false
//     const newContent = message.message!.content.map(block => {
//       if (
//         block.type === 'tool_result' &&
//         clearSet.has(block.tool_use_id) &&
//         block.content !== TIME_BASED_MC_CLEARED_MESSAGE
//       ) {
//         tokensSaved += calculateToolResultTokens(block)
//         touched = true
//         return { ...block, content: TIME_BASED_MC_CLEARED_MESSAGE }
//       }
//       return block
//     })
//     if (!touched) return message
//     return {
//       ...message,
//       message: { ...message.message, content: newContent },
//     }
//   })

//   if (tokensSaved === 0) {
//     return null
//   }


//   logForDebugging(
//     `[TIME-BASED MC] gap ${Math.round(gapMinutes)}min > ${config.gapThresholdMinutes}min, cleared ${clearSet.size} tool results (~${tokensSaved} tokens), kept last ${keepSet.size}`,
//   )

//   // Cached-MC state (module-level) holds tool IDs registered on prior turns.
//   // We just content-cleared some of those tools AND invalidated the server
//   // cache by changing prompt content. If cached-MC runs next turn with the
//   // stale state, it would try to cache_edit tools whose server-side entries
//   // no longer exist. Reset it.
//   resetMicrocompactState()
//   // We just changed the prompt content — the next response's cache read will
//   // be low, but that's us, not a break. Tell the detector to expect a drop.
//   // notifyCacheDeletion (not notifyCompaction) because it's already imported
//   // here and achieves the same false-positive suppression — adding the second
//   // symbol to the import was flagged by the circular-deps check.
//   // Pass the actual querySource: getTrackingKey returns the full source string
//   // (e.g. 'repl_main_thread:outputStyle:custom'), not just the prefix.

//   return { messages: result, clearedToolUseIds: [...clearSet] }
// }
