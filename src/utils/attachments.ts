import { Message } from "execa"
import { IDESelection } from "src/hooks/useIdeSelection"
import { AttachmentMessage } from "src/package/message"
import { QuerySource } from "src/services/compact/querySource"
import { ToolUseContext } from "src/Tool"
import { QueuedCommand } from "src/types/textInputTypes"
import { createAttachmentMessage } from "./messages"
import { logError } from "./log"
import { truncate } from "lodash"
import { dirname, parse, relative, resolve } from 'path'
import { logAntError } from "./debug"
import { createAbortController } from "./abortController"
import { MCPServerConnection } from "packages/mcp-client/src"
import { isSupportedTerminal, toIDEDisplayName } from "./ide"
import { envDynamic } from "./envDynamic"
import { getCwd } from "./cwd"
import { countCharInString } from "./stringUtils"

import {
  FileReadTool,
  MaxFileReadTokenExceededError,
  type Output as FileReadToolOutput,
  readImageWithTokenBudget,
} from 'src/tools/FileReadTool/FileReadTool.js'
import { isFileWithinReadSizeLimit } from "./file"
import { getDefaultFileReadingLimits } from "src/tools/FileReadTool/limits"
import { isPDFExtension } from "./pdfUtils"
import { stat } from "fs/promises"
import { MAX_LINES_TO_READ } from "src/tools/FileReadTool/prompt"
import { FileTooLargeError } from "./readFileInRange"
export type Attachment =
  /**
   * User at-mentioned the file
   */
  | FileAttachment
  | CompactFileReferenceAttachment
  | PDFReferenceAttachment
  | AlreadyReadFileAttachment
  /**
   * An at-mentioned file was edited
   */
  | {
      type: 'edited_text_file'
      filename: string
      snippet: string
    }
  // | {
  //     type: 'edited_image_file'
  //     filename: string
  //     content: FileReadToolOutput
  //   }
  | {
      type: 'directory'
      path: string
      content: string
      /** Path relative to CWD at creation time, for stable display */
      displayPath: string
    }
  | {
      type: 'selected_lines_in_ide'
      ideName: string
      lineStart: number
      lineEnd: number
      filename: string
      content: string
      /** Path relative to CWD at creation time, for stable display */
      displayPath: string
    }
  | {
      type: 'opened_file_in_ide'
      filename: string
    }
  // | {
  //     type: 'todo_reminder'
  //     content: TodoList
  //     itemCount: number
  //   }
  // | {
  //     type: 'task_reminder'
  //     content: Task[]
  //     itemCount: number
  //   }
  // | {
  //     type: 'nested_memory'
  //     path: string
  //     content: MemoryFileInfo
  //     /** Path relative to CWD at creation time, for stable display */
  //     displayPath: string
  //   }
  | {
      type: 'relevant_memories'
      memories: {
        path: string
        content: string
        mtimeMs: number
        /**
         * Pre-computed header string (age + path prefix).  Computed once
         * at attachment-creation time so the rendered bytes are stable
         * across turns — recomputing memoryAge(mtimeMs) at render time
         * calls Date.now(), so "saved 3 days ago" becomes "saved 4 days
         * ago" across turns → different bytes → prompt cache bust.
         * Optional for backward compat with resumed sessions; render
         * path falls back to recomputing if missing.
         */
        header?: string
        /**
         * lineCount when the file was truncated by readMemoriesForSurfacing,
         * else undefined. Threaded to the readFileState write so
         * getChangedFiles skips truncated memories (partial content would
         * yield a misleading diff).
         */
        limit?: number
      }[]
    }
  | {
      type: 'dynamic_skill'
      skillDir: string
      skillNames: string[]
      /** Path relative to CWD at creation time, for stable display */
      displayPath: string
    }
  | {
      type: 'skill_listing'
      content: string
      skillCount: number
      isInitial: boolean
    }
  // | {
  //     type: 'skill_discovery'
  //     skills: {
  //       name: string
  //       description: string
  //       shortId?: string
  //       score?: number
  //       autoLoaded?: boolean
  //       content?: string
  //       path?: string
  //     }[]
  //     signal: DiscoverySignal
  //     source: 'native' | 'aki' | 'both'
  //     gap?: {
  //       key: string
  //       status: 'pending' | 'draft' | 'active'
  //       draftName?: string
  //       draftPath?: string
  //       activeName?: string
  //       activePath?: string
  //     }
  //   }
  // | {
  //     type: 'queued_command'
  //     prompt: string | Array<ContentBlockParam>
  //     source_uuid?: UUID
  //     imagePasteIds?: number[]
  //     /** Original queue mode — 'prompt' for user messages, 'task-notification' for system events */
  //     commandMode?: string
  //     /** Provenance carried from QueuedCommand so mid-turn drains preserve it */
  //     origin?: MessageOrigin
  //     /** Carried from QueuedCommand.isMeta — distinguishes human-typed from system-injected */
  //     isMeta?: boolean
  //   }
  | {
      type: 'output_style'
      style: string
    }
  // | {
  //     type: 'diagnostics'
  //     files: DiagnosticFile[]
  //     isNew: boolean
  //   }
  | {
      type: 'plan_mode'
      reminderType: 'full' | 'sparse'
      isSubAgent?: boolean
      planFilePath: string
      planExists: boolean
    }
  | {
      type: 'plan_mode_reentry'
      planFilePath: string
    }
  | {
      type: 'plan_mode_exit'
      planFilePath: string
      planExists: boolean
    }
  | {
      type: 'auto_mode'
      reminderType: 'full' | 'sparse'
    }
  | {
      type: 'auto_mode_exit'
    }
  | {
      type: 'critical_system_reminder'
      content: string
    }
  | {
      type: 'plan_file_reference'
      planFilePath: string
      planContent: string
    }
  // | {
  //     type: 'mcp_resource'
  //     server: string
  //     uri: string
  //     name: string
  //     description?: string
  //     content: ReadResourceResult
  //   }
  | {
      type: 'command_permissions'
      allowedTools: string[]
      model?: string
    }
  // | AgentMentionAttachment
  // | {
  //     type: 'task_status'
  //     taskId: string
  //     taskType: TaskType
  //     status: TaskStatus
  //     description: string
  //     deltaSummary: string | null
  //     outputFilePath?: string
  //   }
  // | AsyncHookResponseAttachment
  // | {
  //     type: 'token_usage'
  //     used: number
  //     total: number
  //     remaining: number
  //   }
  | {
      type: 'budget_usd'
      used: number
      total: number
      remaining: number
    }
  | {
      type: 'output_token_usage'
      turn: number
      session: number
      budget: number | null
    }
  | {
      type: 'structured_output'
      data: unknown
    }
  // | TeammateMailboxAttachment
  // | TeamContextAttachment
  // | HookAttachment
  | {
      type: 'invoked_skills'
      skills: Array<{
        name: string
        path: string
        content: string
      }>
    }
  | {
      type: 'verify_plan_reminder'
    }
  | {
      type: 'max_turns_reached'
      maxTurns: number
      turnCount: number
    }
  | {
      type: 'current_session_memory'
      content: string
      path: string
      tokenCount: number
    }
  | {
      type: 'teammate_shutdown_batch'
      count: number
    }
  | {
      type: 'compaction_reminder'
    }
  | {
      type: 'context_efficiency'
    }
  | {
      type: 'date_change'
      newDate: string
    }
  | {
      type: 'ultrathink_effort'
      level: 'high'
    }
  | {
      type: 'deferred_tools_delta'
      addedNames: string[]
      addedLines: string[]
      removedNames: string[]
    }
  | {
      type: 'agent_listing_delta'
      addedTypes: string[]
      addedLines: string[]
      removedTypes: string[]
      /** True when this is the first announcement in the conversation */
      isInitial: boolean
      /** Whether to include the "launch multiple agents concurrently" note (non-pro subscriptions) */
      showConcurrencyNote: boolean
    }
  | {
      type: 'mcp_instructions_delta'
      addedNames: string[]
      addedBlocks: string[]
      removedNames: string[]
    }
  | {
      type: 'companion_intro'
      name: string
      species: string
    }
  | {
      type: 'bagel_console'
      errorCount: number
      warningCount: number
      sample: string
    }
