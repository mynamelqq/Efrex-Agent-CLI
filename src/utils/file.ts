
import { chmodSync, readFileSync, renameSync, writeFileSync as fsWriteFileSync } from 'fs'
import { realpath, stat} from 'fs/promises'
import { homedir } from 'os'
import { open } from 'fs/promises'

import * as nodePath from 'path'
import { lstatSync,realpathSync,openSync,readSync,closeSync,readlinkSync} from 'fs'
import { fileReadCache } from './fileReadCache'
import { readdirSync,Dirent,statSync,unlinkSync,existsSync} from 'fs'
import { isENOENT } from './errors.js'
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from 'path'
import { getCwd } from '../utils/cwd.js'
import { expandPath } from './path.js'
export type LineEndingType = 'CRLF' | 'LF'
import { getPlatform } from './platform.js'
export type File = {
  filename: string
  content: string
}
/**
 * Binary file extensions to skip for text-based operations.
 * These files can't be meaningfully compared as text and are often large.
 */
export const BINARY_EXTENSIONS = new Set([
  // Images
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.ico',
  '.webp',
  '.tiff',
  '.tif',
  // Videos
  '.mp4',
  '.mov',
  '.avi',
  '.mkv',
  '.webm',
  '.wmv',
  '.flv',
  '.m4v',
  '.mpeg',
  '.mpg',
  // Audio
  '.mp3',
  '.wav',
  '.ogg',
  '.flac',
  '.aac',
  '.m4a',
  '.wma',
  '.aiff',
  '.opus',
  // Archives
  '.zip',
  '.tar',
  '.gz',
  '.bz2',
  '.7z',
  '.rar',
  '.xz',
  '.z',
  '.tgz',
  '.iso',
  // Executables/binaries
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.o',
  '.a',
  '.obj',
  '.lib',
  '.app',
  '.msi',
  '.deb',
  '.rpm',
  // Documents (PDF is here; FileReadTool excludes it at the call site)
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.odt',
  '.ods',
  '.odp',
  // Fonts
  '.ttf',
  '.otf',
  '.woff',
  '.woff2',
  '.eot',
  // Bytecode / VM artifacts
  '.pyc',
  '.pyo',
  '.class',
  '.jar',
  '.war',
  '.ear',
  '.node',
  '.wasm',
  '.rlib',
  // Database files
  '.sqlite',
  '.sqlite3',
  '.db',
  '.mdb',
  '.idx',
  // Design / 3D
  '.psd',
  '.ai',
  '.eps',
  '.sketch',
  '.fig',
  '.xd',
  '.blend',
  '.3ds',
  '.max',
  // Flash
  '.swf',
  '.fla',
  // Lock/profiling data
  '.lockb',
  '.dat',
  '.data',
])

/**
 * Marker included in file-not-found error messages that contain a cwd note.
 * UI renderers check for this to show a short "File not found" message.
 */
export const FILE_NOT_FOUND_CWD_NOTE = 'Note: your current working directory is'

/**
 * Check if a path exists asynchronously.
 */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
export function convertLeadingTabsToSpaces(content: string): string {
  // The /gm regex scans every line even on no-match; skip it entirely
  // for the common tab-free case.
  if (!content.includes('\t')) return content
  return content.replace(/^\t+/gm, _ => '  '.repeat(_.length))
}
export function detectFileEncoding(filePath: string): BufferEncoding {
  try {
    const sample = readFileSync(filePath, { flag: 'r' }).subarray(0, 4096)
    if (sample.length >= 3 && sample[0] === 0xef && sample[1] === 0xbb && sample[2] === 0xbf) {
      return 'utf8'
    }
    if (sample.length >= 2 && sample[0] === 0xff && sample[1] === 0xfe) {
      return 'utf16le'
    }

    let evenNulls = 0
    let oddNulls = 0
    for (let i = 0; i < sample.length; i++) {
      if (sample[i] !== 0) continue
      if (i % 2 === 0) {
        evenNulls++
      } else {
        oddNulls++
      }
    }

    if (oddNulls > evenNulls * 2 && oddNulls > sample.length / 8) {
      return 'utf16le'
    }
  } catch {
    return 'utf8'
  }
  return 'utf8'
}
export function getAbsoluteAndRelativePaths(path: string | undefined): {
  absolutePath: string | undefined
  relativePath: string | undefined
} {
  const absolutePath = path ? expandPath(path) : undefined
  const relativePath = absolutePath
    ? relative(getCwd(), absolutePath)
    : undefined
  return { absolutePath, relativePath }
}

