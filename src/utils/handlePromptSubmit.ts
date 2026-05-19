import type { Message } from '../package/message.js'
import { createAbortController } from './abortController.js'
import { logForDebugging } from './debug.js'
import { PastedContent } from './config.js'
import { executeUserInput } from './executeUserInput.js'
import { logError } from './logger.js'
import { isValidImagePaste } from 'src/types/textInputTypes.js'
import { parseReferences,formatPastedTextRef,formatImageRef,expandPastedTextRefs } from 'src/history.js'
export async function handlePromptSubmit({
  text,
  setAbortController,
  getCurrentModel,
  setPastedContents,
  pastedContents,
  onQuery,
}: {
  text: string
  setAbortController: (value: AbortController | null) => void
  getCurrentModel: () => string
  pastedContents?: Record<number, PastedContent>
  setPastedContents: React.Dispatch<
    React.SetStateAction<Record<number, PastedContent>>
  >
  onQuery: (
    newMessages: Message[],
    abortController: AbortController,
    shouldQuery: boolean,
    additionalAllowedTools: string[],
    mainLoopModelParam: string,
  ) => Promise<void>
}): Promise<void> {

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

  const abortController = createAbortController()
  setAbortController(abortController)
  try {
    await executeUserInput({
      text:finalInput,
      abortController,
      getCurrentModel,
      onQuery,
    })
  } finally {
    setAbortController(null)
  }
}
