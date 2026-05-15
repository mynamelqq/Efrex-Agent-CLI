import { feature } from 'bun:bundle'
import { access } from 'fs/promises'
import { tmpdir as osTmpdir } from 'os'
import { join as nativeJoin } from 'path'
import { join as posixJoin } from 'path/posix'
import { rewriteWindowsNullRedirect,shouldAddStdinRedirect,quoteShellCommand } from './bashQuoting.js'
import { quote } from './shellQuote.js'
import { logForDebugging } from '../debug.js'
import { getPlatform } from '../platform.js'
import { rearrangePipeCommand } from './bashPipeCommand.js'
import { windowsPathToPosixPath } from '../windowsPaths.js'
import type { ShellProvider } from '../shell/shellProvider.js'


export async function createBashShellProvider(
  shellPath: string,
  options?: { skipSnapshot?: boolean },
): Promise<ShellProvider> {
  let currentSandboxTmpDir: string | undefined
  // const snapshotPromise: Promise<string | undefined> = options?.skipSnapshot
  //   ? Promise.resolve(undefined)
  //   : createAndSaveSnapshot(shellPath).catch(error => {
  //       logForDebugging(`Failed to create shell snapshot: ${error}`)
  //       return undefined
  //     })
  // Track the last resolved snapshot path for use in getSpawnArgs
  let lastSnapshotFilePath: string | undefined

  return {
    type: 'bash',
    shellPath,
    detached: true,

    async buildExecCommand(
      command: string,
      opts: {
        id: number | string
        sandboxTmpDir?: string
        useSandbox: boolean
      },
    ): Promise<{ commandString: string; cwdFilePath: string }> {
      let snapshotFilePath = await Promise.resolve(undefined)
      // This access() check is NOT pure TOCTOU — it's the fallback decision
      // point for getSpawnArgs. When the snapshot disappears mid-session
      // (tmpdir cleanup), we must clear lastSnapshotFilePath so getSpawnArgs
      // adds -l and the command gets login-shell init. Without this check,
      // `source ... || true` silently fails and commands run with NO shell
      // init (neither snapshot env nor login profile). The `|| true` on source
      // still guards the race between this check and the spawned shell.
      // if (snapshotFilePath) {
      //   try {
      //     await access(snapshotFilePath)
      //   } catch {
      //     logForDebugging(
      //       `Snapshot file missing, falling back to login shell: ${snapshotFilePath}`,
      //     )
      //     snapshotFilePath = undefined
      //   }
      // }
      lastSnapshotFilePath = snapshotFilePath

      // Stash sandboxTmpDir for use in getEnvironmentOverrides
      currentSandboxTmpDir = opts.sandboxTmpDir

      const tmpdir = osTmpdir()//获取系统临时目录
      const isWindows = getPlatform() === 'windows'
      const shellTmpdir = isWindows ? windowsPathToPosixPath(tmpdir) : tmpdir//转换成linux路径 git bash要用

      // shellCwdFilePath: POSIX path used inside the bash command (pwd -P >| ...)
      // cwdFilePath: native OS path used by Node.js for readFileSync/unlinkSync
      // On non-Windows these are identical; on Windows, Git Bash needs POSIX paths
      // but Node.js needs native Windows paths for file operations.
      const shellCwdFilePath = posixJoin(shellTmpdir, `efrex-${opts.id}-cwd`)//linux路径
      const cwdFilePath = nativeJoin(tmpdir, `efrex-${opts.id}-cwd`)//本地

      // Defensive rewrite: the model sometimes emits Windows CMD-style `2>nul`
      // redirects. In POSIX bash (including Git Bash on Windows), this creates a
      // literal file named `nul` — a reserved device name that breaks git.
      const normalizedCommand = rewriteWindowsNullRedirect(command)//命令清洗 / 安全处理函数
      // AI 模型有时会输出 Windows 命令 2>nul，在 Linux/Mac/Git Bash 里会创建真实文件 nul 导致 Git 崩溃
      const addStdinRedirect = shouldAddStdinRedirect(normalizedCommand)//判断是否需要自动添加标准输入重定向（< /dev/null）
      let quotedCommand = quoteShellCommand(normalizedCommand, addStdinRedirect)
// Shell 命令安全转义函数
// 给命令加引号、转义特殊字符（$///|/ 空格）
      // Debug logging for heredoc/multiline commands to trace trailer handling
      // Only log when commit attribution is enabled to avoid noise
      if (
        feature('COMMIT_ATTRIBUTION') &&
        (command.includes('<<') || command.includes('\n'))
      ) {
        logForDebugging(
          `Shell: Command before quoting (first 500 chars):\n${command.slice(0, 500)}`,
        )
        logForDebugging(
          `Shell: Quoted command (first 500 chars):\n${quotedCommand.slice(0, 500)}`,
        )
      }

      // Special handling for pipes: move stdin redirect after first command
      // This ensures the redirect applies to the first command, not to eval itself.
      // Without this, `eval 'rg foo | wc -l' \< /dev/null` becomes
      // `rg foo | wc -l < /dev/null` — wc reads /dev/null and outputs 0, and
      // rg (with no path arg) waits on the open spawn stdin pipe forever.
      // Applies to sandbox mode too: sandbox wraps the assembled commandString,
      // not the raw command (since PR #9189).
      if (normalizedCommand.includes('|') && addStdinRedirect) {//处理 ** 管道命令（|）** 的特殊逻辑  把 stdin 重定向移动到第一个命令后面，避免管道后命令读不到输入卡死
        quotedCommand = rearrangePipeCommand(normalizedCommand)
      }

      const commandParts: string[] = []

      // Source the snapshot file. The `|| true` guards the race between the
      // access() check above and the spawned shell's `source` — if the file
      // vanishes in that window, the `&&` chain still continues.
      if (snapshotFilePath) {
        const finalPath =
          getPlatform() === 'windows'
            ? windowsPathToPosixPath(snapshotFilePath)
            : snapshotFilePath
        commandParts.push(`source ${quote([finalPath])} 2>/dev/null || true`)//命令拼接
      }

      // // Source session environment variables captured from session start hooks
      // const sessionEnvScript = await getSessionEnvironmentScript()//异步获取会话环境变量脚本
      // if (sessionEnvScript) {
      //   commandParts.push(sessionEnvScript)
      // }

      // Disable extended glob patterns for security (after sourcing user config to override)
      const disableExtglobCmd = getDisableExtglobCommand(shellPath)//关闭 Shell 扩展通配符（extglob）
      if (disableExtglobCmd) {
        commandParts.push(disableExtglobCmd)
      }

      // When sourcing a file with aliases, they won't be expanded in the same command line
      // because the shell parses the entire line before execution. Using eval after
      // sourcing causes a second parsing pass where aliases are now available for expansion.
      commandParts.push(`eval ${quotedCommand}`)
      // Use `pwd -P` to get the physical path of the current working directory for consistency with `process.cwd()`
      commandParts.push(`pwd -P >| ${quote([shellCwdFilePath])}`)
      let commandString = commandParts.join(' && ')

      return { commandString, cwdFilePath }
    },

    getSpawnArgs(commandString: string): string[] {
      const skipLoginShell = lastSnapshotFilePath !== undefined
      if (skipLoginShell) {
        logForDebugging('Spawning shell without login (-l flag skipped)')
      }
      return ['-c', ...(skipLoginShell ? [] : ['-l']), commandString]
    },

    async getEnvironmentOverrides(
      command: string,
    ): Promise<Record<string, string>> {//TMUX：终端复用工具，用于在一个终端窗口中运行多个会话
      // TMUX SOCKET ISOLATION (DEFERRED):
      // We initialize efrex's tmux socket ONLY AFTER the Tmux tool has been usedSocket（套接字）：TMUX 用于进程间通信的文件，是 TMUX 工作的核心
      // at least once, OR if the current command appears to use tmux.
      // This defers the startup cost until tmux is actually needed.
      //
      // Once the Tmux tool is used (or a tmux command runs), all subsequent Bash
      // commands will use efrex's isolated socket via the TMUX env var override.
      //
      // See tmuxSocket.ts for the full isolation architecture documentation.
      const commandUsesTmux = command.includes('tmux')//让 Efrex 使用独立的 TMUX Socket，不干扰系统原生 TMUX
      const env: Record<string, string> = {}
      if (currentSandboxTmpDir) {
        let posixTmpDir = currentSandboxTmpDir
        if (getPlatform() === 'windows') {
          posixTmpDir = windowsPathToPosixPath(posixTmpDir)
        }
        env.TMPDIR = posixTmpDir
        env.CLAUDE_CODE_TMPDIR = posixTmpDir
        // Zsh uses TMPPREFIX (default /tmp/zsh) for heredoc temp files,
        // not TMPDIR. Set it to a path inside the sandbox tmp dir so
        // heredocs work in sandboxed zsh commands.
        // Safe to set unconditionally — non-zsh shells ignore TMPPREFIX.
        env.TMPPREFIX = posixJoin(posixTmpDir, 'zsh')
      }
      // // Apply session env vars set via /env (child processes only, not the REPL)
      // for (const [key, value] of getSessionEnvVars()) {
      //   env[key] = value
      // }
      return env
    },
  }
}

