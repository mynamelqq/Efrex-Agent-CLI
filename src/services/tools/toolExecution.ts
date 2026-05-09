import type { ToolUseBlock } from 'src/package/message'
import type { AssistantMessage, Message } from 'src/package/message.js'
import { findToolByName, type ToolUseContext } from '../../Tool.js'
import { createUserMessage } from 'src/utils/messages.js'

export type MessageUpdateLazy<M extends Message = Message> = {
  message: M
  contextModifier?: {
    toolUseID: string
    modifyContext: (context: ToolUseContext) => ToolUseContext
  }
}

export async function* runToolUse(
  toolUse: ToolUseBlock,
  assistantMessage: AssistantMessage,
  toolUseContext: ToolUseContext,
): AsyncGenerator<MessageUpdateLazy, void> {
  const tool = findToolByName(toolUseContext.options.tools, toolUse.name)

  if (!tool) {
    const msg = `Error: No such tool available: ${toolUse.name}`
    yield {
      message: createUserMessage({
        content: [
          {
            type: 'tool_result',
            content: `<tool_use_error>${msg}</tool_use_error>`,
            is_error: true,
            tool_use_id: toolUse.id,
          },
        ],
        toolUseResult: msg,
        sourceToolAssistantUUID: assistantMessage.uuid,
      }),
    }
    return
  }

  const parsedInput = tool.inputSchema.safeParse(toolUse.input)
  if (!parsedInput.success) {
    const msg = `InputValidationError: ${parsedInput.error.message}`
    yield {
      message: createUserMessage({
        content: [
          {
            type: 'tool_result',
            content: `<tool_use_error>${msg}</tool_use_error>`,
            is_error: true,
            tool_use_id: toolUse.id,
          },
        ],
        toolUseResult: msg,
        sourceToolAssistantUUID: assistantMessage.uuid,
      }),
    }
    return
  }

  try {
    const result = await tool.call(parsedInput.data, toolUseContext)
    const toolResultBlock = tool.mapToolResultToToolResultBlockParam(
      result.data,
      toolUse.id,
    )

    yield {
      message: createUserMessage({
        content: [toolResultBlock],
        toolUseResult: result.data,
        sourceToolAssistantUUID: assistantMessage.uuid,
      }),
      contextModifier: result.contextModifier
        ? {
            toolUseID: toolUse.id,
            modifyContext: result.contextModifier,
          }
        : undefined,
    }

    if (result.newMessages && result.newMessages.length > 0) {
      for (const message of result.newMessages) {
        yield { message }
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    const detail = `Error calling tool (${tool.name}): ${msg}`
    yield {
      message: createUserMessage({
        content: [
          {
            type: 'tool_result',
            content: `<tool_use_error>${detail}</tool_use_error>`,
            is_error: true,
            tool_use_id: toolUse.id,
          },
        ],
        toolUseResult: detail,
        sourceToolAssistantUUID: assistantMessage.uuid,
      }),
    }
  }
}