export type FileAttachment = {
  type: 'file'
  filename: string
  content: FileReadToolOutput
  /**
   * Whether the file was truncated due to size limits
   */
  truncated?: boolean
  /** Path relative to CWD at creation time, for stable display */
  displayPath: string
}

export type CompactFileReferenceAttachment = {
  type: 'compact_file_reference'
  filename: string
  /** Path relative to CWD at creation time, for stable display */
  displayPath: string
}

export type PDFReferenceAttachment = {
  type: 'pdf_reference'
  filename: string
  pageCount: number
  fileSize: number
  /** Path relative to CWD at creation time, for stable display */
  displayPath: string
}

export type AlreadyReadFileAttachment = {
  type: 'already_read_file'
  filename: string
  content: FileReadToolOutput
  /**
   * Whether the file was truncated due to size limits
   */
  truncated?: boolean
  /** Path relative to CWD at creation time, for stable display */
  displayPath: string
}

export type AgentMentionAttachment = {
  type: 'agent_mention'
  agentType: string
}


/**
 * This is janky
 * TODO: Generate attachments when we create messages
 */
export async function getAttachments(
  input: string | null,
  toolUseContext: ToolUseContext,
  ideSelection: IDESelection | null,
  queuedCommands: QueuedCommand[],
  messages?: Message[],
  querySource?: QuerySource,
  options?: { skipSkillDiscovery?: boolean },
): Promise<Attachment[]> {

  // This will slow down submissions
  // TODO: Compute attachments as the user types, not here (though we use this
  // function for slash command prompts too)
  const abortController = createAbortController()
  const timeoutId = setTimeout(ac => ac.abort(), 1000, abortController)
  const context = { ...toolUseContext, abortController }

  const isMainThread = true


  // Process user input attachments first (includes @mentioned files)
  // This ensures files are added to nestedMemoryAttachmentTriggers before nested_memory processes them
  const userAttachmentResults = await Promise.all([])

  // Thread-safe attachments available in sub-agents
  // NOTE: These must be created AFTER userInputAttachments completes to ensure
  // nestedMemoryAttachmentTriggers is populated before getNestedMemoryAttachments runs
  // const allThreadAttachments = [
    // queuedCommands is already agent-scoped by the drain gate in query.ts —
    // main thread gets agentId===undefined, subagents get their own agentId.
    // Must run for all threads or subagent notifications drain into the void
    // (removed from queue by removeFromQueue but never attached).    
    // maybe('changed_files', () => getChangedFiles(context)),
  

  // ]

  // Attachments which are semantically only for the main conversation or don't have concurrency-safe implementations
  const mainThreadAttachments =  [
        maybe('ide_selection', async () =>
          getSelectedLinesFromIDE(ideSelection, toolUseContext),
        ),

      ]


  // Process thread and main thread attachments in parallel (no dependencies between them)
  const [threadAttachmentResults] =
    await Promise.all([
      // Promise.all(allThreadAttachments),
      Promise.all(mainThreadAttachments),
    ])

  clearTimeout(timeoutId)
  // Defensive: a getter leaking [undefined] crashes .map(a => a.type) below.
  return (
    [
      ...userAttachmentResults.flat(),
      ...threadAttachmentResults.flat(),
      // ...mainThreadAttachmentResults.flat(),
    ] as Attachment[]
  ).filter(a => a !== undefined && a !== null)
}
async function maybe<A>(label: string, f: () => Promise<A[]>): Promise<A[]> {//异步包装函数，用于执行可能失败的异步操作（特别是获取附件数据）
  const startTime = Date.now()
  try {
    const result = await f()
    const duration = Date.now() - startTime
    // Log only 5% of events to reduce volume
    if (Math.random() < 0.05) {
      // jsonStringify(undefined) returns undefined, so .length would throw
      const attachmentSizeBytes = result
        .filter(a => a !== undefined && a !== null)
        .reduce((total, attachment) => {
          return total + JSON.stringify(attachment).length
        }, 0)
    }
    return result
  } catch (e) {
    const duration = Date.now() - startTime
    // Log only 5% of events to reduce volume
    if (Math.random() < 0.05) {
    
    }
    logError(e)
    // For Ant users, log the full error to help with debugging
    logAntError(`Attachment error in ${label}`, e)

    return []
  }
}
export async function generateFileAttachment(
  filename: string,
  toolUseContext: ToolUseContext,
  successEventName: string,
  errorEventName: string,
  mode: 'compact' | 'at-mention',
  options?: {
    offset?: number
    limit?: number
  },
): Promise<
  | FileAttachment
  | CompactFileReferenceAttachment
  | PDFReferenceAttachment
  | AlreadyReadFileAttachment
  | null
