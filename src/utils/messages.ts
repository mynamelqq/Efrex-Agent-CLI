import type {
  ChatCompletion,
} from 'openai/resources/chat/completions'
import { PermissionMode } from 'src/types/permissions'
import { randomUUID, type UUID } from 'crypto'
import { DeepImmutable } from './messageQueueManager'
import { APIError } from '@anthropic-ai/sdk'
import { BetaUsage as Usage } from '../package/message'
import type { BetaContentBlock } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { Tools } from 'src/Tool'
import { findToolByName } from 'src/Tool'
import { safeParseJSON } from './json'
import { RedactedThinkingBlock, RedactedThinkingBlockParam, ThinkingBlock, ThinkingBlockParam, ToolUseBlock,ToolUseBlockParam } from '@anthropic-ai/sdk/resources'
import { Attachment } from './attachments'
import {normalizeToolInput} from "src/utils/api"
import {
  COMMAND_ARGS_TAG,
  COMMAND_MESSAGE_TAG,
  COMMAND_NAME_TAG,
  LOCAL_COMMAND_CAVEAT_TAG,
  LOCAL_COMMAND_STDOUT_TAG,
} from '../constants/xml.js'
import { escapeRegExp } from './stringUtils'
import type {
  ToolResultBlockParam,
  AssistantMessage,
  AttachmentMessage,
  ContentBlock,
  MessageContent,
  ContentBlockParam,
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
} from '../package/message'
import { BetaRedactedThinkingBlock, BetaThinkingBlock, BetaUsage } from 'src/types/message'
export const NO_CONTENT_MESSAGE = '(no content)'
export const INTERRUPT_MESSAGE_FOR_TOOL_USE =
  '[Request interrupted by user for tool use]'
export const INTERRUPT_MESSAGE = '[Request interrupted by user]'
export function AUTO_REJECT_MESSAGE(toolName: string): string {
  return `Permission to use ${toolName} has been denied. ${DENIAL_WORKAROUND_GUIDANCE}`
}
export const CANCEL_MESSAGE =
  "The user doesn't want to take this action right now. STOP what you are doing and wait for the user to tell you how to proceed."
/**
 * Shared guidance for permission denials, instructing the model on appropriate workarounds.
 */
export const DENIAL_WORKAROUND_GUIDANCE =
`IMPORTANT: You *may* attempt to accomplish this action using other tools that might naturally be used to accomplish this goal, ` +
`e.g. using head instead of cat. But you *should not* attempt to work around this denial in malicious ways, ` +
`e.g. do not use your ability to run tests to execute non-test actions. ` +
`You should only try to work around this restriction in reasonable ways that do not attempt to bypass the intent behind this denial. ` +
`If you believe this capability is essential to complete the user's request, STOP and explain to the user ` +
`what you were trying to do and why you need this permission. Let the user decide how to proceed.`
export function DONT_ASK_REJECT_MESSAGE(toolName: string): string {
  return `Permission to use ${toolName} has been denied because Claude Code is running in don't ask mode. ${DENIAL_WORKAROUND_GUIDANCE}`
}
// Synthetic tool_result content inserted by ensureToolResultPairing when a
// tool_use block has no matching tool_result. Exported so HFI submission can
// reject any payload containing it — placeholder satisfies pairing structurally
// but the content is fake, which poisons training data if submitted.
export const SYNTHETIC_TOOL_RESULT_PLACEHOLDER =
  '[Tool result missing due to internal error]'
export type SDKAssistantMessageError =
  | 'authentication_failed'
  | 'billing_error'
  | 'rate_limit'
  | 'invalid_request'
  | 'server_error'
  | 'unknown'
  | 'max_output_tokens'
export function createUserMessage({
  content,
  isMeta,
  isVisibleInTranscriptOnly,
  isVirtual,
  isCompactSummary,
  toolUseResult,
  mcpMeta,
  uuid,
  timestamp,
  imagePasteIds,
  sourceToolAssistantUUID,
}: {
  content:string | ContentBlockParam[]
  isMeta?: true
  isVisibleInTranscriptOnly?: true
  isVirtual?: true
  isCompactSummary?: true
  toolUseResult?: unknown // Matches tool's `Output` type
  /** MCP protocol metadata to pass through to SDK consumers (never sent to model) */
  mcpMeta?: {
    _meta?: Record<string, unknown>
    structuredContent?: Record<string, unknown>
  }
  uuid?: UUID | string
  timestamp?: string
  permissionMode?: PermissionMode
  imagePasteIds?: number[]
  // For tool_result messages: the UUID of the assistant message containing the matching tool_use
  sourceToolAssistantUUID?: UUID|string
}): UserMessage {
  const m: UserMessage = {
    type: 'user',
    message: {
      role: 'user',
      content: content || '(no content)', // Make sure we don't send empty messages
    },
    isMeta,
    isVisibleInTranscriptOnly,
    isVirtual,
    isCompactSummary,
    uuid: (uuid as UUID | undefined) || randomUUID(),
    timestamp: timestamp ?? new Date().toISOString(),
    toolUseResult,
    mcpMeta,
    imagePasteIds,
    sourceToolAssistantUUID,
  }
  return m
}
export const NO_RESPONSE_REQUESTED = 'No response requested.'
export const SYNTHETIC_MODEL = '<synthetic>'
export const REJECT_MESSAGE =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed."

