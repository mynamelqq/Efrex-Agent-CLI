import { feature } from 'bun:bundle'
import type { UUID } from 'crypto'
import type { Dirent } from 'fs'
// Sync fs primitives for readFileTailSync — separate from fs/promises
// imports above. Named (not wildcard) per CLAUDE.md style; no collisions
// with the async-suffixed names.
import { closeSync, fstatSync, openSync, readSync } from 'fs'
import {
  appendFile as fsAppendFile,
  open as fsOpen,
  mkdir,
  readdir,
  readFile,
  stat,
  unlink,
  writeFile,
} from 'fs/promises'
import memoize from 'lodash/memoize'
import { basename, dirname, join } from 'path'
import {
  getOriginalCwd,
  getSessionId
} from '../bootstrap/state.js'
import { getEfrexConfigHomeDir } from './envUtils.js'

// Use getOriginalCwd() at each call site instead of capturing at module load
// time. getCwd() at import time may run before bootstrap resolves symlinks via
// realpathSync, causing a different sanitized project directory than what
// getOriginalCwd() returns after bootstrap. This split-brain made sessions
// saved under one path invisible when loaded via the other.

/**
 * 预编译的正则表达式可在提取第一个提示时跳过无意义的消息。
 * 匹配以小写 XML 类标记开头的任何内容（IDE 上下文、钩子
 * 输出、任务通知、通道消息等）或合成中断
 * 标记。与 sessionStoragePortable.ts 保持同步 — 避免通用模式
 * 随着新通知类型的发布，许可名单不断增长，但逐渐落后。
 */
// 50MB — 防止逻辑删除慢速路径中的 OOM 读取+重写
// 整个会话文件。会话文件可以增长到多个 GB (inc-3930)。
const MAX_TOMBSTONE_REWRITE_BYTES = 50 * 1024 * 1024

const SKIP_FIRST_PROMPT_PATTERN =
  /^(?:\s*<[a-z][\w-]*[\s>]|\[Request interrupted by user[^\]]*\])/

export function getProjectsDir(): string {
  return join(getEfrexConfigHomeDir(), 'projects')
}

// Subdirectory name for tool results within a session
export const TOOL_RESULTS_SUBDIR = 'tool-results'
export function getToolResultsDir(): string {
  return join(getSessionDir(), TOOL_RESULTS_SUBDIR)//~/.efrex/sessions/<sessionId>/tool-results
}


function getSessionDir(): string {
  return join(getProjectDir(getOriginalCwd()), getSessionId())
}
// 记忆化：通过 hooks.ts createBaseHookInput 每回合调用 12 次以上
// （PostToolUse路径，5×/转）+各种保存*功能。输入是cwd
// 字符串； homedir/env/regex 都是会话不变的，所以结果是
// 对于给定的输入是稳定的。工作树开关只是改变键 -不
// 需要清除缓存。
export const getProjectDir = memoize((projectDir: string): string => {
  return join(getProjectsDir(), sanitizePath(projectDir))
})
// 50 MB — 会话 JSONL 可以增长到多个 GB (inc-3930)。来电者表示
// 读取原始成绩单必须超过此阈值才能避免 OOM。
export const MAX_TRANSCRIPT_READ_BYTES = 50 * 1024 * 1024

// agentId的内存映射→用于分组相关子代理的子目录
// 转录本（例如工作流运行写入 subagents/workflows/<runId>/）。
// 在代理运行之前填充；由 getAgentTranscriptPath 咨询。
const agentTranscriptSubdirs = new Map<string, string>()
/**
 * 使字符串可以安全地用作目录或文件名。
 * 用连字符替换所有非字母数字字符。
 * 这确保了所有平台的兼容性，包括 Windows
 * 其中冒号等字符被保留。
 *
 * 对于超出文件系统限制（255 字节）的深层嵌套路径，
 * 截断并附加哈希后缀以确保唯一性。
 *
 * @param name -确保安全的字符串（例如“/Users/foo/my-project”或“plugin:name:server”）
 * @returns A safe name (e.g., '-Users-foo-my-project' or 'plugin-name-server')
 */
export function sanitizePath(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9]/g, '-')
  if (sanitized.length <= MAX_SANITIZED_LENGTH) {
    return sanitized
  }
  const hash =
    typeof Bun !== 'undefined' ? Bun.hash(name).toString(36) : simpleHash(name)
  return `${sanitized.slice(0, MAX_SANITIZED_LENGTH)}-${hash}`
}
/**
 * Maximum length for a single filesystem path component (directory or file name).
 * Most filesystems (ext4, APFS, NTFS) limit individual components to 255 bytes.
 * We use 200 to leave room for the hash suffix and separator.
 */
export const MAX_SANITIZED_LENGTH = 200
function simpleHash(str: string): string {
  return Math.abs(djb2Hash(str)).toString(36)
}
/**
 * djb2 string hash — fast non-cryptographic hash returning a signed 32-bit int.
 * Deterministic across runtimes (unlike Bun.hash which uses wyhash). Use as a
 * fallback when Bun.hash isn't available, or when you need on-disk-stable
 * output (e.g. cache directory names that must survive runtime upgrades).
 */
export function djb2Hash(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return hash
}