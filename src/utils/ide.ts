import axios from 'axios'
import { execa } from 'execa'
import capitalize from 'lodash/capitalize.js'
import memoize from 'lodash/memoize.js'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { createConnection } from 'net'
import * as os from 'os'
import { basename, join, sep as pathSeparator, resolve } from 'path'
import {  getOriginalCwd } from '../bootstrap/state.js'
import { env,} from './env.js'
import { GlobalConfig,getGlobalConfig,saveConfig,saveGlobalConfig} from './config.js'
import { envDynamic } from './envDynamic.js'
import { getIsScrollDraining } from '../bootstrap/state.js'
import { MCPServerConnection,ConnectedMCPServer } from 'src/services/mcp/types.js'
import { getEfrexConfigHomeDir, isEnvTruthy } from './envUtils.js'
import {
  execFileNoThrow,
  execFileNoThrowWithCwd,

} from './execFileNoThrow.js'
import { logError } from './log'
import { getPlatform } from './platform.js'
import {getAncestorPidsAsync} from './genericProcessUtils.js'
import { lt } from './semver.js'
import { createAbortController } from './abortController.js'
import { logForDebugging } from './debug.js'
/* eslint-enable @typescript-eslint/no-require-imports */
import { sleep } from './sleep.js'
import { WindowsToWSLConverter,checkWSLDistroMatch } from './idePathConversion.js'

import { errorMessage, isFsInaccessible } from './errors.js'
import { readdir, readFile, stat, unlink } from 'fs/promises'
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)//signal = 0 不是真正的"杀死"信号，而是一个空信号（null signal）
    return true
  } catch {
    return false
  }
}
// Returns a function that lazily fetches our process's ancestor PID chain,
// caching within the closure's lifetime. Callers should scope this to a
// single detection pass — PIDs recycle and process trees change over time.(//惰性缓存工厂
function makeAncestorPidLookup(): () => Promise<Set<number>> {//进程祖先链查找工具，用于获取当前进程（或指定进程）的父进程、祖父进程……直到根进程的 PID 列表。
  let promise: Promise<Set<number>> | null = null
  return () => {//能确定 当前 CLI 是由哪个 IDE 调用的
    if (!promise) {
      promise = getAncestorPidsAsync(process.ppid, 10).then(
        pids => new Set(pids),
      )
    }
    return promise
  }
}
  //IDE 进程间通信（IPC）的锁文件协议，用于 CLI 工具与运行中的 IDE 实例建立连接。
type LockfileJsonContent = {//（原始 JSON）
  workspaceFolders?: string[]//当前打开的工作区/项目路径列表
  pid?: number//主进程 ID
  ideName?: string
  transport?: 'ws' | 'sse'//通信协议：WebSocket 或 Server-Sent Events
  runningInWindows?: boolean
  authToken?: string//可选的认证令牌，用于连接时的身份验证
}
type IdeLockfileInfo = {// → 解析 → IdeLockfileInfo（内部使用）
  workspaceFolders: string[]
  port: number
  pid?: number
  ideName?: string
  useWebSocket: boolean
  runningInWindows: boolean
  authToken?: string
}
export type DetectedIDEInfo = {//转换 → DetectedIDEInfo（对外暴露）
  name: string
  port: number//通信端口
  workspaceFolders: string[]//根据协议和端口构造的连接 URL（如 ws://localhost:12345 或 http://localhost:12345/sse）
  url: string
  isValid: boolean//锁文件是否有效（PID 是否仍在运行、路径是否存在等）
  authToken?: string//透传认证令牌
  ideRunningInWindows?: boolean
}

export type IdeType =
  | 'cursor'
  | 'windsurf'
  | 'vscode'
  | 'pycharm'
  | 'intellij'
  | 'webstorm'
  | 'phpstorm'
  | 'rubymine'
  | 'clion'
  | 'goland'
  | 'rider'
  | 'datagrip'
  | 'appcode'
  | 'dataspell'
  | 'aqua'
  | 'gateway'
  | 'fleet'
  | 'androidstudio'
