
import { stat } from 'fs/promises'
import memoize from 'lodash/memoize.js'
import { env, JETBRAINS_IDES } from './env.js'
import { isEnvTruthy } from './envUtils.js'
import { execFileNoThrow } from './execFileNoThrow.js'
import { getAncestorCommandsAsync } from './genericProcessUtils'


export async function getTerminalWithJetBrainsDetectionAsync(): Promise<//检查环境变量 TERMINAL_EMULATOR === 'JetBrains-JediTerm'（JetBrains 终端的标识）
  string | null
> {
  // Check for JetBrains terminal on Linux/Windows
  if (process.env.TERMINAL_EMULATOR === 'JetBrains-JediTerm') {
    // For macOS, bundle ID detection above already handles JetBrains IDEs
    if (env.platform !== 'darwin') {//在非 macOS 系统上，进一步通过父进程识别具体是哪个 IDE
      const specificIDE = await detectJetBrainsIDEFromParentProcessAsync()
      return specificIDE || 'pycharm'
    }
  }
  return env.terminal//返回 IDE 名称
}
// Cache for async JetBrains detection
let jetBrainsIDECache: string | null | undefined

async function detectJetBrainsIDEFromParentProcessAsync(): Promise<
  string | null
> {
  if (jetBrainsIDECache !== undefined) {//使用缓存避免重复检测
    return jetBrainsIDECache
  }

  if (process.platform === 'darwin') {//macOS 直接返回 null
    jetBrainsIDECache = null
    return null // macOS uses bundle ID detection which is already handled
  }

  try {
    // Get ancestor commands in a single call (avoids sync bash in loop)
    const commands = await getAncestorCommandsAsync(process.pid, 10)//通过 getAncestorCommandsAsync 获取进程树中所有祖先进程的命令行

    for (const command of commands) {//遍历所有祖先进程的命令
      const lowerCommand = command.toLowerCase()
      // Check for specific JetBrains IDEs in the command line
      for (const ide of JETBRAINS_IDES) {
        if (lowerCommand.includes(ide)) {//遍历每个ide如果命令中包含该名称
          jetBrainsIDECache = ide
          return ide
        }
      }
    }
  } catch {
    // Silently fail - this is a best-effort detection
  }

  jetBrainsIDECache = null
  return null
}
// Synchronous version that returns cached result or falls back to env.terminal
// Used for backward compatibility - callers should migrate to async version同步版本
export function getTerminalWithJetBrainsDetection(): string | null {//用于向后兼容
  // Check for JetBrains terminal on Linux/Windows
  if (process.env.TERMINAL_EMULATOR === 'JetBrains-JediTerm') {//依赖异步版本预先填充的缓
    // For macOS, bundle ID detection above already handles JetBrains IDEs
    if (env.platform !== 'darwin') {
      // Return cached value if available, otherwise fall back to generic detection
      // The async version should be called early in app initialization to populate cache
      if (jetBrainsIDECache !== undefined) {
        return jetBrainsIDECache || 'pycharm'
      }
      // Fall back to generic 'pycharm' if cache not populated yet
      return 'pycharm'//如果缓存未就绪，默认返回 'pycharm'
    }
  }
  return env.terminal
}
/**
 * Initialize JetBrains IDE detection asynchronously.
 * Call this early in app initialization to populate the cache.
 * After this resolves, getTerminalWithJetBrainsDetection() will return accurate results.
 */
export async function initJetBrainsDetection(): Promise<void> {//应在应用启动早期调用，异步填充缓存
  if (process.env.TERMINAL_EMULATOR === 'JetBrains-JediTerm') {
    await detectJetBrainsIDEFromParentProcessAsync()//调用后同步版本才能返回准确结果
  }
}
// Combined export that includes all env properties plus dynamic functions
export const envDynamic = {
  ...env, // Include all properties from env
  terminal: getTerminalWithJetBrainsDetection(),//原代码可能是同步的，后来改成异步检测
//   getIsDocker,
//   getIsBubblewrapSandbox,
//   isMuslEnvironment,
  getTerminalWithJetBrainsDetectionAsync,
  initJetBrainsDetection,
}
