import type { Message } from '../package/message.js'
import { createUserMessage } from './messages.js'

export async function executeUserInput({
  text,
  abortController,
  getCurrentModel,
  onQuery,
}: {
  text: string
  abortController: AbortController
  getCurrentModel: () => string
  onQuery: (
    newMessages: Message[],
    abortController: AbortController,
    shouldQuery: boolean,
    additionalAllowedTools: string[],
    mainLoopModelParam: string,
  ) => Promise<void>
}): Promise<void> {
  const userMessage = createUserMessage({ content: text })
  await onQuery([userMessage], abortController, true, [], getCurrentModel())
}
