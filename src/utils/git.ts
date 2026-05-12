import { open, readFile, realpath, stat } from 'fs/promises'
import { createHash } from 'crypto'
import { readFileSync, realpathSync, statSync } from 'fs'
import memoize from 'lodash/memoize.js'
import { basename, dirname, join, resolve, sep } from 'path'
import { hasBinaryExtension, isBinaryContent } from '../constants/files.js'
import { getCwd } from './cwd.js'
import { logForDebugging } from './debug.js'
import { execFileNoThrow } from './execFileNoThrow.js'
import { logError } from './log.js'
import { memoizeWithLRU } from './memoize.js'
const GIT_ROOT_NOT_FOUND = Symbol('git-root-not-found')


/**
 * 通过沿着目录树向上查找 git root。
 * 查找 .git 目录或文件（工作树/子模块使用文件）。
 * 返回包含 .git 的目录，如果未找到则返回 null。
 *
 * 使用 LRU 缓存（最多 50 个条目）记录每个 startPath，以防止
 * 无限制的增长——gitDiff 用 dirname(file) 来调用它，所以编辑很多
 * 否则，不同目录中的文件将永远累积条目。
 */
export const findGitRoot = createFindGitRoot()

const findGitRootImpl = memoizeWithLRU(
  (startPath: string): string | typeof GIT_ROOT_NOT_FOUND => {
    const startTime = Date.now()
    let current = resolve(startPath)//绝对路径
    const root = current.substring(0, current.indexOf(sep) + 1) || sep
    let statCount = 0
    while (current !== root) {
      try {
        const gitPath = join(current, '.git')
        statCount++
        const stat = statSync(gitPath)
        // .git can be a directory (regular repo) or file (worktree/submodule)
        if (stat.isDirectory() || stat.isFile()) {
          return current.normalize('NFC')
        }
      } catch {
        // .git doesn't exist at this level, continue up
      }
      const parent = dirname(current)
      if (parent === current) {
        break
      }
      current = parent
    }

    // Check root directory as well
    try {
      const gitPath = join(root, '.git')
      statCount++
      const stat = statSync(gitPath)
      if (stat.isDirectory() || stat.isFile()) {
        return root.normalize('NFC')
      }
    } catch {
      // .git doesn't exist at root
    }
    return GIT_ROOT_NOT_FOUND
  },
  path => path,
  50,
)
function createFindGitRoot(): {
  (startPath: string): string | null
  cache: typeof findGitRootImpl.cache
} {
  function wrapper(startPath: string): string | null {
    const result = findGitRootImpl(startPath)
    return result === GIT_ROOT_NOT_FOUND ? null : result
  }
  wrapper.cache = findGitRootImpl.cache
  return wrapper
}

export const getIsGit = memoize(async (): Promise<boolean> => {
  const startTime = Date.now()
  const isGit = findGitRoot(getCwd()) !== null
  return isGit
})
