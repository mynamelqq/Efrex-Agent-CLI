import type { UUID } from 'crypto'
import type { FileHistorySnapshot } from 'src/utils/fileHistory.js'
import type { ContentReplacementRecord } from 'src/utils/toolResultStorage.js'
import type { AgentId } from './ids.js'
import type { Message } from 'src/package/message.js'

export interface SerializedMessage {
  type: 'user' | 'assistant' | 'system'
  role?: 'user' | 'assistant' | 'system'
  message?: {
    content?: string | object
    role?: string
  }
  content?: string
  timestamp?: string
}

export interface LogOption {
  date: string
  fullPath: string
  messages: SerializedMessage[]
  value: number
  created: Date
  modified: Date
  firstPrompt: string
  messageCount: number
  isSidechain?: boolean
  sessionId?: string
  agentName?: string
  customTitle?: string
  summary?: string
}

export type FileHistorySnapshotMessage = {
  type: 'file-history-snapshot'
  messageId: UUID
  snapshot: FileHistorySnapshot
  isSnapshotUpdate: boolean
}

export type Entry =
  | FileHistorySnapshotMessage

/**
 * Sort logs by modified date (newest first)
 */
export function sortLogs(logs: LogOption[]): LogOption[] {
  return [...logs].sort((a, b) => b.modified.getTime() - a.modified.getTime())
}
