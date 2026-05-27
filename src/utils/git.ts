import { readFile, stat } from 'fs/promises'
import { whichSync } from './which.js'
import { readFileSync, realpathSync, statSync } from 'fs'
import { unwatchFile, watchFile } from 'fs'
import memoize from 'lodash/memoize.js'
import { basename, dirname, join, resolve, sep } from 'path'
import { getCwd } from './cwd.js'
import { registerCleanup } from '../utils/cleanupRegistry.js'
import { memoizeWithLRU } from './memoize.js'
const GIT_ROOT_NOT_FOUND = Symbol('git-root-not-found')
const WATCH_INTERVAL_MS = process.env.NODE_ENV === 'test' ? 10 : 1000

const resolveGitDirCache = new Map<string, string | null>()//缓存 .git 目录解析结果

/** Clear cached git dir resolutions. Exported for testing only. */
export function clearResolveGitDirCache(): void {//清空 resolveGitDir() 的缓存要给测试用。
  resolveGitDirCache.clear()
}

// ---------------------------------------------------------------------------
// GitFileWatcher — watches git files and caches derived values.
// Lazily initialized on first cache access. Invalidates all cached
// values when any watched file changes.
//
// Watches:
//   .git/HEAD          — branch switches, detached HEAD
//   .git/config        — remote URL changes
//   .git/refs/heads/<branch> — new commits on the current branch
//
// When HEAD changes (branch switch), the branch ref watcher is updated
// to track the new branch's ref file.
// ---------------------------------------------------------------------------

type CacheEntry<T> = {
value: T
dirty: boolean
compute: () => Promise<T>
}
/**
 * Resolve the actual .git directory for a repo.
 * Handles worktrees/submodules where .git is a file containing `gitdir: <path>`.
 * Memoized per startPath.
 */
export async function resolveGitDir(//解析真实 .git 目录。
  startPath?: string,
): Promise<string | null> {
  const cwd = resolve(startPath ?? getCwd())
  const cached = resolveGitDirCache.get(cwd)
  if (cached !== undefined) {
    return cached
  }

  const root = findGitRoot(cwd)
  if (!root) {
    resolveGitDirCache.set(cwd, null)
    return null
  }

  const gitPath = join(root, '.git')
  try {
    const st = await stat(gitPath)
    if (st.isFile()) {
      // Worktree or submodule: .git is a file with `gitdir: <path>`
      // Git strips trailing \n and \r (setup.c read_gitfile_gently).
      const content = (await readFile(gitPath, 'utf-8')).trim()
      if (content.startsWith('gitdir:')) {
        const rawDir = content.slice('gitdir:'.length).trim()
        const resolved = resolve(root, rawDir)
        resolveGitDirCache.set(cwd, resolved)
        return resolved
      }
    }
    // Regular repo: .git is a directory
    resolveGitDirCache.set(cwd, gitPath)
    return gitPath
  } catch {
    resolveGitDirCache.set(cwd, null)
    return null
  }
}
class GitFileWatcher {
  private gitDir: string | null = null
  private commonDir: string | null = null
  private initialized = false
  private initPromise: Promise<void> | null = null
  private watchedPaths: string[] = []
  private branchRefPath: string | null = null
  private cache = new Map<string, CacheEntry<unknown>>()//缓存 branch、defaultBranch 等计算结果

  async ensureStarted(): Promise<void> {//确保 Git 文件监听器已经启动。 避免重复初始化  并用 initPromise 防止并发启动多次。
    if (this.initialized) {
      return
    }
    if (this.initPromise) {
      return this.initPromise
    }
    this.initPromise = this.start()
    return this.initPromise
  }

  private async start(): Promise<void> {
    this.gitDir = await resolveGitDir()//找到 .git 目录
    this.initialized = true
    if (!this.gitDir) {
      return
    }

    // In a worktree, branch refs and the main config are shared and live in
    // commonDir, not the per-worktree gitDir. Resolve once so we don't
    // re-read the commondir file on every branch switch.
    this.commonDir = await getCommonDir(this.gitDir)//解析 commondir

    // Watch .git/HEAD and .git/config
    this.watchPath(join(this.gitDir, 'HEAD'), () => {//监听HEAD指针
      void this.onHeadChanged()
    })
    // Config (remote URLs) lives in commonDir for worktrees
    this.watchPath(join(this.commonDir ?? this.gitDir, 'config'), () => {//监听 config
      this.invalidate()
    })

    // Watch the current branch's ref file for commit changes
    await this.watchCurrentBranchRef()//监听当前分支 ref 文件

    registerCleanup(async () => {//注册清理函数
      this.stopWatching()
    })
  }

