import { isEnvTruthy } from '../../utils/envUtils.js'
import {
  isMediaSizeErrorMessage,
  isPromptTooLongMessage,
} from '../api/errors.js'
import type { AssistantMessage, Message } from '../../package/message.js'
import { type CompactionResult, compactConversation } from './compact.js'
import { logError } from '../../utils/log.js'
import { logForDebugging } from '../../utils/debug.js'
import { ToolUseContext } from 'src/Tool.js'



export const isReactiveCompactEnabled: () => boolean = () => {
  if (isEnvTruthy(process.env.DISABLE_COMPACT)) return false
  return true
}
export const isWithheldPromptTooLong: (message: Message) => boolean =
  message => {
    if (message.type !== 'assistant' || !message.isApiErrorMessage) return false
    return isPromptTooLongMessage(message as AssistantMessage)
  }
export const isWithheldMediaSizeError: (message: Message) => boolean =
  message => {
    if (message.type !== 'assistant' || !message.isApiErrorMessage) return false
    return isMediaSizeErrorMessage(message as AssistantMessage)
  }


export const tryReactiveCompact: (params: {
  hasAttempted: boolean
  toolUseContext:ToolUseContext
  querySource: string
  aborted: boolean
  messages: Message[]
}) => Promise<CompactionResult | null> = async ({
  hasAttempted,
  toolUseContext,
  querySource,
  aborted,
  messages,
}) => {
  if (hasAttempted || aborted) return null
  try {
    const result = await compactConversation(
      messages,
      toolUseContext,
      true,
      undefined,
      true,
      {
        isRecompactionInChain: false,
        turnsSincePreviousCompact: 0,
        autoCompactThreshold: 0,
      },
    )
    return result
  } catch (error) {
    logForDebugging(
      `reactiveCompact: emergency compaction failed — ${String(error)}`,
      { level: 'warn' },
    )
    logError(error)
    return null
  }
}
