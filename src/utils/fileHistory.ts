
import { createHash, type UUID } from 'crypto'
import { dirname, isAbsolute, join, relative } from 'path'
import { diffLines } from 'diff'
import type { Stats } from 'fs'
import { getOriginalCwd } from 'src/bootstrap/state'
import { logError } from './logger'
import { getSessionId } from 'src/bootstrap/state'
import { recordFileHistorySnapshot } from './sessionStorage'
import {
  chmod,
  copyFile,
  link,
  mkdir,
  readFile,
  stat,
  unlink,
} from 'fs/promises'
import { isEnvTruthy } from './envUtils'
import type { LogOption } from 'src/types/logs.js'
import { inspect } from 'util'
import { logForDebugging } from './debug.js'
import { getClaudeConfigHomeDir} from './envUtils.js'
import { getErrnoCode, isENOENT } from './errors.js'
import { pathExists } from './file.js'
type BackupFileName = string | null // The null value means the file does not exist in this version
import { getGlobalConfig } from './config'
export type FileHistoryBackup = {
  backupFileName: BackupFileName
  version: number
  backupTime: Date
}
export type FileHistorySnapshot = {
  messageId: UUID // The associated message ID for this snapshot
  trackedFileBackups: Record<string, FileHistoryBackup> // Map of file paths to backup versions
  timestamp: Date
}
export type FileHistoryState = {
  snapshots: FileHistorySnapshot[]
  trackedFiles: Set<string>
  // Monotonically-increasing counter incremented on every snapshot, even when
  // old snapshots are evicted.  Used by useGitDiffStats as an activity signal
  // (snapshots.length plateaus once the cap is reached).
  snapshotSequence: number
}
const MAX_SNAPSHOTS = 100
export type DiffStats =
  | {
      filesChanged?: string[]
      insertions: number
      deletions: number
    }
  | undefined

export function fileHistoryEnabled(): boolean {
  return (
    getGlobalConfig().fileCheckpointingEnabled !== false &&
    !isEnvTruthy(process.env.DISABLE_FILE_CHECKPOINTING)
  )
}
/**
 * Use the relative path as the key to reduce session storage space for tracking.
 */
function maybeShortenFilePath(filePath: string): string {//返回相对路径
  if (!isAbsolute(filePath)) {
    return filePath
  }
  const cwd = getOriginalCwd()
  if (filePath.startsWith(cwd)) {
    return relative(cwd, filePath)
  }
  return filePath
}

/**
* 通过创建文件当前内容的备份（如有必要）来跟踪文件的编辑（及添加）操作。 * *
*  此操作必须在实际添加或编辑文件之前执行，以便我们能够在编辑之前保存其内容。
 */
