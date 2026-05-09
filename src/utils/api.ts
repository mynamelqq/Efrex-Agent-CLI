import { getCwd } from './cwd.js'
import { Tool, Tools, toolMatchesName } from 'src/Tool'
import type {
  AssistantMessage,
  AttachmentMessage,
  Message,
  MessageOrigin,
  MessageType,
  NormalizedAssistantMessage,
  NormalizedMessage,
  NormalizedUserMessage,
  PartialCompactDirection,
  ProgressMessage,
  RequestStartEvent,
  StopHookInfo,
  StreamEvent,
  SystemAgentsKilledMessage,
  SystemAPIErrorMessage,
  SystemApiMetricsMessage,
  SystemAwaySummaryMessage,
  SystemBridgeStatusMessage,
  SystemCompactBoundaryMessage,
  SystemInformationalMessage,
  SystemLocalCommandMessage,
  SystemMemorySavedMessage,
  SystemMessage,
  SystemMessageLevel,
  SystemMicrocompactBoundaryMessage,
  SystemPermissionRetryMessage,
  SystemScheduledTaskFireMessage,
  SystemStopHookSummaryMessage,
  SystemTurnDurationMessage,
  TombstoneMessage,
  ToolUseSummaryMessage,
  UserMessage,
} from 'src/package/message.js'
import { createUserMessage } from './messages.js'
import type { z } from 'zod/v4'

type BetaTool = {
  name: string
  description: string
  input_schema: Record<string, unknown>
  defer_loading?: boolean
}

type BetaToolUnion = BetaTool

export async function toolToAPISchema(
  tool: Tool,
  options: {
    tools: Tools
    allowedAgentTypes?: string[]
    model?: string
    /** When true, mark this tool with defer_loading for tool search */
    deferLoading?: boolean
    cacheControl?: {
      type: 'ephemeral'
      scope?: 'global' | 'org'
      ttl?: '5m' | '1h'
    }
  },
): Promise<BetaToolUnion> {
  const schema: BetaTool = {
    name: tool.name,
    description: tool.searchHint || tool.name,
    input_schema:
      'inputJSONSchema' in tool &&
      typeof tool.inputJSONSchema === 'object' &&
      tool.inputJSONSchema !== null
        ? (tool.inputJSONSchema as Record<string, unknown>)
        : { type: 'object', additionalProperties: true },
  }

  if (options.deferLoading) {
    schema.defer_loading = true
  }

  return schema
}

// TODO: Generalize this to all tools
export function normalizeToolInput<T extends Tool>(
  tool: T,
  input: z.infer<T['inputSchema']>,
): z.infer<T['inputSchema']> {
  switch (tool.name) {
    default:
      return input
  }
}
export function normalizeMessagesForAPI(
  messages: Message[],
  tools: Tools = [],
): (UserMessage | AssistantMessage)[] {
  const result: (UserMessage | AssistantMessage)[] = []
  for (const message of messages) {
    if (message.type !== 'user' && message.type !== 'assistant') continue
    if (message.isVirtual) continue

    if (message.type === 'user') {
      pushUserMessage(result, message as UserMessage)
      continue
    }

    pushAssistantMessage(
      result,
      normalizeAssistantMessageForAPI(message as AssistantMessage, tools),
    )
  }

  return ensureAssistantMessagesHaveContent(
    filterWhitespaceOnlyAssistantMessages(result),
  )
}

function pushUserMessage(
  result: (UserMessage | AssistantMessage)[],
  message: UserMessage,
): void {
  const previous = result.at(-1)
  if (previous?.type === 'user') {
    result[result.length - 1] = mergeUserMessages(previous, message)
    return
  }
  result.push(message)
}

function pushAssistantMessage(
  result: (UserMessage | AssistantMessage)[],
  message: AssistantMessage,
): void {
  const previous = result.at(-1)
  if (previous?.type === 'assistant' && previous.message.id === message.message.id) {
    result[result.length - 1] = mergeAssistantMessages(previous, message)
    return
  }
  result.push(message)
}