type IdeConfig = {
  ideKind: 'vscode' | 'jetbrains'//基类
  displayName: string
  processKeywordsMac: string[]
  processKeywordsWindows: string[]
  processKeywordsLinux: string[]
}
const supportedIdeConfigs: Record<IdeType, IdeConfig> = {
  cursor: {
    ideKind: 'vscode',
    displayName: 'Cursor',
    processKeywordsMac: ['Cursor Helper', 'Cursor.app'],
    processKeywordsWindows: ['cursor.exe'],
    processKeywordsLinux: ['cursor'],
  },
  windsurf: {
    ideKind: 'vscode',
    displayName: 'Windsurf',
    processKeywordsMac: ['Windsurf Helper', 'Windsurf.app'],
    processKeywordsWindows: ['windsurf.exe'],
    processKeywordsLinux: ['windsurf'],
  },
  vscode: {
    ideKind: 'vscode',
    displayName: 'VS Code',
    processKeywordsMac: ['Visual Studio Code', 'Code Helper'],
    processKeywordsWindows: ['code.exe'],
    processKeywordsLinux: ['code'],
  },
  intellij: {
    ideKind: 'jetbrains',
    displayName: 'IntelliJ IDEA',
    processKeywordsMac: ['IntelliJ IDEA'],
    processKeywordsWindows: ['idea64.exe'],
    processKeywordsLinux: ['idea', 'intellij'],
  },
  pycharm: {
    ideKind: 'jetbrains',
    displayName: 'PyCharm',
    processKeywordsMac: ['PyCharm'],
    processKeywordsWindows: ['pycharm64.exe'],
    processKeywordsLinux: ['pycharm'],
  },
  webstorm: {
    ideKind: 'jetbrains',
    displayName: 'WebStorm',
    processKeywordsMac: ['WebStorm'],
    processKeywordsWindows: ['webstorm64.exe'],
    processKeywordsLinux: ['webstorm'],
  },
  phpstorm: {
    ideKind: 'jetbrains',
    displayName: 'PhpStorm',
    processKeywordsMac: ['PhpStorm'],
    processKeywordsWindows: ['phpstorm64.exe'],
    processKeywordsLinux: ['phpstorm'],
  },
  rubymine: {
    ideKind: 'jetbrains',
    displayName: 'RubyMine',
    processKeywordsMac: ['RubyMine'],
    processKeywordsWindows: ['rubymine64.exe'],
    processKeywordsLinux: ['rubymine'],
  },
  clion: {
    ideKind: 'jetbrains',
    displayName: 'CLion',
    processKeywordsMac: ['CLion'],
    processKeywordsWindows: ['clion64.exe'],
    processKeywordsLinux: ['clion'],
  },
  goland: {
    ideKind: 'jetbrains',
    displayName: 'GoLand',
    processKeywordsMac: ['GoLand'],
    processKeywordsWindows: ['goland64.exe'],
    processKeywordsLinux: ['goland'],
  },
  rider: {
    ideKind: 'jetbrains',
    displayName: 'Rider',
    processKeywordsMac: ['Rider'],
    processKeywordsWindows: ['rider64.exe'],
    processKeywordsLinux: ['rider'],
  },
  datagrip: {
    ideKind: 'jetbrains',
    displayName: 'DataGrip',
    processKeywordsMac: ['DataGrip'],
    processKeywordsWindows: ['datagrip64.exe'],
    processKeywordsLinux: ['datagrip'],
  },
  appcode: {
    ideKind: 'jetbrains',
    displayName: 'AppCode',
    processKeywordsMac: ['AppCode'],
    processKeywordsWindows: ['appcode.exe'],
    processKeywordsLinux: ['appcode'],
  },
  dataspell: {
    ideKind: 'jetbrains',
    displayName: 'DataSpell',
    processKeywordsMac: ['DataSpell'],
    processKeywordsWindows: ['dataspell64.exe'],
    processKeywordsLinux: ['dataspell'],
  },
  aqua: {
    ideKind: 'jetbrains',
    displayName: 'Aqua',
    processKeywordsMac: [], // Do not auto-detect since aqua is too common
    processKeywordsWindows: ['aqua64.exe'],
    processKeywordsLinux: [],
  },
  gateway: {
    ideKind: 'jetbrains',
    displayName: 'Gateway',
    processKeywordsMac: [], // Do not auto-detect since gateway is too common
    processKeywordsWindows: ['gateway64.exe'],
    processKeywordsLinux: [],
  },
  fleet: {
    ideKind: 'jetbrains',
    displayName: 'Fleet',
    processKeywordsMac: [], // Do not auto-detect since fleet is too common
    processKeywordsWindows: ['fleet.exe'],
    processKeywordsLinux: [],
  },
  androidstudio: {
    ideKind: 'jetbrains',
    displayName: 'Android Studio',
    processKeywordsMac: ['Android Studio'],
    processKeywordsWindows: ['studio64.exe'],
    processKeywordsLinux: ['android-studio'],
  },
}
export function isVSCodeIde(ide: IdeType | null): boolean {//判断IDE是否是vscode
  if (!ide) return false
  const config = supportedIdeConfigs[ide]
  return config && config.ideKind === 'vscode'
}
export function isJetBrainsIde(ide: IdeType | null): boolean {
  if (!ide) return false
  const config = supportedIdeConfigs[ide]
  return config && config.ideKind === 'jetbrains'
}
export const isSupportedVSCodeTerminal = memoize(() => {
  return isVSCodeIde(env.terminal as IdeType)
})
export const isSupportedJetBrainsTerminal = memoize(() => {//是否支持jetbrains
  return isJetBrainsIde(envDynamic.terminal as IdeType)
})
export const isSupportedTerminal = memoize(() => {
  return (
    isSupportedVSCodeTerminal() ||
    isSupportedJetBrainsTerminal() ||
    Boolean(process.env.FORCE_CODE_TERMINAL)
  )
})
export function getTerminalIdeType(): IdeType | null {
  if (!isSupportedTerminal()) {
    return null
  }
  return env.terminal as IdeType
}

/**
 * Gets sorted IDE lockfiles from ~/.claude/ide directory
 * @returns Array of full lockfile paths sorted by modification time (newest first)
 */
