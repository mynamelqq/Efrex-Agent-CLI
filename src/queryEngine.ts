
// import type { ChatCompletionContentPart } from "openai/resources/chat/completions"
// import { Tools } from "./Tool"
// import { createAbortController } from "./utils/abortController"
// import {setCwd}from "./utils/shell"
// import { FileStateCache } from "./utils/fileStateCache"
// import { AppState } from "./state/AppStateStore"
// import { buildSystemInitMessage } from "./utils/messages/initSystemMessage"
// import { toolMatchesName } from "./Tool"
// import type { Message, SDKMessage } from './types/message'
export type ThinkingConfig =
  | { type: 'adaptive' }
  | { type: 'enabled'; budgetTokens: number }
  | { type: 'disabled' }
// export type QueryEngineConfig = {
//   cwd: string
//   tools: Tools
// //   private totalUsage: NonNullableUsage
// //   commands: Command[]
//   customSystemPrompt?: string
//   appendSystemPrompt?: string
//   maxTurns?: number
//   maxBudgetUsd?: number
//   readFileCache: FileStateCache
//   initialMessages?: Message[]
//   jsonSchema?: Record<string, unknown>
//   verbose?: boolean
//   replayUserMessages?: boolean
//   abortController?: AbortController
//   thinkingConfig?: ThinkingConfig
//   getAppState: () => AppState
//   setAppState: (f: (prev: AppState) => AppState) => void
// }
// export const SYNTHETIC_OUTPUT_TOOL_NAME = 'StructuredOutput'
// export class queryEngine{
//     private config: QueryEngineConfig
//     private abortController:AbortController;
//     private mutableMessages:Message[];
//     private hasHandledOrphanedPermission = false
//     private readFileState: FileStateCache

//     constructor(queryEngineConfig:QueryEngineConfig){
//         this.config=queryEngineConfig
//         this.abortController=queryEngineConfig.abortController ?? createAbortController()
//         // this.totalUsage = EMPTY_USAGE
//         this.mutableMessages = queryEngineConfig.initialMessages ?? []
//         this.readFileState = queryEngineConfig.readFileCache
//     }
//     async *submitMessage(
//         prompt: string | ChatCompletionContentPart[],
//         options?: { uuid?: string; isMeta?: boolean },
//     ): AsyncGenerator<SDKMessage, void, unknown> {
//          const {
//             cwd,
//             tools,
//             verbose = false,
//             thinkingConfig,
//             maxTurns,
//             maxBudgetUsd,
//             customSystemPrompt,
//             appendSystemPrompt,
//             jsonSchema,
//             getAppState,
//             setAppState,
//             replayUserMessages = false
//             } = this.config//解构配置项
//         setCwd(cwd)//设置当前的工作路径
//         const startTime = Date.now()//记录开始时间
//         const initialAppState = getAppState()//获取初始的应用状态
//         const initialMainLoopModel ="kimi-k2.6";
//         const initialThinkingConfig: ThinkingConfig = { type: 'adaptive' };
//         const customPrompt =typeof customSystemPrompt === 'string' ? customSystemPrompt : undefined;
//         const systemPrompt="你好！";

//         // // Push new messages, including user input and any attachments
//         // this.mutableMessages.push(...messagesFromUserInput)
//         // // Update params to reflect updates from processing /slash commands
//         // const messages = [...this.mutableMessages]
//         yield buildSystemInitMessage({
//             tools,
//             model: initialMainLoopModel,
//         })
//         const shouldQuery = false
//         if (!shouldQuery) {
            
