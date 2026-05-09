import { setMaxListeners } from 'events'

/**
 * Default max listeners for standard operations
 */
const DEFAULT_MAX_LISTENERS = 50

/**
 * Creates an AbortController with proper event listener limits set.
 * This prevents MaxListenersExceededWarning when multiple listeners
 * are attached to the abort signal.
 *
 * @param maxListeners - Maximum number of listeners (default: 50)
 * @returns AbortController with configured listener limit
 */
export function createAbortController(
  maxListeners: number = DEFAULT_MAX_LISTENERS,
): AbortController {
  const controller = new AbortController()
  setMaxListeners(maxListeners, controller.signal)//设置最大连接数量
  return controller
}

/**
 * 将父控制器的取消信号传播到【弱引用】的子控制器。
 * 父控制器和子控制器都使用弱引用持有 —— 两个方向都不会创建
 * 会阻止垃圾回收(GC)的强引用。
 * 这是模块级函数，避免每次调用时创建闭包，提升性能。
 */
function propagateAbort(
  this: WeakRef<AbortController>,
  weakChild: WeakRef<AbortController>,
): void {
  // 从弱引用中获取父控制器（如果已被GC则为undefined）
  const parent = this.deref()
  // 获取子控制器 → 如果存在 → 调用 abort()，并传递父控制器的取消原因
  weakChild.deref()?.abort(parent?.signal.reason)
}

/**
 * 从【弱引用】的父控制器信号上移除取消事件监听器。
 * 父控制器和处理函数都使用弱引用持有 —— 如果任意一方已被GC
 * 或者父控制器已经取消（{once: true}），此函数什么都不做。
 * 这是模块级函数，避免每次调用时创建闭包，提升性能。
 */
function removeAbortHandler(
  this: WeakRef<AbortController>,
  weakHandler: WeakRef<(...args: unknown[]) => void>,
): void {
  const parent = this.deref()
  const handler = weakHandler.deref()
  // 只有父控制器和处理函数都存在时，才移除监听器
  if (parent && handler) {
    parent.signal.removeEventListener('abort', handler)
  }
}

/**
 * 创建一个【子取消控制器】，当父控制器取消时，子控制器会自动取消。
 * 注意：取消子控制器**不会影响**父控制器。
 *
 * 内存安全：使用 WeakRef（弱引用），确保父控制器不会持有被遗弃的子控制器。
 * 如果子控制器被丢弃但没有手动取消，它仍然可以被垃圾回收。
 * 当子控制器**真的被取消**时，会自动清理父控制器上的监听器，
 * 防止死监听器堆积造成内存泄漏。
 *
 * @param parent - 父取消控制器
 * @param maxListeners - 最大监听器数量（默认：50）
 * @returns 子取消控制器
 */
export function createChildAbortController(
  parent: AbortController,
  maxListeners?: number,
): AbortController {
  // 创建一个新的子控制器
  const child = createAbortController(maxListeners)

  // 快速路径：如果父控制器已经取消，直接取消子控制器，无需绑定监听器
  if (parent.signal.aborted) {
    child.abort(parent.signal.reason)
    return child
  }

  // ==================== 核心：弱引用防止内存泄漏 ====================
  // 弱引用子控制器：父控制器不会强引用子控制器
  const weakChild = new WeakRef(child)
  // 弱引用父控制器
  const weakParent = new WeakRef(parent)
  // 绑定传播函数
  const handler = propagateAbort.bind(weakParent, weakChild)
  
  // 监听父控制器的取消事件（once: true 表示只触发一次，自动清理）
  parent.signal.addEventListener('abort', handler, { once: true })

  // ==================== 自动清理机制 ====================
  // 当子控制器被取消时 → 自动移除父控制器上的监听器
  // 全部使用弱引用，避免任何内存泄漏风险
  child.signal.addEventListener(
    'abort',
    removeAbortHandler.bind(weakParent, new WeakRef(handler)),
    { once: true },
  )

  return child
}
