/**

proper-lockfile 的懒加载访问器。

proper-lockfile 依赖于 graceful-fs，后者在首次 require 时会动态修补所有 fs 方法（耗时约 8ms）。即使实际没有发生锁操作（例如执行 --help 时），静态导入 proper-lockfile 也会将这一性能开销引入启动流程。

请改用本模块代替直接导入 proper-lockfile。只有在首次实际调用锁相关函数时，才会真正加载底层的依赖包。
*/
import type { CheckOptions, LockOptions, UnlockOptions } from 'proper-lockfile'

type Lockfile = typeof import('proper-lockfile')

let _lockfile: Lockfile | undefined// 缓存实例

function getLockfile(): Lockfile {
  if (!_lockfile) { // ← 第一次才执行
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _lockfile = require('proper-lockfile') as Lockfile
  }
  return _lockfile
}

export function lock(
  file: string,
  options?: LockOptions,
): Promise<() => Promise<void>> {////异步加锁
  return getLockfile().lock(file, options)
}
// 导出的 API 与 proper-lockfile 完全一致
export function lockSync(file: string, options?: LockOptions): () => void {
  return getLockfile().lockSync(file, options)
}

export function unlock(file: string, options?: UnlockOptions): Promise<void> {
  return getLockfile().unlock(file, options)
}

export function check(file: string, options?: CheckOptions): Promise<boolean> {//检查锁定状态
  return getLockfile().check(file, options)
}
//API 透明：导出的 lock / unlock / check / lockSync 函数签名与原库完全一致，调用方无感知替换
// API 是 文件锁操作 的封装，用于在多个进程间协调对同一文件的访问，防止并发冲突。
