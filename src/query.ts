import type { ToolUseContext } from './Tool.js'
import type { Terminal } from 'src/query/transitions.js'
import { normalizeMessagesForAPI } from './utils/api.js'
import { StreamingToolExecutor } from './services/tools/StreamingToolExecutor.js'
import { runTools } from './services/tools/toolOrchestration.js'
import { createAssistantAPIErrorMessage } from './utils/messages.js'
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
import { asSystemPrompt } from './prompt.js'

export type QueryParams = {
  messages: Message[]
  systemPrompt: string
  userContext: Record<string, string>
  systemContext: Record<string, string>
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

  const { fallbackModel, maxTurns } = params
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
    if (maxTurns !== undefined && state.turnCount > maxTurns) {
      return { reason: 'max_turns', turnCount: state.turnCount }
    }

    let toolUseContext = state.toolUseContext
    const messagesForQuery = [...state.messages]
    toolUseContext = { ...toolUseContext, messages: messagesForQuery }

    yield { type: 'stream_request_start' }

    const assistantMessages: AssistantMessage[] = []
    const toolResults: UserMessage[] = []
    const toolUseBlocks: ToolUseBlock[] = []
    let needsFollowUp = false

    const model =
      toolUseContext.options.mainLoopModel || fallbackModel || 'kimi-k2.6'

    const fullSystemPrompt = asSystemPrompt([params.systemPrompt])

    const useStreamingToolExecution = config.gates.streamingToolExecution
    const streamingToolExecutor = useStreamingToolExecution
      ? new StreamingToolExecutor(toolUseContext.options.tools, toolUseContext)
      : null

    try {
      const appState = toolUseContext.getAppState()
      for await (const message of queryModelWithStreamingImpl({
        messages: messagesForQuery,
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

        const msgToolUseBlocks = collectToolUseBlocks(assistantMessage)
        if (msgToolUseBlocks.length > 0) {
          needsFollowUp = true
          toolUseBlocks.push(...msgToolUseBlocks)

          if (streamingToolExecutor && !toolUseContext.abortController.signal.aborted) {
            for (const toolBlock of msgToolUseBlocks) {
              streamingToolExecutor.addTool(toolBlock, assistantMessage)
            }
          }
        }

        if (streamingToolExecutor && !toolUseContext.abortController.signal.aborted) {
          for (const result of streamingToolExecutor.getCompletedResults()) {
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
      }
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
      if (streamingToolExecutor) {
        for await (const update of streamingToolExecutor.getRemainingResults()) {
          if (update.message) {
            yield update.message
          }
        }
      }
      return { reason: 'aborted_streaming' }
    }

    if (!needsFollowUp) {
      return { reason: 'completed' }
    }

    const toolUpdates = streamingToolExecutor
      ? streamingToolExecutor.getRemainingResults()
      : runTools(toolUseBlocks, assistantMessages, toolUseContext)

    for await (const update of toolUpdates) {
      if (!update.message) continue
      yield update.message
      toolResults.push(
        ...normalizeMessagesForAPI([update.message], toolUseContext.options.tools).filter(
          m => m.type === 'user',
        ) as UserMessage[],
      )
      if (update.newContext) {
        toolUseContext = update.newContext
      }
    }

    state = {
      ...state,
      messages: [...messagesForQuery, ...assistantMessages, ...toolResults],
      toolUseContext,
      turnCount: state.turnCount + 1,
    }
  }
}