//         }
//         // let currentMessageUsage: NonNullableUsage = EMPTY_USAGE
//         let turnCount = 1
//         let hasAcknowledgedInitialMessages = false
//         let lastStopReason: string | null = null// Track the last stop_reason from assistant messages
//         for await (const message of query({
//             messages,
//             systemPrompt,
//             userContext,
//             systemContext,
//             canUseTool: wrappedCanUseTool,
//             toolUseContext: processUserInputContext,
//             fallbackModel,
//             querySource: 'sdk',
//             maxTurns,
//             taskBudget,
//           })) {
//         // Record assistant, user, and compact boundary messages
//         if (
//           message.type === 'assistant' ||
//           message.type === 'user' ||
//           (message.type === 'system' && message.subtype === 'compact_boundary')
//         ) {
//           // Before writing a compact boundary, flush any in-memory-only
//           // messages up through the preservedSegment tail. Attachments and
//           // progress are now recorded inline (their switch cases below), but
//           // this flush still matters for the preservedSegment tail walk.
//           // If the SDK subprocess restarts before then (claude-desktop kills
//           // between turns), tailUuid points to a never-written message →
//           // applyPreservedSegmentRelinks fails its tail→head walk → returns
//           // without pruning → resume loads full pre-compact history.
//           if (
//             persistSession &&
//             message.type === 'system' &&
//             message.subtype === 'compact_boundary'
//           ) {
//             const tailUuid = message.compactMetadata?.preservedSegment?.tailUuid
//             if (tailUuid) {
//               const tailIdx = this.mutableMessages.findLastIndex(
//                 m => m.uuid === tailUuid,
//               )
//               if (tailIdx !== -1) {
//                 await recordTranscript(this.mutableMessages.slice(0, tailIdx + 1))
//               }
//             }
//           }
//           messages.push(message)
//           if (persistSession) {
//             // Fire-and-forget for assistant messages. claude.ts yields one
//             // assistant message per content block, then mutates the last
//             // one's message.usage/stop_reason on message_delta — relying on
//             // the write queue's 100ms lazy jsonStringify. Awaiting here
//             // blocks ask()'s generator, so message_delta can't run until
//             // every block is consumed; the drain timer (started at block 1)
//             // elapses first. Interactive CC doesn't hit this because
//             // useLogMessages.ts fire-and-forgets. enqueueWrite is
//             // order-preserving so fire-and-forget here is safe.
//             if (message.type === 'assistant') {
//               void recordTranscript(messages)
//             } else {
//               await recordTranscript(messages)
//             }
//           }

//           // Acknowledge initial user messages after first transcript recording
//           if (!hasAcknowledgedInitialMessages && messagesToAck.length > 0) {
//             hasAcknowledgedInitialMessages = true
//             for (const msgToAck of messagesToAck) {
//               if (msgToAck.type === 'user') {
//                 yield {
//                   type: 'user',
//                   message: msgToAck.message,
//                   session_id: getSessionId(),
//                   parent_tool_use_id: null,
//                   uuid: msgToAck.uuid,
//                   timestamp: msgToAck.timestamp,
//                   isReplay: true,
//                 } as SDKUserMessageReplay
//               }
//             }
//           }
//         }

//         if (message.type === 'user') {
//           turnCount++
//         }

//         switch (message.type) {
//           case 'tombstone':
//             // Tombstone messages are control signals for removing messages, skip them
//             break
//           case 'assistant':
//             // Capture stop_reason if already set (synthetic messages). For
//             // streamed responses, this is null at content_block_stop time;
//             // the real value arrives via message_delta (handled below).
//             if (message.message.stop_reason != null) {
//               lastStopReason = message.message.stop_reason
//             }
//             this.mutableMessages.push(message)
//             yield* normalizeMessage(message)
//             break
//           case 'progress':
//             this.mutableMessages.push(message)
//             // Record inline so the dedup loop in the next ask() call sees it
//             // as already-recorded. Without this, deferred progress interleaves
//             // with already-recorded tool_results in mutableMessages, and the
//             // dedup walk freezes startingParentUuid at the wrong message —
//             // forking the chain and orphaning the conversation on resume.
//             if (persistSession) {
//               messages.push(message)
//               void recordTranscript(messages)
//             }
//             yield* normalizeMessage(message)
//             break
//           case 'user':
//             this.mutableMessages.push(message)
//             yield* normalizeMessage(message)
//             break
//           case 'stream_event':
//             if (message.event.type === 'message_start') {
//               // Reset current message usage for new message
//               currentMessageUsage = EMPTY_USAGE
//               currentMessageUsage = updateUsage(
//                 currentMessageUsage,
//                 message.event.message.usage,
//               )
//             }
//             if (message.event.type === 'message_delta') {
//               currentMessageUsage = updateUsage(
//                 currentMessageUsage,
//                 message.event.usage,
//               )
//               // Capture stop_reason from message_delta. The assistant message
//               // is yielded at content_block_stop with stop_reason=null; the
//               // real value only arrives here (see claude.ts message_delta
//               // handler). Without this, result.stop_reason is always null.
//               if (message.event.delta.stop_reason != null) {
//                 lastStopReason = message.event.delta.stop_reason
//               }
//             }
//             if (message.event.type === 'message_stop') {
//               // Accumulate current message usage into total
//               this.totalUsage = accumulateUsage(
//                 this.totalUsage,
//                 currentMessageUsage,
//               )
//             }

