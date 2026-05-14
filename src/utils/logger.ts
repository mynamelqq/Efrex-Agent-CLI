import { readdir, readFile, stat, mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import type { LogOption, SerializedMessage } from '../types/logs.js'
import { sortLogs } from '../types/logs.js'
import { LOG_PATHS, dateToFilename } from './logPaths.js'


// ─── In-memory error log ───

const MAX_IN_MEMORY_ERRORS = 100
let inMemoryErrorLog: Array<{ error: string; timestamp: string }> = []

function addToInMemoryErrorLog(errorInfo: { error: string; timestamp: string }): void {
  if (inMemoryErrorLog.length >= MAX_IN_MEMORY_ERRORS) {
    inMemoryErrorLog.shift()
  }
  inMemoryErrorLog.push(errorInfo)
}

// ─── Error Log Sink ───

export type ErrorLogSink = {
  logError: (error: Error) => void
  getErrorsPath: () => string
}

type QueuedErrorEvent = { type: 'error'; error: Error }

const errorQueue: QueuedErrorEvent[] = []
let errorLogSink: ErrorLogSink | null = null

/**
 * Attach the error log sink. Queued events are drained immediately.
 * Idempotent: no-op if already attached.
 */
export function attachErrorLogSink(newSink: ErrorLogSink): void {
  if (errorLogSink !== null) return
  errorLogSink = newSink

  if (errorQueue.length > 0) {
    const queued = [...errorQueue]
    errorQueue.length = 0
    for (const event of queued) {
      errorLogSink.logError(event.error)
    }
  }
}

// ─── Core Logging Functions ───

function toError(error: unknown): Error {
  if (error instanceof Error) return error
  if (typeof error === 'string') return new Error(error)
  return new Error(String(error))
}

/**
 * Log an error to multiple destinations:
 * - In-memory error log (for current session inspection)
 * - Persistent error log file (via sink)
 */
export function logError(error: unknown): void {
  const err = toError(error)
  try {
    const errorStr = err.stack || err.message
    const errorInfo = {
      error: errorStr,
      timestamp: new Date().toISOString(),
    }

    addToInMemoryErrorLog(errorInfo)

    if (errorLogSink === null) {
      errorQueue.push({ type: 'error', error: err })
      return
    }

    errorLogSink.logError(err)
  } catch {
    // Silently fail to avoid infinite loops
  }
}

export function getInMemoryErrors(): Array<{ error: string; timestamp: string }> {
  return [...inMemoryErrorLog]
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

async function loadLogList(dirPath: string): Promise<LogOption[]> {
  let files: { name: string; isFile(): boolean }[]
  try {
    files = await readdir(dirPath, { withFileTypes: true })
  } catch {
    return []
  }

  const logData = await Promise.all(
    files.map(async (file, i) => {
      if (!file.isFile() || !file.name.endsWith('.json')) return null

      const fullPath = join(dirPath, file.name)
      try {
        const content = await readFile(fullPath, { encoding: 'utf8' })
        const messages = JSON.parse(content) as SerializedMessage[]
        const firstMessage = messages[0]
        const lastMessage = messages[messages.length - 1]

        const firstContent =
          firstMessage?.type === 'user' && typeof firstMessage?.message?.content === 'string'
            ? firstMessage.message.content
            : firstMessage?.content || 'No prompt'

        const fileStats = await stat(fullPath)
        const isSidechain = fullPath.includes('sidechain')
        const date = dateToFilename(fileStats.mtime)

        return {
          date,
          fullPath,
          messages,
          value: i,
          created: parseISOString(firstMessage?.timestamp || date),
          modified: lastMessage?.timestamp
            ? parseISOString(lastMessage.timestamp)
            : parseISOString(date),
          firstPrompt:
            (firstContent.split('\n')[0]?.slice(0, 50) || 'No prompt') +
            (firstContent.length > 50 ? '…' : ''),
          messageCount: messages.length,
          isSidechain,
        }
      } catch {
        return null
      }
    }),
  )

  return sortLogs(logData.filter((l): l is NonNullable<typeof l> => l !== null)).map((l, i) => ({
    ...l,
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
 * Create a simple file-based error sink that writes to ~/.efrex/errors/
 */
export function createFileErrorSink(): ErrorLogSink {
  const errorsPath = LOG_PATHS.errors()

  return {
    getErrorsPath: () => errorsPath,
    logError: async (error: Error) => {
      try {
        await mkdir(errorsPath, { recursive: true })
        const filename = `${dateToFilename(new Date())}.json`
        const filepath = join(errorsPath, filename)
        const payload = {
          error: error.stack || error.message,
          timestamp: new Date().toISOString(),
        }
        await writeFile(filepath, JSON.stringify(payload, null, 2) + '\n', { flag: 'a' })
      } catch {
        // Silently fail
      }
    },
  }
}

/**
 * Reset error log state for testing purposes.
 * @internal
 */
export function _resetErrorLogForTesting(): void {
  errorLogSink = null
  errorQueue.length = 0
  inMemoryErrorLog = []
}