export function getDisplayPath(filePath: string): string {//输入一个文件路径 → 输出最优雅、最短、最易读的显示路径
  // Use relative path if file is in the current working directory
  const { relativePath } = getAbsoluteAndRelativePaths(filePath)
  if (relativePath && !relativePath.startsWith('..')) {
    return relativePath
  }

  // Use tilde notation for files in home directory
  const homeDir = homedir()
  if (filePath.startsWith(homeDir + sep)) {
    return '~' + filePath.slice(homeDir.length)
  }

  // Otherwise return the absolute path
  return filePath
}
/**

 */
export async function getFileModificationTimeAsync(
  filePath: string,
): Promise<number> {
  const s = await stat(filePath)
  return Math.floor(s.mtimeMs)
}
export function findSimilarFile(filePath: string): string | undefined {
  try {
    const dir = dirname(filePath)
    const fileBaseName = basename(filePath, extname(filePath))

    // Get all files in the directory
    const files: Dirent[] = readdirSync(dir, { withFileTypes: true });

    // Find files with the same base name but different extension
    const similarFiles = files.filter(
      file =>
        basename(file.name, extname(file.name)) === fileBaseName &&
        join(dir, file.name) !== filePath,
    )

    // Return just the filename of the first match if found
    const firstMatch = similarFiles[0]
    if (firstMatch) {
      return firstMatch.name
    }
    return undefined
  } catch (error) {
    // Missing dir (ENOENT) is expected; for other errors log and return undefined
    if (!isENOENT(error)) {
    }
    return undefined
  }
}

/**
 * Check if a file path has a binary extension.
 */
export function hasBinaryExtension(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
  return BINARY_EXTENSIONS.has(ext)
}

/**
 * Get the normalized modification time of a file in milliseconds.
 * Uses Math.floor to ensure consistent timestamp comparisons across file operations,
 * reducing false positives from sub-millisecond precision changes (e.g., from IDE
 * file watchers that touch files without changing content).
 */
export function getFileModificationTime(filePath: string): number {
  return Math.floor(statSync(filePath).mtimeMs)
}
/**
 * Suggests a corrected path under the current working directory when a file/directory
 * is not found. Detects the "dropped repo folder" pattern where the model constructs
 * an absolute path missing the repo directory component.
 *
 * Example:
 *   cwd = /Users/zeeg/src/currentRepo
 *   requestedPath = /Users/zeeg/src/foobar           (doesn't exist)
 *   returns        /Users/zeeg/src/currentRepo/foobar (if it exists)
 *
 * @param requestedPath - The absolute path that was not found
 * @returns The corrected path if found under cwd, undefined otherwise
 */