export async function getSortedIdeLockfiles(): Promise<string[]> {
  try {
    const ideLockFilePaths = await getIdeLockfilesPaths()//获取潜在的 IDE 锁文件夹目录路径列表

    // Collect all lockfiles from all directories 从路径中收集所有的锁文件
    const allLockfiles: Array<{ path: string; mtime: Date }>[] =
      await Promise.all(
        ideLockFilePaths.map(async ideLockFilePath => {
          try {
            const entries = await readdir(ideLockFilePath, { withFileTypes: true })//读取文件夹
            const lockEntries = entries.filter(file =>//过滤掉只剩下lock结尾的文件
              file.name.endsWith('.lock'),
            )
            // Stat all lockfiles in parallel; skip ones that fail
            const stats = await Promise.all(//并发的stat所有的锁文件 跳过失败的
              lockEntries.map(async file => {
                const fullPath = join(ideLockFilePath, file.name)//文件的全路径
                try {
                  const fileStat = await stat(fullPath)//stat获取文件状态
                  return { path: fullPath, mtime: fileStat.mtime }
                } catch {
                  return null
                }
              }),
            )
            return stats.filter(s => s !== null)
          } catch (error) {
            return []
          }
        }),
      )

    // Flatten and sort all lockfiles by last modified date (newest first)
    return allLockfiles
      .flat()
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())//按时间从新到旧
      .map(file => file.path)
  } catch (error) {
    logError(error as Error)
    return []
  }
}
async function readIdeLockfile(path: string): Promise<IdeLockfileInfo | null> {
  try {
    const content = await readFile(path, {//读取文件
      encoding: 'utf-8',
    })

    let workspaceFolders: string[] = []
    let pid: number | undefined
    let ideName: string | undefined
    let useWebSocket = false
    let runningInWindows = false
    let authToken: string | undefined

    try {
      const parsedContent = JSON.parse(content) as LockfileJsonContent //解析JSON成
      if (parsedContent.workspaceFolders) {
        workspaceFolders = parsedContent.workspaceFolders
      }
      pid = parsedContent.pid//逐一获取JSON的信息
      ideName = parsedContent.ideName
      useWebSocket = parsedContent.transport === 'ws'
      runningInWindows = parsedContent.runningInWindows === true
      authToken = parsedContent.authToken
    } catch (_) {
      // Older format- just a list of paths.
      workspaceFolders = content.split('\n').map(line => line.trim())
    }

    // Extract the port from the filename (e.g., 12345.lock -> 12345)
    const filename = path.split(pathSeparator).pop()//提取文件名中的端口
    if (!filename) return null

    const port = filename.replace('.lock', '')//获取端口

    return {
      workspaceFolders,
      port: parseInt(port, 10),
      pid,
      ideName,
      useWebSocket,
      runningInWindows,
      authToken,
    }
  } catch (error) {
    logError(error as Error)
    return null
  }
}
/**
 * Checks if the IDE connection is responding by testing if the port is open
 * @param host Host to connect to
 * @param port Port to connect to
 * @param timeout Optional timeout in milliseconds (defaults to 500ms)
 * @returns true if the port is open, false otherwise
 */
async function checkIdeConnection(
  host: string,
  port: number,
  timeout = 500,
): Promise<boolean> {
  try {
    return new Promise(resolve => {//创建socket连接
      const socket = createConnection({
        host: host,
        port: port,
        timeout: timeout,
      })

      socket.on('connect', () => {
        socket.destroy()
        void resolve(true)
      })

      socket.on('error', () => {
        void resolve(false)
      })

      socket.on('timeout', () => {
        socket.destroy()
        void resolve(false)
      })
    })
  } catch (_) {
    // Invalid URL or other errors
    return false
  }
}


/**
 * Resolve the Windows USERPROFILE path. WSL often doesn't pass USERPROFILE
 * through, so fall back to shelling out to powershell.exe. That spawn is
 * ~500ms–2s cold; the value is static per session.
 */
const getWindowsUserProfile = memoize(async (): Promise<string | undefined> => {
  if (process.env.USERPROFILE) return process.env.USERPROFILE
  const { stdout, code } = await execFileNoThrow('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    '$env:USERPROFILE',
  ])
  if (code === 0 && stdout.trim()) return stdout.trim()
  logForDebugging(
    'Unable to get Windows USERPROFILE via PowerShell - IDE detection may be incomplete',
  )
  return undefined
})

/**
 * Gets the potential IDE lockfiles directories path based on platform.
 * Paths are not pre-checked for existence — the consumer readdirs each
 * and handles ENOENT. Pre-checking with stat() would double syscalls,
 * and on WSL (where /mnt/c access is 2-10x slower) the per-user-dir
 * stat loop compounded startup latency.
 */
