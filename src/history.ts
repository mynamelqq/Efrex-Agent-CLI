import { PastedContent } from "./utils/config"
import { hashPastedText } from "./utils/pasteStore"
import { writeFile,appendFile } from "fs"
import { sleep } from "bun"
import { storePastedText } from "./utils/pasteStore"
import { registerCleanup } from "./utils/cleanupRegistry"
import { logForDebugging } from "./utils/debug"
import { getProjectRoot } from "./bootstrap/state"
import { getErrnoCode } from "./utils/errors"
import { lock } from "./utils/lockfile"
import {join}from "path"
import { isEnvTruthy } from "./utils/envUtils"
import { HistoryEntry } from "./utils/config"
const MAX_HISTORY_ITEMS = 100
const MAX_PASTED_CONTENT_LENGTH = 512
import { getSessionId } from "./bootstrap/state"
import { getEfrexConfigHomeDir } from "./utils/envUtils"
/**
 * Stored paste content - either inline content or a hash reference to paste store.
 */
type StoredPastedContent = {
  id: number
  type: 'text' | 'image'
  content?: string // Inline content for small pastes
  contentHash?: string // Hash reference for large pastes stored externally
  mediaType?: string
  filename?: string
}
type LogEntry = {
  display: string
  pastedContents: Record<number, StoredPastedContent>
  timestamp: number
  project: string
  sessionId?: string
}
export function getPastedTextRefNumLines(text: string): number {
  return (text.match(/\r\n|\r|\n/g) || []).length
}
export function formatPastedTextRef(id: number, numLines: number): string {
  if (numLines === 0) {
    return `[Pasted text #${id}]`
  }
  return `[Pasted text #${id} +${numLines} lines]`
}
export function formatImageRef(id: number): string {
  return `[Image #${id}]`
}