export const SYNTHETIC_MESSAGES = new Set([
  INTERRUPT_MESSAGE,
  INTERRUPT_MESSAGE_FOR_TOOL_USE,
  CANCEL_MESSAGE,
  REJECT_MESSAGE,
  NO_RESPONSE_REQUESTED,
])
export function createAssistantAPIErrorMessage({
  content,
  apiError,
  error,
  errorDetails,
}: {
  content: string
  apiError?: AssistantMessage['apiError']
  error?: SDKAssistantMessageError
  errorDetails?: string
}): AssistantMessage {
  return baseCreateAssistantMessage({
    content: [
      {
        type: 'text' as const,
        text: content === '' ? NO_CONTENT_MESSAGE : content,
      } as BetaContentBlock, // NOTE: citations field is not supported in Bedrock API
    ],
    isApiErrorMessage: true,
    apiError,
    error,
    errorDetails,
  })
}
export function createToolResultStopMessage(
  toolUseID: string,
): ToolResultBlockParam {
  return {
    type: 'tool_result',
    content: CANCEL_MESSAGE,
    is_error: true,
    tool_use_id: toolUseID,
  }
}
export function isEmptyMessageText(text: string): boolean {
  return (
    stripPromptXMLTags(text).trim() === '' || text.trim() === NO_CONTENT_MESSAGE
  )
}
const STRIPPED_TAGS_RE =
  /<(commit_analysis|context|function_analysis|pr_analysis)>.*?<\/\1>\n?/gs

export function stripPromptXMLTags(content: string): string {
  return content.replace(STRIPPED_TAGS_RE, '').trim()
}
function baseCreateAssistantMessage({
  content,
  isApiErrorMessage = false,
  apiError,
  error,
  errorDetails,
  isVirtual,
  usage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
    service_tier: null,
    cache_creation: {
      ephemeral_1h_input_tokens: 0,
      ephemeral_5m_input_tokens: 0,
    },
    inference_geo: null,
    iterations: null,
    speed: null,
  },
}: {
  content: BetaContentBlock[]
  isApiErrorMessage?: boolean
  apiError?: AssistantMessage['apiError']
  error?: SDKAssistantMessageError
  errorDetails?: string
  isVirtual?: true
  usage?: Usage
}): AssistantMessage {
  return {
    type: 'assistant',
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    message: {
      id: randomUUID(),
      container: null,
      model: SYNTHETIC_MODEL,
      role: 'assistant',
      stop_reason: 'stop_sequence',
      stop_sequence: '',
      type: 'message',
      usage,
      content: content as ContentBlock[],
      context_management: null,
    },
    requestId: undefined,
    apiError,
    error,
    errorDetails,
    isApiErrorMessage,
    isVirtual,
  }
}
export function createUserInterruptionMessage({
  toolUse = false,
}: {
  toolUse?: boolean
}): UserMessage {
  const content = toolUse ? INTERRUPT_MESSAGE_FOR_TOOL_USE : INTERRUPT_MESSAGE

  return createUserMessage({
    content: [
      {
        type: 'text',
        text: content,
      },
    ],
  })
}
export function createAttachmentMessage(
  attachment: Attachment,
): AttachmentMessage<Attachment> {
  return {
    attachment,
    type: 'attachment',
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
  } as unknown as AttachmentMessage<Attachment>
}

// 处理 API 返回的不规范数据格式
// API 有时会返回空消息（如 "\n\n"），需要过滤
// 工具调用（tool_use）的输入可能是字符串或对象，需要统一处理
// 处理嵌套的 JSON 字符串
// API 可能返回多层嵌套的字符串化 JSON（比如一个 JSON 对象里某个字段又是 JSON 字符串）
// 函数会递归解析这些字符串，将字符串转为真正的对象
export function normalizeContentFromAPI(
  contentBlocks:
    | MessageContent
    | BetaContentBlock[]
    | ReadonlyArray<Record<string, unknown>>,
  tools: Tools,
): MessageContent {
  if (!contentBlocks) {
    return ''
  }
  if (typeof contentBlocks === 'string') {
    return contentBlocks
  }
  const normalizedBlocks = contentBlocks.map(contentBlock => {
    switch (contentBlock.type) {
      case 'tool_use': {
        if (
          typeof contentBlock.input !== 'string' &&
          !(contentBlock.input instanceof Object)
        ) {
          // we stream tool use inputs as strings, but when we fall back, they're objects
          throw new Error('Tool use input must be a string or object')
        }

        // With fine-grained streaming on, we are getting a stringied JSON back from the API.
        // The API has strange behaviour, where it returns nested stringified JSONs, and so
        // we need to recursively parse these. If the top-level value returned from the API is
        // an empty string, this should become an empty object (nested values should be empty string).
        // TODO: This needs patching as recursive fields can still be stringified
        let normalizedInput: unknown
        if (typeof contentBlock.input === 'string') {
          const parsed = safeParseJSON(contentBlock.input)
          if (parsed === null && contentBlock.input.length > 0) {
            // TET/FC-v3 diagnostic: the streamed tool input JSON failed to
            // parse. We fall back to {} which means downstream validation
            // sees empty input. The raw prefix goes to debug log only — no
            // PII-tagged proto column exists for it yet.
           
          }
          normalizedInput = parsed ?? {}
        } else {
          normalizedInput = contentBlock.input
        }

        // Then apply tool-specific corrections
        if (typeof normalizedInput === 'object' && normalizedInput !== null) {
          const tool = findToolByName(tools, contentBlock.name as string)
          if (tool) {
            try {
              normalizedInput = normalizeToolInput(
                tool,
                normalizedInput as { [key: string]: unknown },
              )
            } catch (error) {
              // Keep the original input if normalization fails
            }
          }
        }

        return {
          ...contentBlock,
          input: normalizedInput,
        }
      }
      case 'text':
        // Return the block as-is to preserve exact content for prompt caching.
        // Empty text blocks are handled at the display layer and must not be
        // altered here.
        return contentBlock
      case 'code_execution_tool_result':
      case 'mcp_tool_use':
      case 'mcp_tool_result':
      case 'container_upload':
        // Beta-specific content blocks - pass through as-is
        return contentBlock
      case 'server_tool_use':
        if (typeof contentBlock.input === 'string') {
          return {
            ...contentBlock,
            input: (safeParseJSON(contentBlock.input) ?? {}) as {
              [key: string]: unknown
            },
          }
        }
        return contentBlock
      default:
        return contentBlock
    }
  })
  return normalizedBlocks as MessageContent
}
export function extractTag(html: string, tagName: string): string | null {
  if (!html.trim() || !tagName.trim()) {
    return null
  }

  const escapedTag = escapeRegExp(tagName)

  // Create regex pattern that handles:
  // 1. Self-closing tags
  // 2. Tags with attributes
  // 3. Nested tags of the same type
  // 4. Multiline content
  const pattern = new RegExp(
    `<${escapedTag}(?:\\s+[^>]*)?>` + // Opening tag with optional attributes
      '([\\s\\S]*?)' + // Content (non-greedy match)
      `<\\/${escapedTag}>`, // Closing tag
    'gi',
  )

  let match
  let depth = 0
  let lastIndex = 0
  const openingTag = new RegExp(`<${escapedTag}(?:\\s+[^>]*?)?>`, 'gi')
  const closingTag = new RegExp(`<\\/${escapedTag}>`, 'gi')

  while ((match = pattern.exec(html)) !== null) {
    // Check for nested tags
    const content = match[1]
    const beforeMatch = html.slice(lastIndex, match.index)

    // Reset depth counter
    depth = 0

    // Count opening tags before this match
    openingTag.lastIndex = 0
    while (openingTag.exec(beforeMatch) !== null) {
      depth++
    }

    // Count closing tags before this match
    closingTag.lastIndex = 0
    while (closingTag.exec(beforeMatch) !== null) {
      depth--
    }

    // Only include content if we're at the correct nesting level
    if (depth === 0 && content) {
      return content
    }

    lastIndex = match.index + match[0].length
  }

  return null
}
/**
 * Extract text from an array of content blocks, joining text blocks with the
 * given separator. Works with ContentBlock, ContentBlockParam, BetaContentBlock,
 * and their readonly/DeepImmutable variants via structural typing.
 */