  private watchPath(path: string, callback: () => void): void {//封装 watchFile()，记录被监听路径，方便后续取消监听。
    this.watchedPaths.push(path)
    watchFile(path, { interval: WATCH_INTERVAL_MS }, callback)
  }

  /**
   * Watch the loose ref file for the current branch.
   * Called on startup and whenever HEAD changes (branch switch).
   */
  private async watchCurrentBranchRef(): Promise<void> {//读取当前 HEAD，如果当前在分支上，就监听：refs/heads/<branch>
    if (!this.gitDir) {
      return
    }

    const head = await readGitHead(this.gitDir)
    // Branch refs live in commonDir for worktrees (gitDir for regular repos)
    const refsDir = this.commonDir ?? this.gitDir
    const refPath =
      head?.type === 'branch' ? join(refsDir, 'refs', 'heads', head.name) : null

    // Already watching this ref (or already not watching anything)
    if (refPath === this.branchRefPath) {
      return
    }

    // Stop watching old branch ref. Runs for branch→branch AND
    // branch→detached (checkout --detach, rebase, bisect).
    if (this.branchRefPath) {
      unwatchFile(this.branchRefPath)//取消旧分支 ref 的监听
      this.watchedPaths = this.watchedPaths.filter(
        p => p !== this.branchRefPath,
      )
    }

    this.branchRefPath = refPath

    if (!refPath) {
      return
    }

    // The ref file may not exist yet (new branch before first commit).
    // watchFile works on nonexistent files — it fires when the file appears.
    this.watchPath(refPath, () => {//当切换分支时，它会取消旧分支 ref 的监听，再监听新分支 ref。
      this.invalidate()
    })
  }

  private async onHeadChanged(): Promise<void> {//当 .git/HEAD 变化时触发。
    // HEAD changed — could be a branch switch or detach.
    // Defer file I/O (readGitHead, watchFile setup) until scroll settles so
    // watchFile callbacks that land mid-scroll don't compete for the event
    // loop. invalidate() is cheap (just marks dirty) so do it first — the
    // cache correctly serves stale-marked values until the watcher updates.
    this.invalidate()//会先让缓存失效，再更新分支 ref 监听。
    //切换分支 detached HEAD   rebase / bisect 等状态变化
    // await waitForScrollIdle()
    await this.watchCurrentBranchRef()
  }

  private invalidate(): void {
    for (const entry of this.cache.values()) {
      entry.dirty = true
    }
  }

  private stopWatching(): void {//取消所有 watchFile 监听
    for (const path of this.watchedPaths) {
      unwatchFile(path)
    }
    this.watchedPaths = []
    this.branchRefPath = null
  }

  /**
   * Get a cached value by key. On first call for a key, computes and caches it.
   * Subsequent calls return the cached value until a watched file changes,
   * which marks the entry dirty. The next get() re-computes from disk.
   *
   * Race condition handling: dirty is cleared BEFORE the async compute starts.
   * If a file change arrives during compute, it re-sets dirty, so the next
   * get() will re-read again rather than serving a stale value.
   */
  async get<T>(key: string, compute: () => Promise<T>): Promise<T> {
    await this.ensureStarted()
    const existing = this.cache.get(key)
    if (existing && !existing.dirty) {
      return existing.value as T
    }
    // Clear dirty before compute — if the file changes again during the
    // async read, invalidate() will re-set dirty and we'll re-read on
    // the next get() call.
    if (existing) {
      existing.dirty = false
    }
    const value = await compute()
    // Only update the cached value if no new invalidation arrived during compute
    const entry = this.cache.get(key)
    if (entry && !entry.dirty) {
      entry.value = value
    }
    if (!entry) {
      this.cache.set(key, { value, dirty: false, compute })
    }
    return value
  }

