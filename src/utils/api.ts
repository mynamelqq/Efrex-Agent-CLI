import { getCwd } from './cwd.js'
import type Anthropic from '@anthropic-ai/sdk'
import type {
  BetaTool,
  BetaToolUnion,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { Tool, Tools, toolMatchesName } from 'src/Tool'
import { ContentBlockParam } from 'src/package/message.js'
import { SystemPrompt } from 'src/prompt.js'
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
import { createUserMessage, SYNTHETIC_MODEL } from './messages.js'
import type { z } from 'zod/v4'
import { toJSONSchema } from 'zod/v4'
import { logAntError, logForDebugging } from './debug.js'
import { getToolSchemaCache } from './toolSchemaCache.js'
import { last } from 'lodash'
import { Attachment } from './attachments.js'



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
    const input_schema = (
      'inputJSONSchema' in tool && tool.inputJSONSchema
        ? tool.inputJSONSchema
        : toJSONSchema(tool.inputSchema)
    ) as Anthropic.Tool.InputSchema
    base = {
      name: tool.name,
      description: tool.searchHint || tool.name,
      input_schema,
    }
    cache.set(cacheKey, base)
    return base
  }
  return base
}
/**
重新排列消息顺序，使附件逐级上升，直至到达以下任一位置： * - 一个工具调用结果（包含“工具结果”内容的用户消息） * - 任何助手消息
 */