export async function getIdeLockfilesPaths(): Promise<string[]> {
  const paths: string[] = [join(getEfrexConfigHomeDir(), 'ide')]

  if (getPlatform() !== 'wsl') {
    return paths
  }

  // For Windows, use heuristics to find the potential paths.
  // See https://learn.microsoft.com/en-us/windows/wsl/filesystems

  const windowsHome = await getWindowsUserProfile()//获取 Windows 用户主目录路径

  if (windowsHome) {
    const converter = new WindowsToWSLConverter(process.env.WSL_DISTRO_NAME)
    const wslPath = converter.toLocalPath(windowsHome)
    paths.push(resolve(wslPath, '.efrex', 'ide'))
  }

  // Construct the path based on the standard Windows WSL locations
  // This can fail if the current user does not have "List folder contents" permission on C:\Users
  try {//读取WSL的用户文件夹，这里可能有多个全部读取跳过系统文件夹
    const usersDir = '/mnt/c/Users'
    const userDirs = await readdir(usersDir,{withFileTypes:true})

    for (const user of userDirs) {
      // Skip files (e.g. desktop.ini) — readdir on a file path throws ENOTDIR.
      // isFsInaccessible covers ENOTDIR, but pre-filtering here avoids the
      // cost of attempting to readdir non-directories. Symlinks are kept since
      // Windows creates junction points for user profiles.
      if (!user.isDirectory() && !user.isSymbolicLink()) {
        continue
      }
      if (
        user.name === 'Public' ||
        user.name === 'Default' ||
        user.name === 'Default User' ||
        user.name === 'All Users'
      ) {
        continue // Skip system directories
      }
      paths.push(join(usersDir, user.name, '.efrex', 'ide'))
    }
  } catch (error: unknown) {
    if (isFsInaccessible(error)) {
      // Expected on WSL when C: drive is not mounted or user lacks permissions
      logForDebugging(
        `WSL IDE lockfile path detection failed (${error.code}): ${errorMessage(error)}`,
      )
    } else {
      logError(error)
    }
  }
  return paths
}


/**
 * Cleans up stale IDE lockfiles
 * - Removes lockfiles for processes that are no longer running
 * - Removes lockfiles for ports that are not responding
 */
export async function cleanupStaleIdeLockfiles(): Promise<void> {//清理死进程或无响应的 lockfile
  try {
    const lockfiles = await getSortedIdeLockfiles()

    for (const lockfilePath of lockfiles) {
      const lockfileInfo = await readIdeLockfile(lockfilePath)

      if (!lockfileInfo) {//如果没获取到信息就删掉
        // If we can't read the lockfile, delete it
        try {
          await unlink(lockfilePath)
        } catch (error) {
          logError(error as Error)
        }
        continue
      }

      const host = await detectHostIP(//获取IP地址，WSL和windows有点不一样
        lockfileInfo.runningInWindows,
        lockfileInfo.port,
      )

      let shouldDelete = false

      if (lockfileInfo.pid) {
        // Check if the process is still running
        if (!isProcessRunning(lockfileInfo.pid)) {//检查进程是否存在 进程不存在时
          if (getPlatform() !== 'wsl') {
            shouldDelete = true//如果不是wsl就删除
          } else {
            // The process id may not be reliable in wsl, so also check the connection
            const isResponding = await checkIdeConnection(//进程ID不可信，所有检查与IDE的连接
              host,
              lockfileInfo.port,
            )
            if (!isResponding) {
              shouldDelete = true//连接不上删掉
            }
          }
        }
      } else {
        // No PID, check if the URL is responding
        const isResponding = await checkIdeConnection(host, lockfileInfo.port)//没有进程PID 检查url连接
        if (!isResponding) {
          shouldDelete = true
        }
      }

      if (shouldDelete) {
        try {
          await unlink(lockfilePath)//删除
        } catch (error) {
          logError(error as Error)
        }
      }
    }
  } catch (error) {
    logError(error as Error)
  }
}
export interface IDEExtensionInstallationStatus {
  installed: boolean
  error: string | null
  installedVersion: string | null
  ideType: IdeType | null
}
export async function maybeInstallIDEExtension(
  ideType: IdeType,
): Promise<IDEExtensionInstallationStatus | null> {
  try {
    // Install/update the extension
    // const installedVersion = await installIDEExtension(ideType)//安装插件
    // Only track successful installations
    const installedVersion="0.0.1";
    // Set diff tool config to auto if it has not been set already
    // const globalConfig = getGlobalConfig()
    // if (!globalConfig.diffTool) {
    //   saveGlobalConfig(current => ({ ...current, diffTool: 'auto' }))
    // }
    return {
      installed: true,
      error: null,
      installedVersion,
      ideType: ideType,
    }
  } catch (error) {
    // Handle installation errors
    const errorMessage = error instanceof Error ? error.message : String(error)
    logError(error as Error)
    return {
      installed: false,
      error: errorMessage,
      installedVersion: null,
      ideType: ideType,
    }
  }
}

let currentIDESearch: AbortController | null = null

