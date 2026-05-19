/**

proper-lockfile 的懒加载访问器。

proper-lockfile 依赖于 graceful-fs，后者在首次 require 时会动态修补所有 fs 方法（耗时约 8ms）。即使实际没有发生锁操作（例如执行 --help 时），静态导入 proper-lockfile 也会将这一性能开销引入启动流程。

请改用本模块代替直接导入 proper-lockfile。只有在首次实际调用锁相关函数时，才会真正加载底层的依赖包。
*/
import type { CheckOptions, LockOptions, UnlockOptions } from 'proper-lockfile'

type Lockfile = typeof import('proper-lockfile')

let _lockfile: Lockfile | undefined

function getLockfile(): Lockfile {
  if (!_lockfile) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _lockfile = require('proper-lockfile') as Lockfile
  }
  return _lockfile
}

export function lock(
  file: string,
  options?: LockOptions,
): Promise<() => Promise<void>> {
  return getLockfile().lock(file, options)
}

export function lockSync(file: string, options?: LockOptions): () => void {
  return getLockfile().lockSync(file, options)
}

export function unlock(file: string, options?: UnlockOptions): Promise<void> {
  return getLockfile().unlock(file, options)
}

export function check(file: string, options?: CheckOptions): Promise<boolean> {
  return getLockfile().check(file, options)
}
