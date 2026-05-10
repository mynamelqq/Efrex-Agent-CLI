import type { ToolUseBlock } from 'src/package/message'
import type { AssistantMessage, Message } from 'src/package/message.js'
import { findToolByName, type ToolUseContext } from '../../Tool.js'
import { all } from '../../utils/generators.js'
import { type MessageUpdateLazy, runToolUse } from './toolExecution.js'

export type MessageUpdate = {
  message?: Message
  newContext: ToolUseContext
}

type Batch = { isConcurrencySafe: boolean; blocks: ToolUseBlock[] }

function getMaxToolUseConcurrency(): number {
  return (
    parseInt(process.env.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY || '', 10) || 10
  )
}

function findOwnerAssistant(
  toolUse: ToolUseBlock,
  assistantMessages: AssistantMessage[],
): AssistantMessage | undefined {
  return (
    assistantMessages.find(message => {
      const content = Array.isArray(message.message?.content)
        ? message.message.content
        : []
      return content.some(
        block => block.type === 'tool_use' && block.id === toolUse.id,
      )
    }) ?? assistantMessages.at(-1)
  )
}

function partitionToolCalls(
  toolUseMessages: ToolUseBlock[],
  toolUseContext: ToolUseContext,
): Batch[] {
  return toolUseMessages.reduce((acc: Batch[], toolUse) => {
    const tool = findToolByName(toolUseContext.options.tools, toolUse.name)
    const parsedInput = tool?.inputSchema.safeParse(toolUse.input)
    const isConcurrencySafe = parsedInput?.success
      ? (() => {
          try {
            return Boolean(tool?.isConcurrencySafe(parsedInput.data))
          } catch {
            return false
          }
        })()
      : false

    if (isConcurrencySafe && acc[acc.length - 1]?.isConcurrencySafe) {
      acc[acc.length - 1]!.blocks.push(toolUse)
    } else {
      acc.push({ isConcurrencySafe, blocks: [toolUse] })
    }

    return acc
  }, [])
}

async function* runToolsSerially(
  toolUseMessages: ToolUseBlock[],
  assistantMessages: AssistantMessage[],
  toolUseContext: ToolUseContext,
): AsyncGenerator<MessageUpdate, void> {
  let currentContext = toolUseContext

  for (const toolUse of toolUseMessages) {
    const ownerAssistant = findOwnerAssistant(toolUse, assistantMessages)
    if (!ownerAssistant) {
      continue
    }

    for await (const update of runToolUse(
      toolUse,
      ownerAssistant,
      currentContext,
    )) {
      if (update.contextModifier) {
        currentContext = update.contextModifier.modifyContext(currentContext)
      }

      yield {
        message: update.message,
        newContext: currentContext,
      }
    }
  }
}

async function* runToolsConcurrently(
  toolUseMessages: ToolUseBlock[],
  assistantMessages: AssistantMessage[],
  toolUseContext: ToolUseContext,
): AsyncGenerator<MessageUpdateLazy, void> {
  yield* all(
    toolUseMessages
      .map(toolUse => {
        const ownerAssistant = findOwnerAssistant(toolUse, assistantMessages)
        if (!ownerAssistant) {
          return null
        }

        return runToolUse(toolUse, ownerAssistant, toolUseContext)
      })
      .filter((generator): generator is AsyncGenerator<MessageUpdateLazy, void> =>
        generator !== null,
      ),
    getMaxToolUseConcurrency(),
  )
}

export async function* runTools(
  toolUseMessages: ToolUseBlock[],
  assistantMessages: AssistantMessage[],
  toolUseContext: ToolUseContext,
): AsyncGenerator<MessageUpdate, void> {
  let currentContext = toolUseContext

  for (const { isConcurrencySafe, blocks } of partitionToolCalls(
    toolUseMessages,
    currentContext,
  )) {
    if (isConcurrencySafe) {
      const queuedContextModifiers: Record<
        string,
        ((context: ToolUseContext) => ToolUseContext)[]
      > = {}

      for await (const update of runToolsConcurrently(
        blocks,
        assistantMessages,
        currentContext,
      )) {
        if (update.contextModifier) {
          const { toolUseID, modifyContext } = update.contextModifier
          if (!queuedContextModifiers[toolUseID]) {
            queuedContextModifiers[toolUseID] = []
          }
          queuedContextModifiers[toolUseID].push(modifyContext)
        }

        yield {
          message: update.message,
          newContext: currentContext,
        }
      }

      for (const block of blocks) {
        const modifiers = queuedContextModifiers[block.id]
        if (!modifiers) {
          continue
        }
        for (const modifier of modifiers) {
          currentContext = modifier(currentContext)
        }
      }

      yield { newContext: currentContext }
      continue
    }

    for await (const update of runToolsSerially(
      blocks,
      assistantMessages,
      currentContext,
    )) {
      currentContext = update.newContext
      yield update
    }
  }
}