/**
 * Returns a shell command to disable extended glob patterns for security.
 * Extended globs (bash extglob, zsh EXTENDED_GLOB) can be exploited via
 * malicious filenames that expand after our security validation.
 *
 * When CLAUDE_CODE_SHELL_PREFIX is set, the actual executing shell may differ
 * from shellPath (e.g., shellPath is zsh but the wrapper runs bash). In this
 * case, we include commands for BOTH shells. We redirect both stdout and stderr
 * to /dev/null because zsh's command_not_found_handler writes to STDOUT.
 *
 * When no shell prefix is set, we use the appropriate command for the detected shell.
 */
function getDisableExtglobCommand(shellPath: string): string | null {
  // When CLAUDE_CODE_SHELL_PREFIX is set, the wrapper may use a different shell
  // than shellPath, so we include both bash and zsh commands
  if (process.env.SHELL_PREFIX) {
    // Redirect both stdout and stderr because zsh's command_not_found_handler
    // writes to stdout instead of stderr
    return '{ shopt -u extglob || setopt NO_EXTENDED_GLOB; } >/dev/null 2>&1 || true'
  }

  // No shell prefix - use shell-specific command
  if (shellPath.includes('bash')) {
    return 'shopt -u extglob 2>/dev/null || true'
  } else if (shellPath.includes('zsh')) {
    return 'setopt NO_EXTENDED_GLOB 2>/dev/null || true'
  }
  // Unknown shell - do nothing, we don't know the right command
  return null
}