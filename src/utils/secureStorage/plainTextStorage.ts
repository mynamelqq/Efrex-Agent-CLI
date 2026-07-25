import { chmodSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getEfrexConfigHomeDir } from '../envUtils.js'
import { getErrnoCode } from '../errors.js'
import { readFile } from 'fs/promises'
import { writeFileSyncAndFlush_DEPRECATED } from '../file.js'
// Auto-generated stub — replace with real implementation
export type SecureStorage = any
export type SecureStorageData = any
function getStoragePath(): { storageDir: string; storagePath: string } {
  const storageDir = getEfrexConfigHomeDir()
  const storageFileName = '.credentials.json'//存储到.efrex/.credentials.json
  return { storageDir, storagePath: join(storageDir, storageFileName) }
}

export const plainTextStorage = {
  name: 'plaintext',
  read(): SecureStorageData | null {
    // sync IO: called from sync context (SecureStorage interface)
    const { storagePath } = getStoragePath()
    try {
      const data = readFileSync(storagePath, {
        encoding: 'utf8',
      })
      return JSON.parse(data)
    } catch {
      return null
    }
  },
  async readAsync(): Promise<SecureStorageData | null> {
    const { storagePath } = getStoragePath()
    try {
      const data = await readFile(storagePath, {
        encoding: 'utf8',
      })
      return JSON.parse(data)
    } catch {
      return null
    }
  },
  update(data: SecureStorageData): { success: boolean; warning?: string } {
    // sync IO: called from sync context (SecureStorage interface)
    try {
      const { storageDir, storagePath } = getStoragePath()
      try {
        mkdirSync(storageDir,{recursive:true})
      } catch (e: unknown) {
        const code = getErrnoCode(e)
        if (code !== 'EEXIST') {
          throw e
        }
      }
      writeFileSync(storagePath,JSON.stringify(data),{//写入存储文件并更改权限
        encoding: 'utf8',
        flush: false,
      })
      chmodSync(storagePath, 0o600)
      return {
        success: true,
        warning: 'Warning: Storing credentials in plaintext.',
      }
    } catch {
      return { success: false }
    }
  },
  delete(): boolean {
    // sync IO: called from sync context (SecureStorage interface)
    const { storagePath } = getStoragePath()
    try {
      unlinkSync(storagePath)
      return true
    } catch (e: unknown) {
      const code = getErrnoCode(e)
      if (code === 'ENOENT') {
        return true
      }
      return false
    }
  },
} satisfies SecureStorage
