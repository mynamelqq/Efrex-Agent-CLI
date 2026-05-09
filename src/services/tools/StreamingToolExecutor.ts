import type { ToolUseBlock } from 'src/package/message'
import type { AssistantMessage, Message } from 'src/package/message.js'
import {
  findToolByName,
  type Tools,
  type ToolUseContext,
} from '../../Tool.js'
import { createChildAbortController } from 'src/utils/abortController.js'
import { createUserMessage } from 'src/utils/messages.js'
import { runToolUse } from './toolExecution.js'

type MessageUpdate = {
  message?: Message
  newContext?: ToolUseContext
}

type ToolStatus = 'queued' | 'executing' | 'completed' | 'yielded'

type TrackedTool = {
  id: string
  block: ToolUseBlock
  assistantMessage: AssistantMessage
  status: ToolStatus
  isConcurrencySafe: boolean
  promise?: Promise<void>
  results?: Message[]
  pendingProgress: Message[]
  contextModifiers?: Array<(context: ToolUseContext) => ToolUseContext>
}

export class StreamingToolExecutor {
  private tools: TrackedTool[] = []
  private toolUseContext: ToolUseContext
  private siblingAbortController: AbortController
  private discarded = false

  constructor(
    private readonly toolDefinitions: Tools,
    toolUseContext: ToolUseContext,
  ) {
    this.toolUseContext = toolUseContext
    this.siblingAbortController = createChildAbortController(
      toolUseContext.abortController,
    )
  }

  discard(): void {
    this.discarded = true
    this.siblingAbortController.abort('streaming_fallback')
    this.tools.length = 0
  }

  addTool(block: ToolUseBlock, assistantMessage: AssistantMessage): void {
    const toolDefinition = findToolByName(this.toolDefinitions, block.name)
    if (!toolDefinition) {
      this.tools.push({
        id: block.id,
        block,
        assistantMessage,
        status: 'completed',
        isConcurrencySafe: true,
        pendingProgress: [],
        results: [
          createUserMessage({
            content: [
              {
                type: 'tool_result',
                content: `<tool_use_error>Error: No such tool available: ${block.name}</tool_use_error>`,
                is_error: true,
                tool_use_id: block.id,
              },
            ],
            toolUseResult: `Error: No such tool available: ${block.name}`,
            sourceToolAssistantUUID: assistantMessage.uuid,
          }),
        ],
      })
      return
    }

    const parsedInput = toolDefinition.inputSchema.safeParse(block.input)
    const isConcurrencySafe = parsedInput.success
      ? Boolean(toolDefinition.isConcurrencySafe(parsedInput.data))
      : false

    this.tools.push({
      id: block.id,
      block,
      assistantMessage,
      status: 'queued',
      isConcurrencySafe,
      pendingProgress: [],
    })

    void this.processQueue()
  }

  private canExecuteTool(isConcurrencySafe: boolean): boolean {
    const executingTools = this.tools.filter(t => t.status === 'executing')//正在执行的工具，且并发不安全
    return (
      executingTools.length === 0 ||
      (isConcurrencySafe && executingTools.every(t => t.isConcurrencySafe))
    )
  }

  private async processQueue(): Promise<void> {
    for (const tool of this.tools) {
      if (tool.status !== 'queued') continue

      if (this.canExecuteTool(tool.isConcurrencySafe)) {
        await this.executeTool(tool)
      } else if (!tool.isConcurrencySafe) {
        break
      }
    }
  }

  private async executeTool(tool: TrackedTool): Promise<void> {
    tool.status = 'executing'
    const messages: Message[] = []
    const contextModifiers: Array<(context: ToolUseContext) => ToolUseContext> =
      []

    const collectResults = async () => {
      if (this.discarded) {
        tool.status = 'completed'
        tool.results = []
        return
      }

      const toolAbortController = createChildAbortController(
        this.siblingAbortController,
      )

      const generator = runToolUse(tool.block, tool.assistantMessage, {
        ...this.toolUseContext,
        abortController: toolAbortController,
      })

      for await (const update of generator) {
        if (this.discarded) break
        messages.push(update.message)
        if (update.contextModifier) {
          contextModifiers.push(update.contextModifier.modifyContext)
        }
      }

      tool.results = messages
      tool.contextModifiers = contextModifiers
      tool.status = 'completed'

      if (!tool.isConcurrencySafe && contextModifiers.length > 0) {
        for (const modifier of contextModifiers) {
          this.toolUseContext = modifier(this.toolUseContext)
        }
      }
    }

    const promise = collectResults()
    tool.promise = promise
    void promise.finally(() => {
      void this.processQueue()
    })
  }

  *getCompletedResults(): Generator<MessageUpdate, void> {
    if (this.discarded) {
      return
    }

    for (const tool of this.tools) {
      if (tool.status === 'yielded') continue

      if (tool.status === 'completed' && tool.results) {
        tool.status = 'yielded'
        for (const message of tool.results) {
          yield { message, newContext: this.toolUseContext }
        }
      } else if (tool.status === 'executing' && !tool.isConcurrencySafe) {
        break
      }
    }
  }

  async *getRemainingResults(): AsyncGenerator<MessageUpdate, void> {
    if (this.discarded) {
      return
    }

    while (this.hasUnfinishedTools()) {
      await this.processQueue()

      for (const result of this.getCompletedResults()) {
        yield result
      }

      if (this.hasExecutingTools() && !this.hasCompletedResults()) {
        const executingPromises = this.tools
          .filter(t => t.status === 'executing' && t.promise)
          .map(t => t.promise!)

        if (executingPromises.length > 0) {
          await Promise.race(executingPromises)
        }
      }
    }

    for (const result of this.getCompletedResults()) {
      yield result
    }
  }

  private hasCompletedResults(): boolean {
    return this.tools.some(t => t.status === 'completed')
  }

  private hasExecutingTools(): boolean {
    return this.tools.some(t => t.status === 'executing')
  }

  private hasUnfinishedTools(): boolean {
    return this.tools.some(t => t.status !== 'yielded')
  }

  getUpdatedContext(): ToolUseContext {
    return this.toolUseContext
  }
}