export async function findAvailableIDE(): Promise<DetectedIDEInfo | null> {//最多轮询 30 秒等待可用 IDE
  if (currentIDESearch) {
    currentIDESearch.abort()
  }
  currentIDESearch = createAbortController()
  const signal = currentIDESearch.signal

  // Clean up stale IDE lockfiles first so we don't check them at all.
  await cleanupStaleIdeLockfiles()//清理不合理的IDE lock文件
  const startTime = Date.now()
  while (Date.now() - startTime < 30_000 && !signal.aborted) {//在给定时间内轮询
    // Skip iteration during scroll drain — detectIDEs reads lockfiles +
    // shells out to ps, competing for the event loop with scroll frames.
    // Next tick after scroll settles resumes the search.
    if (getIsScrollDraining()) {
      await sleep(1000, signal)
      continue
    }
    const ides = await detectIDEs(false)//主要还是检测lock文件来找工作区相同的IDE
    if (signal.aborted) {
      return null
    }
    // Return the IDE if and only if there is exactly one match, otherwise the user must
    // use /ide to select an IDE. When running from a supported built-in terminal, detectIDEs()
    // should return at most one IDE.
    if (ides.length === 1) {//如果ides长度不为1那样让用户选择
      return ides[0]!
    }
    await sleep(1000, signal)
  }
  return null
}

/**
 * Detects IDEs that have a running extension/plugin.
 * @param includeInvalid If true, also return IDEs that are invalid (ie. where
 * the workspace directory does not match the cwd)
 */
export async function detectIDEs(//验证 lockfile 的 workspacefolder 是否包含当前 CWD，支持 NFC 路径归一化
  includeInvalid: boolean,
): Promise<DetectedIDEInfo[]> {
  const detectedIDEs: DetectedIDEInfo[] = []

  try {
    // Get the CLAUDE_CODE_SSE_PORT if set
    const ssePort = process.env.SSE_PORT
    const envPort = ssePort ? parseInt(ssePort, 10) : null

    // Get the current working directory, normalized to NFC for consistent
    // comparison. macOS returns NFD paths (decomposed Unicode), while IDEs
    // like VS Code report NFC paths (composed Unicode). Without normalization,
    // paths containing accented/CJK characters fail to match.
    const cwd = getOriginalCwd().normalize('NFC')

    // Get sorted lockfiles (full paths) and read them all in parallel.
    // findAvailableIDE() polls this every 1s for up to 30s; serial I/O here was
    // showing up as ~500ms self-time in CPU profiles.
    const lockfiles = await getSortedIdeLockfiles()//读取ide文件夹
    const lockfileInfos = await Promise.all(lockfiles.map(readIdeLockfile))//获取lockFile信息

    // Ancestor PID walk shells out (ps in a loop, up to 10x). Make it lazy and
    // single-shot per detectIDEs() call; with the workspace-check-first ordering
    // below, this often never fires at all.
    const getAncestors = makeAncestorPidLookup()//返回所有父节点的PID集合
    const needsAncestryCheck = getPlatform() !== 'wsl' && isSupportedTerminal()//

    // Try to find a lockfile that contains our current working directory
    for (const lockfileInfo of lockfileInfos) {//遍历每一个lock文件
      if (!lockfileInfo) continue

      let isValid = false
      if (isEnvTruthy(process.env.IDE_SKIP_VALID_CHECK)) {
        isValid = true
      } else if (lockfileInfo.port === envPort) {
        // If the port matches the environment variable, mark as valid regardless of directory
        isValid = true
      } else {
        // Otherwise, check if the current working directory is within the workspace folders
        isValid = lockfileInfo.workspaceFolders.some(idePath => {
          if (!idePath) return false

          let localPath = idePath

          // Handle WSL-specific path conversion and distro matching
          if (
            getPlatform() === 'wsl' &&
            lockfileInfo.runningInWindows &&
            process.env.WSL_DISTRO_NAME
          ) {
            // Check for WSL distro mismatch
            if (!checkWSLDistroMatch(idePath, process.env.WSL_DISTRO_NAME)) {
              return false
            }

            // Try both the original path and the converted path
            // This handles cases where the IDE might report either format
            const resolvedOriginal = resolve(localPath).normalize('NFC')
            if (
              cwd === resolvedOriginal ||
              cwd.startsWith(resolvedOriginal + pathSeparator)
            ) {
              return true
            }

            // Convert Windows IDE path to WSL local path and check that too
            const converter = new WindowsToWSLConverter(
              process.env.WSL_DISTRO_NAME,
            )
            localPath = converter.toLocalPath(idePath)
          }

          const resolvedPath = resolve(localPath).normalize('NFC')

          // On Windows, normalize paths for case-insensitive drive letter comparison
          if (getPlatform() === 'windows') {
            const normalizedCwd = cwd.replace(/^[a-zA-Z]:/, match =>
              match.toUpperCase(),
            )
            const normalizedResolvedPath = resolvedPath.replace(
              /^[a-zA-Z]:/,
              match => match.toUpperCase(),
            )
            return (
              normalizedCwd === normalizedResolvedPath ||
              normalizedCwd.startsWith(normalizedResolvedPath + pathSeparator)
            )
          }

          return (
            cwd === resolvedPath || cwd.startsWith(resolvedPath + pathSeparator)
          )
        })
      }

      if (!isValid && !includeInvalid) {//如果无效
        continue
      }

      // PID ancestry check: when running in a supported IDE's built-in terminal,
      // ensure this lockfile's IDE is actually our parent process. This
      // disambiguates when multiple IDE windows have overlapping workspace folders.
      // Runs AFTER the workspace check so non-matching lockfiles skip it entirely —
      // previously this shelled out once per lockfile and dominated CPU profiles
      // during findAvailableIDE() polling.
      if (needsAncestryCheck) {
        const portMatchesEnv = envPort !== null && lockfileInfo.port === envPort
        if (!portMatchesEnv) {
          if (!lockfileInfo.pid || !isProcessRunning(lockfileInfo.pid)) {
            continue
          }
          if (process.ppid !== lockfileInfo.pid) {
            const ancestors = await getAncestors()
            if (!ancestors.has(lockfileInfo.pid)) {
              continue
            }
          }
        }
      }

      const ideName =
        lockfileInfo.ideName ??
        (isSupportedTerminal() ? toIDEDisplayName(envDynamic.terminal) : 'IDE')

      const host = await detectHostIP(
        lockfileInfo.runningInWindows,
        lockfileInfo.port,
      )
      let url
      if (lockfileInfo.useWebSocket) {
        url = `ws://${host}:${lockfileInfo.port}`
      } else {
        url = `http://${host}:${lockfileInfo.port}/sse`
      }

      detectedIDEs.push({
        url: url,
        name: ideName,
        workspaceFolders: lockfileInfo.workspaceFolders,
        port: lockfileInfo.port,
        isValid: isValid,
        authToken: lockfileInfo.authToken,
        ideRunningInWindows: lockfileInfo.runningInWindows,
      })
    }

    // The envPort should be defined for supported IDE terminals. If there is
    // an extension with a matching envPort, then we will single that one out
    // and return it, otherwise we return all the valid ones.
    if (!includeInvalid && envPort) {
      const envPortMatch = detectedIDEs.filter(
        ide => ide.isValid && ide.port === envPort,
      )
      if (envPortMatch.length === 1) {
        return envPortMatch
      }
    }
  } catch (error) {
    logError(error as Error)
  }

  return detectedIDEs
}