export function extractTextContent(
  blocks: readonly { readonly type: string }[],
  separator = '',
): string {
  return blocks
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map(b => b.text)
    .join(separator)
}


export function getContentText(
  content: string | DeepImmutable<Array<ContentBlockParam>>,
): string | null {
  if (typeof content === 'string') {
    return content
  }
  if (Array.isArray(content)) {
    return extractTextContent(content, '\n').trim() || null
  }
  return null
}
/**
 * Creates a new synthetic user caveat message for local commands (eg. bash, slash).
 * We need to create a new message each time because messages must have unique uuids.
 */
export function createSyntheticUserCaveatMessage(): UserMessage {
  return createUserMessage({
    content: `<${LOCAL_COMMAND_CAVEAT_TAG}>Caveat: The messages below were generated by the user while running local commands. DO NOT respond to these messages or otherwise consider them in your response unless the user explicitly asks you to.</${LOCAL_COMMAND_CAVEAT_TAG}>`,
    isMeta: true,
  })
}
export function prepareUserContent({
  inputString,
  precedingInputBlocks,
}: {
  inputString: string
  precedingInputBlocks: ContentBlockParam[]
}): string | ContentBlockParam[] {
  if (precedingInputBlocks.length === 0) {
    return inputString
  }

  return [
    ...precedingInputBlocks,
    {
      text: inputString,
      type: 'text',
    },
  ]
}

export function createSystemMessage(
  content: string,
  level: SystemMessageLevel,
  toolUseID?: string,
  preventContinuation?: boolean,
): SystemInformationalMessage {
  return {
    type: 'system',
    subtype: 'informational',
    content,
    isMeta: false,
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
    toolUseID,
    level,
    ...(preventContinuation && { preventContinuation }),
  }
}

/**
 * Formats the command-input breadcrumb the model sees when a slash command runs.
 */
export function formatCommandInputTags(
  commandName: string,
  args: string,
): string {
  return `<${COMMAND_NAME_TAG}>/${commandName}</${COMMAND_NAME_TAG}>
            <${COMMAND_MESSAGE_TAG}>${commandName}</${COMMAND_MESSAGE_TAG}>
            <${COMMAND_ARGS_TAG}>${args}</${COMMAND_ARGS_TAG}>`
}
export function createCommandInputMessage(
  content: string,
): SystemLocalCommandMessage {
  return {
    type: 'system',
    subtype: 'local_command',
    content,
    level: 'info',
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
    isMeta: false,
  }
}
export function isSystemLocalCommandMessage(
  message: Message,
): message is SystemLocalCommandMessage {
  return message.type === 'system' && message.subtype === 'local_command'
}

/**
 * Checks if a message is a compact boundary marker
 */
export function isCompactBoundaryMessage(
  message: Message | NormalizedMessage,
): message is SystemCompactBoundaryMessage {
  return message?.type === 'system' && message.subtype === 'compact_boundary'
}
/**
 * Finds the index of the last compact boundary marker in the messages array
 * @returns The index of the last compact boundary, or -1 if none found
 */
export function findLastCompactBoundaryIndex<
  T extends Message | NormalizedMessage,
>(messages: T[]): number {
  // Scan backwards to find the most recent compact boundary
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message && isCompactBoundaryMessage(message)) {
      return i
    }
  }
  return -1 // No boundary found
}
/**
 * Returns messages from the last compact boundary onward (including the boundary).
 * If no boundary exists, returns all messages.
 *
 * Also filters snipped messages by default (when HISTORY_SNIP is enabled) —
 * the REPL keeps full history for UI scrollback, so model-facing paths need
 * both compact-slice AND snip-filter applied. Pass `{ includeSnipped: true }`
 * to opt out (e.g., REPL.tsx fullscreen compact handler which preserves
 * snipped messages in scrollback).
 *
 * Note: The boundary itself is a system message and will be filtered by normalizeMessagesForAPI.
 */
export function getMessagesAfterCompactBoundary<//找到位于最后面压缩边界后的消息
  T extends Message | NormalizedMessage,
>(messages: T[], options?: { includeSnipped?: boolean }): T[] {
  const boundaryIndex = findLastCompactBoundaryIndex(messages)
  const sliced = boundaryIndex === -1 ? messages : messages.slice(boundaryIndex)
  return sliced
}


