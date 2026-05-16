import type { UUID } from 'crypto'
import { FileHistorySnapshotMessage, Entry } from 'src/types/logs.js'
import type { FileHistorySnapshot } from './fileHistory.js'
import { registerCleanup } from './cleanupRegistry.js'
import { getSessionProjectDir } from '../bootstrap/state.js'
import { appendFile as fsAppendFile, mkdir } from 'fs/promises'
import memoize from 'lodash/memoize'
import { dirname, join } from 'path'
import { getOriginalCwd, getSessionId } from '../bootstrap/state.js'
import { getEfrexConfigHomeDir } from './envUtils.js'

let project: Project | null = null
let cleanupRegistered = false

export function getProjectsDir(): string {
  return join(getEfrexConfigHomeDir(), 'projects')
}

export const TOOL_RESULTS_SUBDIR = 'tool-results'
export function getToolResultsDir(): string {
  return join(getSessionDir(), TOOL_RESULTS_SUBDIR)
}

function getSessionDir(): string {
  return join(getProjectDir(getOriginalCwd()), getSessionId())
}

export const getProjectDir = memoize((projectDir: string): string => {
  return join(getProjectsDir(), sanitizePath(projectDir))
})
export function getTranscriptPath(): string {//.claude/projects/Chat--UI/sessionId.jsonl
  const projectDir = getSessionProjectDir() ?? getProjectDir(getOriginalCwd())//回/.efrex/‘项目名称’/会话的jsonl
  return join(projectDir, `${getSessionId()}.jsonl`)
}

export const MAX_TRANSCRIPT_READ_BYTES = 50 * 1024 * 1024

export function sanitizePath(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9]/g, '-')
  if (sanitized.length <= MAX_SANITIZED_LENGTH) {
    return sanitized
  }
  const hash =
    typeof Bun !== 'undefined' ? Bun.hash(name).toString(36) : simpleHash(name)
  return `${sanitized.slice(0, MAX_SANITIZED_LENGTH)}-${hash}`
}

export const MAX_SANITIZED_LENGTH = 200

function simpleHash(str: string): string {
  return Math.abs(djb2Hash(str)).toString(36)
}

export function djb2Hash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return hash
}

export async function recordFileHistorySnapshot(
  messageId: UUID,
  snapshot: FileHistorySnapshot,
  isSnapshotUpdate: boolean,
) {
  await getProject().insertFileHistorySnapshot(
    messageId,
    snapshot,
    isSnapshotUpdate,
  )
}

function getProject(): Project {
  if (!project) {
    project = new Project()
    if (!cleanupRegistered) {
      registerCleanup(async () => {
        await project?.flush()
      })
      cleanupRegistered = true
    }
  }
  return project
}

class Project {
  private pendingWriteCount: number = 0
  private flushResolvers: Array<() => void> = []
  private writeQueues = new Map<
    string,
    Array<{ entry: Entry; resolve: () => void }>
  >()
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private activeDrain: Promise<void> | null = null
  private readonly FLUSH_INTERVAL_MS = 100
  private readonly MAX_CHUNK_BYTES = 100 * 1024 * 1024
  private sessionFile: string | null = null

  private incrementPendingWrites(): void {
    this.pendingWriteCount++
  }

  private decrementPendingWrites(): void {
    this.pendingWriteCount--
    if (this.pendingWriteCount === 0) {
      for (const resolve of this.flushResolvers) {
        resolve()
      }
      this.flushResolvers = []
    }
  }

