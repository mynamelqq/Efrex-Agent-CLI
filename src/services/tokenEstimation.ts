import type { Attachment } from '../utils/attachments.js'
import type { Message } from '../package/message.js'
import { ContentBlock,ContentBlockParam } from '../package/message.js'

export function roughTokenCountEstimation(//来估算 token 数。默认认为 大约 4 个字符 ≈ 1 个 token。
  content: string,
  bytesPerToken: number = 4,
): number {
  return Math.round(content.length / bytesPerToken)
}

/**
 * Returns an estimated bytes-per-token ratio for a given file extension.
 * Dense JSON has many single-character tokens (`{`, `}`, `:`, `,`, `"`)
 * which makes the real ratio closer to 2 rather than the default 4.
 * 根据文件扩展名决定 bytesPerToken：

json / jsonl / jsonc：用 2
其他类型：用 4
 */
export function bytesPerTokenForFileType(fileExtension: string): number {
  switch (fileExtension) {//
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
// 遍历所有 messages，把每条消息的估算 token 加起来。
export function roughTokenCountEstimationForMessages(
  messages: Message[],
): number {
  let totalTokens = 0
  for (const message of messages) {
    totalTokens += roughTokenCountEstimationForMessage(message)
  }
  return totalTokens
}


export function roughTokenCountEstimationForMessage(message: Message): number {
  if (
    (message.type === 'assistant' || message.type === 'user') &&
    message.message?.content
  ) {
    return roughTokenCountEstimationForContent(
      message.message?.content as
        | string
        | Array<ContentBlock>
        | Array<ContentBlockParam>
        | undefined,
    )
  }

  // if (message.type === 'attachment' && message.attachment) {
  //   const userMessages = normalizeAttachmentForAPI(message.attachment)
  //   let total = 0
  //   for (const userMsg of userMessages) {
  //     total += roughTokenCountEstimationForContent(userMsg.message.content)
  //   }
  //   return total
  // }

  return 0
}

function roughTokenCountEstimationForMessageContent(
  content: NonNullable<Message['message']>,
): number {
  let totalTokens = roughTokenCountEstimationForContent(content.content)

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
    | string
    | Array<ContentBlock>
    | Array<ContentBlockParam>
    | undefined,
): number {
  if (!content) {
    return 0
  }
  if (typeof content === 'string') {
    return roughTokenCountEstimation(content)
  }
  let totalTokens = 0
  for (const block of content) {
    totalTokens += roughTokenCountEstimationForBlock(block)
  }
  return totalTokens
}

function roughTokenCountEstimationForBlock(
  block: string | ContentBlock | ContentBlockParam,
): number {
  if (typeof block === 'string') {
    return roughTokenCountEstimation(block)
  }
  if (block.type === 'text') {
    return roughTokenCountEstimation(block.text)
  }
  if (block.type === 'image' || block.type === 'document') {
    // https://platform.claude.com/docs/en/build-with-claude/vision#calculate-image-costs
    // tokens = (width px * height px)/750
    // Images are resized to max 2000x2000 (5333 tokens). Use a conservative
    // estimate that matches microCompact's IMAGE_MAX_TOKEN_SIZE to avoid
    // underestimating and triggering auto-compact too late.
    //
    // document: base64 PDF in source.data.  Must NOT reach the
    // jsonStringify catch-all — a 1MB PDF is ~1.33M base64 chars →
    // ~325k estimated tokens, vs the ~2000 the API actually charges.
    // Same constant as microCompact's calculateToolResultTokens.
    return 2000
  }
  if (block.type === 'tool_result') {
    return roughTokenCountEstimationForContent(block.content as any)
  }
  if (block.type === 'tool_use') {
    // input is the JSON the model generated — arbitrarily large (bash
    // commands, Edit diffs, file contents).  Stringify once for the
    // char count; the API re-serializes anyway so this is what it sees.
    return roughTokenCountEstimation(
      block.name + JSON.stringify(block.input ?? {}),
    )
  }
  if (block.type === 'thinking') {
    return roughTokenCountEstimation(block.thinking)
  }
  if (block.type === 'redacted_thinking') {
    return roughTokenCountEstimation(block.data)
  }
  // server_tool_use, web_search_tool_result, mcp_tool_use, etc. —
  // text-like payloads (tool inputs, search results, no base64).
  // Stringify-length tracks the serialized form the API sees; the
  // key/bracket overhead is single-digit percent on real blocks.
  return roughTokenCountEstimation(JSON.stringify(block))
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


