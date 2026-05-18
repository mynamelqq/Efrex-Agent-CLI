
import { chmodSync, readFileSync, renameSync, writeFileSync as fsWriteFileSync } from 'fs'
import { realpath, stat} from 'fs/promises'
import { homedir } from 'os'
import { lstatSync,realpathSync,openSync,readSync,closeSync,readlinkSync} from 'fs'
import { fileReadCache } from './fileReadCache'
import { readdirSync,Dirent,statSync,unlinkSync} from 'fs'
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


