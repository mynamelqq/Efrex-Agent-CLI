import { feature } from 'bun:bundle'
import type {
  Base64ImageSource,
  ContentBlockParam,
  ImageBlockParam,
} from '@anthropic-ai/sdk/resources/messages.mjs'
import { storeImages } from '../imageStore.js'
import { processTextPrompt } from './processTextPrompt.js'
import { randomUUID } from 'crypto'

import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import { createAttachmentMessage } from '../messages.js'
import { createImageMetadataText,maybeResizeAndDownsampleImageBlock } from '../imageResizer.js'
import { getContentText } from '../messages.js'
import type { ToolUseContext } from '../../Tool.js'
import type { SetToolJSXFn } from '../../Tool.js'
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
import { IDESelection } from 'src/hooks/useIdeSelection.js'
import { getAttachmentMessages } from '../attachments.js'
import QueryApp from 'src/QueryApp.js'
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
  setToolJSX,
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
  ideSelection
}: {
  input: string | Array<ContentBlockParam>
  /**
   * Input before [Pasted text #N] expansion. Used for ultraplan keyword
   * detection so pasted content containing the word cannot trigger. Falls
   * back to the string `input` when unset.
   */
  preExpansionInput?: string
  mode: PromptInputMode
  setToolJSX: SetToolJSXFn
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
  ideSelection?: IDESelection
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
    setToolJSX,
    context,
    pastedContents,
    messages,
    uuid,
    isAlreadyProcessing,
    canUseTool,
    appState.toolPermissionContext.mode,
    ideSelection,
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
  setToolJSX: SetToolJSXFn,
  context: ProcessUserInputContext,
  pastedContents?: Record<number, PastedContent>,
  messages?: Message[],
  uuid?: string,
  isAlreadyProcessing?: boolean,
  canUseTool?: CanUseToolFn,
  permissionMode?: PermissionMode,
  ideSelection?: IDESelection,
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
      if (block.type === 'image') {
        const resized = await maybeResizeAndDownsampleImageBlock(block)
        // Collect image metadata for isMeta message
        if (resized.dimensions) {
          const metadataText = createImageMetadataText(resized.dimensions)
          if (metadataText) {
            imageMetadataTexts.push(metadataText)
          }
        }
        processedBlocks.push(resized.block)
      } else {
        processedBlocks.push(block)
      }
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
  // Collect results preserving order
  const imageContentBlocks: ContentBlockParam[] = []
  // Extract and convert image content to content blocks early
  // Keep track of IDs in order for message storage
  const imageContents = pastedContents
    ? Object.values(pastedContents).filter(isValidImagePaste)
    : []
  const imagePasteIds = imageContents.map(img => img.id)
  // Store images to disk so Claude can reference the path in context
  // (for manipulation with CLI tools, uploading to PRs, etc.)
  const storedImagePaths = pastedContents
    ? await storeImages(pastedContents)//保存引用的图片到磁盘
    : new Map<number, string>()
 const imageProcessingResults = await Promise.all(
    imageContents.map(async pastedImage => {
      const imageBlock: ImageBlockParam = {
        type: 'image',
        source: {
          type: 'base64',
          media_type: (pastedImage.mediaType ||
            'image/png') as Base64ImageSource['media_type'],
          data: pastedImage.content,
        },
      }

      const resized = await maybeResizeAndDownsampleImageBlock(imageBlock)
      return {
        resized,
        originalDimensions: pastedImage.dimensions,
        sourcePath:
          pastedImage.sourcePath ?? storedImagePaths.get(pastedImage.id),
      }
    }),
  )
   for (const {
    resized,
    originalDimensions,
    sourcePath,
  } of imageProcessingResults) {
    // Collect image metadata for isMeta message (prefer resized dimensions)
    if (resized.dimensions) {
      const metadataText = createImageMetadataText(
        resized.dimensions,
        sourcePath,
      )
      if (metadataText) {
        imageMetadataTexts.push(metadataText)
      }
    } else if (originalDimensions) {
      // Fall back to original dimensions if resize didn't provide them
      const metadataText = createImageMetadataText(
        originalDimensions,
        sourcePath,
      )
      if (metadataText) {
        imageMetadataTexts.push(metadataText)
      }
    } else if (sourcePath) {
      // If we have a source path but no dimensions, still add source info
      imageMetadataTexts.push(`[Image source: ${sourcePath}]`)
    }
    imageContentBlocks.push(resized.block)
  }
  
 
  // with a helpful message rather than letting the model see raw "/config".
  let effectiveSkipSlash = skipSlashCommands
     // For slash commands, attachments will be extracted within getMessagesForSlashCommand
  const shouldExtractAttachments =//是否应该包含附件
    !skipAttachments &&
    inputString !== null &&
    (mode !== 'prompt' || effectiveSkipSlash || !inputString.startsWith('/'))

  const attachmentMessages = shouldExtractAttachments//核心函数 获取所有的附件消息
    ? await toArray(
        getAttachmentMessages(
          inputString,
          context,
          ideSelection ?? null,
          [], // queuedCommands - handled by query.ts for mid-turn attachments
          messages,
        ),
      )
    : []
   // Slash commands
  // Skip for remote bridge messages — input from CCR clients is plain text
  if (
    inputString !== null &&
    !effectiveSkipSlash &&
    inputString.startsWith('/')
  ) {
    const { processSlashCommand } = await import('./processSlashCommand.js')
    const slashResult = await processSlashCommand(
      inputString,
      context,
      setToolJSX,
      precedingInputBlocks,
      uuid,
      isAlreadyProcessing,
      canUseTool,

    )
    return slashResult
  }

  // Bash commands
  if (inputString !== null && mode === 'bash') {
    const { processBashCommand } = await import('./processBashCommand.js')
    return addImageMetadataMessage(
      await processBashCommand(
        inputString,
        precedingInputBlocks,
        [],
        context,
        setToolJSX,
    ),
      imageMetadataTexts,
    )
  }

 


  // Regular user prompt正常用户输入
  return addImageMetadataMessage(
    processTextPrompt(
      normalizedInput,
      imageContentBlocks,
      attachmentMessages,
      imagePasteIds,
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
