/**
 * Global registry for cleanup functions that should run during graceful shutdown.
 * This module is separate from gracefulShutdown.ts to avoid circular dependencies.
 */
//提供一个集中式的清理函数管理机制，让应用各个模块可以注册自己的清理逻辑（如关闭数据库连接、刷新日志、保存状态等），在服务关闭时统一执行。
// Global registry for cleanup functions
const cleanupFunctions = new Set<() => Promise<void>>()

/**
 * Register a cleanup function to run during graceful shutdown.
 * @param cleanupFn - Function to run during cleanup (can be sync or async)
 * @returns Unregister function that removes the cleanup handler
 */
export function registerCleanup(cleanupFn: () => Promise<void>): () => void {
  cleanupFunctions.add(cleanupFn)
  return () => cleanupFunctions.delete(cleanupFn) // Return unregister function
}

/**
 * Run all registered cleanup functions.
 * Used internally by gracefulShutdown.
 */
export async function runCleanupFunctions(): Promise<void> {//并发执行：Promise.all 让所有清理函数并行运行，提高关闭速度
  await Promise.all(Array.from(cleanupFunctions).map(fn => fn()))
}