  private async trackWrite<T>(fn: () => Promise<T>): Promise<T> {
    this.incrementPendingWrites()
    try {
      return await fn()
    } finally {
      this.decrementPendingWrites()
    }
  }
//私有方法：将写入任务加入队列（入队），返回 Promise
  private enqueueWrite(filePath: string, entry: Entry): Promise<void> {//出队写入
    return new Promise<void>(resolve => {
      let queue = this.writeQueues.get(filePath)// 获取当前文件对应的写入队列（每个文件独立一个队列）
      if (!queue) {// 2. 如果队列不存在，创建空队列并缓存到 Map 中
        queue = []
        this.writeQueues.set(filePath, queue)
      }
      if (queue.length >= 1000) {//限流核心：队列长度 ≥ 1000 时，丢弃最旧的任务
        const dropped = queue.splice(0, queue.length - 999)
        for (const d of dropped) {
          d.resolve()// 遍历被丢弃的任务，直接 resolve 它们的 Promise
        }
      }//将当前写入任务（数据 + Promise 回调）加入队列
      queue.push({ entry, resolve })
      this.scheduleDrain()// 5. 调度执行队列（开始消费写入）
    })
  }
 
  private scheduleDrain(): void {//消费  延迟批量写入 同一时间只跑一个消费任务 写完还有数据，自动继续调度  分块写入：超大内容自动切分，避免单次写入过大
    if (this.flushTimer) {//scheduleDrain () —— 调度器 延迟一段时间后，批量执行写入，避免频繁 IO。
      return
    }
    this.flushTimer = setTimeout(async () => {
      this.flushTimer = null
      this.activeDrain = this.drainWriteQueue()
      await this.activeDrain// 执行真正的消费逻辑，并保存 promise，防止并发
      this.activeDrain = null
      if (this.writeQueues.size > 0) {//如果队列还有继续调度
        this.scheduleDrain()
      }
    }, this.FLUSH_INTERVAL_MS)
  }

  private async appendToFile(filePath: string, data: string): Promise<void> {
    try {
      await fsAppendFile(filePath, data, { mode: 0o600 })//写入文件末尾 fsAppendFile
    } catch {
      await mkdir(dirname(filePath), { recursive: true, mode: 0o700 })
      await fsAppendFile(filePath, data, { mode: 0o600 })
    }
  }

  private async drainWriteQueue(): Promise<void> {
    for (const [filePath, queue] of this.writeQueues) {// 遍历每个文件的写入队列
      if (queue.length === 0) {
        continue
      }
      const batch = queue.splice(0)// 一次性取出队列中**所有数据**（批量核心）

      let content = ''// 拼接的写入内容
      const resolvers: Array<() => void> = []
  // 遍历这批数据，拼接内容 + 收集resolver
      for (const { entry, resolve } of batch) {
        const line = JSON.stringify(entry) + '\n'
 // 如果当前块 + 新行 超过最大大小 → 先写入一次
        if (content.length + line.length >= this.MAX_CHUNK_BYTES) {
          await this.appendToFile(filePath, content)
          for (const r of resolvers) {
            r()
          }
          resolvers.length = 0
          content = ''
        }

        content += line
        resolvers.push(resolve) // 收集resolver
      }
 // 最后清理：所有空队列直接删除，释放内存
      if (content.length > 0) {
        await this.appendToFile(filePath, content)
        for (const r of resolvers) {
          r()
        }
      }
    }

    for (const [filePath, queue] of this.writeQueues) {
      if (queue.length === 0) {
        this.writeQueues.delete(filePath)
      }
    }
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (this.activeDrain) {
      await this.activeDrain
    }
    await this.drainWriteQueue()

    if (this.pendingWriteCount === 0) {
      return
    }
    return new Promise<void>(resolve => {
      this.flushResolvers.push(resolve)
    })
  }

  async insertFileHistorySnapshot(
    messageId: UUID,
    snapshot: FileHistorySnapshot,
    isSnapshotUpdate: boolean,
  ) {
    return this.trackWrite(async () => {
      const fileHistoryMessage: FileHistorySnapshotMessage = {
        type: 'file-history-snapshot',
        messageId,
        snapshot,
        isSnapshotUpdate,
      }
      await this.appendEntry(fileHistoryMessage)
    })
  }

  private ensureCurrentSessionFile(): string {
    if (this.sessionFile === null) {
      this.sessionFile = getTranscriptPath()
    }
    return this.sessionFile
  }

  private async appendEntry(entry: Entry) {
    const sessionFile = this.ensureCurrentSessionFile()//写入该文件
    void this.enqueueWrite(sessionFile, entry)
  }
}