function getEfrexVersion() {
  return typeof MACRO !== 'undefined' ? MACRO.VERSION : '0.0.1'
}
export async function maybeNotifyIDEConnected(client: Client) {
  await client.notification({
    method: 'ide_connected',
    params: {
      pid: process.pid,
    },
  })
}
async function installIDEExtension(ideType: IdeType): Promise<string | null> {
  if (isVSCodeIde(ideType)) {
    const command = await getVSCodeIDECommand(ideType)

    if (command) {
      let version = await getInstalledVSCodeExtensionVersion(command)
      // If it's not installed or the version is older than the one we have bundled,
      if (!version || lt(version,getEfrexVersion())) {
        // `code` may crash when invoked too quickly in succession
        await sleep(500)
        const result = await execFileNoThrowWithCwd(
          command,
          ['--force', '--install-extension', 'anthropic.claude-code'],
          {
            env: getInstallationEnv(),
          },
        )
        if (result.code !== 0) {
          throw new Error(`${result.code}: ${result.error} ${result.stderr}`)
        }
        version = getEfrexVersion()
      }
      return version
    }
  }
  // No automatic installation for JetBrains IDEs as it is not supported in native
  // builds. We show a prominent notice for them to download from the marketplace
  // instead.
  return null
}


async function getVSCodeIDECommand(ideType: IdeType): Promise<string | null> {
  const parentExecutable = getVSCodeIDECommandByParentProcess()
  if (parentExecutable) {
    // Verify the parent executable actually exists
    try {
      await stat(parentExecutable)
      return parentExecutable
    } catch {
      // Parent executable doesn't exist
    }
  }

  // On Windows, explicitly request the .cmd wrapper. VS Code 1.110.0 began
  // prepending the install root (containing Code.exe, the Electron GUI binary)
  // to the integrated terminal's PATH ahead of bin\ (containing code.cmd, the
  // CLI wrapper) when launched via Start-Menu/Taskbar shortcuts. A bare 'code'
  // then resolves to Code.exe via PATHEXT which opens a new editor window
  // instead of running the CLI. Asking for 'code.cmd' forces cross-spawn/which
  // to skip Code.exe. See microsoft/vscode#299416 (fixed in Insiders) and
  // anthropics/claude-code#30975.
  const ext = getPlatform() === 'windows' ? '.cmd' : ''
  switch (ideType) {
    case 'vscode':
      return 'code' + ext
    case 'cursor':
      return 'cursor' + ext
    case 'windsurf':
      return 'windsurf' + ext
    default:
      break
  }
  return null
}

export async function isCursorInstalled(): Promise<boolean> {
  const result = await execFileNoThrow('cursor', ['--version'])
  return result.code === 0
}
export async function isWindsurfInstalled(): Promise<boolean> {
  const result = await execFileNoThrow('windsurf', ['--version'])
  return result.code === 0
}
export async function isVSCodeInstalled(): Promise<boolean> {
  const result = await execFileNoThrow('code', ['--help'])
  // Check if the output indicates this is actually Visual Studio Code
  return (
    result.code === 0 && Boolean(result.stdout?.includes('Visual Studio Code'))
  )
}
// Cache for IDE detection results
let cachedRunningIDEs: IdeType[] | null = null
/**
 * Internal implementation of IDE detection.
 */