//             if (includePartialMessages) {
//               yield {
//                 type: 'stream_event' as const,
//                 event: message.event,
//                 session_id: getSessionId(),
//                 parent_tool_use_id: null,
//                 uuid: randomUUID(),
//               }
//             }

//             break
//           case 'attachment':
//             this.mutableMessages.push(message)
//             // Record inline (same reason as progress above).
//             if (persistSession) {
//               messages.push(message)
//               void recordTranscript(messages)
//             }

//             // Extract structured output from StructuredOutput tool calls
//             if (message.attachment.type === 'structured_output') {
//               structuredOutputFromTool = message.attachment.data
//             }
//             // Handle max turns reached signal from query.ts
//             else if (message.attachment.type === 'max_turns_reached') {
//               if (persistSession) {
//                 if (
//                   isEnvTruthy(process.env.CLAUDE_CODE_EAGER_FLUSH) ||
//                   isEnvTruthy(process.env.CLAUDE_CODE_IS_COWORK)
//                 ) {
//                   await flushSessionStorage()
//                 }
//               }
//               yield {
//                 type: 'result',
//                 subtype: 'error_max_turns',
//                 duration_ms: Date.now() - startTime,
//                 duration_api_ms: getTotalAPIDuration(),
//                 is_error: true,
//                 num_turns: message.attachment.turnCount,
//                 stop_reason: lastStopReason,
//                 session_id: getSessionId(),
//                 total_cost_usd: getTotalCost(),
//                 usage: this.totalUsage,
//                 modelUsage: getModelUsage(),
//                 permission_denials: this.permissionDenials,
//                 fast_mode_state: getFastModeState(
//                   mainLoopModel,
//                   initialAppState.fastMode,
//                 ),
//                 uuid: randomUUID(),
//                 errors: [
//                   `Reached maximum number of turns (${message.attachment.maxTurns})`,
//                 ],
//               }
//               return
//             }
//             // Yield queued_command attachments as SDK user message replays
//             else if (
//               replayUserMessages &&
//               message.attachment.type === 'queued_command'
//             ) {
//               yield {
//                 type: 'user',
//                 message: {
//                   role: 'user' as const,
//                   content: message.attachment.prompt,
//                 },
//                 session_id: getSessionId(),
//                 parent_tool_use_id: null,
//                 uuid: message.attachment.source_uuid || message.uuid,
//                 timestamp: message.timestamp,
//                 isReplay: true,
//               } as SDKUserMessageReplay
//             }
//             break
//           case 'stream_request_start':
//             // Don't yield stream request start messages
//             break
//           case 'system': {
//             // Snip boundary: replay on our store to remove zombie messages and
//             // stale markers. The yielded boundary is a signal, not data to push —
//             // the replay produces its own equivalent boundary. Without this,
//             // markers persist and re-trigger on every turn, and mutableMessages
//             // never shrinks (memory leak in long SDK sessions). The subtype
//             // check lives inside the injected callback so feature-gated strings
//             // stay out of this file (excluded-strings check).
//             const snipResult = this.config.snipReplay?.(
//               message,
//               this.mutableMessages,
//             )
//             if (snipResult !== undefined) {
//               if (snipResult.executed) {
//                 this.mutableMessages.length = 0
//                 this.mutableMessages.push(...snipResult.messages)
//               }
//               break
//             }
//             this.mutableMessages.push(message)
//             // Yield compact boundary messages to SDK
//             if (
//               message.subtype === 'compact_boundary' &&
//               message.compactMetadata
//             ) {
//               // Release pre-compaction messages for GC. The boundary was just
//               // pushed so it's the last element. query.ts already uses
//               // getMessagesAfterCompactBoundary() internally, so only
//               // post-boundary messages are needed going forward.
//               const mutableBoundaryIdx = this.mutableMessages.length - 1
//               if (mutableBoundaryIdx > 0) {
//                 this.mutableMessages.splice(0, mutableBoundaryIdx)
//               }
//               const localBoundaryIdx = messages.length - 1
//               if (localBoundaryIdx > 0) {
//                 messages.splice(0, localBoundaryIdx)
//               }

