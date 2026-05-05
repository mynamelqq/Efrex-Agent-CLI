
import { chmodSync, readFileSync, writeFileSync as fsWriteFileSync } from 'fs'
import { realpath, stat } from 'fs/promises'
import { homedir } from 'os'
import { readdirSync,Dirent } from 'fs'
import { isENOENT } from './error.js'
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

import { getPlatform } from './platform.js'
export type File = {
  filename: string
  content: string
}
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