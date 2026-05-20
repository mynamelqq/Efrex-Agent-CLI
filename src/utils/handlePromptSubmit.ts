import type { Message } from '../package/message.js'
import { createAbortController } from './abortController.js'
import { PastedContent } from './config.js'
import { QueryGuard } from './QueryGuard.js'
import { executeUserInput } from './executeUserInput.js'
import { enqueue } from './messageQueueManager.js'
import { Command } from 'src/types/command.js'
import { UUID } from 'crypto'
import type { ProcessUserInputContext } from './executeUserInput.js'
import { AppState } from 'src/state/AppStateStore.js'
import { QueuedCommand } from 'src/types/textInputTypes.js'
import { isValidImagePaste } from 'src/types/textInputTypes.js'
import { parseReferences, expandPastedTextRefs } from 'src/history.js'
type BaseExecutionParams = {
  queuedCommands?: QueuedCommand[]
  messages: Message[]//
  mainLoopModel: string//
  commands: Command[]//
  queryGuard: QueryGuard//
  getToolUseContext: (
    messages: Message[],
    newMessages: Message[],
    abortController: AbortController,
    mainLoopModel: string,
  ) => ProcessUserInputContext

  setAbortController: (abortController: AbortController | null) => void//
  onQuery: (
    newMessages: Message[],
    abortController: AbortController,
    shouldQuery: boolean,
    additionalAllowedTools: string[],
    mainLoopModel: string,
  ) => Promise<void>
  setAppState: (updater: (prev: AppState) => AppState) => void//
  onBeforeQuery?: (input: string, newMessages: Message[]) => Promise<boolean>
}
/**
 * Parameters for core execution logic (no UI concerns).
 */
export type ExecuteUserInputParams = BaseExecutionParams & {
  resetHistory: () => void
  onInputChange: (value: string) => void
}
export type PromptInputHelpers = {
  setCursorOffset: (offset: number) => void
  clearBuffer: () => void
  resetHistory: () => void
}
export type HandlePromptSubmitParams = BaseExecutionParams & {
  // Direct user input path (set when called from onSubmit, absent for queue processor)
  input?: string
  pastedContents?: Record<number, PastedContent>
  helpers?: PromptInputHelpers
  onInputChange: (value: string) => void
  setPastedContents: React.Dispatch<
    React.SetStateAction<Record<number, PastedContent>>
  >
  abortController?: AbortController | null
  addNotification?: (notification: {
    key: string
    text: string
    priority: 'low' | 'medium' | 'high' | 'immediate'
  }) => void
  setMessages?: (updater: (prev: Message[]) => Message[]) => void
  hasInterruptibleToolInProgress?: boolean
  uuid?: UUID
  /**
   * When true, input starting with `/` is treated as plain text.
   * Used for remotely-received messages (bridge/CCR) that should not
   * trigger local slash commands or skills.
   */
  skipSlashCommands?: boolean
  /** Preserves that the input originated from Remote Control when queued. */
  bridgeOrigin?: boolean
}

export async function handlePromptSubmit(
 params: HandlePromptSubmitParams)
: Promise<void> {
  const {
    input,
    queryGuard,
    commands,
    setPastedContents,
    messages,
    mainLoopModel,
    setAbortController,
    onQuery,
    setAppState,
    onBeforeQuery,
    queuedCommands,
    uuid,
    pastedContents,
    skipSlashCommands,
    bridgeOrigin,
    helpers,
    onInputChange,
    getToolUseContext
  } = params

  const setCursorOffset = helpers?.setCursorOffset ?? (() => {})
  const clearBuffer = helpers?.clearBuffer ?? (() => {})
  const resetHistory = helpers?.resetHistory ?? (() => {})
  const clearInput = onInputChange ?? (() => {})
  if (queuedCommands?.length) {
    await executeUserInput({
       queuedCommands,
      messages,
      mainLoopModel,
      commands,
      getToolUseContext,
      queryGuard,
      setAbortController,
      onQuery,
      setAppState,
      onBeforeQuery,
      onInputChange ,
      resetHistory
    })
    return
  }
  const text = params.input ?? ''
  const rawPastedContents = pastedContents ?? {}
  // Images are only sent if their [Image #N] placeholder is still in the text.
  // Deleting the inline pill drops the image; orphaned entries are filtered here.
  const referencedIds = new Set(parseReferences(text).map(r => r.id))

  const thePastedContents = Object.fromEntries(
    Object.entries(rawPastedContents).filter(
      ([, c]) => c.type !== 'image' || referencedIds.has(c.id),
    ),
  )
  const hasImages = Object.values(thePastedContents).some(isValidImagePaste)
  if (text.trim() === '') {
    return
  }
  
  // Parse references and replace with actual content early, before queueing
  // or immediate-command dispatch, so queued commands and immediate commands
  // both receive the expanded text from when it was submitted.
  const finalInput = expandPastedTextRefs(text, thePastedContents)
  const pastedTextRefs = parseReferences(text).filter(
    r => thePastedContents[r.id]?.type === 'text',
  )

  if (queryGuard.isActive ) {//如果query在运行

    if (params.hasInterruptibleToolInProgress) {
      params.abortController?.abort('interrupt')
    }

    // Enqueue with string value + raw pastedContents. Images will be resized
    // at execution time when processUserInput runs (not baked in here).
    enqueue({
      value: finalInput.trim(),
      preExpansionValue: text.trim(),
      mode:"prompt",
      pastedContents: hasImages ? pastedContents : undefined,
      skipSlashCommands,
      bridgeOrigin,
      uuid,
    })
    clearInput('')// 把当前输入内容清空（UI 上输入框变空）
    setCursorOffset(0)//光标位置重置到开头，避免残留在旧位置。
    setPastedContents({})
    resetHistory()//重置输入历史导航状态
    clearBuffer()//  清空底层输入缓冲
    return
  }

  // Construct a QueuedCommand from the direct user input so both paths
  // go through the same executeUserInput loop. This ensures images get
  // resized via processUserInput regardless of how the command arrives.
  
  const cmd: QueuedCommand = {
    value: finalInput,
    preExpansionValue: input,
    mode:'prompt',
    pastedContents: hasImages ? pastedContents : undefined,
    skipSlashCommands,
    bridgeOrigin,
    uuid,
  }
  await executeUserInput({
    queuedCommands: [cmd],
    messages,
    mainLoopModel,
    getToolUseContext,
    onInputChange,
    commands,
    queryGuard,
    setAbortController,
    onQuery,
    setAppState,
    resetHistory,
    onBeforeQuery,
  })
 
}