export function getAssistantMessageText(message: Message): string | null {
  if (message.type !== 'assistant') {
    return null
  }
  // For content blocks array, extract and concatenate text blocks
  if (Array.isArray(message.message?.content)) {
    return (
      (message.message?.content as Array<{ type: string; text?: string }>)
        .filter(block => block.type === 'text')
        .map(block => block.text ?? '')
        .join('\n')
        .trim() || null
    )
  }
  return null
}

export function createCompactBoundaryMessage(
  trigger: 'manual' | 'auto',
  preTokens: number,
  lastPreCompactMessageUuid?: UUID,
  userContext?: string,
  messagesSummarized?: number,
): SystemCompactBoundaryMessage {
  return {
    type: 'system',
    subtype: 'compact_boundary',
    content: `Conversation compacted`,
    isMeta: false,
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
    level: 'info',
    compactMetadata: {
      trigger,
      preTokens,
      userContext,
      messagesSummarized,
    },
    ...(lastPreCompactMessageUuid && {
      logicalParentUuid: lastPreCompactMessageUuid,
    }),
  }
}
/**
防御性验证：确保 tool_use 与 tool_result 的配对正确。

处理两种方向：

正向：为缺少结果的 tool_use 块插入合成的错误 tool_result 块

反向：剥离引用了不存在 tool_use 块的孤立 tool_result 块

当此验证被触发时会记录日志，以帮助定位根本原因。

严格模式：当 getStrictToolResultPairing() 返回 true 时（HFI 在启动时选择启用），

任何不匹配都会抛出错误而非进行修复。用于训练数据收集时，基于合成占位符条件的模型响应是有污染的 ——

应废弃整个轨迹，而不是在标注环节花费时间处理一个最终也会在提交阶段被拒绝的轮次。
 * that will be rejected at submission anyway.
 */