async function detectRunningIDEsImpl(): Promise<IdeType[]> {//检测正在运行的IDE
  const runningIDEs: IdeType[] = []

  try {
    const platform = getPlatform()
    if (platform === 'macos') {
      // On macOS, use ps with process name matching
      const result = await execa(
        'ps aux | grep -E "Visual Studio Code|Code Helper|Cursor Helper|Windsurf Helper|IntelliJ IDEA|PyCharm|WebStorm|PhpStorm|RubyMine|CLion|GoLand|Rider|DataGrip|AppCode|DataSpell|Aqua|Gateway|Fleet|Android Studio" | grep -v grep',
        { shell: true, reject: false },
      )
      const stdout = result.stdout ?? ''
      for (const [ide, config] of Object.entries(supportedIdeConfigs)) {
        for (const keyword of config.processKeywordsMac) {
          if (stdout.includes(keyword)) {
            runningIDEs.push(ide as IdeType)
            break
          }
        }
      }
    } else if (platform === 'windows') {
      // On Windows, use tasklist with findstr for multiple patterns
      const result = await execa(
        'tasklist | findstr /I "Code.exe Cursor.exe Windsurf.exe idea64.exe pycharm64.exe webstorm64.exe phpstorm64.exe rubymine64.exe clion64.exe goland64.exe rider64.exe datagrip64.exe appcode.exe dataspell64.exe aqua64.exe gateway64.exe fleet.exe studio64.exe"',
        { shell: true, reject: false },
      )
      const stdout = result.stdout ?? ''

      const normalizedStdout = stdout.toLowerCase()

      for (const [ide, config] of Object.entries(supportedIdeConfigs)) {
        for (const keyword of config.processKeywordsWindows) {
          if (normalizedStdout.includes(keyword.toLowerCase())) {
            runningIDEs.push(ide as IdeType)
            break
          }
        }
      }
    } else if (platform === 'linux') {
      // On Linux, use ps with process name matching
      const result = await execa(
        'ps aux | grep -E "code|cursor|windsurf|idea|pycharm|webstorm|phpstorm|rubymine|clion|goland|rider|datagrip|dataspell|aqua|gateway|fleet|android-studio" | grep -v grep',
        { shell: true, reject: false },
      )
      const stdout = result.stdout ?? ''

      const normalizedStdout = stdout.toLowerCase()

      for (const [ide, config] of Object.entries(supportedIdeConfigs)) {
        for (const keyword of config.processKeywordsLinux) {
          if (normalizedStdout.includes(keyword)) {
            if (ide !== 'vscode') {
              runningIDEs.push(ide as IdeType)
              break
            } else if (
              !normalizedStdout.includes('cursor') &&
              !normalizedStdout.includes('appcode')
            ) {
              // Special case conflicting keywords from some of the IDEs.
              runningIDEs.push(ide as IdeType)
              break
            }
          }
        }
      }
    }
  } catch (error) {
    // If process detection fails, return empty array
    logError(error as Error)
  }

  return runningIDEs
}
const EXTENSION_ID =
  process.env.USER_TYPE === 'ant'
    ? 'anthropic.claude-code-internal'
    : 'anthropic.claude-code'

export async function isIDEExtensionInstalled(
  ideType: IdeType,
): Promise<boolean> {
  if (isVSCodeIde(ideType)) {
    return true;
    // const command = await getVSCodeIDECommand(ideType)
    // if (command) {
    //   try {
    //     const result = await execFileNoThrowWithCwd(
    //       command,
    //       ['--list-extensions'],
    //       {
    //         env: getInstallationEnv(),
    //       },
    //     )
    //     if (result.stdout?.includes(EXTENSION_ID)) {
    //       return true
    //     }
    //   } catch {
    //     // eat the error
    //   }
    // }
  } 
  else if (isJetBrainsIde(ideType)) {
    // return await isJetBrainsPluginInstalledCached(ideType)
  }
  return false
}
function getInstallationEnv(): NodeJS.ProcessEnv | undefined {
// 在 Linux 上，cursor可能会错误地实现 `code``` 命令，实际启动用户界面。 // 如果出现此问题，请通过清除 DISPLAY DISPLAY DISPLAY 环境变量来修复该错误。
  if (getPlatform() === 'linux') {
    return {
      ...process.env,
      DISPLAY: '',
    }
  }
  return undefined
}


/**
 * Initializes IDE detection and extension installation, then calls the provided callback
 * with the detected IDE information and installation status.
 * @param ideToInstallExtension The ide to install the extension to (if installing from external terminal)
 * @param onIdeDetected Callback to be called when an IDE is detected (including null)
 * @param onInstallationComplete Callback to be called when extension installation is complete
 */