export async function suggestPathUnderCwd(
  requestedPath: string,
): Promise<string | undefined> {
  const cwd = getCwd()
  const cwdParent = dirname(cwd)

  // Resolve symlinks in the requested path's parent directory (e.g., /tmp -> /private/tmp on macOS)
  // so the prefix comparison works correctly against the cwd (which is already realpath-resolved).
  let resolvedPath = requestedPath
  try {
    const resolvedDir = await realpath(dirname(requestedPath))
    resolvedPath = join(resolvedDir, basename(requestedPath))
  } catch {
    // Parent directory doesn't exist, use the original path
  }

  // Only check if the requested path is under cwd's parent but not under cwd itself.
  // When cwdParent is the root directory (e.g., '/'), use it directly as the prefix
  // to avoid a double-separator '//' that would never match.
  const cwdParentPrefix = cwdParent === sep ? sep : cwdParent + sep
  if (
    !resolvedPath.startsWith(cwdParentPrefix) ||
    resolvedPath.startsWith(cwd + sep) ||
    resolvedPath === cwd
  ) {
    return undefined
  }

  // Get the relative path from the parent directory
  const relFromParent = relative(cwdParent, resolvedPath)

  // Check if the same relative path exists under cwd
  const correctedPath = join(cwd, relFromParent)
  try {
    await stat(correctedPath)
    return correctedPath
  } catch {
    return undefined
  }
}
/**
 * Adds cat -n style line numbers to the content.
 */
export function addLineNumbers({
  content,
  // 1-indexed
  startLine,
}: {
  content: string
  startLine: number
}): string {
  if (!content) {
    return ''
  }

  const lines = content.split(/\r?\n/)

  return lines//默认紧凑模式
    .map((line, index) => `${index + startLine}\t${line}`)
    .join('\n')

  // return lines
  //   .map((line, index) => {
  //     const numStr = String(index + startLine)
  //     if (numStr.length >= 6) {
  //       return `${numStr}→${line}`
  //     }
  //     return `${numStr.padStart(6, ' ')}→${line}`
  //   })
  //   .join('\n')
}
export function safeResolvePath(
  filePath: string,
): { resolvedPath: string; isSymlink: boolean; isCanonical: boolean } {
  // Block UNC paths before any filesystem access to prevent network
  // requests (DNS/SMB) during validation on Windows
  if (filePath.startsWith('//') || filePath.startsWith('\\\\')) {
    return { resolvedPath: filePath, isSymlink: false, isCanonical: false }
  }

  try {
    // Check for special file types (FIFOs, sockets, devices) before calling realpathSync.
    // realpathSync can block on FIFOs waiting for a writer, causing hangs.
    // If the file doesn't exist, lstatSync throws ENOENT which the catch
    // below handles by returning the original path (allows file creation).
    const stats = lstatSync(filePath)
    if (
      stats.isFIFO() ||
      stats.isSocket() ||
      stats.isCharacterDevice() ||
      stats.isBlockDevice()
    ) {
      return { resolvedPath: filePath, isSymlink: false, isCanonical: false }
    }

    const resolvedPath = realpathSync(filePath)
    return {
      resolvedPath,
      isSymlink: resolvedPath !== filePath,
      // realpathSync returned: resolvedPath is canonical (all symlinks in
      // all path components resolved). Callers can skip further symlink
      // resolution on this path.
      isCanonical: true,
    }
  } catch (_error) {
    // If lstat/realpath fails for any reason (ENOENT, broken symlink,
    // EACCES, ELOOP, etc.), return the original path to allow operations
    // to proceed
    return { resolvedPath: filePath, isSymlink: false, isCanonical: false }
  }
}
export function fsReadSync(fsPath:string,  options: {
      length: number
    },)
{
  let fd: number | undefined
  try {
    fd = openSync(fsPath, 'r')
    const buffer = Buffer.alloc(options.length)
    const bytesRead = readSync(fd, buffer, 0, options.length, 0)
    return { buffer, bytesRead }
  } finally {
    if (fd) closeSync(fd)
  }
}
export function writeTextContent(
  filePath: string,
  content: string,
  encoding: BufferEncoding,
  endings: LineEndingType,
): void {
  let toWrite = content
  if (endings === 'CRLF') {
    // Normalize any existing CRLF to LF first so a new_string that already
    // contains \r\n (raw model output) doesn't become \r\r\n after the join.
    toWrite = content.replaceAll('\r\n', '\n').split('\n').join('\r\n')
  }

  writeFileSyncAndFlush_DEPRECATED(filePath, toWrite, { encoding })
}