export function ensureToolResultPairing(
  messages: (UserMessage | AssistantMessage)[],
): (UserMessage | AssistantMessage)[] {
  const result: (UserMessage | AssistantMessage)[] = []
  let repaired = false

  // Cross-message tool_use ID tracking. The per-message seenToolUseIds below
  // only caught duplicates within a single assistant's content array (the
  // normalizeMessagesForAPI-merged case). When two assistants with DIFFERENT
  // message.id carry the same tool_use ID — e.g. orphan handler re-pushed an
  // assistant already present in mutableMessages with a fresh message.id, or
  // normalizeMessagesForAPI's backward walk broke on an intervening user
  // message — the dup lived in separate result entries and the API rejected
  // with "tool_use ids must be unique", deadlocking the session (CC-1212).
  const allSeenToolUseIds = new Set<string>()

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!

    if (msg.type !== 'assistant') {
      // A user message with tool_result blocks but NO preceding assistant
      // message in the output has orphaned tool_results. The assistant
      // lookahead below only validates assistant→user adjacency; it never
      // sees user messages at index 0 or user messages preceded by another
      // user. This happens on resume when the transcript starts mid-turn
      // (e.g. messages[0] is a tool_result whose assistant pair was dropped
      // by earlier compaction — API rejects with "messages.0.content:
      // unexpected tool_use_id").
      if (
        msg.type === 'user' &&
        Array.isArray(msg.message.content) &&
        result.at(-1)?.type !== 'assistant'
      ) {
        const stripped = msg.message.content.filter(
          block =>
            !(
              typeof block === 'object' &&
              'type' in block &&
              block.type === 'tool_result'
            ),
        )
        if (stripped.length !== msg.message.content.length) {
          repaired = true
          // If stripping emptied the message and nothing has been pushed yet,
          // keep a placeholder so the payload still starts with a user
          // message (normalizeMessagesForAPI runs before us, so messages[1]
          // is an assistant — dropping messages[0] entirely would yield a
          // payload starting with assistant, a different 400).
          const content =
            stripped.length > 0
              ? stripped
              : result.length === 0
                ? [
                    {
                      type: 'text' as const,
                      text: '[Orphaned tool result removed due to conversation resume]',
                    },
                  ]
                : null
          if (content !== null) {
            result.push({
              ...msg,
              message: { ...msg.message, content },
            })
          }
          continue
        }
      }
      result.push(msg)
      continue
    }

    // Collect server-side tool result IDs (*_tool_result blocks have tool_use_id).
    const serverResultIds = new Set<string>()
    const aMsg5 = msg as AssistantMessage
    for (const c of aMsg5.message.content as (
      | ContentBlockParam
      | ContentBlock
    )[]) {
      if (
        typeof c !== 'string' &&
        'tool_use_id' in c &&
        typeof (c as { tool_use_id: string }).tool_use_id === 'string'
      ) {
        serverResultIds.add((c as { tool_use_id: string }).tool_use_id)
      }
    }

    // Dedupe tool_use blocks by ID. Checks against the cross-message
    // allSeenToolUseIds Set so a duplicate in a LATER assistant (different
    // message.id, not merged by normalizeMessagesForAPI) is also stripped.
    // The per-message seenToolUseIds tracks only THIS assistant's surviving
    // IDs — the orphan/missing-result detection below needs a per-message
    // view, not the cumulative one.
    //
    // Also strip orphaned server-side tool use blocks (server_tool_use,
    // mcp_tool_use) whose result blocks live in the SAME assistant message.
    // If the stream was interrupted before the result arrived, the use block
    // has no matching *_tool_result and the API rejects with e.g. "advisor
    // tool use without corresponding advisor_tool_result".
    const seenToolUseIds = new Set<string>()
    const assistantContent = Array.isArray(aMsg5.message.content)
      ? aMsg5.message.content
      : []
    const finalContent = assistantContent.filter(block => {
      if (typeof block === 'string') return true
      if (block.type === 'tool_use') {
        if (allSeenToolUseIds.has((block as ToolUseBlock).id)) {
          repaired = true
          return false
        }
        allSeenToolUseIds.add((block as ToolUseBlock).id)
        seenToolUseIds.add((block as ToolUseBlock).id)
      }
      if (
        ((block.type as string) === 'server_tool_use' ||
          (block.type as string) === 'mcp_tool_use') &&
        !serverResultIds.has((block as { id: string }).id)
      ) {
        repaired = true
        return false
      }
      return true
    })

    const assistantContentChanged =
      finalContent.length !==
      (aMsg5.message.content as (ContentBlockParam | ContentBlock)[]).length

    // If stripping orphaned server tool uses empties the content array,
    // insert a placeholder so the API doesn't reject empty assistant content.
    if (finalContent.length === 0) {
      finalContent.push({
        type: 'text' as const,
        text: '[Tool use interrupted]',
        citations: [],
      })
    }

    const assistantMsg = assistantContentChanged
      ? {
          ...msg,
          message: { ...msg.message, content: finalContent },
        }
      : msg

    result.push(assistantMsg)

    // Collect tool_use IDs from this assistant message
    const toolUseIds = [...seenToolUseIds]

    // Check the next message for matching tool_results. Also track duplicate
    // tool_result blocks (same tool_use_id appearing twice) — for transcripts
    // corrupted before Fix 1 shipped, the orphan handler ran to completion
    // multiple times, producing [asst(X), user(tr_X), asst(X), user(tr_X)] which
    // normalizeMessagesForAPI merges to [asst([X,X]), user([tr_X,tr_X])]. The
    // tool_use dedup above strips the second X; without also stripping the
    // second tr_X, the API rejects with a duplicate-tool_result 400 and the
    // session stays stuck.
    const nextMsg = messages[i + 1]
    const existingToolResultIds = new Set<string>()
    let hasDuplicateToolResults = false

    if (nextMsg?.type === 'user') {
      const content = nextMsg.message.content
      if (Array.isArray(content)) {
        for (const block of content) {
          if (
            typeof block === 'object' &&
            'type' in block &&
            block.type === 'tool_result'
          ) {
            const trId = (block as ToolResultBlockParam).tool_use_id
            if (existingToolResultIds.has(trId)) {
              hasDuplicateToolResults = true
            }
            existingToolResultIds.add(trId)
          }
        }
      }
    }

    // Find missing tool_result IDs (forward direction: tool_use without tool_result)
    const toolUseIdSet = new Set(toolUseIds)
    const missingIds = toolUseIds.filter(id => !existingToolResultIds.has(id))

    // Find orphaned tool_result IDs (reverse direction: tool_result without tool_use)
    const orphanedIds = [...existingToolResultIds].filter(
      id => !toolUseIdSet.has(id),
    )

    if (
      missingIds.length === 0 &&
      orphanedIds.length === 0 &&
      !hasDuplicateToolResults
    ) {
      continue
    }

    repaired = true

    // Build synthetic error tool_result blocks for missing IDs
    const syntheticBlocks: ToolResultBlockParam[] = missingIds.map(id => ({
      type: 'tool_result' as const,
      tool_use_id: id,
      content: SYNTHETIC_TOOL_RESULT_PLACEHOLDER,
      is_error: true,
    }))

    if (nextMsg?.type === 'user') {
      // Next message is already a user message - patch it
      const nextUserMsg = nextMsg as UserMessage
      let content: (ContentBlockParam | ContentBlock)[] = Array.isArray(
        nextUserMsg.message.content,
      )
        ? (nextUserMsg.message.content as (ContentBlockParam | ContentBlock)[])
        : [
            {
              type: 'text' as const,
              text: (nextUserMsg.message.content as string | undefined) ?? '',
            },
          ]

      // Strip orphaned tool_results and dedupe duplicate tool_result IDs
      if (orphanedIds.length > 0 || hasDuplicateToolResults) {
        const orphanedSet = new Set(orphanedIds)
        const seenTrIds = new Set<string>()
        content = content.filter(block => {
          if (
            typeof block === 'object' &&
            'type' in block &&
            block.type === 'tool_result'
          ) {
            const trId = (block as ToolResultBlockParam).tool_use_id
            if (orphanedSet.has(trId)) return false
            if (seenTrIds.has(trId)) return false
            seenTrIds.add(trId)
          }
          return true
        })
      }

      const patchedContent = [...syntheticBlocks, ...content]

      // If content is now empty after stripping orphans, skip the user message
      if (patchedContent.length > 0) {
        const patchedNext: UserMessage = {
          ...nextUserMsg,
          message: {
            ...nextUserMsg.message,
            content: patchedContent,
          },
        }
        i++
        // Prepending synthetics to existing content can produce a
        // [tool_result, text] sibling the smoosh inside normalize never saw
        // (pairing runs after normalize). Re-smoosh just this one message.
        result.push(patchedNext)
      } else {
        // Content is empty after stripping orphaned tool_results. We still
        // need a user message here to maintain role alternation — otherwise
        // the assistant placeholder we just pushed would be immediately
        // followed by the NEXT assistant message, which the API rejects with
        // a role-alternation 400 (not the duplicate-id 400 we handle).
        i++
        result.push(
          createUserMessage({
            content: NO_CONTENT_MESSAGE,
            isMeta: true,
          }),
        )
      }
    } else {
      // No user message follows - insert a synthetic user message (only if missing IDs)
      if (syntheticBlocks.length > 0) {
        result.push(
          createUserMessage({
            content: syntheticBlocks,
            isMeta: true,
          }),
        )
      }
    }
  }

  if (repaired) {
    // Capture diagnostic info to help identify root cause
    const messageTypes = messages.map((m, idx) => {
      if (m.type === 'assistant') {
        const contentArr = Array.isArray(m.message.content)
          ? m.message.content
          : []
        const toolUses = contentArr
          .filter(b => typeof b !== 'string' && b.type === 'tool_use')
          .map(b => (b as ToolUseBlock | ToolUseBlockParam).id)
        const serverToolUses = contentArr
          .filter(
            b =>
              typeof b !== 'string' &&
              ((b.type as string) === 'server_tool_use' ||
                (b.type as string) === 'mcp_tool_use'),
          )
          .map(b => (b as { id: string }).id)
        const parts = [
          `id=${m.message.id}`,
          `tool_uses=[${toolUses.join(',')}]`,
        ]
        if (serverToolUses.length > 0) {
          parts.push(`server_tool_uses=[${serverToolUses.join(',')}]`)
        }
        return `[${idx}] assistant(${parts.join(', ')})`
      }
      if (m.type === 'user' && Array.isArray(m.message.content)) {
        const toolResults = m.message.content
          .filter(
            b =>
              typeof b === 'object' && 'type' in b && b.type === 'tool_result',
          )
          .map(b => (b as ToolResultBlockParam).tool_use_id)
        if (toolResults.length > 0) {
          return `[${idx}] user(tool_results=[${toolResults.join(',')}])`
        }
      }
      return `[${idx}] ${m.type}`
    })

    // if (getStrictToolResultPairing()) {
    //   throw new Error(
    //     `ensureToolResultPairing: tool_use/tool_result pairing mismatch detected (strict mode). ` +
    //       `Refusing to repair — would inject synthetic placeholders into model context. ` +
    //       `Message structure: ${messageTypes.join('; ')}. See inc-4977.`,
    //   )
    // }

  }

  return result
}
export function createSystemAPIErrorMessage(
  error: APIError,
  retryInMs: number,
  retryAttempt: number,
  maxRetries: number,
): SystemAPIErrorMessage {
  return {
    type: 'system',
    subtype: 'api_error',
    level: 'error',
    cause: error.cause instanceof Error ? error.cause : undefined,
    error,
    retryInMs,
    retryAttempt,
    maxRetries,
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
  }
}
export function createAssistantMessage({
  content,
  usage,
  isVirtual,
}: {
  content: string | BetaContentBlock[]
  usage?: Usage
  isVirtual?: true
}): AssistantMessage {
  return baseCreateAssistantMessage({
    content:
      typeof content === 'string'
        ? [
            {
              type: 'text' as const,
              text: content === '' ? NO_CONTENT_MESSAGE : content,
            } as BetaContentBlock, // NOTE: citations field is not supported in Bedrock API
          ]
        : content,
    usage,
    isVirtual,
  })
}

