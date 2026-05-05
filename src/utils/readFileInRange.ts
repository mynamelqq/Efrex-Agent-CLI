// ---------------------------------------------------------------------------
// readFileInRange — line-oriented file reader with two code paths
// ---------------------------------------------------------------------------
//
// Returns lines [offset, offset + maxLines) from a file.
//
// Fast path (regular files < 10 MB):
//   Opens the file, stats the fd, reads the whole file with readFile(),
//   then splits lines in memory.  This avoids the per-chunk async overhead
//   of createReadStream and is ~2x faster for typical source files.
//
// Streaming path (large files, pipes, devices, etc.):
//   Uses createReadStream with manual indexOf('\n') scanning.  Content is
//   only accumulated for lines inside the requested range — lines outside
//   the range are counted (for totalLines) but discarded, so reading line
//   1 of a 100 GB file won't balloon RSS.
//
//   All event handlers (streamOnOpen/Data/End) are module-level named
//   functions with zero closures.  State lives in a StreamState object;
//   handlers access it via `this`, bound at registration time.
//
//   Lifecycle: `open`, `end`, and `error` use .once() (auto-remove).
//   `data` fires until the stream ends or is destroyed — either way the
//   stream and state become unreachable together and are GC'd.
//
//   On error (including maxBytes exceeded), stream.destroy(err) emits
//   'error' → reject (passed directly to .once('error')).
//
// Both paths strip UTF-8 BOM and \r (CRLF → LF).
//
// mtime comes from fstat/stat on the already-open fd — no extra open().
//
// maxBytes behavior depends on options.truncateOnByteLimit:
//   false (default): legacy semantics — throws FileTooLargeError if the FILE
//     size (fast path) or total streamed bytes (streaming) exceed maxBytes.
//   true: caps SELECTED OUTPUT at maxBytes.  Stops at the last complete line
//     that fits; sets truncatedByBytes in the result.  Never throws.
// ---------------------------------------------------------------------------

import { createReadStream, fstat } from 'fs'
import { stat as fsStat, readFile } from 'fs/promises'
import { formatFileSize } from './format.js'

const FAST_PATH_MAX_SIZE = 10 * 1024 * 1024 // 10 MB

export type ReadFileRangeResult = {
  content: string
  lineCount: number
  totalLines: number
  totalBytes: number
  readBytes: number
  mtimeMs: number
  /** true when output was clipped to maxBytes under truncate mode */
  truncatedByBytes?: boolean
}

