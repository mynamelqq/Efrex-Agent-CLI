import type { ToolUseContext } from './Tool.js'
import type { Terminal } from 'src/query/transitions.js'
import { normalizeMessagesForAPI, prependUserContext } from './utils/api.js'
import { StreamingToolExecutor } from './services/tools/StreamingToolExecutor.js'
import { runTools } from './services/tools/toolOrchestration.js'
import { createAssistantAPIErrorMessage, createUserInterruptionMessage } from './utils/messages.js'
import { queryModelWithStreaming } from './services/api/efrex.js'
import { buildQueryConfig } from './query/config.js'
import { ImageResizeError } from './utils/imageResizer.js'
import type {
  AssistantMessage,
  Message,
  RequestStartEvent,
  StreamEvent,
  TombstoneMessage,
  ToolUseBlock,
  ToolUseSummaryMessage,
  UserMessage,
} from 'src/package/message.js'
import { asSystemPrompt, SystemPrompt } from './prompt.js'
import { logForDebugging } from './utils/debug.js'
import { createAttachmentMessage } from './utils/messages.js'
import { applyToolResultBudget } from './utils/toolResultStorage.js'
export type QueryParams = {
  messages: Message[]
  systemPrompt: SystemPrompt
  userContext: { [k: string]: string }
  systemContext: { [k: string]: string }
  toolUseContext: ToolUseContext
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
}

function collectToolUseBlocks(assistantMessage: AssistantMessage): ToolUseBlock[] {
  const content = Array.isArray(assistantMessage.message?.content)
    ? assistantMessage.message.content
    : []
  return content.filter((block: { type?: string }) => block.type === 'tool_use') as ToolUseBlock[]
}

export async function* query(
  params: QueryParams,
): AsyncGenerator<StreamEvent | RequestStartEvent | Message | ToolUseSummaryMessage, Terminal> {
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
  | Message
  | TombstoneMessage
  | ToolUseSummaryMessage,
  Terminal
> {
  void consumedCommandUuids
  const { fallbackModel, maxTurns,
    systemPrompt,
    userContext,
    systemContext,
    querySource,
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
  }

  while (true) {

    const {
        messages,
        hasAttemptedReactiveCompact,
        stopHookActive,
        turnCount,
    } = state
    if (maxTurns !== undefined && state.turnCount > maxTurns) {
      return { reason: 'max_turns', turnCount: state.turnCount }
    }

    let toolUseContext = state.toolUseContext
    const messagesForQuery = await applyToolResultBudget(state.messages,
      toolUseContext.contentReplacementState,
      undefined,
      new Set(
        toolUseContext.options.tools//从工具配置里提取出【没有设置最大字符限制】的工具名称，并存进 Set 去重。
          .filter(t => !Number.isFinite(t.maxResultSizeChars))
          .map(t => t.name),
      ),
    )
    // const { compactionResult, consecutiveFailures } = await autoCompactIfNeeded(
    //   messagesForQuery,
    //   toolUseContext,
    //   {
    //     systemPrompt,
    //     userContext,
    //     systemContext,
    //     toolUseContext,
    //     forkContextMessages: messagesForQuery,
    //   },
    //   querySource,
    //   tracking,
    //   snipTokensFreed,
    // )
    toolUseContext = { ...toolUseContext, messages: messagesForQuery }

    yield { type: 'stream_request_start' }

    const assistantMessages: AssistantMessage[] = []
    const toolResults: UserMessage[] = []
    const toolUseBlocks: ToolUseBlock[] = []
    let needsFollowUp = false

    const model =
      toolUseContext.options.mainLoopModel || fallbackModel || 'kimi-k2.6'

    const fullSystemPrompt = asSystemPrompt(params.systemPrompt)

    const useStreamingToolExecution = config.gates.streamingToolExecution
    const streamingToolExecutor = useStreamingToolExecution
      ? new StreamingToolExecutor(toolUseContext.options.tools, toolUseContext)
      : null

    try {
      const appState = toolUseContext.getAppState()
      for await (const message of queryModelWithStreamingImpl({
        messages:prependUserContext(messagesForQuery, userContext),
        systemPrompt: fullSystemPrompt,
        thinkingConfig: toolUseContext.options.thinkingConfig,
        tools: toolUseContext.options.tools,
        signal: toolUseContext.abortController.signal,
        options: {
          model,
          toolChoice: undefined,
          isNonInteractiveSession: toolUseContext.options.isNonInteractiveSession,
          fallbackModel,
          hasAppendSystemPrompt: !!toolUseContext.options.appendSystemPrompt,
          effortValue: appState?.effortValue,
          advisorModel: appState?.advisorModel,
        },
      })) {
        yield message

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
            logForDebugging('Received tool result message from streaming executor:', result.message)
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
      return { reason: 'completed' }
    }
   
    const toolUpdates = streamingToolExecutor
      ? streamingToolExecutor.getRemainingResults()
      : runTools(toolUseBlocks, assistantMessages, toolUseContext)//流式执行器存在，走 StreamingToolExecutor；否则回退到传统的 runTools 批处理执行器。

    for await (const update of toolUpdates) {
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
      if (!update.message) continue
      yield update.message
      toolResults.push(
        ...normalizeMessagesForAPI([update.message], toolUseContext.options.tools).filter(
          m => m.type === 'user',
        ),
      )
      if (update.newContext) {
        toolUseContext = update.newContext
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
      messages:messagesForQuery.concat(assistantMessages,toolResults),
      toolUseContext,
      turnCount: nextTurnCount,
    }
  }
}
