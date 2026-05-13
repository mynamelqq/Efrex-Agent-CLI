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
  BetaToolUnion,BetaTool
} from 'src/package/message.js'
import { createUserMessage } from './messages.js'
import type { z } from 'zod/v4'
import { toJSONSchema } from 'zod/v4'
import { logForDebugging } from './debug.js'
import { getToolSchemaCache } from './toolSchemaCache.js'



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
  const cacheKey =
  'inputJSONSchema' in tool && tool.inputJSONSchema
    ? `${tool.name}:${JSON.stringify(tool.inputJSONSchema)}`
    : tool.name
  const cache = getToolSchemaCache()
  let base = cache.get(cacheKey)
  if (!base) {
    let input_schema = (
      'inputJSONSchema' in tool && tool.inputJSONSchema
        ? tool.inputJSONSchema
        : toJSONSchema(tool.inputSchema)
    )as Record<string, unknown>
    base = {
      name: tool.name,
      description: tool.searchHint || tool.name,
      input_schema:input_schema
    }
    cache.set(cacheKey, base)
    return base as BetaTool
  }
  return base
}

// TODO: Generalize this to all tools
export function normalizeToolInput<T extends Tool>(//FileWriteTool.name FileEditTool.name
  tool: T,
  input: z.infer<T['inputSchema']>,
): z.infer<T['inputSchema']> {
  return input
}
export function normalizeMessagesForAPI(
  messages: Message[],
  tools: Tools = [],
): (UserMessage | AssistantMessage)[] {
  const result: (UserMessage | AssistantMessage)[] = []
  let assistantMessageIndexesById = new Map<string, number>()

  for (const message of messages) {
    if (message.type !== 'user' && message.type !== 'assistant') continue
    if (message.isVirtual) continue
    logForDebugging("Normalizing message for API:", message)
    if (message.type === 'user') {
      pushUserMessage(result, message as UserMessage)
      assistantMessageIndexesById = new Map()
      continue
    }

    pushAssistantMessage(
      result,
      normalizeAssistantMessageForAPI(message as AssistantMessage, tools),
      assistantMessageIndexesById,
    )
  }

  return ensureAssistantMessagesHaveContent(
    filterWhitespaceOnlyAssistantMessages(
      filterOrphanedThinkingOnlyMessages(
        filterTrailingThinkingFromLastAssistant(result),
      ),
    ),
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
  assistantMessageIndexesById: Map<string, number>,
): void {
  const messageId = getAssistantMessageId(message)
  const existingIndex =
    messageId === undefined ? undefined : assistantMessageIndexesById.get(messageId)

  if (existingIndex !== undefined) {
    const existing = result[existingIndex]
    if (existing?.type === 'assistant') {
      result[existingIndex] = mergeAssistantMessages(existing, message)
      return
    }
  }

  if (messageId !== undefined) {
    assistantMessageIndexesById.set(messageId, result.length)
  }
  result.push(message)
}

function getAssistantMessageId(message: AssistantMessage): string | undefined {
  const id = message.message.id
  if (typeof id === 'string' && id.length > 0) {
    return id
  }
  return undefined
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

function filterOrphanedThinkingOnlyMessages(
  messages: (UserMessage | AssistantMessage)[],
): (UserMessage | AssistantMessage)[] {
  return messages.filter(message => {
    if (message.type !== 'assistant') return true
    const content = message.message.content
    if (!Array.isArray(content) || content.length === 0) return true

    return (content as unknown[]).some(isMeaningfulNonThinkingBlock)
  })
}

function filterTrailingThinkingFromLastAssistant(
  messages: (UserMessage | AssistantMessage)[],
): (UserMessage | AssistantMessage)[] {
  const lastAssistantIndex = findLastAssistantIndex(messages)
  if (lastAssistantIndex === -1) return messages

  const lastAssistant = messages[lastAssistantIndex]
  if (lastAssistant?.type !== 'assistant') return messages

  const content = lastAssistant.message.content
  if (!Array.isArray(content) || content.length === 0) return messages

  const trimmedContent = [...(content as unknown[])]
  while (
    trimmedContent.length > 0 &&
    isThinkingBlock(trimmedContent[trimmedContent.length - 1])
  ) {
    trimmedContent.pop()
  }

  if (trimmedContent.length === content.length) return messages

  const nextMessages = [...messages]
  nextMessages[lastAssistantIndex] = {
    ...lastAssistant,
    message: {
      ...lastAssistant.message,
      content: trimmedContent as AssistantMessage['message']['content'],
    },
  }
  return nextMessages
}

function findLastAssistantIndex(
  messages: (UserMessage | AssistantMessage)[],
): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.type === 'assistant') return i
  }
  return -1
}

function isThinkingBlock(block: unknown): boolean {
  if (typeof block !== 'object' || block === null) return false
  const type = (block as Record<string, unknown>).type
  return type === 'thinking' || type === 'redacted_thinking'
}

function isMeaningfulNonThinkingBlock(block: unknown): boolean {
  if (isThinkingBlock(block)) return false
  if (typeof block !== 'object' || block === null) return false

  const typedBlock = block as Record<string, unknown>
  if (typedBlock.type === 'text') {
    return typeof typedBlock.text === 'string' && typedBlock.text.trim().length > 0
  }
  return true
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
export function prependUserContext(
  messages: Message[],
  context: { [k: string]: string },
): Message[] {
  if (Object.entries(context).length === 0) {
    return messages
  }

  return [
    createUserMessage({
      content: `<system-reminder>\nAs you answer the user's questions, you can use the following context:\n${Object.entries(
        context,
      )
        .map(([key, value]) => `# ${key}\n${value}`)
        .join('\n')}

      IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.\n</system-reminder>\n`,
      isMeta: true,
    }),
    ...messages,
  ]
}