/**
 * Filter orphaned thinking-only assistant messages.
 *
 * During streaming, each content block is yielded as a separate message with the same
 * message.id. When messages are loaded for resume, interleaved user messages or attachments
 * can prevent proper merging by message.id, leaving orphaned assistant messages that contain
 * only thinking blocks. These cause "thinking blocks cannot be modified" API errors.
 *
 * A thinking-only message is "orphaned" if there is NO other assistant message with the
 * same message.id that contains non-thinking content (text, tool_use, etc). If such a
 * message exists, the thinking block will be merged with it in normalizeMessagesForAPI().
 */
export function filterOrphanedThinkingOnlyMessages(
  messages: (UserMessage | AssistantMessage)[],
): (UserMessage | AssistantMessage)[]
export function filterOrphanedThinkingOnlyMessages(
  messages: Message[],
): Message[]
export function filterOrphanedThinkingOnlyMessages(
  messages: Message[],
): Message[] {
  // First pass: collect message.ids that have non-thinking content
  // These will be merged later in normalizeMessagesForAPI()
  const messageIdsWithNonThinkingContent = new Set<string>()
  for (const msg of messages) {
    if (msg.type !== 'assistant') continue

    const content = msg.message?.content
    if (!Array.isArray(content)) continue

    const hasNonThinking = (content as Array<{ type: string }>).some(
      block => block.type !== 'thinking' && block.type !== 'redacted_thinking',
    )
    if (hasNonThinking && msg.message?.id) {
      messageIdsWithNonThinkingContent.add(msg.message.id as string)
    }
  }

  // Second pass: filter out thinking-only messages that are truly orphaned
  const filtered = messages.filter(msg => {
    if (msg.type !== 'assistant') {
      return true
    }

    const content = msg.message?.content
    if (!Array.isArray(content) || content.length === 0) {
      return true
    }

    // Check if ALL content blocks are thinking blocks
    const allThinking = (content as Array<{ type: string }>).every(
      block => block.type === 'thinking' || block.type === 'redacted_thinking',
    )

    if (!allThinking) {
      return true // Has non-thinking content, keep it
    }

    // It's thinking-only. Keep it if there's another message with same id
    // that has non-thinking content (they'll be merged later)
    if (
      msg.message?.id &&
      messageIdsWithNonThinkingContent.has(msg.message.id as string)
    ) {
      return true
    }

    return false
  })

  return filtered
}
type ToolUseResultMessage = NormalizedUserMessage & {
  message: { content: [ToolResultBlockParam] }
}

export function isToolUseResultMessage(
  message: Message,
): message is ToolUseResultMessage {
  return (
    message.type === 'user' &&
    ((Array.isArray(message.message?.content) &&
      (message.message?.content as Array<{ type: string }>)[0]?.type ===
        'tool_result') ||
      Boolean(message.toolUseResult))
  )
}
export function filterUnresolvedToolUses(messages: Message[]): Message[] {
  // Collect all tool_use IDs and tool_result IDs directly from message content blocks.
  // This avoids calling normalizeMessages() which generates new UUIDs — if those
  // normalized messages were returned and later recorded to the transcript JSONL,
  // the UUID dedup would not catch them, causing exponential transcript growth on
  // every session resume.
  const toolUseIds = new Set<string>()
  const toolResultIds = new Set<string>()

  for (const msg of messages) {
    if (msg.type !== 'user' && msg.type !== 'assistant') continue
    const content = msg.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content as Array<{
      type: string
      id?: string
      tool_use_id?: string
    }>) {
      if (block.type === 'tool_use') {
        toolUseIds.add(block.id!)
      }
      if (block.type === 'tool_result') {
        toolResultIds.add(block.tool_use_id!)
      }
    }
  }

  const unresolvedIds = new Set(
    [...toolUseIds].filter(id => !toolResultIds.has(id)),
  )

  if (unresolvedIds.size === 0) {
    return messages
  }

  // Filter out assistant messages whose tool_use blocks are all unresolved
  return messages.filter(msg => {
    if (msg.type !== 'assistant') return true
    const content = msg.message?.content
    if (!Array.isArray(content)) return true
    const toolUseBlockIds: string[] = []
    for (const b of content as Array<{ type: string; id?: string }>) {
      if (b.type === 'tool_use') {
        toolUseBlockIds.push(b.id!)
      }
    }
    if (toolUseBlockIds.length === 0) return true
    // Remove message only if ALL its tool_use blocks are unresolved
    return !toolUseBlockIds.every(id => unresolvedIds.has(id))
  })
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
/**
 * In thecontent[] list on a UserMessage, tool_result blocks much come first
 * to avoid "tool result must follow tool use" API errors.
 */
