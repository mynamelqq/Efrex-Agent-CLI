import { feature } from 'bun:bundle'
import type {
  Base64ImageSource,
  ContentBlockParam,
  ImageBlockParam,
} from '@anthropic-ai/sdk/resources/messages.mjs'
import { processTextPrompt } from './processTextPrompt.js'
import { randomUUID } from 'crypto'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import { createAttachmentMessage } from '../messages.js'

import { getContentText } from '../messages.js'
import type { ToolUseContext } from '../../Tool.js'
import { LocalJSXCommandContext } from 'src/types/command.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  Message,
  ProgressMessage,
  SystemMessage,
  UserMessage,
} from 'src/package/message.js'
import type { PermissionMode } from '../../types/permissions.js'
import {
  isValidImagePaste,
  type QueuedCommand,
  type PromptInputMode,
} from '../../types/textInputTypes.js'
import type { PastedContent } from '../config.js'
import type { EffortValue } from '../effort.js'
import { toArray } from '../generators.js'
import {
  createUserMessage,
} from '../messages.js'
import { getCommandName } from 'src/types/command.js'
export type ProcessUserInputContext = ToolUseContext & LocalJSXCommandContext

export type ProcessUserInputBaseResult = {
  messages: (
    | UserMessage
    | AssistantMessage
    | AttachmentMessage
    | SystemMessage
    | ProgressMessage
  )[]
  shouldQuery: boolean
  allowedTools?: string[]
  model?: string
  effort?: EffortValue
  // Output text for non-interactive mode (e.g., forked commands)
  // When set, this is used as the result in -p mode instead of empty string
  resultText?: string
  // When set, prefills or submits the next input after command completes
  // Used by /discover to chain into the selected feature's command
  nextInput?: string
  submitNextInput?: boolean
  // When true, the command started detached work that will finalize its
  // autonomy run after the background work completes.
  deferAutonomyCompletion?: boolean
}
export async function processUserInput({
  input,
  preExpansionInput,
  mode,
  context,
  pastedContents,
  messages,
  uuid,
  isAlreadyProcessing,
  canUseTool,
  skipSlashCommands,
  bridgeOrigin,
  isMeta,
  skipAttachments,
  autonomy,
}: {
  input: string | Array<ContentBlockParam>
  /**
   * Input before [Pasted text #N] expansion. Used for ultraplan keyword
   * detection so pasted content containing the word cannot trigger. Falls
   * back to the string `input` when unset.
   */
  preExpansionInput?: string
  mode: PromptInputMode
  context: ProcessUserInputContext
  pastedContents?: Record<number, PastedContent>
  messages?: Message[]
  uuid?: string
  isAlreadyProcessing?: boolean
  canUseTool?: CanUseToolFn
  /**
   * When true, input starting with `/` is treated as plain text.
   * Used for remotely-received messages (bridge/CCR) that should not
   * trigger local slash commands or skills.
   */
  skipSlashCommands?: boolean
  /**
   * When true, slash commands matching isBridgeSafeCommand() execute even
   * though skipSlashCommands is set. See QueuedCommand.bridgeOrigin.
   */
  bridgeOrigin?: boolean
  /**
   * When true, the resulting UserMessage gets `isMeta: true` (user-hidden,
   * model-visible). Propagated from `QueuedCommand.isMeta` for queued
   * system-generated prompts.
   */
  isMeta?: boolean
  skipAttachments?: boolean
  autonomy?: QueuedCommand['autonomy']
}): Promise<ProcessUserInputBaseResult> {
  const inputString = typeof input === 'string' ? input : null
  // Immediately show the user input prompt while we are still processing the input.
  // Skip for isMeta (system-generated prompts like scheduled tasks) — those
  // should run invisibly.
//   if (mode === 'prompt' && inputString !== null && !isMeta) {
//     setUserInputOnProcessing?.(inputString)
//   }


  const appState = context.getAppState()

  const result = await processUserInputBase(
    input,
    mode,
    context,
    pastedContents,
    messages,
    uuid,
    isAlreadyProcessing,
    canUseTool,
    appState.toolPermissionContext.mode,
    skipSlashCommands,
    bridgeOrigin,
    isMeta,
    skipAttachments,
    )

  if (!result.shouldQuery) {
    return result
  }

  const inputMessage = getContentText(input) || ''



  // Happy path: onQuery will clear userInputOnProcessing via startTransition
  // so it resolves in the same frame as deferredMessages (no flicker gap).
  // Error paths are handled by handlePromptSubmit's finally block.
  return result
}