export class FileTooLargeError extends Error {
  constructor(
    public sizeInBytes: number,
    public maxSizeBytes: number,
  ) {
    super(
      `File content (${formatFileSize(sizeInBytes)}) exceeds maximum allowed size (${formatFileSize(maxSizeBytes)}). Use offset and limit parameters to read specific portions of the file, or search for specific content instead of reading the whole file.`,
    )
    this.name = 'FileTooLargeError'
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function readFileInRange(
  filePath: string,
  offset = 0,
  maxLines?: number,
  maxBytes?: number,
  signal?: AbortSignal,
  options?: { truncateOnByteLimit?: boolean },
): Promise<ReadFileRangeResult> {
  signal?.throwIfAborted()
  const truncateOnByteLimit = options?.truncateOnByteLimit ?? false

  // stat to decide the code path and guard against OOM.
  // For regular files under 10 MB: readFile + in-memory split (fast).
  // Everything else (large files, FIFOs, devices): streaming.
  const stats = await fsStat(filePath)

  if (stats.isDirectory()) {
    throw new Error(
      `EISDIR: illegal operation on a directory, read '${filePath}'`,
    )
  }

  if (stats.isFile() && stats.size < FAST_PATH_MAX_SIZE) {//文件大小太小就快速读取
    if (
      !truncateOnByteLimit &&
      maxBytes !== undefined &&
      stats.size > maxBytes
    ) {
      throw new FileTooLargeError(stats.size, maxBytes)
    }

    const text = await readFile(filePath, { encoding: 'utf8', signal })

    return readFileInRangeFast(//读取完格式化，统计一些数据，按行读取
      text,
      stats.mtimeMs,
      offset,
      maxLines,
      truncateOnByteLimit ? maxBytes : undefined,
    )
  }

  return readFileInRangeStreaming(//大文件 / 管道 / 设备：streaming path
    filePath,
    offset,
    maxLines,
    maxBytes,
    truncateOnByteLimit,
    signal,
  )
}

// ---------------------------------------------------------------------------
// Fast path — readFile + in-memory split
// ---------------------------------------------------------------------------

function readFileInRangeFast(
  raw: string,
  mtimeMs: number,
  offset: number,
  maxLines: number | undefined,
  truncateAtBytes: number | undefined,
): ReadFileRangeResult {
  const endLine = maxLines !== undefined ? offset + maxLines : Infinity//要提取的行索引区间为 [offset, endLine)。
/*     去掉 C
把 CRLF 的 \r\n 处理成 \n
只收集 [offset, offset + maxLines) 范围内的行
如果开启 truncateOnByteLimit，只截断输出内容，不抛错 */
  // Strip BOM.
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw

  // Split lines, strip \r, select range.
  const selectedLines: string[] = []//存放最终选中的行
  let lineIndex = 0//当前扫描到的行号
  let startPos = 0//当前行在 text 中的起始索引
  let newlinePos: number//新一行的起始索引
  let selectedBytes = 0//已选中内容（含换行符）的 UTF-8 字节数
  let truncatedByBytes = false//是否因字节限制而截断

  function tryPush(line: string): boolean {
    if (truncateAtBytes !== undefined) {
      const sep = selectedLines.length > 0 ? 1 : 0
      const nextBytes = selectedBytes + sep + Buffer.byteLength(line)
      if (nextBytes > truncateAtBytes) {
        truncatedByBytes = true
        return false
      }
      selectedBytes = nextBytes
    }
    selectedLines.push(line)
    return true
  }

  while ((newlinePos = text.indexOf('\n', startPos)) !== -1) {// 遍历所有行
    if (lineIndex >= offset && lineIndex < endLine && !truncatedByBytes) {
      let line = text.slice(startPos, newlinePos)
      if (line.endsWith('\r')) {
        line = line.slice(0, -1)
      }
      tryPush(line)
    }
    lineIndex++
    startPos = newlinePos + 1
  }

  // Final fragment (no trailing newline).
  if (lineIndex >= offset && lineIndex < endLine && !truncatedByBytes) {//处理最后一行
    let line = text.slice(startPos)
    if (line.endsWith('\r')) {
      line = line.slice(0, -1)
    }
    tryPush(line)
  }
  lineIndex++

  const content = selectedLines.join('\n');
  return {
    content,
    lineCount: selectedLines.length,   // 实际返回的行数
    totalLines: lineIndex,             // 原始文件总行数
    totalBytes: Buffer.byteLength(text, 'utf8'), // 原始文件总字节数
    readBytes: Buffer.byteLength(content, 'utf8'), // 返回内容的字节数
    mtimeMs,
    ...(truncatedByBytes ? { truncatedByBytes: true } : {})
  };
}

// ---------------------------------------------------------------------------
// Streaming path — createReadStream + event handlers
// ---------------------------------------------------------------------------

type StreamState = {
  stream: ReturnType<typeof createReadStream>
  offset: number
  endLine: number
  maxBytes: number | undefined
  truncateOnByteLimit: boolean
  resolve: (value: ReadFileRangeResult) => void
  totalBytesRead: number
  selectedBytes: number
  truncatedByBytes: boolean
  currentLineIndex: number
  selectedLines: string[]
  partial: string
  isFirstChunk: boolean
  resolveMtime: (ms: number) => void
  mtimeReady: Promise<number>
}

function streamOnOpen(this: StreamState, fd: number): void {
  fstat(fd, (err, stats) => {
    this.resolveMtime(err ? 0 : stats.mtimeMs)
  })
}

function streamOnData(this: StreamState, chunk: string): void {
  if (this.isFirstChunk) {//第一块chunk默认就为true
    this.isFirstChunk = false
    if (chunk.charCodeAt(0) === 0xfeff) {
      chunk = chunk.slice(1)
    }
  }

  this.totalBytesRead += Buffer.byteLength(chunk)
  if (
    !this.truncateOnByteLimit &&
    this.maxBytes !== undefined &&
    this.totalBytesRead > this.maxBytes
  ) {
    this.stream.destroy(//文件太大超出了限制，销毁流并触发 error 事件
      new FileTooLargeError(this.totalBytesRead, this.maxBytes),
    )
    return
  }

  const data = this.partial.length > 0 ? this.partial + chunk : chunk//上一个 chunk 残留的半行
  this.partial = ''

  let startPos = 0
  let newlinePos: number
  while ((newlinePos = data.indexOf('\n', startPos)) !== -1) {
    if (
      this.currentLineIndex >= this.offset &&
      this.currentLineIndex < this.endLine
    ) {
      let line = data.slice(startPos, newlinePos)
      if (line.endsWith('\r')) {
        line = line.slice(0, -1)
      }
      if (this.truncateOnByteLimit && this.maxBytes !== undefined) {
        const sep = this.selectedLines.length > 0 ? 1 : 0
        const nextBytes = this.selectedBytes + sep + Buffer.byteLength(line)
        if (nextBytes > this.maxBytes) {
          // Cap hit — collapse the selection range so nothing more is
          // accumulated.  Stream continues (to count totalLines).
          this.truncatedByBytes = true
          this.endLine = this.currentLineIndex
        } else {
          this.selectedBytes = nextBytes
          this.selectedLines.push(line)
        }
      } else {
        this.selectedLines.push(line)
      }
    }
    this.currentLineIndex++
    startPos = newlinePos + 1
  }

  // Only keep the trailing fragment when inside the selected range.
  // Outside the range we just count newlines — discarding prevents
  // unbounded memory growth on huge single-line files.
  if (startPos < data.length) {
    if (
      this.currentLineIndex >= this.offset &&
      this.currentLineIndex < this.endLine
    ) {
      const fragment = data.slice(startPos)
      // In truncate mode, `partial` can grow unboundedly if the selected
      // range contains a huge single line (no newline across many chunks).
      // Once the fragment alone would overflow the remaining budget, we know
      // the completed line can never fit — set truncated, collapse the
      // selection range, and discard the fragment to stop accumulation.
      if (this.truncateOnByteLimit && this.maxBytes !== undefined) {
        const sep = this.selectedLines.length > 0 ? 1 : 0
        const fragBytes = this.selectedBytes + sep + Buffer.byteLength(fragment)
        if (fragBytes > this.maxBytes) {
          this.truncatedByBytes = true
          this.endLine = this.currentLineIndex
          return
        }
      }
      this.partial = fragment
    }
  }
}

function streamOnEnd(this: StreamState): void {
  let line = this.partial
  if (line.endsWith('\r')) {
    line = line.slice(0, -1)
  }
  if (
    this.currentLineIndex >= this.offset &&
    this.currentLineIndex < this.endLine
  ) {
    if (this.truncateOnByteLimit && this.maxBytes !== undefined) {
      const sep = this.selectedLines.length > 0 ? 1 : 0
      const nextBytes = this.selectedBytes + sep + Buffer.byteLength(line)
      if (nextBytes > this.maxBytes) {
        this.truncatedByBytes = true
      } else {
        this.selectedLines.push(line)
      }
    } else {
      this.selectedLines.push(line)
    }
  }
  this.currentLineIndex++

  const content = this.selectedLines.join('\n')
  const truncated = this.truncatedByBytes
  this.mtimeReady.then(mtimeMs => {
    this.resolve({
      content,
      lineCount: this.selectedLines.length,
      totalLines: this.currentLineIndex,
      totalBytes: this.totalBytesRead,
      readBytes: Buffer.byteLength(content, 'utf8'),
      mtimeMs,
      ...(truncated ? { truncatedByBytes: true } : {}),
    })
  })
}

function readFileInRangeStreaming(
  filePath: string,
  offset: number,
  maxLines: number | undefined,
  maxBytes: number | undefined,
  truncateOnByteLimit: boolean,
  signal?: AbortSignal,
): Promise<ReadFileRangeResult> {
  return new Promise((resolve, reject) => {//不在目标范围内的行不会被保存，只用来计数，所以读超大文件时不会因为跳过很多行而占用巨大内存。
    const state: StreamState = {
      stream: createReadStream(filePath, {
        encoding: 'utf8',
        highWaterMark: 512 * 1024,
        ...(signal ? { signal } : undefined),
      }),
      offset,
      endLine: maxLines !== undefined ? offset + maxLines : Infinity,
      maxBytes,
      truncateOnByteLimit,
      resolve,
      totalBytesRead: 0,//totalBytesRead
      selectedBytes: 0,//输出内容已占字节
      truncatedByBytes: false,//是否被 maxBytes 截断
      currentLineIndex: 0,//当前读到第几行
      selectedLines: [],//选中的行
      partial: '',//上一个 chunk 残留的半行
      isFirstChunk: true,//
      resolveMtime: () => {},
      mtimeReady: null as unknown as Promise<number>,
    }
    state.mtimeReady = new Promise<number>(r => {
      state.resolveMtime = r
    })

    state.stream.once('open', streamOnOpen.bind(state))
    state.stream.on('data', streamOnData.bind(state))
    state.stream.once('end', streamOnEnd.bind(state))
    state.stream.once('error', reject)
  })
}
