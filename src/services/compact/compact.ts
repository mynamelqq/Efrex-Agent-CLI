import { feature } from 'bun:bundle'
import type { UUID } from 'crypto'
import { APIUserAbortError } from '@anthropic-ai/sdk'
import type { QuerySource } from './querySource'
import type { Tool, ToolUseContext } from '../../Tool.js'
import { FileReadTool } from 'src/tools/FileReadTool/FileReadTool.js'
import {
  FILE_READ_TOOL_NAME,
  FILE_UNCHANGED_STUB,
} from 'src/tools/FileReadTool/prompt.js'
import type { AgentId } from '../../types/ids.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  Message,
  HookResultMessage,
  PartialCompactDirection,
  StreamEvent,
  SystemAPIErrorMessage,
  SystemCompactBoundaryMessage,
  SystemMessage,
  UserMessage,
} from 'src/package/message'

import { logForDebugging } from '../../utils/debug.js'
import { cacheToObject } from '../../utils/fileStateCache.js'
import { logError } from '../../utils/log.js'

import { expandPath } from '../../utils/path.js'






export const ERROR_MESSAGE_NOT_ENOUGH_MESSAGES =
  'Not enough messages to compact.'
const MAX_PTL_RETRIES = 3
const PTL_RETRY_MARKER = '[earlier conversation truncated for compaction retry]'

export const ERROR_MESSAGE_PROMPT_TOO_LONG =
  'Conversation too long. Press esc twice to go up a few messages and try again.'
export const ERROR_MESSAGE_USER_ABORT = 'API Error: Request was aborted.'
export const ERROR_MESSAGE_INCOMPLETE_RESPONSE =
  'Compaction interrupted · This may be due to network issues — please try again.'

export interface CompactionResult {
  boundaryMarker: SystemMessage
  summaryMessages: UserMessage[]
  attachments: AttachmentMessage[]
  hookResults: HookResultMessage[]
  messagesToKeep?: Message[]
  userDisplayMessage?: string
  preCompactTokenCount?: number
  postCompactTokenCount?: number
  truePostCompactTokenCount?: number
  compactionUsage?: ReturnType<typeof getTokenUsage>
}