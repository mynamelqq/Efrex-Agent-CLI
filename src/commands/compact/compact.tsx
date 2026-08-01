import { feature } from 'bun:bundle'
import chalk from 'chalk'
import { getSystemPrompt } from '../../constants/prompts.js'
import { getSystemContext, getUserContext } from '../../context.js'
import {
  type CompactionResult,
  compactConversation,
  ERROR_MESSAGE_INCOMPLETE_RESPONSE,
  ERROR_MESSAGE_NOT_ENOUGH_MESSAGES,
  ERROR_MESSAGE_USER_ABORT,
} from '../../services/compact/compact.js'
import { microcompactMessages } from 'src/services/compact/mircoCompact.js'
import type { ToolUseContext } from '../../Tool.js'
import type { LocalCommandCall } from '../../types/command.js'
import type { Message } from 'src/package/message.js'
import { hasExactErrorMessage } from '../../utils/errors.js'
import { logError } from '../../utils/log.js'
import { getMessagesAfterCompactBoundary } from '../../utils/messages.js'
import {
  buildEffectiveSystemPrompt,
} from '../../utils/systemPrompt.js'
import { SystemPrompt } from 'src/prompt.js'
/* eslint-disable @typescript-eslint/no-require-imports */
const reactiveCompact = feature('REACTIVE_COMPACT')
  ? (require('../../services/compact/reactiveCompact.js') as typeof import('../../services/compact/reactiveCompact.js'))
  : null
/* eslint-enable @typescript-eslint/no-require-imports */

export const call: LocalCommandCall = async (args, context) => {
  const { abortController } = context
  let { messages } = context

  // REPL 保留 UI 回滚的消息片段 — 项目如此紧凑
  // 模型不会总结故意删除的内容。
  messages = getMessagesAfterCompactBoundary(messages)

  if (messages.length === 0) {
    throw new Error('No messages to compact')
  }

  const customInstructions = args.trim()

  try {
    // Try session memory compaction first if no custom instructions
    // (session memory compaction doesn't support custom instructions)
    // if (!customInstructions) {
    //   const sessionMemoryResult = await trySessionMemoryCompaction(
    //     messages,
    //     context.agentId,
    //   )
    //   if (sessionMemoryResult) {
    //     getUserContext.cache.clear?.()
    //     runPostCompactCleanup()
    //     // Reset cache read baseline so the post-compact drop isn't flagged
    //     // as a break. compactConversation does this internally; SM-compact doesn't.
    //     if (feature('PROMPT_CACHE_BREAK_DETECTION')) {
    //       notifyCompaction(
    //         context.options.querySource ?? 'compact',
    //         context.agentId,
    //       )
    //     }
    //     markPostCompaction()
    //     // Suppress warning immediately after successful compaction
    //     suppressCompactWarning()

    //     return {
    //       type: 'compact',
    //       compactionResult: sessionMemoryResult,
    //       displayText: buildDisplayText(context),
    //     }
    //   }
    // }

    // 仅反应式模式：通过反应式路径路由 /compact。
    // 在会话内存之后检查（该路径便宜且正交）。
    // if (reactiveCompact?.isReactiveOnlyMode()) {
    //   return await compactViaReactive(
    //     messages,
    //     context,
    //     customInstructions,
    //     reactiveCompact,
    //   )
    // }

    // Fall back to traditional compaction
    // Run microcompact first to reduce tokens before summarization
    const microcompactResult = await microcompactMessages(messages, context)
    const messagesForCompact = microcompactResult.messages

    const result = await compactConversation(
      messagesForCompact,
      context,
    //   await getCacheSharingParams(context, messagesForCompact),
      false,
      customInstructions,
      false,
    )

    // Reset lastSummarizedMessageId since legacy compaction replaces all messages
    // and the old message UUID will no longer exist in the new messages array
    // setLastSummarizedMessageId(undefined)

    // Suppress the "Context left until auto-compact" warning after successful compaction

    getUserContext.cache.clear?.()
    // runPostCompactCleanup()

    return {
      type: 'compact',
      compactionResult: result,
      displayText: buildDisplayText(context, result.userDisplayMessage),
    }
  } catch (error) {
    if (abortController.signal.aborted) {
      throw new Error('Compaction canceled.')
    } else if (hasExactErrorMessage(error, ERROR_MESSAGE_NOT_ENOUGH_MESSAGES)) {
      throw new Error(ERROR_MESSAGE_NOT_ENOUGH_MESSAGES)
    } else if (hasExactErrorMessage(error, ERROR_MESSAGE_INCOMPLETE_RESPONSE)) {
      throw new Error(ERROR_MESSAGE_INCOMPLETE_RESPONSE)
    } else {
      logError(error)
      throw new Error(`Error during compaction: ${error}`)
    }
  }
}



function buildDisplayText(
  context: ToolUseContext,
  userDisplayMessage?: string,
): string {

  const dimmed = [
    ...(context.options.verbose
      ? []
      : []),
    ...(userDisplayMessage ? [userDisplayMessage] : []),
  ]
  return chalk.dim('Compacted ' + dimmed.join('\n'))
}
async function getCacheSharingParams(
  context: ToolUseContext,
  forkContextMessages: Message[],
): Promise<{
  systemPrompt: SystemPrompt
  userContext: { [k: string]: string }
  systemContext: { [k: string]: string }
  toolUseContext: ToolUseContext
  forkContextMessages: Message[]
}> {
  const appState = context.getAppState()
  const defaultSysPrompt = await getSystemPrompt(
    context.options.tools,
    context.options.mainLoopModel,
    Array.from(
      []
    ),
    context.options.mcpClients,
  )
  const systemPrompt = buildEffectiveSystemPrompt({
    toolUseContext: context,
    customSystemPrompt: context.options.customSystemPrompt,
    defaultSystemPrompt: defaultSysPrompt,
    appendSystemPrompt: context.options.appendSystemPrompt,
  })
  const [userContext, systemContext] = await Promise.all([
    getUserContext(),
    getSystemContext(),
  ])
  return {
    systemPrompt,
    userContext,
    systemContext,
    toolUseContext: context,
    forkContextMessages,
  }
}