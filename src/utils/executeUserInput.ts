import type { Message } from '../package/message.js'
// import {fileHistoryMake}
import { logForDebugging } from './debug.js'
import { createUserMessage } from './messages.js'
import { selectableUserMessagesFilter } from 'src/components/MessageSelector.js'
import { ToolUseContext } from 'src/Tool.js'
import { enqueue } from './messageQueueManager.js'
import { createAbortController } from './abortController.js'
import { fileHistoryEnabled, FileHistoryState, fileHistoryMakeSnapshot } from './fileHistory.js'
import { EffortValue } from './effort.js'
import { ExecuteUserInputParams } from "src/utils/handlePromptSubmit.js"
import { LocalJSXCommandContext } from 'src/types/command.js'
import { processUserInput } from './processUserInput/processUserInput.js'
export type ProcessUserInputContext = ToolUseContext & LocalJSXCommandContext

export async function executeUserInput(params: ExecuteUserInputParams): Promise<void> {
  const {
    messages,
    mainLoopModel,
    queryGuard,
    setAbortController,
    getToolUseContext,
    onQuery,
    setAppState,
    onBeforeQuery,
    queuedCommands,
    onInputChange,
    resetHistory
  } = params

  const abortController = createAbortController()
  params.setAbortController(abortController)

  function makeContext(): ProcessUserInputContext {
    return getToolUseContext(messages, [], abortController, mainLoopModel)
  }
  let turnError: unknown
  try {
    queryGuard.reserve()
    
    const newMessages: Message[] = []
    let shouldQuery = false
    let allowedTools: string[] | undefined
    let model: string | undefined
    let effort: EffortValue | undefined
    let nextInput: string | undefined
    let submitNextInput: boolean | undefined

    let commands = queuedCommands ?? []
    if (commands.length === 0) {
      setAbortController(null)
      return
    }

    

    try {
    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i]!
      const isFirst = i === 0
      
      const result = await processUserInput({//用户输入进入 query 之前的统一预处理/分流层
        input: cmd.value,
        preExpansionInput: cmd.preExpansionValue,
        mode: cmd.mode,
        context: makeContext(),
        pastedContents: isFirst ? cmd.pastedContents : undefined,
        messages,
        isAlreadyProcessing: !isFirst,
        uuid: cmd.uuid,
        skipSlashCommands: cmd.skipSlashCommands,
        bridgeOrigin: cmd.bridgeOrigin,
        isMeta: cmd.isMeta,
        skipAttachments: !isFirst,
        autonomy: cmd.autonomy,
      })

      const origin = cmd.origin ??
        (cmd.mode === 'task-notification'
          ? ({ kind: 'task-notification' } as const)
          : undefined)

      if (origin) {
        for (const m of result.messages) {
          if (m.type === 'user') m.origin = origin
        }
      }

      newMessages.push(...result.messages)

      if (isFirst) {
        shouldQuery = result.shouldQuery
        model = result.model
        effort = result.effort
        nextInput = result.nextInput
        submitNextInput = result.submitNextInput
      }
    }

    if (fileHistoryEnabled()) {
      newMessages.filter(selectableUserMessagesFilter).forEach(message => {
        void fileHistoryMakeSnapshot(
          (updater: (prev: FileHistoryState) => FileHistoryState) => {
            setAppState(prev => ({
              ...prev,
              fileHistory: updater(prev.fileHistory),
            }))
          },
          message.uuid,
        )
      })
    }

    if (newMessages.length) {
      resetHistory()
      const primaryCmd = commands[0]
      const primaryMode = primaryCmd?.mode ?? 'prompt'
      const primaryInput = primaryCmd && typeof primaryCmd.value === 'string'
        ? primaryCmd.value
        : undefined
      const shouldCallBeforeQuery = primaryMode === 'prompt'
      
      await onQuery(
        newMessages,
        abortController,
        shouldQuery,
        allowedTools ?? [],
        mainLoopModel,
      )
    } else {
      queryGuard.cancelReservation()
      resetHistory()
      setAbortController(null)
    }

    if (nextInput) {
      if (submitNextInput) {
        enqueue({ value: nextInput, mode: 'prompt' })
      } else {
        params.onInputChange(nextInput)
      }
    }

  } catch (error) {
      turnError = error
    } 
  if (turnError) {
    throw turnError
  }
  } finally {
    queryGuard.cancelReservation()
  }
}