  /** Reset all state. Stops file watchers. For testing only. */
  reset(): void {
    this.stopWatching()
    this.cache.clear()
    this.initialized = false
    this.initPromise = null
    this.gitDir = null
    this.commonDir = null
  }
}
const gitWatcher = new GitFileWatcher()
/**
 * 通过沿着目录树向上查找 git root。
 * 查找 .git 目录或文件（工作树/子模块使用文件）。
 * 返回包含 .git 的目录，如果未找到则返回 null。
 *
 * 使用 LRU 缓存（最多 50 个条目）记录每个 startPath，以防止
 * 无限制的增长——gitDiff 用 dirname(file) 来调用它，所以编辑很多
 * 否则，不同目录中的文件将永远累积条目。
 */
const findGitRootImpl = memoizeWithLRU(//LRU 缓存，最多 50 条，防止无限增长
  (startPath: string): string | typeof GIT_ROOT_NOT_FOUND => {
    const startTime = Date.now()
    let current = resolve(startPath)//绝对路径
    const root = current.substring(0, current.indexOf(sep) + 1) || sep
    let statCount = 0
    while (current !== root) {
      try {
        const gitPath = join(current, '.git')
        statCount++
        const stat = statSync(gitPath)
        // .git can be a directory (regular repo) or file (worktree/submodule)
        if (stat.isDirectory() || stat.isFile()) {
          return current.normalize('NFC')
        }
      } catch {
        // .git doesn't exist at this level, continue up
      }
      const parent = dirname(current)
      if (parent === current) {
        break
      }
      current = parent
    }

    // Check root directory as well
    try {
      const gitPath = join(root, '.git')
      statCount++
      const stat = statSync(gitPath)
      if (stat.isDirectory() || stat.isFile()) {
        return root.normalize('NFC')
      }
    } catch {
      // .git doesn't exist at root
    }
    return GIT_ROOT_NOT_FOUND
  },
  path => path,
  50,
)
function createFindGitRoot(): {
  (startPath: string): string | null
  cache: typeof findGitRootImpl.cache
} {
  function wrapper(startPath: string): string | null {
    const result = findGitRootImpl(startPath)
    return result === GIT_ROOT_NOT_FOUND ? null : result
  }
  wrapper.cache = findGitRootImpl.cache
  return wrapper
}

export const findGitRoot = createFindGitRoot()

/**
 * Validate that a string is a git SHA: 40 hex chars (SHA-1) or 64 hex chars
 * (SHA-256). Git never writes abbreviated SHAs to HEAD or ref files, so we
 * only accept full-length hashes.
 *
 * An attacker who controls .git/HEAD when detached, or a loose ref file,
 * could otherwise return arbitrary content that flows into shell contexts.
 */
export function isValidGitSha(s: string): boolean {//判断字符串是否是合法 Git SHA：
  return /^[0-9a-f]{40}$/.test(s) || /^[0-9a-f]{64}$/.test(s)
}

export const getIsGit = memoize(async (): Promise<boolean> => {//重点是 worktree：不同 worktree 最终会映射到同一个主仓库 identity。
  const startTime = Date.now()
  const isGit = findGitRoot(getCwd()) !== null
  return isGit
})

/**
 * Resolve a git root to the canonical main repository root.
 * For a regular repo this is a no-op. For a worktree, follows the
 * `.git` file → `gitdir:` → `commondir` chain to find the main repo's
 * working directory.
 *
 * Submodules (`.git` is a file but no `commondir`) fall through to the
 * input root, which is correct since submodules are separate repos.
 *
 * Memoized with a small LRU to avoid repeated file reads on the hot
 * path (permission checks, prompt building).
 */