> {
  const { offset, limit } = options ?? {}

  // Check if file has a deny rule configured
  const appState = toolUseContext.getAppState()
  // if (isFileReadDenied(filename, appState.toolPermissionContext)) {
  //   return null
  // }

  // Check file size before attempting to read (skip for PDFs — they have their own size/page handling below)
  if (
    mode === 'at-mention' &&
    !isFileWithinReadSizeLimit(
      filename,
      getDefaultFileReadingLimits().maxSizeBytes,
    )
  ) {
    const ext = parse(filename).ext.toLowerCase()
    if (!isPDFExtension(ext)) {
      try {
        const stats = await stat(filename)
        return null
      } catch {
        // If we can't stat the file, proceed with normal reading (will fail later if file doesn't exist)
      }
    }
  }

  // For large PDFs on @ mention, return a lightweight reference instead of inlining
  // if (mode === 'at-mention') {
  //   const pdfRef = await tryGetPDFReference(filename)
  //   if (pdfRef) {
  //     return pdfRef
  //   }
  // }

  // // Check if file is already in context with latest version
  // const existingFileState = toolUseContext.readFileState.get(filename)
  // if (existingFileState && mode === 'at-mention') {
  //   try {
  //     // Check if the file has been modified since we last read it
  //     const mtimeMs = await getFileModificationTimeAsync(filename)

  //     // Handle timestamp format inconsistency:
  //     // - FileReadTool stores Date.now() (current time when read)
  //     // - FileEdit/WriteTools store mtimeMs (file modification time)
  //     //
  //     // If timestamp > mtimeMs, it was stored by FileReadTool using Date.now()
  //     // In this case, we should not use the optimization since we can't reliably
  //     // compare modification times. Only use optimization when timestamp <= mtimeMs,
  //     // indicating it was stored by FileEdit/WriteTool with actual mtimeMs.

  //     if (
  //       existingFileState.timestamp <= mtimeMs &&
  //       mtimeMs === existingFileState.timestamp
  //     ) {
  //       // File hasn't been modified, return already_read_file attachment
  //       // This tells the system the file is already in context and doesn't need to be sent to API
  //       return {
  //         type: 'already_read_file',
  //         filename,
  //         displayPath: relative(getCwd(), filename),
  //         content: {
  //           type: 'text',
  //           file: {
  //             filePath: filename,
  //             content: existingFileState.content,
  //             numLines: countCharInString(existingFileState.content, '\n') + 1,
  //             startLine: offset ?? 1,
  //             totalLines:
  //               countCharInString(existingFileState.content, '\n') + 1,
  //           },
  //         },
  //       }
  //     }
  //   } catch {
  //     // If we can't stat the file, proceed with normal reading
  //   }
  // }

  try {
    const fileInput = {
      file_path: filename,
      offset,
      limit,
    }

    async function readTruncatedFile(): Promise<
      | FileAttachment
      | CompactFileReferenceAttachment
      | AlreadyReadFileAttachment
      | null
    > {
      if (mode === 'compact') {
        return {
          type: 'compact_file_reference',
          filename,
          displayPath: relative(getCwd(), filename),
        }
      }

      // Check deny rules before reading truncated file
      const appState = toolUseContext.getAppState()
      // if (isFileReadDenied(filename, appState.toolPermissionContext)) {
      //   return null
      // }

      try {
        // Read only the first MAX_LINES_TO_READ lines for files that are too large
        const truncatedInput = {
          file_path: filename,
          offset: offset ?? 1,
          limit: MAX_LINES_TO_READ,
        }
        const result = await FileReadTool.call(truncatedInput, toolUseContext)

        return {
          type: 'file' as const,
          filename,
          content: result.data,
          truncated: true,
          displayPath: relative(getCwd(), filename),
        }
      } catch {
        return null
      }
    }

    // Validate file path is valid
    const validateInput = FileReadTool.validateInput
    if (!validateInput) {
      return null
    }

    const isValid = await validateInput(fileInput, toolUseContext)
    if (!isValid.result) {
      return null
    }

    try {
      const result = await FileReadTool.call(fileInput, toolUseContext)
      return {
        type: 'file',
        filename,
        content: result.data,
        displayPath: relative(getCwd(), filename),
      }
    } catch (error) {
      if (
        error instanceof MaxFileReadTokenExceededError ||
        error instanceof FileTooLargeError
      ) {
        return await readTruncatedFile()
      }
      throw error
    }
  } catch {
    return null
  }
}

