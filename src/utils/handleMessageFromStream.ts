import type { Message, StreamEvent } from '../package/message.js'

type QueryEvent = Message | StreamEvent | { type: string; [key: string]: unknown }

type StreamCallbacks = {
  onMessageStart?: () => void
  onTextBlockStart?: () => void
  onToolUseBlockStart?: (toolName: string) => void
  onTextDelta?: (text: string) => void
  onMessageStop?: () => void
  onTombstone?: (message: Message) => void
  onMessage?: (message: Message) => void
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null
}

export function handleMessageFromStream(
  event: QueryEvent,
  callbacks: StreamCallbacks,
): void {
  if (event.type === 'stream_event') {
    const streamEvent = asRecord(event.event)
    if (!streamEvent || typeof streamEvent.type !== 'string') {
      return
    }

    switch (streamEvent.type) {
      case 'message_start':
        callbacks.onMessageStart?.()
        return
      case 'content_block_start': {
        const contentBlock = asRecord(streamEvent.content_block)
        if (contentBlock?.type === 'text') {
          callbacks.onTextBlockStart?.()
        }
        if (contentBlock?.type === 'tool_use') {
          callbacks.onToolUseBlockStart?.(
            typeof contentBlock.name === 'string'
              ? contentBlock.name
              : 'unknown_tool',
          )
        }
        return
      }
      case 'content_block_delta': {
        const delta = asRecord(streamEvent.delta)
        if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
          callbacks.onTextDelta?.(delta.text)
        }
        return
      }
      case 'message_stop':
        callbacks.onMessageStop?.()
        return
      default:
        return
    }
  }

  if (event.type === 'stream_request_start' || event.type === 'tool_use_summary') {
    return
  }

  if (event.type === 'tombstone') {
    callbacks.onTombstone?.(event as Message)
    return
  }

  callbacks.onMessage?.(event as Message)
}
