import { AsyncLocalStorage } from 'async_hooks'
import { cwd as getProcessCwd } from 'node:process'
import { getCwdState, getOriginalCwd } from "../bootstrap/state"

const cwdOverrideStorage = new AsyncLocalStorage<string>()

/**
在当前异步上下文中，使用重写后的工作目录运行一个函数。
该函数（及其异步子调用）内部所有对 pwd()/getCwd() 的调用，都将返回重写后的当前工作目录，而非全局工作目录。
此功能可让并发执行的程序单元各自拥有独立的工作目录，且互不干扰。
 */
export function runWithCwdOverride<T>(cwd: string, fn: () => T): T {
  return cwdOverrideStorage.run(cwd, fn)
}

/**
 * Get the current working directory
 */
export function pwd(): string {
  const override = cwdOverrideStorage.getStore()
  if (override) return override

  return getCwdState() || getOriginalCwd() || getProcessCwd()
}

/**
 * Get the current working directory or the original working directory if the current one is not available
 */
export function getCwd(): string {
  try {
    return pwd()
  } catch {
    return getOriginalCwd()
  }
}
