import { stripBOM } from './jsonRead'
import { logError } from './log.js'
import { memoizeWithLRU } from './memoize.js'
const PARSE_CACHE_MAX_KEY_BYTES = 8 * 1024
type CachedParse = { ok: true; value: unknown } | { ok: false }
function parseJSONUncached(json: string, shouldLogError: boolean): CachedParse {
  try {
    return { ok: true, value: JSON.parse(stripBOM(json)) }
  } catch (e) {
    if (shouldLogError) {
      logError(e)
    }
    return { ok: false }
  }
}
const parseJSONCached = memoizeWithLRU(parseJSONUncached, json => json, 50)

// Important: memoized for performance (LRU-bounded to 50 entries, small inputs only).
export const safeParseJSON = Object.assign(
  function safeParseJSON(
    json: string | null | undefined,
    shouldLogError: boolean = true,
  ): unknown {
    if (!json) return null
    const result =
      json.length > PARSE_CACHE_MAX_KEY_BYTES
        ? parseJSONUncached(json, shouldLogError)
        : parseJSONCached(json, shouldLogError)
    return result.ok ? result.value : null
  },
  { cache: parseJSONCached.cache },
)
/**
 * Bun.JSONL.parseChunk if available, false otherwise.
 * Supports both strings and Buffers, minimizing memory usage and copies.
 * Also handles BOM stripping internally.
 */
type BunJSONLParseChunk = (
  data: string | Buffer,
  offset?: number,
) => { values: unknown[]; error: null | Error; read: number; done: boolean }

const bunJSONLParse: BunJSONLParseChunk | false = (() => {
  if (typeof Bun === 'undefined') return false
  const b = Bun as Record<string, unknown>
  const jsonl = b.JSONL as Record<string, unknown> | undefined
  if (!jsonl?.parseChunk) return false
  return jsonl.parseChunk as BunJSONLParseChunk
})()
function parseJSONLBun<T>(data: string | Buffer): T[] {
  const parse = bunJSONLParse as BunJSONLParseChunk
  const len = data.length
  const result = parse(data)
  if (!result.error || result.done || result.read >= len) {
    return result.values as T[]
  }
  // Had an error mid-stream — collect what we got and keep going
  // Bun.JSONL.parseChunk 遇到坏数据可能停在某个位置，于是代码从下一个换行符继续解析，尽量保留后面的合法 JSON 行。
  let values = result.values as T[]
  let offset = result.read
  while (offset < len) {
    const newlineIndex =
      typeof data === 'string'
        ? data.indexOf('\n', offset)
        : data.indexOf(0x0a, offset)
    if (newlineIndex === -1) break
    offset = newlineIndex + 1
    const next = parse(data, offset)
    if (next.values.length > 0) {
      values = values.concat(next.values as T[])
    }
    if (!next.error || next.done || next.read >= len) break
    offset = next.read
  }
  return values
}
function parseJSONLString<T>(data: string): T[] {
  const stripped = stripBOM(data)
  const len = stripped.length
  let start = 0

  const results: T[] = []
  while (start < len) {
    let end = stripped.indexOf('\n', start)
    if (end === -1) end = len

    const line = stripped.substring(start, end).trim()
    start = end + 1
    if (!line) continue
    try {
      results.push(JSON.parse(line) as T)
    } catch {
      // Skip malformed lines
    }
  }
  return results
}
function parseJSONLBuffer<T>(buf: Buffer): T[] {
  const bufLen = buf.length
  let start = 0

  // Strip UTF-8 BOM (EF BB BF)
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    start = 3
  }

  const results: T[] = []
  while (start < bufLen) {
    let end = buf.indexOf(0x0a, start)
    if (end === -1) end = bufLen

    const line = buf.toString('utf8', start, end).trim()
    start = end + 1
    if (!line) continue
    try {
      results.push(JSON.parse(line) as T)
    } catch {
      // Skip malformed lines
    }
  }
  return results
}
/**
 * Parses JSONL data from a string or Buffer, skipping malformed lines.
 * Uses Bun.JSONL.parseChunk when available for better performance,
 * falls back to indexOf-based scanning otherwise.
 */
export function parseJSONL<T>(data: string | Buffer): T[] {
  if (bunJSONLParse) {//第一层，优先用 Bun 原生能力：
    return parseJSONLBun<T>(data)
  }
  if (typeof data === 'string') {//第二层，支持 string 和 Buffer 分开处理。
    return parseJSONLString<T>(data)
  }
  return parseJSONLBuffer<T>(data)
}

const MAX_JSONL_READ_BYTES = 100 * 1024 * 1024