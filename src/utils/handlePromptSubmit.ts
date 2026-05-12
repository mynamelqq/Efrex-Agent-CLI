import type { Message } from '../package/message.js'
import { createAbortController } from './abortController.js'
import { logForDebugging } from './debug.js'
import { executeUserInput } from './executeUserInput.js'
import { logError } from './logger.js'
export async function handlePromptSubmit({
  text,
  setAbortController,
  getCurrentModel,
  onQuery,
}: {
  text: string
  setAbortController: (value: AbortController | null) => void
  getCurrentModel: () => string
  onQuery: (
    newMessages: Message[],
    abortController: AbortController,
    shouldQuery: boolean,
    additionalAllowedTools: string[],
    mainLoopModelParam: string,
  ) => Promise<void>
}): Promise<void> {
  const abortController = createAbortController()
  setAbortController(abortController)
  logForDebugging('User submitted prompt:', text)
  try {
    await executeUserInput({
      text,
      abortController,
      getCurrentModel,
      onQuery,
    })
  } finally {
    setAbortController(null)
  }
}
