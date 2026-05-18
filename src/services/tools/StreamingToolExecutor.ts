import type { ToolUseBlock } from 'src/package/message'
import type { AssistantMessage, Message } from 'src/package/message.js'
import {
  findToolByName,
  type Tools,
  type ToolUseContext,
} from '../../Tool.js'
import { normalizeToolInput } from 'src/utils/api.js'

import { createChildAbortController } from 'src/utils/abortController.js'
import { createUserMessage } from 'src/utils/messages.js'
import { runToolUse } from './toolExecution.js'
import { type MessageUpdate } from './toolOrchestration.js'
import { loggerFor } from 'node_modules/openai/internal/utils/log.mjs'
import { logError } from 'src/utils/logger.js'
//Agent Tool Runtime  并发工具调度器
type ToolStatus = 'queued' | 'executing' | 'completed' | 'yielded'//排队、执行中、已完成、已产出结果
import { CanUseToolFn } from 'src/hooks/useCanUseTool.js'
type TrackedTool = {//跟踪工具的状态和结果
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
    private readonly canUseTool: CanUseToolFn,
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
    if (!toolDefinition) {//如果工具定义不存在，直接将错误结果添加到工具列表中，并标记为已完成
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

    const normalizedInput = normalizeToolInput(
      toolDefinition,
      block.input as never,
    )
    const parsedInput = toolDefinition.inputSchema.safeParse(normalizedInput)
    if(parsedInput.success===false){
      logError(`Error parsing input for tool '${block.name}': ${parsedInput.error.message}: ${JSON.stringify(block.input)}`)
    }
    const isConcurrencySafe = parsedInput?.success
      ? (() => {
          try {
            return Boolean(toolDefinition.isConcurrencySafe(parsedInput.data))
          } catch {
            return false
          }
        })()
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
  private getToolDescription(tool: TrackedTool): string {
    const input = tool.block.input as Record<string, unknown> | undefined
    const summary = input?.command ?? input?.file_path ?? input?.pattern ?? ''
    if (typeof summary === 'string' && summary.length > 0) {
      const truncated =
        summary.length > 40 ? summary.slice(0, 40) + '\u2026' : summary
      return `${tool.block.name}(${truncated})`
    }
    return tool.block.name
  }
  private async processQueue(): Promise<void> {
    for (const tool of this.tools) {//遍历工具列表，如果工具状态不是排队中，跳过
      if (tool.status !== 'queued') continue

      if (this.canExecuteTool(tool.isConcurrencySafe)) {
        await this.executeTool(tool)//执行工具
      } else if (!tool.isConcurrencySafe) {
        break
      }
    }
  }

  private async executeTool(tool: TrackedTool): Promise<void> {
    tool.status = 'executing'//标记工具为执行中
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
        this.siblingAbortController,//创建一个新的AbortController，用于控制工具执行的取消
      )

      const generator = runToolUse(tool.block, tool.assistantMessage, 
        this.canUseTool,
        {
        ...this.toolUseContext,
        abortController: toolAbortController,
      }
    )

      for await (const update of generator) {
        if (this.discarded) break
        messages.push(update.message)
        if (update.contextModifier) {
          contextModifiers.push(update.contextModifier.modifyContext)//加入contextModifiers数组，稍后用于修改工具使用上下文
        }
      }

      tool.results = messages//将工具执行结果保存到工具对象中 数组
      tool.contextModifiers = contextModifiers
      tool.status = 'completed'

      if (!tool.isConcurrencySafe && contextModifiers.length > 0) {//不支持并发且有上下文修改器，立即应用这些修改器
        for (const modifier of contextModifiers) {
          this.toolUseContext = modifier(this.toolUseContext)
        }
      }
    }

    const promise = collectResults()
    tool.promise = promise
    void promise.finally(() => {//处理完继续处理下一个
      void this.processQueue()
    })
  }

  *getCompletedResults(): Generator<MessageUpdate, void> {
    if (this.discarded) {
      return
    }

    for (const tool of this.tools) {//遍历工具列表，如果工具状态已完成，产出结果
      if (tool.status === 'yielded') continue

      if (tool.status === 'completed' && tool.results) {
        tool.status = 'yielded'//标记工具为已产出结果，避免重复产出
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

    while (this.hasUnfinishedTools()) {//有未完成的工具
      await this.processQueue()//继续处理工具队列，确保所有工具都得到执行

      for (const result of this.getCompletedResults()) {
        yield result
      }

      if (this.hasExecutingTools() && !this.hasCompletedResults()) {//producer-consumer 调度优化
        const executingPromises = this.tools
          .filter(t => t.status === 'executing' && t.promise)
          .map(t => t.promise!)//获取所有正在执行的工具的Promise，等待其中任意一个完成，以便及时产出结果

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