const resolveCanonicalRoot = memoizeWithLRU(//worktree：读取 .git → gitdir → commondir，找到主仓库。 普通仓库：直接返回 gitRoot。
  (gitRoot: string): string => {
    try {
      // In a worktree, .git is a file containing: gitdir: <path>
      // In a regular repo, .git is a directory (readFileSync throws EISDIR).
      const gitContent = readFileSync(join(gitRoot, '.git'), 'utf-8').trim()
      if (!gitContent.startsWith('gitdir:')) {
        return gitRoot
      }
      const worktreeGitDir = resolve(
        gitRoot,
        gitContent.slice('gitdir:'.length).trim(),
      )
      // commondir points to the shared .git directory (relative to worktree gitdir).
      // Submodules have no commondir (readFileSync throws ENOENT) → fall through.
      const commonDir = resolve(
        worktreeGitDir,
        readFileSync(join(worktreeGitDir, 'commondir'), 'utf-8').trim(),
      )
/*     先用 findGitRoot(startPath) 找到当前 Git 根目录。
如果 .git 是目录，说明是普通 repo，直接返回它。
如果 .git 是文件，读取里面的 gitdir: xxx。
再读取 commondir，判断它是不是 Git worktree。
通过安全校验确认它真的是合法 worktree：
worktreeGitDir 必须在 <commonDir>/worktrees/ 下。
worktreeGitDir/gitdir 必须反向指回当前 <gitRoot>/.git。
如果校验通过：
普通主仓库 worktree：返回主仓库根目录。
bare repo worktree：返回 common git dir。
如果任何步骤失败，就保守返回原来的 gitRoot。 */
      if (resolve(dirname(worktreeGitDir)) !== join(commonDir, 'worktrees')) {
        return gitRoot
      }
      // Git writes gitdir with strbuf_realpath() (symlinks resolved), but
      // gitRoot from findGitRoot() is only lexically resolved. Realpath gitRoot
      // so legitimate worktrees accessed via a symlinked path (e.g. macOS
      // /tmp → /private/tmp) aren't rejected. Realpath the directory then join
      // '.git' — realpathing the .git file itself would follow a symlinked .git
      // and let an attacker borrow a victim's back-link.
      const backlink = realpathSync(
        readFileSync(join(worktreeGitDir, 'gitdir'), 'utf-8').trim(),
      )
      if (backlink !== join(realpathSync(gitRoot), '.git')) {
        return gitRoot
      }
      // Bare-repo worktrees: the common dir isn't inside a working directory.
      // Use the common dir itself as the stable identity (anthropics/claude-code#27994).
      if (basename(commonDir) !== '.git') {
        return commonDir.normalize('NFC')
      }
      return dirname(commonDir).normalize('NFC')
    } catch {
      return gitRoot
    }
  },
  root => root,
  50,
)
function createFindCanonicalGitRoot(): {
  (startPath: string): string | null
  cache: typeof resolveCanonicalRoot.cache
} {
  function wrapper(startPath: string): string | null {
    const root = findGitRoot(startPath)
    if (!root) {
      return null
    }
    return resolveCanonicalRoot(root)
  }
  wrapper.cache = resolveCanonicalRoot.cache
  return wrapper
}

/**
 * Find the canonical git repository root, resolving through worktrees.
 *
 * Unlike findGitRoot, which returns the worktree directory (where the `.git`
 * file lives), this returns the main repository's working directory. This
 * ensures all worktrees of the same repo map to the same project identity.
 *
 * Use this instead of findGitRoot for project-scoped state (auto-memory,
 * project config, agent memory) so worktrees share state with the main repo.
 */
export const findCanonicalGitRoot = createFindCanonicalGitRoot()

export function getCachedBranch(): Promise<string> {
  return gitWatcher.get('branch', computeBranch)
}
export function getCachedDefaultBranch(): Promise<string> {
  return gitWatcher.get('defaultBranch', computeDefaultBranch)
}


export const getBranch = async (): Promise<string> => {
  return getCachedBranch()
}
export const getDefaultBranch = async (): Promise<string> => {
  return getCachedDefaultBranch()
}
/**
 * Read the `commondir` file to find the shared git directory.
 * In a worktree, this points to the main repo's .git dir.
 * Returns null if no commondir file exists (regular repo).
 */