function hoistToolResults(content: ContentBlockParam[]): ContentBlockParam[] {
  const toolResults: ContentBlockParam[] = []
  const otherBlocks: ContentBlockParam[] = []

  for (const block of content) {
    if (block.type === 'tool_result') {
      toolResults.push(block)
    } else {
      otherBlocks.push(block)
    }
  }

  return [...toolResults, ...otherBlocks]
}

export function mergeUserMessages(a: UserMessage, b: UserMessage): UserMessage {
  const lastContent = normalizeUserTextContent(
    a.message.content as string | ContentBlockParam[],
  )
  const currentContent = normalizeUserTextContent(
    b.message.content as string | ContentBlockParam[],
  )
  return {
    ...a,
    // Preserve the non-meta message's uuid so [id:] tags (derived from uuid)
    // stay stable across API calls (meta messages like system context get fresh uuids each call)
    uuid: a.isMeta ? b.uuid : a.uuid,
    message: {
      ...a.message,
      content: hoistToolResults(joinTextAtSeam(lastContent, currentContent)),
    },
  }
}
/**
 * Filter out assistant messages with only whitespace-only text content.
 *
 * The API requires "text content blocks must contain non-whitespace text".
 * This can happen when the model outputs whitespace (like "\n\n") before a thinking block,
 * but the user cancels mid-stream, leaving only the whitespace text.
 *
 * This function removes such messages entirely rather than keeping a placeholder,
 * since whitespace-only content has no semantic value.
 *
 * Also used by conversationRecovery to filter these from the main state during session resume.
 */
export function filterWhitespaceOnlyAssistantMessages(
  messages: (UserMessage | AssistantMessage)[],
): (UserMessage | AssistantMessage)[]
export function filterWhitespaceOnlyAssistantMessages(
  messages: Message[],
): Message[]
export function filterWhitespaceOnlyAssistantMessages(
  messages: Message[],
): Message[] {
  let hasChanges = false

  const filtered = messages.filter(message => {
    if (message.type !== 'assistant') {
      return true
    }

    const content = message.message?.content
    if (!Array.isArray(content) || content.length === 0) {
      return true
    }

    if (hasOnlyWhitespaceTextContent(content)) {
      hasChanges = true
      return false
    }

    return true
  })

  if (!hasChanges) {
    return messages
  }

  // Removing assistant messages may leave adjacent user messages that need
  // merging (the API requires alternating user/assistant roles).
  const merged: Message[] = []
  for (const message of filtered) {
    const prev = merged.at(-1)
    if (message.type === 'user' && prev?.type === 'user') {
      merged[merged.length - 1] = mergeUserMessages(
        prev as UserMessage,
        message as UserMessage,
      ) // lvalue
    } else {
      merged.push(message)
    }
  }
  return merged
}
/**
 * Check if an assistant message has only whitespace-only text content blocks.
 * Returns true if all content blocks are text blocks with only whitespace.
 * Returns false if there are any non-text blocks (like tool_use) or text with actual content.
 */