export async function initializeIdeIntegration(
  onIdeDetected: (ide: DetectedIDEInfo | null) => void,
  ideToInstallExtension: IdeType | null,
  onShowIdeOnboarding: () => void,
  onInstallationComplete: (
    status: IDEExtensionInstallationStatus | null,
  ) => void,
): Promise<void> {
  // Don't await so we don't block startup, but return a promise that resolves with the status
  void findAvailableIDE().then(onIdeDetected)//先检测一下lockfile

  const shouldAutoInstall = getGlobalConfig().autoInstallIdeExtension ?? true
  if (
    !isEnvTruthy(process.env.IDE_SKIP_AUTO_INSTALL) &&
    shouldAutoInstall
  ) {
    const ideType = ideToInstallExtension ?? getTerminalIdeType()
    if (ideType) {
      if (isVSCodeIde(ideType)) {
        void isIDEExtensionInstalled(ideType).then(async isAlreadyInstalled => {
          void maybeInstallIDEExtension(ideType)
            .catch(error => {
              const ideInstallationStatus: IDEExtensionInstallationStatus = {
                installed: false,
                error: error.message || 'Installation failed',
                installedVersion: null,
                ideType: ideType,
              }
              return ideInstallationStatus
            })
            .then(status => {
              onInstallationComplete(status)//设置这个回调

              if (status?.installed) {
                // If we installed and don't yet have an IDE, search again.
                void findAvailableIDE().then(onIdeDetected)//安装插件并检测到
              }

              // if (
              //   !isAlreadyInstalled &&
              //   status?.installed === true &&
              //   !ideOnboardingDialog().hasIdeOnboardingDialogBeenShown()
              // ) {
              //   onShowIdeOnboarding()
              // }
            })
        })
      } else if (isJetBrainsIde(ideType)) {
        // Always check installation to populate the sync cache used by status notices
        // void isIDEExtensionInstalled(ideType).then(async installed => {
        //   if (
        //     installed &&
        //     !ideOnboardingDialog().hasIdeOnboardingDialogBeenShown()
        //   ) {
        //     onShowIdeOnboarding()
        //   }
        // })
      }
    }
  }
}

/**
 * Detects the host IP to use to connect to the extension.
 */
const detectHostIP = memoize(//是 WSL2 网络环境下检测主机 IP 的函数  WSL2 有独立的虚拟网卡，127.0.0.1 指向 WSL2 内部，不是 Windows
  //所以 WSL2 里不能用 127.0.0.1 访问 Windows，必须用宿主机的实际 IP。
  async (isIdeRunningInWindows: boolean, port: number) => {
    if (process.env.IDE_HOST_OVERRIDE) {
      return process.env.IDE_HOST_OVERRIDE
    }

    if (getPlatform() !== 'wsl' || !isIdeRunningInWindows) {
      return '127.0.0.1'//win32
    }

    // If we are running under the WSL2 VM but the extension/plugin is running in
    // Windows, then we must use a different IP address to connect to the extension.
    // https://learn.microsoft.com/en-us/windows/wsl/networking
    try {
      const routeResult = await execa('ip route show | grep -i default', {//执行 ip route 获取默认路由：
        shell: true,
        reject: false,
      })
      if (routeResult.exitCode === 0 && routeResult.stdout) {
        const gatewayMatch = routeResult.stdout.match(
          /default via (\d+\.\d+\.\d+\.\d+)/,
        )
        if (gatewayMatch) {
          const gatewayIP = gatewayMatch[1]!
          if (await checkIdeConnection(gatewayIP, port)) {//验证连通性
            return gatewayIP
          }
        }
      }
    } catch (_) {
      // Suppress any errors
    }

    // Fallback to the default if we cannot find anything
    return '127.0.0.1'
  },
  (isIdeRunningInWindows, port) => `${isIdeRunningInWindows}:${port}`,
)




const EDITOR_DISPLAY_NAMES: Record<string, string> = {
  code: 'VS Code',
  cursor: 'Cursor',
  windsurf: 'Windsurf',
  antigravity: 'Antigravity',
  vi: 'Vim',
  vim: 'Vim',
  nano: 'nano',
  notepad: 'Notepad',
  'start /wait notepad': 'Notepad',
  emacs: 'Emacs',
  subl: 'Sublime Text',
  atom: 'Atom',
}


export function toIDEDisplayName(terminal: string | null): string {
  if (!terminal) return 'IDE'

  const config = supportedIdeConfigs[terminal as IdeType]
  if (config) {
    return config.displayName
  }

  // Check editor command names (exact match first)
  const editorName = EDITOR_DISPLAY_NAMES[terminal.toLowerCase().trim()]
  if (editorName) {
    return editorName
  }

  // Extract command name from path/arguments (e.g., "/usr/bin/code --wait" -> "code")
  const command = terminal.split(' ')[0]
  const commandName = command ? basename(command).toLowerCase() : null
  if (commandName) {
    const mappedName = EDITOR_DISPLAY_NAMES[commandName]
    if (mappedName) {
      return mappedName
    }
    // Fallback: capitalize the command basename
    return capitalize(commandName)
  }

  // Fallback: capitalize first letter
  return capitalize(terminal)
}
/**
 * Gets the connected IDE client from a list of MCP clients
 * @param mcpClients - Array of wrapped MCP clients
 * @returns The connected IDE client, or undefined if not found
 */
export function getConnectedIdeClient(//获取已连接的IDE MCP
  mcpClients?: MCPServerConnection[],
): ConnectedMCPServer | undefined {
  if (!mcpClients) {
    return undefined
  }

  const ideClient = mcpClients.find(
    client => client.type === 'connected' && client.name === 'ide',
  )

  // Type guard to ensure we return the correct type
  return ideClient?.type === 'connected' ? ideClient : undefined
}