export async function getCommonDir(gitDir: string): Promise<string | null> {//共同的git文件
  try {
    const content = (await readFile(join(gitDir, 'commondir'), 'utf-8')).trim()
    return resolve(gitDir, content)
  } catch {
    return null
  }
}
/**
 * Parse .git/HEAD to determine current branch or detached SHA.
 *
 * HEAD format (per git source, refs/files-backend.c):
 *   - `ref: refs/heads/<branch>\n`  — on a branch
 *   - `ref: <other-ref>\n`          — unusual symref (e.g. during bisect)
 *   - `<hex-sha>\n`                 — detached HEAD (e.g. during rebase)
 *
 * Git strips trailing whitespace via strbuf_rtrim; .trim() is equivalent.
 * Git allows any whitespace between "ref:" and the path; we handle
 * this by trimming after slicing past "ref:".
 */
export async function readGitHead(
  gitDir: string,
): Promise<
  { type: 'branch'; name: string } | { type: 'detached'; sha: string } | null
> {
  try {
    const content = (await readFile(join(gitDir, 'HEAD'), 'utf-8')).trim()
    if (content.startsWith('ref:')) {
      const ref = content.slice('ref:'.length).trim()
      if (ref.startsWith('refs/heads/')) {
        const name = ref.slice('refs/heads/'.length)
        // Reject path traversal and argument injection from a tampered HEAD.
        if (!isSafeRefName(name)) {
          return null
        }
        return { type: 'branch', name }
      }
      // Unusual symref (not a local branch) — resolve to SHA
      if (!isSafeRefName(ref)) {
        return null
      }
      const sha = await resolveRef(gitDir, ref)
      return sha ? { type: 'detached', sha } : { type: 'detached', sha: '' }
    }
    // Raw SHA (detached HEAD). Validate: an attacker-controlled HEAD file
    // could contain shell metacharacters that flow into downstream shell
    // contexts.
    if (!isValidGitSha(content)) {
      return null
    }
    return { type: 'detached', sha: content }
  } catch {
    return null
  }
}
// ---------------------------------------------------------------------------
// isSafeRefName — validate ref/branch names read from .git/
// ---------------------------------------------------------------------------

/**
 * Validate that a ref/branch name read from .git/ is safe to use in path
 * joins, as git positional arguments, and when interpolated into shell
 * commands (commit-push-pr skill interpolates the branch into shell).
 * An attacker who controls .git/HEAD or a loose ref file could otherwise
 * embed path traversal (`..`), argument injection (leading `-`), or shell
 * metacharacters — .git/HEAD is a plain text file that can be written
 * without git's own check-ref-format validation.
 *
 * Allowlist: ASCII alphanumerics, `/`, `.`, `_`, `+`, `-`, `@` only. This
 * covers all legitimate git branch names (e.g. `feature/foo`,
 * `release-1.2.3+build`, `dependabot/npm_and_yarn/@types/node-18.0.0`)
 * while rejecting everything that could be dangerous in shell context
 * (newlines, backticks, `$`, `;`, `|`, `&`, `(`, `)`, `<`, `>`, spaces,
 * tabs, quotes, backslash) and path traversal (`..`).
 */
export function isSafeRefName(name: string): boolean {
  if (!name || name.startsWith('-') || name.startsWith('/')) {
    return false
  }
  if (name.includes('..')) {
    return false
  }
  // Reject single-dot and empty path components (`.`, `foo/./bar`, `foo//bar`,
  // `foo/`). Git-check-ref-format rejects these, and `.` normalizes away in
  // path joins so a tampered HEAD of `refs/heads/.` would make us watch the
  // refs/heads directory itself instead of a branch file.
  if (name.split('/').some(c => c === '.' || c === '')) {
    return false
  }
  // Allowlist-only: alphanumerics, /, ., _, +, -, @. Rejects all shell
  // metacharacters, whitespace, NUL, and non-ASCII. Git's forbidden @{
  // sequence is blocked because { is not in the allowlist.
  if (!/^[a-zA-Z0-9/._+@-]+$/.test(name)) {
    return false
  }
  return true
}
/**
 * Resolve a git ref (e.g. `refs/heads/main`) to a commit SHA.
 * Checks loose ref files first, then falls back to packed-refs.
 * Follows symrefs (e.g. `ref: refs/remotes/origin/main`).
 *
 * For worktrees, refs live in the common gitdir (pointed to by the
 * `commondir` file), not the worktree-specific gitdir. We check the
 * worktree gitdir first, then fall back to the common dir.
 *
 * Packed-refs format (per packed-backend.c):
 *   - Header: `# pack-refs with: <traits>\n`
 *   - Entries: `<40-hex-sha> <refname>\n`
 *   - Peeled:  `^<40-hex-sha>\n` (after annotated tag entries)
 */
