import type { ToolUseContext } from './Tool.js'
import type { Terminal } from 'src/query/transitions.js'
import { normalizeMessagesForAPI, prependUserContext,appendSystemContext} from './utils/api.js'
import { autoCompactIfNeeded } from './services/compact/autoCompact.js'
import { StreamingToolExecutor } from './services/tools/StreamingToolExecutor.js'
import { AutoCompactTrackingState } from './services/compact/autoCompact.js'
import { runTools } from './services/tools/toolOrchestration.js'
import { PROMPT_TOO_LONG_ERROR_MESSAGE } from './services/api/errors.js'
import { calculateTokenWarningState } from './services/compact/autoCompact.js'
import { tokenCountWithEstimation } from './utils/tokens.js'
import { getMessagesAfterCompactBoundary } from './utils/messages.js'
import { isAutoCompactEnabled } from './services/compact/autoCompact.js'
import { createAssistantAPIErrorMessage, createUserInterruptionMessage } from './utils/messages.js'
import { queryModelWithStreaming } from './services/api/efrex.js'
import { buildQueryConfig } from './query/config.js'
import { ImageResizeError } from './utils/imageResizer.js'
import { isPromptTooLongMessage } from './services/api/errors.js'
import type {
  ApiRetryStatusEvent,
  AssistantMessage,
  Message,
  RequestStartEvent,
  StreamEvent,
  TombstoneMessage,
  ToolUseBlock,
  ToolUseSummaryMessage,
  UserMessage,
} from 'src/package/message.js'
import {randomUUID}from "crypto"
import { asSystemPrompt, SystemPrompt } from './prompt.js'
import { logForDebugging } from './utils/debug.js'
import { createAttachmentMessage } from './utils/messages.js'
import { CanUseToolFn } from './hooks/useCanUseTool.js'
import { applyToolResultBudget } from './utils/toolResultStorage.js'
import { buildPostCompactMessages } from './services/compact/compact.js'
import { microcompactMessages } from './services/compact/mircoCompact.js'
const reactiveCompact = (require('./services/compact/reactiveCompact.js') as typeof import('./services/compact/reactiveCompact.js'))
export type QueryParams = {
  messages: Message[]
  systemPrompt: SystemPrompt
  userContext: { [k: string]: string }
  systemContext: { [k: string]: string }
  toolUseContext: ToolUseContext
  canUseTool: CanUseToolFn
  fallbackModel?: string
  querySource: string
  maxTurns?: number
  queryModelWithStreamingImpl?: typeof queryModelWithStreaming
}

type State = {
  messages: Message[]
  hasAttemptedReactiveCompact: boolean
  stopHookActive: boolean | undefined
  turnCount: number
  toolUseContext: ToolUseContext
 autoCompactTracking: AutoCompactTrackingState | undefined
}
/**
 * Is this a max_output_tokens error message? If so, the streaming loop should
 * withhold it from SDK callers until we know whether the recovery loop can
 * continue. Yielding early leaks an intermediate error to SDK callers (e.g.
 * cowork/desktop) that terminate the session on any `error` field — the
 * recovery loop keeps running but nobody is listening.
 *
 * Mirrors reactiveCompact.isWithheldPromptTooLong.
 */
function isWithheldMaxOutputTokens(
  msg: Message | StreamEvent | undefined,
): msg is AssistantMessage {
  return msg?.type === 'assistant' && msg.apiError === 'max_output_tokens'
}
function collectToolUseBlocks(assistantMessage: AssistantMessage): ToolUseBlock[] {
  const content = Array.isArray(assistantMessage.message?.content)
    ? assistantMessage.message.content
    : []
  return content.filter((block: { type?: string }) => block.type === 'tool_use') as ToolUseBlock[]
}

export async function* query(
  params: QueryParams,
): AsyncGenerator<
  StreamEvent | RequestStartEvent | Message | ToolUseSummaryMessage | ApiRetryStatusEvent,
  Terminal
> {
  const consumedCommandUuids: string[] = []
  const terminal = yield* queryLoop(params, consumedCommandUuids)
  return terminal
}

async function* queryLoop(
  params: QueryParams,
  consumedCommandUuids: string[],
): AsyncGenerator<
  | StreamEvent
  | RequestStartEvent
  | ApiRetryStatusEvent
  | Message
  | TombstoneMessage
  | ToolUseSummaryMessage,
  Terminal