/**
 * Writes to a file and flushes the file to disk
 * @param filePath The path to the file to write to
 * @param content The content to write to the file
 * @param options Options for writing the file, including encoding and mode
 * @deprecated Use `fs.promises.writeFile` with flush option instead for non-blocking writes.
 * Sync file writes block the event loop and cause performance issues.
 */
export function writeFileSyncAndFlush_DEPRECATED(
  filePath: string,
  content: string,
  options: { encoding: BufferEncoding; mode?: number } = { encoding: 'utf-8' },
): void {
  // Check if the target file is a symlink to preserve it for all users
  // Note: We don't use safeResolvePath here because we need to manually handle
  // symlinks to ensure we write to the target while preserving the symlink itself
  let targetPath = filePath
  try {
    // Try to read the symlink - if successful, it's a symlink
    const linkTarget = readlinkSync(filePath)
    // Resolve to absolute path
    targetPath = isAbsolute(linkTarget)
      ? linkTarget
      : resolve(dirname(filePath), linkTarget)
  } catch {
    // ENOENT (doesn't exist) or EINVAL (not a symlink) — keep targetPath = filePath
  }

  // Try atomic write first
  const tempPath = `${targetPath}.tmp.${process.pid}.${Date.now()}`

  // Check if target file exists and get its permissions (single stat, reused in both atomic and fallback paths)
  let targetMode: number | undefined
  let targetExists = false
  try {
    targetMode = statSync(targetPath).mode
    targetExists = true
  } catch (e) {
    if (!isENOENT(e)) throw e
    if (options.mode !== undefined) {
      // Use provided mode for new files
      targetMode = options.mode
    }
  }

  try {

    // Write to temp file with flush and mode (if specified for new file)
    const writeOptions: {
      encoding: BufferEncoding
      flush: boolean
      mode?: number
    } = {
      encoding: options.encoding,
      flush: true,
    }
    // Only set mode in writeFileSync for new files to ensure atomic permission setting
    if (!targetExists && options.mode !== undefined) {
      writeOptions.mode = options.mode
    }

    fsWriteFileSync(tempPath, content, writeOptions)//直接同步写入文件

    // For existing files or if mode was not set atomically, apply permissions 对于存在的文件，更改文件权限
    if (targetExists && targetMode !== undefined) {
      chmodSync(tempPath, targetMode)
    
    }

    // Atomic rename (on POSIX systems, this is atomic)
    // On Windows, this will overwrite the destination if it exists
    renameSync(tempPath, targetPath)//原子的重命名
  } catch (atomicError) {//原子错误
    //回退到非原子写入
    // Clean up temp file on error
    try {
      unlinkSync(tempPath)//先删除临时文件
    } catch (cleanupError) {
    }

    // Fallback to non-atomic write
    try {
      const fallbackOptions: {//回退
        encoding: BufferEncoding
        flush: boolean
        mode?: number
      } = {
        encoding: options.encoding,
        flush: true,
      }
      // Only set mode for new files
      if (!targetExists && options.mode !== undefined) {
        fallbackOptions.mode = options.mode
      }

      fsWriteFileSync(targetPath, content, fallbackOptions)

    } catch (fallbackError) {
      throw fallbackError
    }
  }
}
/**
 * Reads a file with caching to avoid redundant I/O operations.
 * This is the preferred method for FileEditTool operations.
 */
export function readFileSyncCached(filePath: string): string {
  const { content } = fileReadCache.readFile(filePath)
  return content
}


/**
 * Async generator that yields lines from a file in reverse order.
 * Reads the file backwards in chunks to avoid loading the entire file into memory.
 * @param path - The path to the file to read
 * @returns An async generator that yields lines in reverse order
 */