const MAX_HOOK_OUTPUT_LENGTH = 10000

function applyTruncation(content: string): string {
  if (content.length > MAX_HOOK_OUTPUT_LENGTH) {
    return `${content.substring(0, MAX_HOOK_OUTPUT_LENGTH)}… [output truncated - exceeded ${MAX_HOOK_OUTPUT_LENGTH} characters]`
  }
  return content
}

async function processUserInputBase(
  input: string | Array<ContentBlockParam>,
  mode: PromptInputMode,
  context: ProcessUserInputContext,
  pastedContents?: Record<number, PastedContent>,
  messages?: Message[],
  uuid?: string,
  isAlreadyProcessing?: boolean,
  canUseTool?: CanUseToolFn,
  permissionMode?: PermissionMode,
  skipSlashCommands?: boolean,
  bridgeOrigin?: boolean,
  isMeta?: boolean,
  skipAttachments?: boolean,
  autonomy?: QueuedCommand['autonomy'],
): Promise<ProcessUserInputBaseResult> {
  let inputString: string | null = null
  let precedingInputBlocks: ContentBlockParam[] = []
  // Collect image metadata texts for isMeta message
  const imageMetadataTexts: string[] = []

  // Normalized view of `input` with image blocks resized. For string input
  // this is just `input`; for array input it's the processed blocks. We pass
  // this (not raw `input`) to processTextPrompt so resized/normalized image
  // blocks actually reach the API — otherwise the resize work above is
  // discarded for the regular prompt path. Also normalizes bridge inputs
  // where iOS may send `mediaType` instead of `media_type` (mobile-apps#5825).
  let normalizedInput: string | ContentBlockParam[] = input

  if (typeof input === 'string') {
    inputString = input//是字符串直接赋值
  } else if (input.length > 0) {//数组
    const processedBlocks: ContentBlockParam[] = []
    for (const block of input) {//直接加到数组里去
        processedBlocks.push(block)
    }
    normalizedInput = processedBlocks
    // Extract the input string from the last content block if it is text,
    // and keep track of the preceding content blocks
    const lastBlock = processedBlocks[processedBlocks.length - 1]//检查最后一块 
    if (lastBlock?.type === 'text') {
      inputString = lastBlock.text//如果是text那就赋值输入字符串InputString
      precedingInputBlocks = processedBlocks.slice(0, -1)
    } else {
      precedingInputBlocks = processedBlocks
    }
  }

  if (inputString === null && mode !== 'prompt') {
    throw new Error(`Mode: ${mode} requires a string input.`)
  }

  // with a helpful message rather than letting the model see raw "/config".
  let effectiveSkipSlash = skipSlashCommands
  // Bash commands
//   if (inputString !== null && mode === 'bash') {
//     const { processBashCommand } = await import('./processBashCommand.js')
//     return addImageMetadataMessage(
//       await processBashCommand(
//         inputString,
//         precedingInputBlocks,
//         context,
//       ),
//       imageMetadataTexts,
//     )
//   }

  // Slash commands
  // Skip for remote bridge messages — input from CCR clients is plain text
//   if (
//     inputString !== null &&
//     !effectiveSkipSlash &&
//     inputString.startsWith('/')
//   ) {
//     const { processSlashCommand } = await import('./processSlashCommand.js')
//     const slashResult = await processSlashCommand(
//       inputString,
//       precedingInputBlocks,
//       context,
//       uuid,
//       isAlreadyProcessing,
//       canUseTool,
//       autonomy,
//     )
//     return addImageMetadataMessage(slashResult, imageMetadataTexts)
//   }


  // Regular user prompt正常用户输入
  return addImageMetadataMessage(
    processTextPrompt(
      normalizedInput,
      uuid,
      permissionMode,
    ),
    imageMetadataTexts,
  )
}

// Adds image metadata texts as isMeta message to result
function addImageMetadataMessage(
  result: ProcessUserInputBaseResult,
  imageMetadataTexts: string[],
): ProcessUserInputBaseResult {
  if (imageMetadataTexts.length > 0) {
    result.messages.push(
      createUserMessage({
        content: imageMetadataTexts.map(text => ({ type: 'text', text })),
        isMeta: true,
      }),
    )
  }
  return result
}
