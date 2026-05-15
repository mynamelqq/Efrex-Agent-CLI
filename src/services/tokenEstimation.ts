import type {
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions/completions.mjs'

import type { Attachment } from '../utils/attachments.js'
import type { Message } from '../package/message.js'

export function roughTokenCountEstimation(
  content: string,
  bytesPerToken: number = 4,
): number {
  return Math.round(content.length / bytesPerToken)
}

/**
 * Returns an estimated bytes-per-token ratio for a given file extension.
 * Dense JSON has many single-character tokens (`{`, `}`, `:`, `,`, `"`)
 * which makes the real ratio closer to 2 rather than the default 4.
 */
export function bytesPerTokenForFileType(fileExtension: string): number {
  switch (fileExtension) {
    case 'json':
    case 'jsonl':
    case 'jsonc':
      return 2
    default:
      return 4
  }
}

/**
 * Like {@link roughTokenCountEstimation} but uses a more accurate
 * bytes-per-token ratio when the file type is known.
 *
 * This matters when the API-based token count is unavailable (e.g. on
 * Bedrock) and we fall back to the rough estimate — an underestimate can
 * let an oversized tool result slip into the conversation.
 */
export function roughTokenCountEstimationForFileType(
  content: string,
  fileExtension: string,
): number {
  return roughTokenCountEstimation(
    content,
    bytesPerTokenForFileType(fileExtension),
  )
}

export function roughTokenCountEstimationForMessages(
  messages: readonly Pick<Message, 'type' | 'message' | 'attachment'>[],
): number {
  let totalTokens = 0
  for (const message of messages) {
    totalTokens += roughTokenCountEstimationForMessage(message)
  }
  return totalTokens
}

export function roughTokenCountEstimationForMessage(
  message: Pick<Message, 'type' | 'message' | 'attachment'>,
): number {
  let totalTokens = 0

  if (message.message) {
    totalTokens += roughTokenCountEstimationForMessageContent(message.message)
  }

  if (message.type === 'attachment' && message.attachment) {
    totalTokens += roughTokenCountEstimationForAttachment(message.attachment)
  }

  return totalTokens
}

function roughTokenCountEstimationForMessageContent(
  content: NonNullable<Message['message']>,
): number {
  let totalTokens = roughTokenCountEstimationForContent(
    content.content as ChatCompletionMessageParam['content'],
  )

  if (Array.isArray(content.tool_calls) && content.tool_calls.length > 0) {
    totalTokens += roughTokenCountEstimation(JSON.stringify(content.tool_calls))
  }

  if (typeof content.refusal === 'string') {
    totalTokens += roughTokenCountEstimation(content.refusal)
  }

  const reasoningContent = (content as { reasoning_content?: unknown })
    .reasoning_content
  if (typeof reasoningContent === 'string') {
    totalTokens += roughTokenCountEstimation(reasoningContent)
  }

  return totalTokens
}

function roughTokenCountEstimationForContent(
  content:
    | ChatCompletionMessageParam['content']
    | Array<Record<string, unknown>>
    | null
    | undefined,
): number {
  if (content == null) {
    return 0
  }

  if (typeof content === 'string') {
    return roughTokenCountEstimation(content)
  }

  if (Array.isArray(content)) {
    let totalTokens = 0
    for (const block of content) {
      totalTokens += roughTokenCountEstimationForBlock(block)
    }
    return totalTokens
  }

  return roughTokenCountEstimationForBlock(content)
}

function roughTokenCountEstimationForBlock(block: unknown): number {
  if (block == null) {
    return 0
  }

  if (typeof block === 'string') {
    return roughTokenCountEstimation(block)
  }

  if (typeof block !== 'object') {
    return roughTokenCountEstimation(String(block))
  }

  const record = block as Record<string, unknown>
  const type = record.type

  if (type === 'text' && typeof record.text === 'string') {
    return roughTokenCountEstimation(record.text)
  }

  if (type === 'refusal' && typeof record.refusal === 'string') {
    return roughTokenCountEstimation(record.refusal)
  }

  if (
    type === 'image' ||
    type === 'image_url' ||
    type === 'document' ||
    type === 'input_image'
  ) {
    // Images and documents are expensive but their serialized form is not a
    // useful proxy for token count. Use a conservative fixed cost so we do not
    // undercount and miss compaction thresholds.
    return 2000
  }

  if (type === 'input_audio') {
    const inputAudio = record.input_audio as Record<string, unknown> | undefined
    if (inputAudio && typeof inputAudio.data === 'string') {
      return roughTokenCountEstimation(inputAudio.data)
    }
    return roughTokenCountEstimation(JSON.stringify(record))
  }

  if (type === 'tool_use') {
    return roughTokenCountEstimation(
      String(record.name ?? '') + JSON.stringify(record.input ?? {}),
    )
  }

  if (type === 'tool_result') {
    return roughTokenCountEstimationForContent(record.content)
  }

  if (type === 'thinking') {
    const thinking = record.thinking
    return typeof thinking === 'string'
      ? roughTokenCountEstimation(thinking)
      : roughTokenCountEstimation(JSON.stringify(record))
  }

  if (type === 'redacted_thinking') {
    return typeof record.data === 'string'
      ? roughTokenCountEstimation(record.data)
      : roughTokenCountEstimation(JSON.stringify(record))
  }

  if (type === 'file') {
    const file = record.file as Record<string, unknown> | undefined
    if (file && typeof file.file_data === 'string') {
      return roughTokenCountEstimation(file.file_data)
    }
    return roughTokenCountEstimation(JSON.stringify(record))
  }

  if (type === 'tool_calls' && Array.isArray(record.tool_calls)) {
    return roughTokenCountEstimation(JSON.stringify(record.tool_calls))
  }

  return roughTokenCountEstimation(JSON.stringify(record))
}

function roughTokenCountEstimationForAttachment(
  attachment: Attachment,
): number {
  switch (attachment.type) {
    case 'edited_text_file':
      return roughTokenCountEstimation(attachment.snippet)
    case 'directory':
      return roughTokenCountEstimation(attachment.content)
    case 'selected_lines_in_ide':
      return roughTokenCountEstimation(attachment.content)
    case 'opened_file_in_ide':
      return roughTokenCountEstimation(attachment.filename)
    case 'relevant_memories':
      return attachment.memories.reduce((totalTokens, memory) => {
        const content = memory.header ?? memory.content
        return totalTokens + roughTokenCountEstimation(content)
      }, 0)
    case 'dynamic_skill':
      return roughTokenCountEstimation(
        attachment.displayPath + attachment.skillNames.join('\n'),
      )
    case 'skill_listing':
      return roughTokenCountEstimation(attachment.content)
    case 'output_style':
      return roughTokenCountEstimation(attachment.style)
    case 'critical_system_reminder':
      return roughTokenCountEstimation(attachment.content)
    case 'plan_file_reference':
      return (
        roughTokenCountEstimation(attachment.planFilePath) +
        roughTokenCountEstimation(attachment.planContent)
      )
    case 'command_permissions':
      return (
        roughTokenCountEstimation(JSON.stringify(attachment.allowedTools)) +
        roughTokenCountEstimation(attachment.model ?? '')
      )
    case 'structured_output':
      return roughTokenCountEstimation(JSON.stringify(attachment.data))
    case 'invoked_skills':
      return attachment.skills.reduce((totalTokens, skill) => {
        return (
          totalTokens +
          roughTokenCountEstimation(skill.name) +
          roughTokenCountEstimation(skill.path) +
          roughTokenCountEstimation(skill.content)
        )
      }, 0)
    case 'current_session_memory':
      return (
        roughTokenCountEstimation(attachment.content) +
        roughTokenCountEstimation(attachment.path)
      )
    case 'deferred_tools_delta':
    case 'agent_listing_delta':
    case 'mcp_instructions_delta':
    case 'bagel_console':
    case 'budget_usd':
    case 'output_token_usage':
    case 'max_turns_reached':
    case 'teammate_shutdown_batch':
    case 'compaction_reminder':
    case 'context_efficiency':
    case 'date_change':
    case 'ultrathink_effort':
    case 'verify_plan_reminder':
      return roughTokenCountEstimation(JSON.stringify(attachment))
    default:
      return roughTokenCountEstimation(JSON.stringify(attachment))
  }
}