export async function fileHistoryTrackEdit(
  updateFileHistoryState: (
    updater: (prev: FileHistoryState) => FileHistoryState,
  ) => void,
  filePath: string,
  messageId: UUID,
): Promise<void> {
  if (!fileHistoryEnabled()) {
    return
  }

  const trackingPath = maybeShortenFilePath(filePath)
//每轮对话结束 会自动备份fileHistoryMakeSnapshot
// 第一步：检查是否需要备份。
// 因为重复调用这个函数会覆盖固定的 v1 备份文件。
// 如果第二次调用时又备份一次，会把原本正确的 v1 版本覆盖成 “编辑后” 的内容，导致历史损坏。
  let captured: FileHistoryState | undefined
  updateFileHistoryState(state => {
    // 调用状态更新函数，但不修改任何状态
// 把当前最新状态赋值给 captured
    captured = state
    return state
  })
  if (!captured) return//如果没有新状态
  const mostRecent = captured.snapshots.at(-1)//取出最后一份快照
  if (!mostRecent) {
    logError(new Error('FileHistory: Missing most recent snapshot'))
    return
  }
  if (mostRecent.trackedFileBackups[trackingPath]) {//已经跟踪了
// 已在最近的快照中进行过跟踪；下次执行“重新生成快照”操作时，会重新检查修改时间并进行备份操作（如果内容有变化的话）。请勿修改 v1 备份文件。
    return
  }

  // Phase 2: async backup.异步创建备份
  let backup: FileHistoryBackup
  try {
    backup = await createBackup(filePath, 1)
  } catch (error) {
    logError(error)
    return
  }
  const isAddingFile = backup.backupFileName === null//有没有新建文件？

  // Phase 3: 提交。重新检查已跟踪的内容（可能有其他版本的编辑内容抢先完成）。
  updateFileHistoryState((state: FileHistoryState) => {
    try {
      const mostRecentSnapshot = state.snapshots.at(-1)//查看最新的一个备份
      if (
        !mostRecentSnapshot ||
        mostRecentSnapshot.trackedFileBackups[trackingPath]//如果没找到或者 已经被跟踪了
      ) {
        return state
      }

      // 该文件在最近的快照中尚未被记录在案，因此我们需要在此处进行补录以将其纳入记录范围。
      const updatedTrackedFiles = state.trackedFiles.has(trackingPath)
        ? state.trackedFiles
        : new Set(state.trackedFiles).add(trackingPath)//重新创建set

// 局部复制就足够了：插入操作后，备份值永远不会被修改，因此我们只需要新的顶层 + 跟踪文件备份引用来实现 React 的变更检测。
// 深度克隆会复制每个现有备份的日期/字符串字段——添加一个条目需要 O(n) 的成本。
      const updatedMostRecentSnapshot = {
        ...mostRecentSnapshot,//最新的备份
        trackedFileBackups: {//
          ...mostRecentSnapshot.trackedFileBackups,
          [trackingPath]: backup,//增加
        },
      }

      const updatedState = {
        ...state,
        snapshots: (() => {//更新快照
          const copy = state.snapshots.slice()//原有的备份
          copy[copy.length - 1] = updatedMostRecentSnapshot//覆盖
          return copy
        })(),
        trackedFiles: updatedTrackedFiles,//记录更新的追踪文件名
      }
      // Record a snapshot update since it has changed.
      void recordFileHistorySnapshot(//持久化到项目会话jsonl
        messageId,
        updatedMostRecentSnapshot,
        true, // isSnapshotUpdate
      ).catch(error => {
        logError(new Error(`FileHistory: Failed to record snapshot: ${error}`))
      })

      logForDebugging(`FileHistory: Tracked file modification for ${filePath}`)

      return updatedState
    } catch (error) {
      logError(error)
      return state
    }
  })
}


/**
 * Creates a backup of the file at filePath. If the file does not exist
 * (ENOENT), records a null backup (file-did-not-exist marker). All IO is
 * async. Lazy mkdir: tries copyFile first, creates the directory on ENOENT.
 */
async function createBackup(
  filePath: string | null,
  version: number,
): Promise<FileHistoryBackup> {
  if (filePath === null) {
    return { backupFileName: null, version, backupTime: new Date() }
  }

  const backupFileName = getBackupFileName(filePath, version)//加密得到的文件名
  const backupPath = resolveBackupPath(backupFileName)//保存路径

  // 第一步：如果源文件不存在，则记录一个空的备份文件并跳过复制操作。
  // 这样就能清晰地区分“源文件缺失”和“备份目录缺失”这两种情况——如果为这两种情况都设置一个统一的捕获条件
  // ，那么在“复制文件成功”之后到“进行统计”这段时间内如果发生文件被删除的情况，就会导致出现一个状态为空的孤立备份文件。
  let srcStats: Stats
  try {
    srcStats = await stat(filePath)
  } catch (e: unknown) {
    if (isENOENT(e)) {
      return { backupFileName: null, version, backupTime: new Date() }
    }
    throw e
  }

  // copyFile preserves content and avoids reading the whole file into the JS
  // heap (which the previous readFileSync+writeFileSync pipeline did, OOMing
  // on large tracked files). Lazy mkdir: 99% of calls hit the fast path
  // (directory already exists); on ENOENT, mkdir then retry.
  try {
    await copyFile(filePath, backupPath)//复制备份
  } catch (e: unknown) {
    if (!isENOENT(e)) throw e
    await mkdir(dirname(backupPath), { recursive: true })//错误就重新创建文件路径
    await copyFile(filePath, backupPath)//再拷贝
  }

  // Preserve file permissions on the backup.
  await chmod(backupPath, srcStats.mode)//同意的权限



  return {
    backupFileName,
    version,
    backupTime: new Date(),
  }
}
function getBackupFileName(filePath: string, version: number): string {//sha256加密
  const fileNameHash = createHash('sha256')
    .update(filePath)
    .digest('hex')
    .slice(0, 16)
  return `${fileNameHash}@v${version}`//文件名后缀加上v版本号
}
function resolveBackupPath(backupFileName: string, sessionId?: string): string {
  const configDir = getClaudeConfigHomeDir()
  return join(
    configDir,
    'file-history',
    sessionId || getSessionId(),
    backupFileName,
  )
}