export function parseReferences(
  input: string,
): Array<{ id: number; match: string; index: number }> {
  const referencePattern =
    /\[(Pasted text|Image|\.\.\.Truncated text) #(\d+)(?: \+\d+ lines)?(\.)*\]/g
  const matches = [...input.matchAll(referencePattern)]
  return matches
    .map(match => ({
      id: parseInt(match[2] || '0', 10),
      match: match[0],
      index: match.index,
    }))
    .filter(match => match.id > 0)
}


/**
 * Replace [Pasted text #N] placeholders in input with their actual content.
 * Image refs are left alone — they become content blocks, not inlined text.
 */
export function expandPastedTextRefs(
  input: string,
  pastedContents: Record<number, PastedContent>,
): string {

  const refs = parseReferences(input)
  let expanded = input
  // Splice at the original match offsets so placeholder-like strings inside
  // pasted content are never confused for real refs. Reverse order keeps
  // earlier offsets valid after later replacements.
  for (let i = refs.length - 1; i >= 0; i--) {
    const ref = refs[i]!
    const content = pastedContents[ref.id]
    if (content?.type !== 'text') continue
    expanded =
      expanded.slice(0, ref.index) +
      content.content +
      expanded.slice(ref.index + ref.match.length)
  }
  return expanded
}
function deserializeLogEntry(line: string): LogEntry {
  return JSON.parse(line) as LogEntry
}
let pendingEntries: LogEntry[] = []
let lastAddedEntry: LogEntry | null = null
let cleanupRegistered = false
let isWriting = false
let currentFlushPromise: Promise<void> | null = null
// Timestamps of entries already flushed to disk that should be skipped when
// reading. Used by removeLastFromHistory when the entry has raced past the
// pending buffer. Session-scoped (module state resets on process restart).
const skippedTimestamps = new Set<number>()
// async function* makeLogEntryReader(): AsyncGenerator<LogEntry> {
//   const currentSession = getSessionId()

//   // Start with entries that have yet to be flushed to disk
//   for (let i = pendingEntries.length - 1; i >= 0; i--) {
//     yield pendingEntries[i]!
//   }

//   // Read from global history file (shared across all projects)
//   const historyPath = join(getEfrexConfigHomeDir(), 'history.jsonl')

//   try {
//     for await (const line of readLinesReverse(historyPath)) {
//       try {
//         const entry = deserializeLogEntry(line)
//         // removeLastFromHistory slow path: entry was flushed before removal,
//         // so filter here so both getHistory (Up-arrow) and makeHistoryReader
//         // (ctrl+r search) skip it consistently.
//         if (
//           entry.sessionId === currentSession &&
//           skippedTimestamps.has(entry.timestamp)
//         ) {
//           continue
//         }
//         yield entry
//       } catch (error) {
//         // Not a critical error - just skip malformed lines
//         logForDebugging(`Failed to parse history line: ${error}`)
//       }
//     }
//   } catch (e: unknown) {
//     const code = getErrnoCode(e)
//     if (code === 'ENOENT') {
//       return
//     }
//     throw e
//   }
// }

// Core flush logic - writes pending entries to disk
async function immediateFlushHistory(): Promise<void> {
  if (pendingEntries.length === 0) {
    return
  }

  let release
  try {
    const historyPath = join(getEfrexConfigHomeDir(), 'history.jsonl')

    // Ensure the file exists before acquiring lock (append mode creates if missing)
    await writeFile(historyPath, '', {//先什么都不写，只确保文件存在
      encoding: 'utf8',
      mode: 0o600,
      flag: 'a',
    },()=>{})

    release = await lock(historyPath, {
      stale: 10000,
      retries: {
        retries: 3,
        minTimeout: 50,
      },
    })

    const jsonLines = pendingEntries.map(entry => JSON.stringify(entry) + '\n')//json化
    pendingEntries = []

    await appendFile(historyPath, jsonLines.join(''), { mode: 0o600 },()=>{})
  } catch (error) {
    logForDebugging(`Failed to write prompt history: ${error}`)
  } finally {
    if (release) {
      await release()
    }
  }
}
export function clearPendingHistoryEntries(): void {
  pendingEntries = []
  lastAddedEntry = null
  skippedTimestamps.clear()
}
export function addToHistory(command: HistoryEntry | string): void {
  // Skip history when running in a tmux session spawned by Claude Code's Tungsten tool.
  // This prevents verification/test sessions from polluting the user's real command history.
  if (isEnvTruthy(process.env.SKIP_PROMPT_HISTORY)) {
    return
  }

  // Register cleanup on first use
  if (!cleanupRegistered) {
    cleanupRegistered = true
    registerCleanup(async () => {
      // If there's an in-progress flush, wait for it
      if (currentFlushPromise) {//等待promise
        await currentFlushPromise
      }
      // If there are still pending entries after the flush completed, do one final flush
      if (pendingEntries.length > 0) {//仍然有等待的写入请求，刷新
        await immediateFlushHistory()
      }
    })
  }

  void addToPromptHistory(command)
}
async function addToPromptHistory(
  command: HistoryEntry | string,
): Promise<void> {
  const entry =
    typeof command === 'string'
      ? { display: command, pastedContents: {} }//字符串的化就不用HistoryEntry了
      : command

  const storedPastedContents: Record<number, StoredPastedContent> = {}//存储的粘贴
  if (entry.pastedContents) {
    for (const [id, content] of Object.entries(entry.pastedContents)) {
      // Filter out images (they're stored separately in image-cache)
      if (content.type === 'image') {
        continue
      }

      // For small text content, store inline
      if (content.content.length <= MAX_PASTED_CONTENT_LENGTH) {
        storedPastedContents[Number(id)] = {
          id: content.id,
          type: content.type,
          content: content.content,
          mediaType: content.mediaType,
          filename: content.filename,
        }
      } else {
        // For large text content, compute hash synchronously and store reference
        // The actual disk write happens async (fire-and-forget)
        const hash = hashPastedText(content.content)
        storedPastedContents[Number(id)] = {
          id: content.id,
          type: content.type,
          contentHash: hash,
          mediaType: content.mediaType,
          filename: content.filename,
        }
        // Fire-and-forget disk write - don't block history entry creation
        void storePastedText(hash, content.content)
      }
    }
  }

  const logEntry: LogEntry = {
    ...entry,
    pastedContents: storedPastedContents,
    timestamp: Date.now(),
    project: getProjectRoot(),
    sessionId: getSessionId(),
  }

  pendingEntries.push(logEntry)
  lastAddedEntry = logEntry
  currentFlushPromise = flushPromptHistory(0)
  void currentFlushPromise
}
async function flushPromptHistory(retries: number): Promise<void> {
  if (isWriting || pendingEntries.length === 0) {
    return
  }

  // Stop trying to flush history until the next user prompt
  if (retries > 5) {
    return
  }

  isWriting = true

  try {//获取锁
    await immediateFlushHistory()
  } finally {
    isWriting = false

    if (pendingEntries.length > 0) {
      // Avoid trying again in a hot loop
      await sleep(500)

      void flushPromptHistory(retries + 1)
    }
  }
}
