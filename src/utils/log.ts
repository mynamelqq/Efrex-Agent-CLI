import { readdir, readFile, stat, mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import type { LogOption, SerializedMessage } from '../types/logs.js'
import { sortLogs } from '../types/logs.js'
import { LOG_PATHS,dateToFilename } from './logPaths.js'
import { shortErrorStack } from './errors.js'


// ─── In-memory error log ───

const MAX_IN_MEMORY_ERRORS = 100
let inMemoryErrorLog: Array<{ error: string; timestamp: string }> = []

function addToInMemoryErrorLog(errorInfo: { error: string; timestamp: string }): void {
  if (inMemoryErrorLog.length >= MAX_IN_MEMORY_ERRORS) {//内存中最多100条 
    inMemoryErrorLog.shift()
  }
  inMemoryErrorLog.push(errorInfo)
}

// ─── Error Log Sink ───


/**
 * Sink interface for the error logging backend
 */
export type ErrorLogSink = {
  logError: (error: Error) => void
  logMCPError: (serverName: string, error: unknown) => void
  logMCPDebug: (serverName: string, message: string) => void
  getErrorsPath: () => string
  getMCPLogsPath: (serverName: string) => string
}



// Queued events for events logged before sink is attached
type QueuedErrorEvent =
  | { type: 'error'; error: Error }
  | { type: 'mcpError'; serverName: string; error: unknown }
  | { type: 'mcpDebug'; serverName: string; message: string }

const errorQueue: QueuedErrorEvent[] = []
// Sink - initialized during app startup
let errorLogSink: ErrorLogSink | null = null

/**
 * Attach the error log sink that will receive all error events.
 * Queued events are drained immediately to ensure no errors are lost.
 *
 * Idempotent: if a sink is already attached, this is a no-op. This allows
 * calling from both the preAction hook (for subcommands) and setup() (for
 * the default command) without coordination.
 */
export function attachErrorLogSink(newSink: ErrorLogSink): void {
  if (errorLogSink !== null) {
    return
  }
  errorLogSink = newSink

  // Drain the queue immediately - errors should not be delayed
  if (errorQueue.length > 0) {
    const queuedEvents = [...errorQueue]
    errorQueue.length = 0

    for (const event of queuedEvents) {
      switch (event.type) {
        case 'error':
          errorLogSink.logError(event.error)
          break
        case 'mcpError':
          errorLogSink.logMCPError(event.serverName, event.error)
          break
        case 'mcpDebug':
          errorLogSink.logMCPDebug(event.serverName, event.message)
          break
      }
    }
  }
}

// ─── Core Logging Functions ───

function toError(error: unknown): Error {
  if (error instanceof Error) return error
  if (typeof error === 'string') return new Error(error)
  return new Error(String(error))
}

export function logError(error: unknown): void {
  const err = toError(error)
  try{
  const errorStr = shortErrorStack(err)//简化调用栈

  const errorInfo = {
    error: errorStr,
    timestamp: new Date().toISOString(),
  }

  // Always add to in-memory log (no dependencies needed)
  addToInMemoryErrorLog(errorInfo)

  // If sink not attached, queue the event
  if (errorLogSink === null) {
    errorQueue.push({ type: 'error', error: err })//如果没有attach log Sink排队
    return
  }

  errorLogSink.logError(err)
  } catch {
    // pass
  }
}


export function getInMemoryErrors(): Array<{ error: string; timestamp: string }> {
  return [...inMemoryErrorLog]
}

export function logMCPError(serverName: string, error: unknown): void {
  try {
    // If sink not attached, queue the event
    if (errorLogSink === null) {
      errorQueue.push({ type: 'mcpError', serverName, error })
      return
    }

    errorLogSink.logMCPError(serverName, error)
  } catch {
    // Silently fail
  }
}

export function logMCPDebug(serverName: string, message: string): void {
  try {
    // If sink not attached, queue the event
    if (errorLogSink === null) {
      errorQueue.push({ type: 'mcpDebug', serverName, message })
      return
    }

    errorLogSink.logMCPDebug(serverName, message)
  } catch {
    // Silently fail
  }
}
// ─── API Request Capture ───



// ─── Log Loading ───

/**
 * Loads the list of error logs sorted by date (newest first).
 */
export async function loadErrorLogs(): Promise<LogOption[]> {
  return loadLogList(LOG_PATHS.errors())
}

/**
 * Loads the list of session logs sorted by date (newest first).
 */
export async function loadSessionLogs(): Promise<LogOption[]> {
  return loadLogList(LOG_PATHS.logs())
}

/**
 * Get an error log by its index in the sorted list.
 */
export async function getErrorLogByIndex(index: number): Promise<LogOption | null> {
  const logs = await loadErrorLogs()
  return logs[index] || null
}

/**
 * Get a session log by its index in the sorted list.
 */
export async function getSessionLogByIndex(index: number): Promise<LogOption | null> {
  const logs = await loadSessionLogs()
  return logs[index] || null
}

/**
 * Internal function to load and process logs from a specified path
 * @param path Directory containing logs
 * @returns Array of logs sorted by date
 * @private
 */
async function loadLogList(path: string): Promise<LogOption[]> {
  let files: Awaited<ReturnType<typeof readdir>>
  try {
    files = (await readdir(path, { withFileTypes: true })) as any
  } catch {
    logError(new Error(`No logs found at ${path}`))
    return []
  }
  const logData = await Promise.all(
    files.map(async (file, i) => {
      const fullPath = join(path, String(file.name))
      const content = await readFile(fullPath, { encoding: 'utf8' })
      const messages = JSON.parse(content) as SerializedMessage[]
      const firstMessage = messages[0]
      const lastMessage = messages[messages.length - 1]
      const firstPrompt =
        firstMessage?.type === 'user' &&
        typeof firstMessage?.message?.content === 'string'
          ? firstMessage?.message?.content
          : 'No prompt'

      // For new random filenames, we'll get stats from the file itself
      const fileStats = await stat(fullPath)

      // Check if it's a sidechain by looking at filename
      const isSidechain = fullPath.includes('sidechain')

      // For new files, use the file modified time as date
      const date = dateToFilename(fileStats.mtime)

      return {
        date,
        fullPath,
        messages,
        value: i, // hack: overwritten after sorting, right below this
        created: parseISOString(firstMessage?.timestamp || date),
        modified: lastMessage?.timestamp
          ? parseISOString(lastMessage.timestamp)
          : parseISOString(date),
        firstPrompt:
          firstPrompt.split('\n')[0]?.slice(0, 50) +
            (firstPrompt.length > 50 ? '…' : '') || 'No prompt',
        messageCount: messages.length,
        isSidechain,
      }
    }),
  )

  return sortLogs(logData.filter(_ => _ !== null)).map((_, i) => ({
    ..._,
    value: i,
  }))
}
// ─── Log Display Title ───

/**
 * Gets the display title for a log/session with fallback logic.
 */
export function getLogDisplayTitle(log: LogOption, defaultTitle?: string): string {
  const title =
    log.agentName ||
    log.customTitle ||
    log.summary ||
    log.firstPrompt ||
    defaultTitle ||
    (log.sessionId ? log.sessionId.slice(0, 8) : '') ||
    'Untitled session'

  return title.trim()
}

// ─── Helpers ───

function parseISOString(s: string): Date {
  const b = s.split(/\D+/)
  if (b.length < 6) return new Date(s)
  return new Date(
    Date.UTC(
      parseInt(b[0]!, 10),
      parseInt(b[1]!, 10) - 1,
      parseInt(b[2]!, 10),
      parseInt(b[3]!, 10),
      parseInt(b[4]!, 10),
      parseInt(b[5]!, 10),
      parseInt(b[6] || '0', 10),
    ),
  )
}

// ─── File Sink Implementation ───



/**
 * Reset error log state for testing purposes.
 * @internal
 */
export function _resetErrorLogForTesting(): void {
  errorLogSink = null
  errorQueue.length = 0
  inMemoryErrorLog = []
}