> {
  void consumedCommandUuids
  const {
    systemPrompt,
    userContext,
    systemContext,
    canUseTool,
    fallbackModel,
    querySource,
    maxTurns,
  } = params
  const queryModelWithStreamingImpl =
    params.queryModelWithStreamingImpl ?? queryModelWithStreaming
  const config = buildQueryConfig()

  let state: State = {
    messages: params.messages,
    toolUseContext: params.toolUseContext,
    stopHookActive: undefined,
    hasAttemptedReactiveCompact: false,
    turnCount: 1,
    autoCompactTracking: undefined,
  }

  while (true) {
    const {
        messages,
        autoCompactTracking,
        hasAttemptedReactiveCompact,
        stopHookActive,
        turnCount,
    } = state
    if (maxTurns !== undefined && state.turnCount > maxTurns) {
      return { reason: 'max_turns', turnCount: state.turnCount }
    }

    let toolUseContext = state.toolUseContext
    let messagesForQuery = getMessagesAfterCompactBoundary(messages)

    let tracking = autoCompactTracking
    messagesForQuery = await applyToolResultBudget(
      state.messages,
      toolUseContext.contentReplacementState,
      undefined,
      new Set(
        toolUseContext.options.tools
          .filter(t => !Number.isFinite(t.maxResultSizeChars))
          .map(t => t.name),
      ),
    )
    const microcompactResult = await microcompactMessages(
      messagesForQuery,
      toolUseContext,
      querySource,
    )
    messagesForQuery = microcompactResult.messages

    // 从 contentReplacementState.replacements 中释放那些内容已被替换为清除消息的工具结果所使用的原始字符串。
    if (microcompactResult.clearedToolUseIds?.length) {
      const replacements = toolUseContext?.contentReplacementState?.replacements
      if (replacements) {
        for (const id of microcompactResult.clearedToolUseIds) {
          replacements.delete(id)
        }
      }
    }
      // For cached microcompact (cache editing), defer boundary message until after
    // the API response so we can use actual cache_deleted_input_tokens.
    // Gated behind feature() so the string is eliminated from external builds.
    const pendingCacheEdits =  undefined
    const { compactionResult, consecutiveFailures } = await autoCompactIfNeeded(
      messagesForQuery,
      toolUseContext,
      {
        systemPrompt,
        userContext,
        systemContext,
        toolUseContext,
        forkContextMessages: messagesForQuery,
      },
      querySource,
      tracking,
    )

    if (compactionResult) {
      const {
        preCompactTokenCount,
        postCompactTokenCount,
        truePostCompactTokenCount,
        compactionUsage,
      } = compactionResult
 
      // Reset on every compact so turnCounter/turnId reflect the MOST RECENT
      // compact. recompactionInfo (autoCompact.ts:190) already captured the
      // old values for turnsSincePreviousCompact/previousCompactTurnId before
      // the call, so this reset doesn't lose those.
      tracking = {
        compacted: true,
        turnId: randomUUID(),
        turnCounter: 0,
        consecutiveFailures: 0,
      }

      const postCompactMessages = buildPostCompactMessages(compactionResult)

      for (const message of postCompactMessages) {
        yield message
      }

      // Continue on with the current query call using the post compact messages
      messagesForQuery = postCompactMessages
    } else if (consecutiveFailures !== undefined) {

      tracking = {
        ...(tracking ?? { compacted: false, turnId: '', turnCounter: 0 }),
        consecutiveFailures,
      }
    }
    toolUseContext = { ...toolUseContext, messages: messagesForQuery }
    const mediaRecoveryEnabled =reactiveCompact?.isReactiveCompactEnabled() ?? false
    yield { type: 'stream_request_start' }

    const assistantMessages: AssistantMessage[] = []
    const toolResults: UserMessage[] = []
    const toolUseBlocks: ToolUseBlock[] = []
    let needsFollowUp = false

    const model =
      toolUseContext.options.mainLoopModel || fallbackModel || 'kimi-k2.6'

    const fullSystemPrompt = asSystemPrompt(appendSystemContext(params.systemPrompt, params.systemContext),)

    const useStreamingToolExecution = config.gates.streamingToolExecution
    const streamingToolExecutor = useStreamingToolExecution
      ? new StreamingToolExecutor(toolUseContext.options.tools, toolUseContext,canUseTool)
      : null
       reactiveCompact?.isReactiveCompactEnabled() ?? false
    
    if (//没有进行自动压缩兜底，检查输入内容（消息）是否超出了模型的令牌（token）限制，如果超出则返回错误。
      !compactionResult &&
      querySource !== 'compact' &&
      querySource !== 'session_memory' &&
      !(
        reactiveCompact?.isReactiveCompactEnabled() && isAutoCompactEnabled()
      ) 
    ) {
      const { isAtBlockingLimit } = calculateTokenWarningState(
        tokenCountWithEstimation(messagesForQuery),
        toolUseContext.options.mainLoopModel,
      )

      if (isAtBlockingLimit) {

        yield createAssistantAPIErrorMessage({
          content: PROMPT_TOO_LONG_ERROR_MESSAGE,
          error: 'invalid_request',
        })
        return { reason: 'blocking_limit' }
      }
    }
// // 预测自动压缩：评估本次增长是否会超出上下文窗口范围。直接使用有效上下文窗口（不使用自动压缩缓冲区）来进行判断，
// // 以避免因调用已减去了缓冲区大小的 getAutoCompactThreshold 方法而导致重复预留资源。
//     if (!autoCompactOutcome.compactionResult && isAutoCompactEnabled()) {
//       const model = toolUseContext.options.mainLoopModel
//       const currentTokens =tokenCountWithEstimation(messagesForQuery)
//       const estimatedGrowth = estimateMaxTurnGrowth(model)
//       const predictiveThreshold =getEffectiveContextWindowSize(model) - estimatedGrowth
//       if (currentTokens > predictiveThreshold) {
//         const predictiveResult = await deps.autocompact(//API 调用前，预估本轮增长后是否会超过 `effectiveContextWindow`
//           messagesForQuery,
//           toolUseContext,
//           {
//             systemPrompt,
//             userContext,
//             systemContext,
//             toolUseContext,
//             forkContextMessages: messagesForQuery,
//           },
//           querySource,
//           tracking,
//         )
//         if (predictiveResult.compactionResult) {
//           messagesForQuery = buildPostCompactMessages(
//             predictiveResult.compactionResult,
//           )
//           tracking = tracking
//             ? {
//                 ...tracking,
//                 compacted: true,
//                 consecutiveFailures: predictiveResult.consecutiveFailures ?? 0,
//               }
//             : tracking
//         }
//       }
//     }
    try {
      const appState = toolUseContext.getAppState()
      logForDebugging('query: forwarding tools to provider', {
        level: 'debug',
        toolCount: toolUseContext.options.tools.length,
        toolNames: toolUseContext.options.tools.map(tool => tool.name),
        mcpToolCount: appState.mcp.tools.length,
        mcpToolNames: appState.mcp.tools.map(tool => tool.name),
      })
      for await (const message of queryModelWithStreamingImpl({
        messages:prependUserContext(messagesForQuery, userContext),
        systemPrompt: fullSystemPrompt,
        thinkingConfig: toolUseContext.options.thinkingConfig,
        tools: toolUseContext.options.tools,
        signal: toolUseContext.abortController.signal,
        options: {
          async getToolPermissionContext() {
            const appState = toolUseContext.getAppState()
            return appState.toolPermissionContext
          },
          model,
          toolChoice: undefined,
          mcpTools: appState.mcp.tools,
          hasPendingMcpServers: appState.mcp.clients.some(
            c => c.type === 'pending',
          ),
          isNonInteractiveSession: toolUseContext.options.isNonInteractiveSession,
          fallbackModel,
          hasAppendSystemPrompt: !!toolUseContext.options.appendSystemPrompt,
          effortValue: appState?.effortValue,
          advisorModel: appState?.advisorModel,
        },
      })) {

        let withheld = false
        if (reactiveCompact?.isWithheldPromptTooLong(message as Message)) {
          withheld = true
        }
        if (
            mediaRecoveryEnabled &&
            reactiveCompact?.isWithheldMediaSizeError(message as Message)
          ) {
            withheld = true
        }
        if (isWithheldMaxOutputTokens(message as Message)) {
            withheld = true
        }
        if (!withheld) {
          yield message
        }

        if (message.type !== 'assistant') {
          continue
        }

        const assistantMessage = message as AssistantMessage
        assistantMessages.push(assistantMessage)
        // 收集工具调用请求
        const msgToolUseBlocks = collectToolUseBlocks(assistantMessage)
        if (msgToolUseBlocks.length > 0) {
          needsFollowUp = true
          toolUseBlocks.push(...msgToolUseBlocks)

          if (streamingToolExecutor && !toolUseContext.abortController.signal.aborted) {//启用流式工具执行器且未中止，则将工具块添加到流式执行器中，以便在生成过程中逐步处理工具调用。
            for (const toolBlock of msgToolUseBlocks) {
              streamingToolExecutor.addTool(toolBlock, assistantMessage)
            }
          }
        }

        if (streamingToolExecutor && !toolUseContext.abortController.signal.aborted) {//如果启用流式工具执行器且未中止，则获取已完成的工具结果并更新上下文。
          for (const result of streamingToolExecutor.getCompletedResults()) {//流式执行器中已完成的工具结果是一个生成器，逐个处理每个结果。
            if (!result.message) continue
            yield result.message
            toolResults.push(
              ...normalizeMessagesForAPI([result.message], toolUseContext.options.tools).filter(
                m => m.type === 'user',
              ) as UserMessage[],
            )
            if (result.newContext) {
              toolUseContext = result.newContext
            }
          }
        }
    
      }//循环
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (error instanceof ImageResizeError) {
        yield createAssistantAPIErrorMessage({ content: error.message })
        return { reason: 'image_error' }
      }
      yield createAssistantAPIErrorMessage({ content: errorMessage })
      return { reason: 'model_error', error }
    }
    if (toolUseContext.abortController.signal.aborted) {
      if (toolUseContext.abortController.signal.reason !== 'interrupt') {
          yield createUserInterruptionMessage({
            toolUse: true,
          })
      }
      const nextTurnCountOnAbort = turnCount + 1
      if (maxTurns && nextTurnCountOnAbort > maxTurns) {
        yield createAttachmentMessage({
          type: 'max_turns_reached',
          maxTurns,
          turnCount: nextTurnCountOnAbort,
        })
      }
      return { reason: 'aborted_tools' }
    }
    
    if (!needsFollowUp) {
      const lastMessage = assistantMessages.at(-1)
      const isWithheld413 =lastMessage?.type === 'assistant' &&lastMessage.isApiErrorMessage &&isPromptTooLongMessage(lastMessage)
      const isWithheldMedia =mediaRecoveryEnabled &&reactiveCompact?.isWithheldMediaSizeError(lastMessage as Message)
      if ((isWithheld413 || isWithheldMedia) && reactiveCompact) {
        const compacted = await reactiveCompact.tryReactiveCompact({
          hasAttempted: hasAttemptedReactiveCompact,
          toolUseContext,
          querySource,
          aborted: toolUseContext.abortController.signal.aborted,
          messages: messagesForQuery,
          // cacheSafeParams: {
          //   systemPrompt,
          //   userContext,
          //   systemContext,
          //   toolUseContext,
          //   forkContextMessages: messagesForQuery,
          // },
        })

        if (compacted) {
          // task_budget: same carryover as the proactive path above.
          // messagesForQuery still holds the pre-compact array here (the
          // 413-failed attempt's input).
          const postCompactMessages = buildPostCompactMessages(compacted)
          for (const msg of postCompactMessages) {
            yield msg
          }
          const next: State = {
            messages: postCompactMessages,
            toolUseContext,
            autoCompactTracking: undefined,
            hasAttemptedReactiveCompact: true,
            stopHookActive: undefined,
            turnCount,
          }
          state = next
          continue
        }

        // No recovery — surface the withheld error and exit. Do NOT fall
        // through to stop hooks: the model never produced a valid response,
        // so hooks have nothing meaningful to evaluate. Running stop hooks
        // on prompt-too-long creates a death spiral: error → hook blocking
        // → retry → error → … (the hook injects more tokens each cycle).
        yield lastMessage!
        return { reason: isWithheldMedia ? 'image_error' : 'prompt_too_long' }
      } 
       // Check for max_output_tokens and inject recovery message. The error
      // was withheld from the stream above; only surface it if recovery
      // exhausts.
      if (isWithheldMaxOutputTokens(lastMessage)) {
        // Escalating retry: if we used the capped 8k default and hit the
        // limit, retry the SAME request at 64k — no meta message, no
        // multi-turn dance. This fires once per turn (guarded by the
        // override check), then falls through to multi-turn recovery if
        // 64k also hits the cap.
        // 3P default: false (not validated on Bedrock/Vertex)
        // if (maxOutputTokensRecoveryCount < MAX_OUTPUT_TOKENS_RECOVERY_LIMIT) {
        //   const recoveryMessage = createUserMessage({
        //     content:
        //       `Output token limit hit. Resume directly — no apology, no recap of what you were doing. ` +
        //       `Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces.`,
        //     isMeta: true,
        //   })

        //   const next: State = {
        //     messages: [
        //       ...messagesForQuery,
        //       ...assistantMessages,
        //       recoveryMessage,
        //     ],
        //     toolUseContext,
        //     autoCompactTracking: tracking,
        //     maxOutputTokensRecoveryCount: maxOutputTokensRecoveryCount + 1,
        //     hasAttemptedReactiveCompact,
        //     maxOutputTokensOverride: undefined,
        //     pendingToolUseSummary: undefined,
        //     stopHookActive: undefined,
        //     turnCount,
        //     transition: {
        //       reason: 'max_output_tokens_recovery',
        //       attempt: maxOutputTokensRecoveryCount + 1,
        //     },
        //   }
        //   state = next
        //   continue
        // }
      // Skip stop hooks when the last message is an API error (rate limit,
          // prompt-too-long, auth failure, etc.). The model never produced a
          // real response — hooks evaluating it create a death spiral:
          // error → hook blocking → retry → error → …
        if (lastMessage?.isApiErrorMessage) {
          return {
            reason: 'model_error',
            error: lastMessage.error ?? lastMessage.apiError ?? 'api_error',
          }
        }
        
        // Recovery exhausted — surface the withheld error now.
        yield lastMessage
      }
      return { reason: 'completed' }
    }
    let shouldPreventContinuation = false
    let updatedToolUseContext = toolUseContext

    const toolUpdates = streamingToolExecutor
      ? streamingToolExecutor.getRemainingResults()
      : runTools(toolUseBlocks, assistantMessages, toolUseContext)//流式执行器存在，走 StreamingToolExecutor；否则回退到传统的 runTools 批处理执行器。

    for await (const update of toolUpdates) {
      if (update.message) {
        yield update.message

        if (
          update.message.type === 'attachment' &&
          update.message.attachment!.type === 'hook_stopped_continuation'
        ) {
          shouldPreventContinuation = true
        }

        toolResults.push(
          ...normalizeMessagesForAPI(
            [update.message],
            toolUseContext.options.tools,
          ).filter(_ => _.type === 'user'),
        )
      }
      if (update.newContext) {
        updatedToolUseContext = {
          ...update.newContext,
        }
      }
    }
    // 在轮次之间刷新工具，以便新连接的 MCP 服务器可用
    if (updatedToolUseContext.options.refreshTools) {//如果在此期间mcp服务器连接上了，工具有百脑汇
      const refreshedTools = updatedToolUseContext.options.refreshTools()
      if (refreshedTools !== updatedToolUseContext.options.tools) {
        updatedToolUseContext = {
          ...updatedToolUseContext,
          options: {
            ...updatedToolUseContext.options,
            tools: refreshedTools,
          },
        }
      }
    }
    const nextTurnCount = turnCount + 1
    logForDebugging('Completed processing tool updates. Total tool results:', toolResults)
    if (maxTurns && nextTurnCount > maxTurns) {//抛出最大轮数错误
      yield createAttachmentMessage({
        type: 'max_turns_reached',
        maxTurns,
        turnCount: nextTurnCount,
      })
      return { reason: 'max_turns', turnCount: nextTurnCount }
    }
    state = {
      ...state,
      autoCompactTracking: tracking,
      messages:messagesForQuery.concat(assistantMessages,toolResults),
      toolUseContext:updatedToolUseContext,
      turnCount: nextTurnCount,
    }
  }
}