export async function* getAttachmentMessages(
  input: string | null,
  toolUseContext: ToolUseContext,
  ideSelection: IDESelection | null,
  queuedCommands: QueuedCommand[],
  messages?: Message[],
  querySource?: QuerySource,
  options?: { skipSkillDiscovery?: boolean },
): AsyncGenerator<AttachmentMessage, void> {
  // TODO: Compute this upstream
  const attachments = await getAttachments(
    input,
    toolUseContext,
    ideSelection,
    queuedCommands,
    messages,
    querySource,
    options,
  )

  if (attachments.length === 0) {
    return
  }

  

  for (const attachment of attachments) {
    yield createAttachmentMessage(attachment)
  }
}
export function getConnectedIdeName(
  mcpClients: MCPServerConnection[],
): string | null {
  const ideClient = mcpClients.find(
    client => client.type === 'connected' && client.name === 'ide',
  )
  return getIdeClientName(ideClient)
}
export function getIdeClientName(
  ideClient?: MCPServerConnection,
): string | null {
  const config = ideClient?.config
  return config?.type === 'sse-ide' || config?.type === 'ws-ide'
    ? config.ideName
    : isSupportedTerminal()
      ? toIDEDisplayName(envDynamic.terminal)
      : null
}
async function getSelectedLinesFromIDE(
  ideSelection: IDESelection | null,
  toolUseContext: ToolUseContext,
): Promise<Attachment[]> {
  const ideName = getConnectedIdeName(toolUseContext.options.mcpClients)
  if (
    !ideName ||
    ideSelection?.lineStart === undefined ||
    !ideSelection.text ||
    !ideSelection.filePath
  ) {
    return []
  }

  const appState = toolUseContext.getAppState()

  return [
    {
      type: 'selected_lines_in_ide',
      ideName,
      lineStart: ideSelection.lineStart,
      lineEnd: ideSelection.lineStart + ideSelection.lineCount - 1,
      filename: ideSelection.filePath,
      content: ideSelection.text,
      displayPath: relative(getCwd(), ideSelection.filePath),
    },
  ]
}