function hasOnlyWhitespaceTextContent(
  content: Array<{ type: string; text?: string }>,
): boolean {
  if (content.length === 0) {
    return false
  }

  for (const block of content) {
    // If there's any non-text block (tool_use, thinking, etc.), the message is valid
    if (block.type !== 'text') {
      return false
    }
    // If there's a text block with non-whitespace content, the message is valid
    if (block.text !== undefined && block.text.trim() !== '') {
      return false
    }
  }

  // All blocks are text blocks with only whitespace
  return true
}
// Deterministic UUID derivation. Produces a stable UUID-shaped string from a
// parent UUID + content block index so that the same input always produces the
// same key across calls. Used by normalizeMessages and synthetic message creation.
export function deriveUUID(parentUUID: UUID, index: number): UUID {
  const hex = index.toString(16).padStart(12, '0')
  return `${parentUUID.slice(0, 24)}${hex}` as UUID
}
// Split messages, so each content block gets its own message
export function normalizeMessages(
  messages: AssistantMessage[],
): NormalizedAssistantMessage[]
export function normalizeMessages(
  messages: UserMessage[],
): NormalizedUserMessage[]
export function normalizeMessages(
  messages: (AssistantMessage | UserMessage)[],
): (NormalizedAssistantMessage | NormalizedUserMessage)[]
export function normalizeMessages(messages: Message[]): NormalizedMessage[]
export function normalizeMessages(messages: Message[]): NormalizedMessage[] {
  // isNewChain tracks whether we need to generate new UUIDs for messages when normalizing.
  // When a message has multiple content blocks, we split it into multiple messages,
  // each with a single content block. When this happens, we need to generate new UUIDs
  // for all subsequent messages to maintain proper ordering and prevent duplicate UUIDs.
  // This flag is set to true once we encounter a message with multiple content blocks,
  // and remains true for all subsequent messages in the normalization process.
  let isNewChain = false
  return messages.flatMap(message => {
    switch (message.type) {
      case 'assistant': {
        const aMsg = message as AssistantMessage
        const assistantContent = Array.isArray(aMsg.message.content)
          ? aMsg.message.content
          : []
        isNewChain = isNewChain || assistantContent.length > 1
        return assistantContent.map((_, index) => {
          const uuid = isNewChain
            ? deriveUUID(message.uuid, index)
            : message.uuid
          return {
            type: 'assistant' as const,
            timestamp: message.timestamp,
            message: {
              ...aMsg.message,
              content: [_],
              context_management: aMsg.message.context_management ?? null,
            },
            isMeta: message.isMeta,
            isVirtual: message.isVirtual,
            requestId: message.requestId,
            uuid,
            error: message.error,
            isApiErrorMessage: message.isApiErrorMessage,
            advisorModel: message.advisorModel,
          } as NormalizedAssistantMessage
        })
      }
      case 'attachment':
        return [message]
      case 'progress':
        return [message]
      case 'system':
        return [message]
      case 'user': {
        const uMsg = message as UserMessage
        if (typeof uMsg.message.content === 'string') {
          const uuid = isNewChain ? deriveUUID(uMsg.uuid, 0) : uMsg.uuid
          return [
            {
              ...uMsg,
              uuid,
              message: {
                ...uMsg.message,
                content: [{ type: 'text', text: uMsg.message.content }],
              },
            } as NormalizedMessage,
          ]
        }
        isNewChain = isNewChain || (uMsg.message.content?.length ?? 0) > 1
        let imageIndex = 0
        return (uMsg.message.content ?? []).map((_, index) => {
          const isImage = _.type === 'image'
          // For image content blocks, extract just the ID for this image
          const imageId =
            isImage && uMsg.imagePasteIds
              ? (uMsg.imagePasteIds as number[])[imageIndex]
              : undefined
          if (isImage) imageIndex++
          return {
            ...createUserMessage({
              content: [_],
              toolUseResult: uMsg.toolUseResult,
              mcpMeta: uMsg.mcpMeta as {
                _meta?: Record<string, unknown>
                structuredContent?: Record<string, unknown>
              },
              isMeta: uMsg.isMeta === true ? true : undefined,
              isVisibleInTranscriptOnly:
                uMsg.isVisibleInTranscriptOnly === true ? true : undefined,
              isVirtual:
                (uMsg.isVirtual as boolean | undefined) === true
                  ? true
                  : undefined,
              timestamp: uMsg.timestamp as string | undefined,
              imagePasteIds: imageId !== undefined ? [imageId] : undefined,

            }),
            uuid: isNewChain ? deriveUUID(uMsg.uuid, index) : uMsg.uuid,
          } as NormalizedMessage
        })
      }
      default:
        return [message]
    }
  })
}
export function isSyntheticMessage(message: Message): boolean {
  return (
    message.type !== 'progress' &&//progress消息不算synthetic
    message.type !== 'attachment' &&//attachment消息不算synthetic
    message.type !== 'system' &&//system消息不算synthetic
    Array.isArray(message.message?.content) &&//synthetic消息必须有content数组
    message.message?.content[0]?.type === 'text' &&//synthetic消息的第一个content块必须是text块
    SYNTHETIC_MESSAGES.has(//content数组的第一个text块的文本必须在SYNTHETIC_MESSAGES集合中
      (message.message?.content[0] as { text: string }).text,
    )
  )
}
export function getUserMessageText(
  message: Message | NormalizedMessage,
): string | null {
  if (message.type !== 'user') {
    return null
  }

  const content = message.message?.content

  return getContentText(content as string | ContentBlockParam[])
}
export function textForResubmit(
  msg: UserMessage,
): { text: string; mode: 'bash' | 'prompt' } | null {
  const content = getUserMessageText(msg)
  if (content === null) return null
  const bash = extractTag(content, 'bash-input')//抽取bash-input标签的内容，如果存在则优先使用bash输入模式
  if (bash) return { text: bash, mode: 'bash' }
  const cmd = extractTag(content, COMMAND_NAME_TAG)//抽取command-name标签的内容，如果存在则使用命令输入模式
  if (cmd) {
    const args = extractTag(content, COMMAND_ARGS_TAG) ?? ''
    return { text: `${cmd} ${args}`, mode: 'prompt' }
  }
  return { text: content, mode: 'prompt' }
}

type ThinkingBlockType =
  | ThinkingBlock
  | RedactedThinkingBlock
  | ThinkingBlockParam
  | RedactedThinkingBlockParam
  | BetaThinkingBlock
  | BetaRedactedThinkingBlock

function isThinkingBlock(
  block: ContentBlockParam | ContentBlock | BetaContentBlock,
): block is ThinkingBlockType {
  return block.type === 'thinking' || block.type === 'redacted_thinking'
}

/**
 * Strip signature-bearing blocks (thinking, redacted_thinking, connector_text)
 * from all assistant messages. Their signatures are bound to the API key that
 * generated them; after a credential change (e.g. /login) they're invalid and
 * the API rejects them with a 400.
 */
export function stripSignatureBlocks(messages: Message[]): Message[] {
  let changed = false
  const result = messages.map(msg => {
    if (msg.type !== 'assistant') return msg

    const content = (msg as AssistantMessage).message.content
    if (!Array.isArray(content)) return msg

    const filtered = content.filter(block => {
      if (isThinkingBlock(block)) return false
      return true
    })
    if (filtered.length === content.length) return msg

    // Strip to [] even for thinking-only messages. Streaming yields each
    // content block as a separate same-id AssistantMessage (claude.ts:2150),
    // so a thinking-only singleton here is usually a split sibling that
    // mergeAssistantMessages (2232) rejoins with its text/tool_use partner.
    // If we returned the original message, the stale signature would survive
    // the merge. Empty content is absorbed by merge; true orphans are handled
    // by the empty-content placeholder path in normalizeMessagesForAPI.

    changed = true
    return {
      ...msg,
      message: { ...msg.message, content: filtered },
    } as typeof msg
  })

  return changed ? result : messages
}