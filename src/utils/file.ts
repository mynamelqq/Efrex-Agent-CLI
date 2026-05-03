
import { chmodSync, readFileSync, writeFileSync as fsWriteFileSync } from 'fs'
import { realpath, stat } from 'fs/promises'
import { homedir } from 'os'
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