//               yield {
//                 type: 'system',
//                 subtype: 'compact_boundary' as const,
//                 session_id: getSessionId(),
//                 uuid: message.uuid,
//                 compact_metadata: toSDKCompactMetadata(message.compactMetadata),
//               }
//             }
//             if (message.subtype === 'api_error') {
//               yield {
//                 type: 'system',
//                 subtype: 'api_retry' as const,
//                 attempt: message.retryAttempt,
//                 max_retries: message.maxRetries,
//                 retry_delay_ms: message.retryInMs,
//                 error_status: message.error.status ?? null,
//                 error: categorizeRetryableAPIError(message.error),
//                 session_id: getSessionId(),
//                 uuid: message.uuid,
//               }
//             }
//             // Don't yield other system messages in headless mode
//             break
//           }
//           case 'tool_use_summary':
//             // Yield tool use summary messages to SDK
//             yield {
//               type: 'tool_use_summary' as const,
//               summary: message.summary,
//               preceding_tool_use_ids: message.precedingToolUseIds,
//               session_id: getSessionId(),
//               uuid: message.uuid,
//             }
//             break
//         }

//         // Check if USD budget has been exceeded
//         if (maxBudgetUsd !== undefined && getTotalCost() >= maxBudgetUsd) {
//           if (persistSession) {
//             if (
//               isEnvTruthy(process.env.CLAUDE_CODE_EAGER_FLUSH) ||
//               isEnvTruthy(process.env.CLAUDE_CODE_IS_COWORK)
//             ) {
//               await flushSessionStorage()
//             }
//           }
//           yield {
//             type: 'result',
//             subtype: 'error_max_budget_usd',
//             duration_ms: Date.now() - startTime,
//             duration_api_ms: getTotalAPIDuration(),
//             is_error: true,
//             num_turns: turnCount,
//             stop_reason: lastStopReason,
//             session_id: getSessionId(),
//             total_cost_usd: getTotalCost(),
//             usage: this.totalUsage,
//             modelUsage: getModelUsage(),
//             permission_denials: this.permissionDenials,
//             fast_mode_state: getFastModeState(
//               mainLoopModel,
//               initialAppState.fastMode,
//             ),
//             uuid: randomUUID(),
//             errors: [`Reached maximum budget ($${maxBudgetUsd})`],
//           }
//           return
//         }

//         // Check if structured output retry limit exceeded (only on user messages)
//         if (message.type === 'user' && jsonSchema) {
//           const currentCalls = countToolCalls(
//             this.mutableMessages,
//             SYNTHETIC_OUTPUT_TOOL_NAME,
//           )
//           const callsThisQuery = currentCalls - initialStructuredOutputCalls
//           const maxRetries = parseInt(
//             process.env.MAX_STRUCTURED_OUTPUT_RETRIES || '5',
//             10,
//           )
//           if (callsThisQuery >= maxRetries) {
//             if (persistSession) {
//               if (
//                 isEnvTruthy(process.env.CLAUDE_CODE_EAGER_FLUSH) ||
//                 isEnvTruthy(process.env.CLAUDE_CODE_IS_COWORK)
//               ) {
//                 await flushSessionStorage()
//               }
//             }
//             yield {
//               type: 'result',
//               subtype: 'error_max_structured_output_retries',
//               duration_ms: Date.now() - startTime,
//               duration_api_ms: getTotalAPIDuration(),
//               is_error: true,
//               num_turns: turnCount,
//               stop_reason: lastStopReason,
//               session_id: getSessionId(),
//               total_cost_usd: getTotalCost(),
//               usage: this.totalUsage,
//               modelUsage: getModelUsage(),
//               permission_denials: this.permissionDenials,
//               fast_mode_state: getFastModeState(
//                 mainLoopModel,
//                 initialAppState.fastMode,
//               ),
//               uuid: randomUUID(),
//               errors: [
//                 `Failed to provide valid structured output after ${maxRetries} attempts`,
//               ],
//             }
//             return
//           }
//         }
//       }
// }
