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

/**
 * Sort logs by modified date (newest first)
 */
export function sortLogs(logs: LogOption[]): LogOption[] {
  return [...logs].sort((a, b) => b.modified.getTime() - a.modified.getTime())
}