export async function* readLinesReverse(
  path: string,//从后往前逐行读取文件，且不把整个文件加载到内存（适合超大文件），完美处理 UTF-8 多字节字符、换行符分割问题。
): AsyncGenerator<string, void, undefined> {
  const CHUNK_SIZE = 1024 * 4
  const fileHandle=await open(path,'r');//每次只读取 4KB 小片段，内存占用极低
  try {
    const stats = await fileHandle.stat()
    let position = stats.size// 读取指针 = 文件总大小（从末尾开始读）
    // Carry raw bytes (not a decoded string) across chunk boundaries so that
    // multi-byte UTF-8 sequences split by the 4KB boundary are not corrupted.
    // Decoding per-chunk would turn a split sequence into U+FFFD on both sides,
    // which for history.jsonl means JSON.parse throws and the entry is dropped.
    let remainder = Buffer.alloc(0)// 存储上一次剩下的字节（关键！）
    const buffer = Buffer.alloc(CHUNK_SIZE)// 读取缓冲区

    while (position > 0) {
      const currentChunkSize = Math.min(CHUNK_SIZE, position)
      position -= currentChunkSize

      await fileHandle.read(buffer, 0, currentChunkSize, position)
      const combined = Buffer.concat([
        buffer.subarray(0, currentChunkSize),
        remainder,
      ])

      const firstNewline = combined.indexOf(0x0a)
      if (firstNewline === -1) {
        remainder = combined
        continue
      }

      remainder = Buffer.from(combined.subarray(0, firstNewline))
      const lines = combined.toString('utf8', firstNewline + 1).split('\n')

      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i]!
        if (line) {
          yield line
        }
      }
    }

    if (remainder.length > 0) {
      yield remainder.toString('utf8')
    }
  } finally {
    await fileHandle.close()
  }
}
/**
 * Gets all paths that should be checked for permissions.
 * This includes the original path, all intermediate symlink targets in the chain,
 * and the final resolved path.
 *
 * For example, if test.txt -> /etc/passwd -> /private/etc/passwd:
 * - test.txt (original path)
 * - /etc/passwd (intermediate symlink target)
 * - /private/etc/passwd (final resolved path)
 *
 * This is important for security: a deny rule for /etc/passwd should block
 * access even if the file is actually at /private/etc/passwd (as on macOS).
 *
 * @param path - The path to check (will be converted to absolute)
 * @returns An array of absolute paths to check permissions for
 */
export function getPathsForPermissionCheck(inputPath: string): string[] {// 输出所有需要检查权限的路径列表
  // Expand tilde notation defensively - tools should do this in getPath(),
  // but we normalize here as defense in depth for permission checking
  let path = inputPath
  if (path === '~') {
    path = homedir().normalize('NFC')//把路径字符串统一成【标准Unicode格式】
  } else if (path.startsWith('~/')) {
    path = nodePath.join(homedir().normalize('NFC'), path.slice(2))
  }

  const pathSet = new Set<string>()
  // Always check the original path
  pathSet.add(path)

  // Block UNC paths before any filesystem access to prevent network
  // requests (DNS/SMB) during validation on Windows
  if (path.startsWith('//') || path.startsWith('\\\\')) {
    return Array.from(pathSet)
  }

  // Follow the symlink chain, collecting ALL intermediate targets
  // This handles cases like: test.txt -> /etc/passwd -> /private/etc/passwd
  // We want to check all three paths, not just test.txt and /private/etc/passwd
  try {
    let currentPath = path
    const visited = new Set<string>()
    const maxDepth = 40 // Prevent runaway loops, matches typical SYMLOOP_MAX

    for (let depth = 0; depth < maxDepth; depth++) {
      // Prevent infinite loops from circular symlinks
      if (visited.has(currentPath)) {
        break
      }
      visited.add(currentPath)

      if (!existsSync(currentPath)) {
        // Path doesn't exist (new file case). existsSync follows symlinks,
        // so this is also reached for DANGLING symlinks (link entry exists,
        // target doesn't). Resolve symlinks in the path and its ancestors
        // so permission checks see the real destination. Without this,
        // `./data -> /etc/cron.d/` (live parent symlink) or
        // `./evil.txt -> ~/.ssh/authorized_keys2` (dangling file symlink)
        // would allow writes that escape the working directory.
        if (currentPath === path) {
          const resolved = resolveDeepestExistingAncestorSync(path)
          if (resolved !== undefined) {
            pathSet.add(resolved)
          }
        }
        break
      }

      const stats = lstatSync(currentPath)

      // Skip special file types that can cause issues
      if (
        stats.isFIFO() ||
        stats.isSocket() ||
        stats.isCharacterDevice() ||
        stats.isBlockDevice()
      ) {
        break
      }

      if (!stats.isSymbolicLink()) {
        break
      }

      // Get the immediate symlink target
      const target = readlinkSync(currentPath)

      // If target is relative, resolve it relative to the symlink's directory
      const absoluteTarget = nodePath.isAbsolute(target)
        ? target
        : nodePath.resolve(nodePath.dirname(currentPath), target)

      // Add this intermediate target to the set
      pathSet.add(absoluteTarget)
      currentPath = absoluteTarget
    }
  } catch {
    // If anything fails during chain traversal, continue with what we have
  }

  // Also add the final resolved path using realpathSync for completeness
  // This handles any remaining symlinks in directory components
  const { resolvedPath, isSymlink } = safeResolvePath(path)
  if (isSymlink && resolvedPath !== path) {
    pathSet.add(resolvedPath)
  }

  return Array.from(pathSet)
}

