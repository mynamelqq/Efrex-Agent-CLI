import type {
  ChatCompletion,
  ChatCompletionContentPart,
  ChatCompletionMessage,
} from 'openai/resources/chat/completions'
import { randomUUID, type UUID } from 'crypto'

import { Tools } from 'src/Tool'
import { findToolByName } from 'src/Tool'
import { safeParseJSON } from './json'
import { Attachment } from './attachments'
import {normalizeToolInput} from "src/utils/api"
import { escapeRegExp } from './stringUtils'
import type {
  ToolResultBlockParam,
  AssistantMessage,
  AttachmentMessage,
  ContentBlock,
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
export const NO_CONTENT_MESSAGE = '(no content)'
export const INTERRUPT_MESSAGE_FOR_TOOL_USE =
  '[Request interrupted by user for tool use]'
export const INTERRUPT_MESSAGE = '[Request interrupted by user]'
export const CANCEL_MESSAGE =
  "The user doesn't want to take this action right now. STOP what you are doing and wait for the user to tell you how to proceed."
export type SDKAssistantMessageError =
  | 'authentication_failed'
  | 'billing_error'
  | 'rate_limit'
  | 'invalid_request'
  | 'server_error'
  | 'unknown'
  | 'max_output_tokens'
import { ContentBlockParam } from '../package/message'
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
  content: string | ChatCompletionContentPart[]|ContentBlock[]|ContentBlockParam[]
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
    content: content === '' ? NO_CONTENT_MESSAGE : content,
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
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  },
}: {
  content: ChatCompletionMessage['content']
  isApiErrorMessage?: boolean
  apiError?: AssistantMessage['apiError']
  error?: SDKAssistantMessageError
  errorDetails?: string
  isVirtual?: true
  usage?: ChatCompletion['usage']
}): AssistantMessage {
  return {
    type: 'assistant',
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    message: {
      id: randomUUID(),
      model: '<synthetic>',
      role: 'assistant',
      finish_reason: 'stop',
      usage,
      content,
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
  contentBlocks: ChatCompletionMessage['content'] | Array<Record<string, unknown>>,
  tools: Tools,
): ChatCompletionMessage['content'] | Array<Record<string, unknown>> {
  if (!contentBlocks) {
    return ''
  }
  if (typeof contentBlocks === 'string') {
    return contentBlocks
  }
  return contentBlocks.map(contentBlock => {
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
