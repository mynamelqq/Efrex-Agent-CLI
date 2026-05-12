import { appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DEBUG_DIR = join(homedir(), '.efrex', 'debug')
const DEBUG_LOG = join(DEBUG_DIR, 'app.log')

export function logForDebugging(message: string, metadata?: unknown): void {
  try {
    mkdirSync(DEBUG_DIR, { recursive: true })
    const suffix =
      metadata === undefined
        ? ''
        : ` ${safeStringify(metadata)}`
    appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${message}${suffix}\n`)
  } catch {
    // Avoid breaking the app on logging failures.
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return '[unserializable metadata]'
  }
}