/**
 * Resolve the deepest existing ancestor of a path via realpathSync, walking
 * up until it succeeds. Detects dangling symlinks (link entry exists, target
 * doesn't) via lstat and resolves them via readlink.
 *
 * Use when the input path may not exist (new file writes) and you need to
 * know where the write would ACTUALLY land after the OS follows symlinks.
 *
 * Returns the resolved absolute path with non-existent tail segments
 * rejoined, or undefined if no symlink was found in any existing ancestor
 * (the path's existing ancestors all resolve to themselves).
 *
 * Handles: live parent symlinks, dangling file symlinks, dangling parent
 * symlinks. Same core algorithm as teamMemPaths.ts:realpathDeepestExisting.
 */
export function resolveDeepestExistingAncestorSync(//路径不存在时，找到它最深层的真实存在的祖先目录，并解析软链接。
  absolutePath: string,
): string | undefined {
  let dir = absolutePath
  const segments: string[] = []
  let st=null
  // Walk up using lstat (cheap, O(1)) to find the first existing component.
  // lstat does not follow symlinks, so dangling symlinks are detected here.
  // Only call realpathSync (expensive, O(depth)) once at the end.
  while (dir !== nodePath.dirname(dir)) {
    try {
      st = lstatSync(dir)
    } catch {
      // lstat failed: truly non-existent. Walk up.
      segments.unshift(nodePath.basename(dir))
      dir = nodePath.dirname(dir)
      continue
    }
    if (st.isSymbolicLink()) {
      // Found a symlink (live or dangling). Try realpath first (resolves
      // chained symlinks); fall back to readlink for dangling symlinks.
      try {
        const resolved = realpathSync(dir)
        return segments.length === 0
          ? resolved
          : nodePath.join(resolved, ...segments)
      } catch {
        // Dangling: realpath failed but lstat saw the link entry.
        const target = readlinkSync(dir)
        const absTarget = nodePath.isAbsolute(target)
          ? target
          : nodePath.resolve(nodePath.dirname(dir), target)
        return segments.length === 0
          ? absTarget
          : nodePath.join(absTarget, ...segments)
      }
    }
    // Existing non-symlink component. One realpath call resolves any
    // symlinks in its ancestors. If none, return undefined (no symlink).
    try {
      const resolved = realpathSync(dir)
      if (resolved !== dir) {
        return segments.length === 0
          ? resolved
          : nodePath.join(resolved, ...segments)
      }
    } catch {
      // realpath can still fail (e.g. EACCES in ancestors). Return
      // undefined — we can't resolve, and the logical path is already
      // in pathSet for the caller.
    }
    return undefined
  }
  return undefined
}