export function reorderAttachmentsForAPI(messages: Message[]): Message[] {//从后向前扫描消息数组  附件不能跨消息归属
  // We build `result` backwards (push) and reverse once at the end — O(N).
  // Using unshift inside the loop would be O(N²).
  const result: Message[] = []
  // Attachments are pushed as we encounter them scanning bottom-up, so
  // this buffer holds them in reverse order (relative to the input array).
  const pendingAttachments: AttachmentMessage[] = []

  // Scan from the bottom up
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!

    if (message.type === 'attachment') {//遇到附件：放入缓冲区
      // Collect attachment to bubble up
      pendingAttachments.push(message as AttachmentMessage)
    } else {  // 遇到非附件消息
    // 检查是否是停止点
      // Check if this is a stopping point
      const isStoppingPoint =
        message.type === 'assistant' ||
        (message.type === 'user' &&
          Array.isArray(message.message?.content) &&
          (message.message?.content as Array<{ type: string }>)[0]?.type ===
            'tool_result')

      if (isStoppingPoint && pendingAttachments.length > 0) {
         // 先将缓冲区中的附件全部推入结果
        // Hit a stopping point — attachments stop here (go after the stopping point).
        // pendingAttachments is already reversed; after the final result.reverse()
        // they will appear in original order right after `message`.
        for (let j = 0; j < pendingAttachments.length; j++) {
          result.push(pendingAttachments[j]!)
        }
        result.push(message)// 再推入停止点消息
        pendingAttachments.length = 0
      } else {
        // Regular message
        result.push(message)// 普通消息直接推入
      }
    }
  }

  // Any remaining attachments bubble all the way to the top.
  for (let j = 0; j < pendingAttachments.length; j++) {// 扫描结束后，如果缓冲区还有附件（没有遇到停止点）
    result.push(pendingAttachments[j]!)
  }

  result.reverse()
  return result
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
  // 首先，重新排列附件的顺序，使其逐层向上排列，直至最终到达工具结果或助手消息处。
  //然后删除虚拟消息——这些消息仅用于显示（例如 REPL 内部工具 // 调用）且绝不能传递至 API。
  const reorderedMessages = reorderAttachmentsForAPI(messages).filter(//附件内容
    m => !((m.type === 'user' || m.type === 'assistant') && m.isVirtual),
  )
  for (const message of reorderedMessages) {
    if (message.isVirtual) continue
    if (message.type === 'system')
    {
        // local_command system messages need to be included as user messages
        // so the model can reference previous command output in later turns
        const userMsg = createUserMessage({
          content: message.content as string | ContentBlockParam[],
          uuid: message.uuid,
          timestamp: message.timestamp as string,
        })
        const lastMessage = last(result)
        if (lastMessage?.type === 'user') {
          result[result.length - 1] = mergeUserMessages(lastMessage, userMsg)
        }
        result.push(userMsg)
    }
    else if (message.type === 'user') {
      pushUserMessage(result, message as UserMessage)
      assistantMessageIndexesById = new Map()
      continue
    }
    else if(message.type=='attachment'){
      const rawAttachmentMessage = normalizeAttachmentForAPI(message.attachment as Attachment)//核心函数
      const attachmentMessage=rawAttachmentMessage
      result.push(...attachmentMessage)
    }
    // Keep normal assistant turns in API context. Only synthetic API error
    // placeholders should be stripped, otherwise tool_use blocks disappear
    // and their following tool_result blocks become orphaned on the next turn.
    if (isSyntheticApiErrorMessage(message)) {
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
  const id = message.message?.id
  if (typeof id === 'string' && id.length > 0) {
    return id
  }
  return undefined
}

function normalizeAssistantMessageForAPI(
  message: AssistantMessage,
  tools: Tools,
): AssistantMessage {
  const messageContent = message.message?.content
  const sourceContent = Array.isArray(messageContent)
    ? (messageContent as unknown[])
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
function normalizeUserTextContent(
  a: string | ContentBlockParam[],
): ContentBlockParam[] {
  if (typeof a === 'string') {
    return [{ type: 'text', text: a }]
  }
  return a
}
/**
 * Concatenate two content block arrays, appending `\n` to a's last text block
 * when the seam is text-text. The API concatenates adjacent text blocks in a
 * user message without a separator, so two queued prompts `"2 + 2"` +
 * `"3 + 3"` would otherwise reach the model as `"2 + 23 + 3"`.
 *
 * Blocks stay separate; the `\n` goes on a's side so no block's startsWith
 * changes — smooshSystemReminderSiblings classifies via
 * `startsWith('<system-reminder>')`, and prepending to b would break that
 * when b is an SR-wrapped attachment.
 */
function joinTextAtSeam(
  a: ContentBlockParam[],
  b: ContentBlockParam[],
): ContentBlockParam[] {
  const lastA = a.at(-1)
  const firstB = b[0]
  if (lastA?.type === 'text' && firstB?.type === 'text') {
    return [...a.slice(0, -1), { ...lastA, text: lastA.text + '\n' }, ...b]
  }
  return [...a, ...b]
}
function mergeUserMessages(a: UserMessage, b: UserMessage): UserMessage {
  const lastContent = normalizeUserTextContent(
    a.message.content as string | ContentBlockParam[],
  )
  const currentContent = normalizeUserTextContent(
    b.message.content as string | ContentBlockParam[],
  )
  return {
    ...a,
    uuid: a.isMeta ? b.uuid : a.uuid,
    isMeta: a.isMeta && b.isMeta ? (true as const) : undefined,
    message: {
      ...a.message,
      content: joinTextAtSeam(lastContent,currentContent),
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
    const content = message.message?.content
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
    const content = message.message?.content
    if (!Array.isArray(content) || content.length === 0) return true

    return (content as unknown[]).some(isMeaningfulNonThinkingBlock)
  })
}
function isSyntheticApiErrorMessage(
  message: Message,
): message is AssistantMessage & { isApiErrorMessage: true } {
  return (
    message.type === 'assistant' &&
    message.isApiErrorMessage === true &&
    message.message?.model === SYNTHETIC_MODEL
  )
}
function filterTrailingThinkingFromLastAssistant(
  messages: (UserMessage | AssistantMessage)[],
): (UserMessage | AssistantMessage)[] {
  const lastAssistantIndex = findLastAssistantIndex(messages)
  if (lastAssistantIndex === -1) return messages

  const lastAssistant = messages[lastAssistantIndex]
  if (lastAssistant?.type !== 'assistant') return messages

  const content = lastAssistant.message?.content
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
    const content = message.message?.content
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
export function appendSystemContext(
  systemPrompt: SystemPrompt,
  context: { [k: string]: string },
): string[] {
  return [
    ...systemPrompt,
    Object.entries(context)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n'),
  ].filter(Boolean)
}

export function normalizeAttachmentForAPI(
  attachment: Attachment,
): UserMessage[] {
  switch (attachment.type) {

    case 'selected_lines_in_ide': {
      const maxSelectionLength = 2000
      const content =
        attachment.content.length > maxSelectionLength
          ? attachment.content.substring(0, maxSelectionLength) +
            '\n... (truncated)'
          : attachment.content

      return wrapMessagesInSystemReminder([
        createUserMessage({
          content: `The user selected the lines ${attachment.lineStart} to ${attachment.lineEnd} from ${attachment.filename}:\n${content}\n\nThis may or may not be related to the current task.`,
          isMeta: true,
        }),
      ])
    }
    // case 'opened_file_in_ide': {
    //   return wrapMessagesInSystemReminder([
    //     createUserMessage({
    //       content: `The user opened the file ${attachment.filename} in the IDE. This may or may not be related to the current task.`,
    //       isMeta: true,
    //     }),
    //   ])
    // }


      return []
  }

  // Handle legacy attachments that were removed
  // IMPORTANT: if you remove an attachment type from normalizeAttachmentForAPI, make sure
  // to add it here to avoid errors from old --resume'd sessions that might still have
  // these attachment types.
  const LEGACY_ATTACHMENT_TYPES = [
    'autocheckpointing',
    'background_task_status',
    'todo',
    'task_progress', // removed in PR #19337
    'ultramemory', // removed in PR #23596
  ]
  if (LEGACY_ATTACHMENT_TYPES.includes((attachment as { type: string }).type)) {
    return []
  }

  logAntError(
    'normalizeAttachmentForAPI',
    new Error(
      `Unknown attachment type: ${(attachment as { type: string }).type}`,
    ),
  )
  return []
}
export function wrapInSystemReminder(content: string): string {
  return `<system-reminder>\n${content}\n</system-reminder>`
}

export function wrapMessagesInSystemReminder(
  messages: UserMessage[],
): UserMessage[] {
  return messages.map(msg => {
    if (typeof msg.message.content === 'string') {
      return {
        ...msg,
        message: {
          ...msg.message,
          content: wrapInSystemReminder(msg.message.content),
        },
      }
    } else if (Array.isArray(msg.message.content)) {
      // For array content, wrap text blocks in system-reminder
      const wrappedContent = msg.message.content.map(block => {
        if (block.type === 'text') {
          return {
            ...block,
            text: wrapInSystemReminder(block.text),
          }
        }
        return block
      })
      return {
        ...msg,
        message: {
          ...msg.message,
          content: wrappedContent,
        },
      }
    }
    return msg
  })
}