function normalizeAssistantMessageForAPI(
  message: AssistantMessage,
  tools: Tools,
): AssistantMessage {
  const sourceContent = Array.isArray(message.message.content)
    ? (message.message.content as unknown[])
    : []
  const content = sourceContent.map(block => {
        const typedBlock = block as unknown as Record<string, unknown>
        if (
          typeof block !== 'object' ||
          block === null ||
          typedBlock.type !== 'tool_use'
        ) {
          return block
        }

        const toolUse = typedBlock as Record<string, unknown> & {
          id: string
          name: string
          input: Record<string, unknown>
        }
        const tool = tools.find(t => toolMatchesName(t, toolUse.name))
        const { caller: _caller, ...rest } = toolUse

        return {
          ...rest,
          type: 'tool_use' as const,
          id: toolUse.id,
          name: tool?.name ?? toolUse.name,
          input: tool ? normalizeToolInputForAPI(tool, toolUse.input) : toolUse.input,
        }
      })

  return {
    ...message,
    message: {
      ...message.message,
      content: content as AssistantMessage['message']['content'],
    },
  }
}

export function normalizeToolInputForAPI<T extends Tool>(
  tool: T,
  input: z.infer<T['inputSchema']>,
): z.infer<T['inputSchema']> {
  return normalizeToolInput(tool, input)
}

function mergeAssistantMessages(
  a: AssistantMessage,
  b: AssistantMessage,
): AssistantMessage {
  return {
    ...a,
    message: {
      ...a.message,
      content: [
        ...(Array.isArray(a.message.content)
          ? (a.message.content as unknown[])
          : []),
        ...(Array.isArray(b.message.content)
          ? (b.message.content as unknown[])
          : []),
      ] as unknown as AssistantMessage['message']['content'],
    },
  }
}

function mergeUserMessages(a: UserMessage, b: UserMessage): UserMessage {
  return {
    ...a,
    message: {
      ...a.message,
      content: mergeUserContent(a.message.content, b.message.content),
    },
  }
}

function mergeUserContent(
  a: UserMessage['message']['content'],
  b: UserMessage['message']['content'],
): UserMessage['message']['content'] {
  if (typeof a === 'string' && typeof b === 'string') {
    return `${a}\n\n${b}`
  }
  return [
    ...toContentBlocks(a),
    ...toContentBlocks(b),
  ] as unknown as UserMessage['message']['content']
}

function toContentBlocks(
  content: UserMessage['message']['content'],
): Record<string, unknown>[] {
  if (Array.isArray(content)) return content as unknown as Record<string, unknown>[]
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return []
}

function filterWhitespaceOnlyAssistantMessages(
  messages: (UserMessage | AssistantMessage)[],
): (UserMessage | AssistantMessage)[] {
  return messages.filter(message => {
    if (message.type !== 'assistant') return true
    const content = message.message.content
    if (typeof content === 'string') return content.trim().length > 0
    if (!Array.isArray(content)) return false
    return (content as unknown[]).some(block => {
      if (typeof block !== 'object' || block === null) return false
      const typedBlock = block as Record<string, unknown>
      if (typedBlock.type !== 'text') return true
      return (
        typeof typedBlock.text === 'string' &&
        typedBlock.text.trim().length > 0
      )
    })
  })
}

function ensureAssistantMessagesHaveContent(
  messages: (UserMessage | AssistantMessage)[],
): (UserMessage | AssistantMessage)[] {
  return messages.map(message => {
    if (message.type !== 'assistant') return message
    const content = message.message.content
    if ((Array.isArray(content) && content.length > 0) || typeof content === 'string') {
      return message
    }
    return {
      ...message,
      message: {
        ...message.message,
      content: [{ type: 'text', text: '(no content)' }] as AssistantMessage['message']['content'],
      },
    }
  })
}

