import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import type { ToolUseConfirm } from '../../components/permissions/PermissionRequest.js'
import type {
  ToolPermissionContext,
  Tool as ToolType,
  ToolUseContext,
} from '../../Tool.js'
import { persistPermissionUpdates } from 'src/utils/permissions/PermissionUpdate.js'
import { BASH_TOOL_NAME } from 'src/tools/BashTool/toolName.js'
import type { AssistantMessage } from 'src/package/message.js'
import type {
  PendingClassifierCheck,
  PermissionAllowDecision,
  PermissionDecisionReason,
  PermissionDenyDecision,
} from '../../types/permissions.js'
import { logForDebugging } from '../../utils/debug.js'
import {
  REJECT_MESSAGE,

} from '../../utils/messages.js'
import { PermissionUpdate,PermissionDecision } from '../../types/permissions.js'
type PermissionApprovalSource =
  | { type: 'hook'; permanent?: boolean }
  | { type: 'user'; permanent: boolean }
  | { type: 'classifier' }

type PermissionRejectionSource =
  | { type: 'hook' }
  | { type: 'user_abort' }
  | { type: 'user_reject'; hasFeedback: boolean }

// 用于权限队列操作的通用接口，与 React 无关。// 在 REPL 中，这些功能由 React 状态来支持。
type PermissionQueueOps = {
  push(item: ToolUseConfirm): void
  remove(toolUseID: string): void
  update(toolUseID: string, patch: Partial<ToolUseConfirm>): void
}
function createPermissionContext(//权限上下文
  tool: ToolType,
  input: Record<string, unknown>,
  toolUseContext: ToolUseContext,
  assistantMessage: AssistantMessage,
  toolUseID: string,
  setToolPermissionContext: (context: ToolPermissionContext) => void,
  queueOps?: PermissionQueueOps,
) {
  const messageId = assistantMessage.message.id!
  const ctx = {
    tool,
    input,
    toolUseContext,
    assistantMessage,
    messageId,
    toolUseID,
    // logDecision(
    //   args: PermissionDecisionArgs,
    //   opts?: {
    //     input?: Record<string, unknown>
    //     permissionPromptStartTimeMs?: number
    //   },
    // ) {
    // },
    logCancelled() {

    },
    async persistPermissions(updates: PermissionUpdate[]) {
      if (updates.length === 0) return false
      persistPermissionUpdates(updates)//持久化权限文件
      const appState = toolUseContext.getAppState()
      // setToolPermissionContext(//设置上下文
        // applyPermissionUpdates(appState.toolPermissionContext, updates),
      // )
      return true
    },
    resolveIfAborted(resolve: (decision: PermissionDecision) => void) {
      if (!toolUseContext.abortController.signal.aborted) return false
      this.logCancelled()
      resolve(this.cancelAndAbort(undefined, true))
      return true
    },
    cancelAndAbort(
      feedback?: string,
      isAbort?: boolean,
      contentBlocks?: ContentBlockParam[],
    ): PermissionDecision {
      const message =  feedback as string
      if (isAbort || (!feedback && !contentBlocks?.length)) {
        logForDebugging(
          `Aborting: tool=${tool.name} isAbort=${isAbort} hasFeedback=${!!feedback}`,
        )
        toolUseContext.abortController.abort()
      }
      return { behavior: 'ask', message, contentBlocks }
    },
    buildAllow(
      updatedInput: Record<string, unknown>,
      opts?: {
        userModified?: boolean
        decisionReason?: PermissionDecisionReason
        acceptFeedback?: string
        contentBlocks?: ContentBlockParam[]
      },
    ): PermissionAllowDecision {
      return {
        behavior: 'allow' as const,
        updatedInput,
        userModified: opts?.userModified ?? false,
        ...(opts?.decisionReason && { decisionReason: opts.decisionReason }),
        ...(opts?.acceptFeedback && { acceptFeedback: opts.acceptFeedback }),
        ...(opts?.contentBlocks &&
          opts.contentBlocks.length > 0 && {
            contentBlocks: opts.contentBlocks,
          }),
      }
    },
    buildDeny(
      message: string,
      decisionReason: PermissionDecisionReason,
    ): PermissionDenyDecision {
      return { behavior: 'deny' as const, message, decisionReason }
    },
    async handleUserAllow(
      updatedInput: Record<string, unknown>,
      permissionUpdates: PermissionUpdate[],
      feedback?: string,
      permissionPromptStartTimeMs?: number,
      contentBlocks?: ContentBlockParam[],
      decisionReason?: PermissionDecisionReason,
    ): Promise<PermissionAllowDecision> {
      const acceptedPermanentUpdates =
        await this.persistPermissions(permissionUpdates)
      const userModified = tool.inputsEquivalent
        ? !tool.inputsEquivalent(input, updatedInput)
        : false
      const trimmedFeedback = feedback?.trim()
      return this.buildAllow(updatedInput, {
        userModified,
        decisionReason,
        acceptFeedback: trimmedFeedback || undefined,
        contentBlocks,
      })
    },
    pushToQueue(item: ToolUseConfirm) {
      queueOps?.push(item)
    },
    removeFromQueue() {
      queueOps?.remove(toolUseID)
    },
    updateQueueItem(patch: Partial<ToolUseConfirm>) {
      queueOps?.update(toolUseID, patch)
    },
  }
  return Object.freeze(ctx)
}

type PermissionContext = ReturnType<typeof createPermissionContext>

/** * 创建一个由 React 状态设置器支持的权限队列操作类。 
  这是连接 React 的 `setToolUseConfirmQueue` 方法与权限上下文所使用的通用队列接口的桥梁。 */
function createPermissionQueueOps(
  setToolUseConfirmQueue: React.Dispatch<
    React.SetStateAction<ToolUseConfirm[]>
  >,
): PermissionQueueOps {
  return {
    push(item: ToolUseConfirm) {
      setToolUseConfirmQueue(queue => [...queue, item])
    },
    remove(toolUseID: string) {
      setToolUseConfirmQueue(queue =>
        queue.filter(item => item.toolUseID !== toolUseID),
      )
    },
    update(toolUseID: string, patch: Partial<ToolUseConfirm>) {
      setToolUseConfirmQueue(queue =>
        queue.map(item =>
          item.toolUseID === toolUseID ? { ...item, ...patch } : item,
        ),
      )
    },
  }
}

export { createPermissionContext, createPermissionQueueOps }
export type {
  PermissionContext,
  PermissionApprovalSource,
  PermissionQueueOps,
  PermissionRejectionSource,
}
type ResolveOnce<T> = {
  resolve(value: T): void
  isResolved(): boolean
  /**
   * Atomically check-and-mark as resolved. Returns true if this caller
   * won the race (nobody else has resolved yet), false otherwise.
   * Use this in async callbacks BEFORE awaiting, to close the window
   * between the `isResolved()` check and the actual `resolve()` call.
   */
  claim(): boolean
}
export function createResolveOnce<T>(resolve: (value: T) => void): ResolveOnce<T> {
  let claimed = false
  let delivered = false
  return {
    resolve(value: T) {
      if (delivered) return
      delivered = true
      claimed = true
      resolve(value)
    },
    isResolved() {
      return claimed
    },
    claim() {
      if (claimed) return false
      claimed = true
      return true
    },
  }
}
