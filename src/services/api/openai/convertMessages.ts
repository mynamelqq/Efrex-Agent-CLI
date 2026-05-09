import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
  ChatCompletionSystemMessageParam,
  ChatCompletionToolMessageParam,
  ChatCompletionUserMessageParam,
} from 'openai/resources/chat/completions/completions.mjs'
import type { AssistantMessage, UserMessage } from 'src/package/message.js'
import type { SystemPrompt } from 'src/prompt.js'

export function messagesToOpenAI(
  messages: (UserMessage | AssistantMessage)[],
  systemPrompt: SystemPrompt,
): ChatCompletionMessageParam[] {
  const result: ChatCompletionMessageParam[] = []
  const systemText = systemPrompt.filter(Boolean).join('\n\n')

  if (systemText) {
    result.push({
      role: 'system',
      content: systemText,
    } satisfies ChatCompletionSystemMessageParam)
  }

  for (const msg of messages) {
    if (msg.type === 'user') result.push(...convertUserMessage(msg))
    if (msg.type === 'assistant') result.push(...convertAssistantMessage(msg))
  }

  return result
}

function convertUserMessage(msg: UserMessage): ChatCompletionMessageParam[] {
  const content = msg.message.content
  if (typeof content === 'string') {
    return [{ role: 'user', content } satisfies ChatCompletionUserMessageParam]
  }
  if (!Array.isArray(content)) return []

  const result: ChatCompletionMessageParam[] = []
  const textParts: string[] = []
  const imageParts: Array<{ type: 'image_url'; image_url: { url: string } }> =
    []

  for (const rawBlock of content) {
    const block = rawBlock as unknown as Record<string, unknown>
    if (typeof rawBlock === 'string') {
      textParts.push(rawBlock)
    } else if (block.type === 'text' && typeof block.text === 'string') {
      textParts.push(block.text)
    } else if (block.type === 'tool_result') {
      result.push(convertToolResult(block))
    } else if (block.type === 'image') {
      const image = convertImageBlock(block)
      if (image) imageParts.push(image)
    }
  }

  if (imageParts.length > 0) {
    result.push({
      role: 'user',
      content: [
        ...(textParts.length > 0
          ? [{ type: 'text' as const, text: textParts.join('\n') }]
          : []),
        ...imageParts,
      ],
    } satisfies ChatCompletionUserMessageParam)
  } else if (textParts.length > 0) {
    result.push({
      role: 'user',
      content: textParts.join('\n'),
    } satisfies ChatCompletionUserMessageParam)
  }

  return result
}

function convertToolResult(
  block: Record<string, unknown>,
): ChatCompletionToolMessageParam {
  const rawContent = block.content
  const content = Array.isArray(rawContent)
    ? rawContent
        .map(item => {
          if (typeof item === 'string') return item
          if (item && typeof item === 'object' && 'text' in item) {
            return String((item as { text?: unknown }).text ?? '')
          }
          return ''
        })
        .filter(Boolean)
        .join('\n')
    : String(rawContent ?? '')

  return {
    role: 'tool',
    tool_call_id: String(block.tool_use_id ?? ''),
    content,
  }
}

function convertAssistantMessage(
  msg: AssistantMessage,
): ChatCompletionMessageParam[] {
  const content = msg.message.content
  if (typeof content === 'string') {
    return [
      { role: 'assistant', content } satisfies ChatCompletionAssistantMessageParam,
    ]
  }
  if (!Array.isArray(content)) {
    return [{ role: 'assistant', content: '' }]
  }

  const textParts: string[] = []
  const reasoningParts: string[] = []
  const toolCalls: NonNullable<
    ChatCompletionAssistantMessageParam['tool_calls']
  > = []

  for (const rawBlock of content) {
    const block = rawBlock as unknown as Record<string, unknown>
    if (typeof rawBlock === 'string') {
      textParts.push(rawBlock)
    } else if (block.type === 'text' && typeof block.text === 'string') {
      textParts.push(block.text)
    } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
      reasoningParts.push(block.thinking)
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: String(block.id ?? ''),
        type: 'function',
        function: {
          name: String(block.name ?? ''),
          arguments:
            typeof block.input === 'string'
              ? block.input
              : JSON.stringify(block.input ?? {}),
        },
      })
    }
  }

  return [
    {
      role: 'assistant',
      content: textParts.length > 0 ? textParts.join('\n') : null,
      ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
      ...(reasoningParts.length > 0 && {
        reasoning_content: reasoningParts.join('\n'),
      }),
    } satisfies ChatCompletionAssistantMessageParam,
  ]
}

function convertImageBlock(
  block: Record<string, unknown>,
): { type: 'image_url'; image_url: { url: string } } | null {
  const source = block.source as Record<string, unknown> | undefined
  if (!source) return null

  if (source.type === 'base64' && typeof source.data === 'string') {
    return {
      type: 'image_url',
      image_url: {
        url: `data:${source.media_type || 'image/png'};base64,${source.data}`,
      },
    }
  }

  if (source.type === 'url' && typeof source.url === 'string') {
    return { type: 'image_url', image_url: { url: source.url } }
  }

  return null
}
