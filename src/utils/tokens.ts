
import { SYNTHETIC_MESSAGES, SYNTHETIC_MODEL } from './messages.js'
import type { CompletionUsage as Usage} from 'openai/resources'
import { roughTokenCountEstimationForMessages } from 'src/services/tokenEstimation.js'

import type {
  AssistantMessage,
  ContentItem,
  Message,
} from 'src/package/message.js'
export function getTokenUsage(message: Message): Usage | undefined {
  if (
    message?.type === 'assistant' &&//必须是助手消息 + 存在 message 对象 + 包含 usage
    message.message &&
    'usage' in message.message &&
    !(
      Array.isArray(message.message.content) &&
      (message.message.content as ContentItem[])[0]?.type === 'text' &&
      SYNTHETIC_MESSAGES.has(//2. 过滤：合成模型直接返回 undefined
        (message.message.content as Array<ContentItem & { text: string }>)[0]!
          .text,
      )
    ) &&// 3. 过滤：文本类型的合成消息（内置固定消息）
    message.message.model !== SYNTHETIC_MODEL
  ) {
    return message.message.usage as Usage
  }
  return undefined
}
/**
 * Get the API response id for an assistant message with real (non-synthetic) usage.
 * Used to identify split assistant records that came from the same API response —
 * when parallel tool calls are streamed, each content block becomes a separate
 * AssistantMessage record, but they all share the same message.id.
 */
function getAssistantMessageId(message: Message): string | undefined {
  if (
    message?.type === 'assistant' &&
    'id' in message.message! &&
    message.message!.model !== SYNTHETIC_MODEL
  ) {
    return message.message!.id as string |undefined
  }
  return undefined
}

/**
 * Get the current context window size in tokens.
 *
 * This is the CANONICAL function for measuring context size when checking
 * thresholds (autocompact, session memory init, etc.). Uses the last API
 * response's token count (input + output + cache) plus estimates for any
 * messages added since.
 *
 * Always use this instead of:
 * - Cumulative token counting (which double-counts as context grows)
 * - messageTokenCountFromLastAPIResponse (which only counts output_tokens)
 * - tokenCountFromLastAPIResponse (which doesn't estimate new messages)
 *
 * Implementation note on parallel tool calls: when the model makes multiple
 * tool calls in one response, the streaming code emits a SEPARATE assistant
 * record per content block (all sharing the same message.id and usage), and
 * the query loop interleaves each tool_result immediately after its tool_use.
 * So the messages array looks like:
 *   [..., assistant(id=A), user(result), assistant(id=A), user(result), ...]
 * If we stop at the LAST assistant record, we only estimate the one tool_result
 * after it and miss all the earlier interleaved tool_results — which will ALL
 * be in the next API request. To avoid undercounting, after finding a usage-
 * bearing record we walk back to the FIRST sibling with the same message.id
 * so every interleaved tool_result is included in the rough estimate.
 */
export function tokenCountWithEstimation(messages: readonly Message[]): number {
  let i = messages.length - 1
  while (i >= 0) {
    const message = messages[i]
    const usage = message ? getTokenUsage(message) : undefined//获得消息的token用量
    if (message && usage) {
      // Walk back past any earlier sibling records split from the same API
      // response (same message.id) so interleaved tool_results between them
      // are included in the estimation slice.
      const responseId = getAssistantMessageId(message)
      if (responseId) {//AI消息 → 工具结果 → AI消息 → 工具结果
// （所有 AI 消息属于同一次回复）
// 普通统计会只算最后一段，这个函数会把同 ID 的所有 AI 片段都算进去
        let j = i - 1
        while (j >= 0) {
          const prior = messages[j]
          const priorId = prior ? getAssistantMessageId(prior) : undefined
          if (priorId === responseId) {//id 相同 → 同一次回复的不同片段
            // Earlier split of the same API response — anchor here instead.
            i = j
          } else if (priorId !== undefined) {
            // Hit a different API response — stop walking.
            break
          }
          // priorId === undefined: a user/tool_result/attachment message,
          // possibly interleaved between splits — keep walking.
          j--
        }
      }
      return (
        getTokenCountFromUsage(usage) +
        roughTokenCountEstimationForMessages(
          messages.slice(i + 1) as Parameters<
            typeof roughTokenCountEstimationForMessages
          >[0],
        )
      )
    }
    i--
  }
  return roughTokenCountEstimationForMessages(
    messages as Parameters<typeof roughTokenCountEstimationForMessages>[0],
  )
}
/**
 * Calculate total context window tokens from an API response's usage data.
 * Includes input_tokens + cache tokens + output_tokens.
 *
 * This represents the full context size at the time of that API call.
 * Use tokenCountWithEstimation() when you need context size from messages.
 */
export function getTokenCountFromUsage(usage: Usage): number {
  if (!usage) {
    return 0
  }
  return (
    (usage.total_tokens ?? 0)
  )
}