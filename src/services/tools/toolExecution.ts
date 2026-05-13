import type { ToolUseBlock } from 'src/package/message'
import type { AssistantMessage, Message } from 'src/package/message.js'
import { findToolByName, type ToolUseContext,Tool} from '../../Tool.js'
import { createUserMessage } from 'src/utils/messages.js'
import { logError } from 'src/utils/logger.js'
import { normalizeToolInput } from 'src/utils/api.js'
import type { z } from 'zod/v4'
// import { Stream } from '../../utils/stream.js'
import { createToolResultStopMessage,CANCEL_MESSAGE } from 'src/utils/messages.js'
import { formatZodValidationError } from 'src/utils/toolErrors.js'
export type MessageUpdateLazy<M extends Message = Message> = {
  message: M
  contextModifier?: {
    toolUseID: string
    modifyContext: (context: ToolUseContext) => ToolUseContext
  }
}
// function streamedCheckPermissionsAndCallTool(
//   tool: Tool,
//   toolUseID: string,
//   input: { [key: string]: boolean | string | number },
//   toolUseContext: ToolUseContext,
//   assistantMessage: AssistantMessage,
// ): AsyncIterable<MessageUpdateLazy> {
//   // This is a bit of a hack to get progress events and final results
//   // into a single async iterable.
//   //
//   // Ideally the progress reporting and tool call reporting would
//   // be via separate mechanisms.
//   const stream = new Stream<MessageUpdateLazy>()
//   checkPermissionsAndCallTool(
//     tool,
//     toolUseID,
//     input,
//     toolUseContext,
//     assistantMessage,

//   )
//     .then(results => {
//       for (const result of results) {
//         stream.enqueue(result)
//       }
//     })
//     .catch(error => {
//       stream.error(error)
//     })
//     .finally(() => {
//       stream.done()
//     })
//   return stream
// }

export async function* runToolUse(
  toolUse: ToolUseBlock,
  assistantMessage: AssistantMessage,
  toolUseContext: ToolUseContext,
): AsyncGenerator<MessageUpdateLazy, void> {
  const tool = findToolByName(toolUseContext.options.tools, toolUse.name)
    // const messageId = assistantMessage.message.id as string
  // const requestId = assistantMessage.requestId as string | undefined
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
  const toolInput = toolUse.input as { [key: string]: string }
  // try {
  //   if (toolUseContext.abortController.signal.aborted) {
  //     const content = createToolResultStopMessage(toolUse.id)
  //     yield {
  //       message: createUserMessage({
  //         content: [content],
  //         toolUseResult: CANCEL_MESSAGE,
  //         sourceToolAssistantUUID: assistantMessage.uuid,
  //       }),
  //     }
  //     return
  //   }

  //   for await (const update of streamedCheckPermissionsAndCallTool(
  //     tool,
  //     toolUse.id,
  //     toolInput,
  //     toolUseContext,
  //     assistantMessage,
  //   )) {
  //     yield update
  //   }
  // } catch (error) {
  //   logError(error)
  //   const errorMessage = error instanceof Error ? error.message : String(error)
  //   const toolInfo = tool ? ` (${tool.name})` : ''
  //   const detailedError = `Error calling tool${toolInfo}: ${errorMessage}`

  //   yield {
  //     message: createUserMessage({
  //       content: [
  //         {
  //           type: 'tool_result',
  //           content: `<tool_use_error>${detailedError}</tool_use_error>`,
  //           is_error: true,
  //           tool_use_id: toolUse.id,
  //         },
  //       ],
  //       toolUseResult: detailedError,
  //       sourceToolAssistantUUID: assistantMessage.uuid,
  //     }),
  //   }
  // } 
  const normalizedInput = normalizeToolInput(
    tool,
    toolUse.input as z.infer<typeof tool.inputSchema>,
  )
  const parsedInput = tool.inputSchema.safeParse(normalizedInput)
  if (!parsedInput.success) {
    let errorContent = formatZodValidationError(tool.name, parsedInput.error)

    yield {
      message: createUserMessage({
        content: [
          {
            type: 'tool_result',
            content: `<tool_use_error>InputValidationError: ${errorContent}</tool_use_error>`,
            is_error: true,
            tool_use_id: toolUse.id,
          },
        ],
        toolUseResult: `InputValidationError: ${parsedInput.error.message}`,
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