export async function resolveRef(
  gitDir: string,
  ref: string,
): Promise<string | null> {
  const result = await resolveRefInDir(gitDir, ref)
  if (result) {
    return result
  }

  // For worktrees: try the common gitdir where shared refs live
  const commonDir = await getCommonDir(gitDir)
  if (commonDir && commonDir !== gitDir) {
    return resolveRefInDir(commonDir, ref)
  }

  return null
}
async function resolveRefInDir(
  dir: string,
  ref: string,
): Promise<string | null> {
  // Try loose ref file
  try {
    const content = (await readFile(join(dir, ref), 'utf-8')).trim()
    if (content.startsWith('ref:')) {
      const target = content.slice('ref:'.length).trim()
      // Reject path traversal in a tampered symref chain.
      if (!isSafeRefName(target)) {
        return null
      }
      return resolveRef(dir, target)
    }
    // Loose ref content should be a raw SHA. Validate: an attacker-controlled
    // ref file could contain shell metacharacters.
    if (!isValidGitSha(content)) {
      return null
    }
    return content
  } catch {
    // Loose ref doesn't exist, try packed-refs
  }

  try {
    const packed = await readFile(join(dir, 'packed-refs'), 'utf-8')
    for (const line of packed.split('\n')) {
      if (line.startsWith('#') || line.startsWith('^')) {
        continue
      }
      const spaceIdx = line.indexOf(' ')
      if (spaceIdx === -1) {
        continue
      }
      if (line.slice(spaceIdx + 1) === ref) {
        const sha = line.slice(0, spaceIdx)
        return isValidGitSha(sha) ? sha : null
      }
    }
  } catch {
    // No packed-refs
  }

  return null
}
async function computeBranch(): Promise<string> {
  const gitDir = await resolveGitDir()
  if (!gitDir) {
    return 'HEAD'
  }
  const head = await readGitHead(gitDir)
  if (!head) {
    return 'HEAD'
  }
  return head.type === 'branch' ? head.name : 'HEAD'
}
async function computeDefaultBranch(): Promise<string> {
  const gitDir = await resolveGitDir()
  if (!gitDir) {
    return 'main'
  }
  // refs/remotes/ lives in commonDir, not the per-worktree gitDir
  const commonDir = (await getCommonDir(gitDir)) ?? gitDir
  const branchFromSymref = await readRawSymref(//读取原始 symref 文件，例如：refs/remotes/origin/HEAD
    commonDir,
    'refs/remotes/origin/HEAD',
    'refs/remotes/origin/',
  )
  if (branchFromSymref) {
    return branchFromSymref
  }
  for (const candidate of ['main', 'master']) {//检查 origin/master
    const sha = await resolveRef(commonDir, `refs/remotes/origin/${candidate}`)
    if (sha) {
      return candidate
    }
  }
  return 'main'
}

/**
 * Read a raw symref file and extract the branch name after a known prefix.
 * Returns null if the ref doesn't exist, isn't a symref, or doesn't match the prefix.
 * Checks loose file only — packed-refs doesn't store symrefs.
 */
export async function readRawSymref(
  gitDir: string,
  refPath: string,
  branchPrefix: string,
): Promise<string | null> {
  try {
    const content = (await readFile(join(gitDir, refPath), 'utf-8')).trim()
    if (content.startsWith('ref:')) {
      const target = content.slice('ref:'.length).trim()
      if (target.startsWith(branchPrefix)) {
        const name = target.slice(branchPrefix.length)
        // Reject path traversal and argument injection from a tampered symref.
        if (!isSafeRefName(name)) {
          return null
        }
        return name
      }
    }
  } catch {
    // Not a loose ref
  }
  return null
}
export const gitExe = memoize((): string => {
  // Every time we spawn a process, we have to lookup the path.
  // Let's instead avoid that lookup so we only do it once.
  return whichSync('git') || 'git'
})