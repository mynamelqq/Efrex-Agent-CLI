import {
  getOriginalCwd,
  setCwdState,
} from '../bootstrap/state.js'
import { accessSync } from 'fs'
import { logForDebugging } from './debug.js'
import { which } from './which.js'
import { execFileSync, spawn } from 'child_process'
import { isAbsolute, resolve } from 'path'
import { getCachedPowerShellPath } from './shell/powershellDetection.js'
import { getPlatform } from './platform.js'
import { logError } from './logger.js'
import { constants as fsConstants, readFileSync } from 'fs'
import { errorMessage } from './errors.js'
import {
  createAbortedCommand,
  createFailedCommand,
  ShellCommand,
  wrapSpawn,
} from './ShellCommand.js'
import { pwd } from './cwd.js'
import { memoize } from 'lodash'
import { realpathSync,unlinkSync,realpath} from 'fs'
import { ShellType,ShellProvider} from './shell/shellProvider.js'
import { cwd } from 'process'
import { createPowerShellProvider } from './powershellProvider.js'
import { posixPathToWindowsPath} from './windowsPaths.js'
import { isENOENT } from './errors.js'
import { getSessionId } from '../bootstrap/state.js'
import { createBashShellProvider } from './bash/bashProvider.js'
const DEFAULT_TIMEOUT = 30 * 60 * 1000 // 30 minutes
export type ShellConfig = {
  provider: ShellProvider
}
/**
 * Set the current working directory
 */
export function setCwd(path: string, relativeTo?: string): void {//得到真实的路径，而不是符号路径
  const resolved = isAbsolute(path)
    ? path
    : resolve(relativeTo || cwd(), path)
  // Resolve symlinks to match the behavior of pwd -P.
  // realpathSync throws ENOENT if the path doesn't exist - convert to a
  // friendlier error message instead of a separate existsSync pre-check (TOCTOU).
  let physicalPath: string
  try {
    physicalPath = realpathSync(resolved)
  } catch (e) {
    if (isENOENT(e)) {
      throw new Error(`Path "${resolved}" does not exist`)
    }
    throw e
  }
  setCwdState(physicalPath)
}

/**
 * Execute a shell command using the environment snapshot
 * Creates a new shell process for each command execution
 */
export async function exec(
  command: string,
  abortSignal: AbortSignal,
  shellType: ShellType,
  options?: ExecOptions,
): Promise<ShellCommand> {
  const {
    timeout,
    preventCwdChanges,
    onStdout,
  } = options ?? {}
  const commandTimeout = timeout || DEFAULT_TIMEOUT

  const provider = await resolveProvider[shellType]()

  const id = Math.floor(Math.random() * 0x10000)
    .toString(16)
    .padStart(4, '0')

  const { commandString: builtCommand, cwdFilePath } =
    await provider.buildExecCommand(command, {//构造命令
      id,
    })

  let cwd = pwd()

  // Recover if the current working directory no longer exists on disk.
  // This can happen when a command deletes its own CWD (e.g., temp dir cleanup).
  try {
    await realpath(cwd,()=>{})
  } catch {
    const fallback = getOriginalCwd()//如果当前pwd访问错误，回退
    logForDebugging(
      `Shell CWD "${cwd}" no longer exists, recovering to "${fallback}"`,
    )
    try {
      await realpath(fallback,()=>{})
      setCwdState(fallback)//设置originalPath
      cwd = fallback
    } catch {
      return createFailedCommand(
        `Working directory "${cwd}" no longer exists. Please restart Claude from an existing directory.`,
      )
    }
  }

  // If already aborted, don't spawn the process at all
  if (abortSignal.aborted) {
    return createAbortedCommand()
  }

  const binShell = provider.shellPath

  const shellArgs = provider.getSpawnArgs(builtCommand)
  const envOverrides = await provider.getEnvironmentOverrides(command)

  try {
    const childProcess = spawn(binShell, shellArgs, {
      env: {
        // ...subprocessEnv(),
        SHELL: shellType === 'bash' ? binShell : undefined,
        GIT_EDITOR: 'true',
        CLAUDECODE: '1',
        ...envOverrides,
        ...(process.env.USER_TYPE === 'ant'
          ? {
              CLAUDE_CODE_SESSION_ID: getSessionId(),
            }
          : {}),
      },
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      // Don't pass the signal - we'll handle termination ourselves with tree-kill
      detached: provider.detached,
      // Prevent visible console window on Windows (no-op on other platforms)
      windowsHide: true,
    })

    const shellCommand = wrapSpawn(
      childProcess,
      abortSignal,
      commandTimeout,
    )

    // Attach optional real-time stdout callbacks. The command result still
    // buffers stdout and stderr until the process exits.
    if (childProcess.stdout && onStdout) {
      childProcess.stdout.on('data', (chunk: string | Buffer) => {
        onStdout(typeof chunk === 'string' ? chunk : chunk.toString())
      })
    }

    // Attach cleanup to the command result
    // NOTE: readFileSync/unlinkSync are intentional here — these must complete
    // synchronously within the .then() microtask so that callers who
    // `await shellCommand.result` see the updated cwd immediately after.
    // Using async readFile would introduce a microtask boundary, causing
    // a race where cwd hasn't been updated yet when the caller continues.

    // On Windows, cwdFilePath is a POSIX path (for bash's `pwd -P >| $path`),
    // but Node.js needs a native Windows path for readFileSync/unlinkSync.
    // Similarly, `pwd -P` outputs a POSIX path that must be converted before setCwd.
    const nativeCwdFilePath =
      getPlatform() === 'windows'
        ? posixPathToWindowsPath(cwdFilePath)
        : cwdFilePath

    void shellCommand.result.then(async result => {
      // Only foreground tasks update the cwd
      if (result && !preventCwdChanges) {
        try {
          let newCwd = readFileSync(nativeCwdFilePath, {
            encoding: 'utf8',
          }).trim()
          if (getPlatform() === 'windows') {
            newCwd = posixPathToWindowsPath(newCwd)
          }
          // // cwd is NFC-normalized (setCwdState); newCwd from `pwd -P` may be
          // // NFD on macOS APFS. Normalize before comparing so Unicode paths
          // // don't false-positive as "changed" on every command.
          // if (newCwd.normalize('NFC') !== cwd) {
          //   setCwd(newCwd, cwd)
          //   invalidateSessionEnvCache()
          //   void onCwdChangedForHooks(cwd, newCwd)
          // }
        } catch {}
      }
      // Clean up the temp file used for cwd tracking
      try {
        unlinkSync(nativeCwdFilePath)
      } catch {
        // File may not exist if command failed before pwd -P ran
      }
    })

    return shellCommand
  } catch (error) {
    logForDebugging(`Shell exec error: ${errorMessage(error)}`)

    return createAbortedCommand({
      code: 126, // Standard Unix code for execution errors
      stderr: errorMessage(error),
    })
  }
}
export type ExecOptions = {
  timeout?: number
  preventCwdChanges?: boolean
  /** When provided, stdout is piped (not sent to file) and this callback fires on each data chunk. */
  onStdout?: (data: string) => void
}


export const getPsProvider = memoize(async (): Promise<ShellProvider> => {//powershell 
  const psPath = await getCachedPowerShellPath()
  if (!psPath) {
    throw new Error('PowerShell is not available')
  }
  return createPowerShellProvider(psPath)
})

const resolveProvider: Record<ShellType, () => Promise<ShellProvider>> = {
  bash: async () => (await getShellConfig()).provider,
  powershell: getPsProvider,
}

// Memoize the entire shell config so it only happens once per session
export const getShellConfig = memoize(getShellConfigImpl)
async function getShellConfigImpl(): Promise<ShellConfig> {
  const binShell = await findSuitableShell()
  const provider = await createBashShellProvider(binShell)
  return { provider }
}
/**
 * Determines the best available shell to use.
 */
export async function findSuitableShell(): Promise<string> {
  // Check for explicit shell override first
  const shellOverride = process.env.SHELL
  if (shellOverride) {
    // Validate it's a supported shell type
    const isSupported =
      shellOverride.includes('bash') || shellOverride.includes('zsh')
    if (isSupported && isExecutable(shellOverride)) {
      logForDebugging(`Using shell override: ${shellOverride}`)
      return shellOverride
    } else {
      // Note, if we ever want to add support for new shells here we'll need to update or Bash tool parsing to account for this
      logForDebugging(
        `CLAUDE_CODE_SHELL="${shellOverride}" is not a valid bash/zsh path, falling back to detection`,
      )
    }
  }

  // Check user's preferred shell from environment
  const env_shell = process.env.SHELL
  // Only consider SHELL if it's bash or zsh
  const isEnvShellSupported =
    env_shell && (env_shell.includes('bash') || env_shell.includes('zsh'))
  const preferBash = env_shell?.includes('bash')

  // Try to locate shells using which (uses Bun.which when available)
  const [zshPath, bashPath] = await Promise.all([which('zsh'), which('bash')])

  // Populate shell paths from which results and fallback locations
  const shellPaths = ['/bin', '/usr/bin', '/usr/local/bin', '/opt/homebrew/bin']
  const windowsGitShellPaths =
    getPlatform() === 'windows'
      ? [
          'C:\\Program Files\\Git\\bin\\bash.exe',
          'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
          'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
          'C:\\Program Files (x86)\\Git\\usr\\bin\\bash.exe',
        ]
      : []

  // Order shells based on user preference
  const shellOrder = preferBash ? ['bash', 'zsh'] : ['zsh', 'bash']
  const supportedShells = shellOrder.flatMap(shell =>
    shellPaths.map(path => `${path}/${shell}`),
  )

  for (const gitShellPath of windowsGitShellPaths) {
    if (gitShellPath.toLowerCase().includes('bash.exe')) {
      if (preferBash) {
        supportedShells.unshift(gitShellPath)
      } else {
        supportedShells.push(gitShellPath)
      }
    }
  }

  // Add discovered paths to the beginning of our search list
  // Put the user's preferred shell type first
  if (preferBash) {
    if (bashPath) supportedShells.unshift(bashPath)
    if (zshPath) supportedShells.push(zshPath)
  } else {
    if (zshPath) supportedShells.unshift(zshPath)
    if (bashPath) supportedShells.push(bashPath)
  }

  // Always prioritize SHELL env variable if it's a supported shell type
  if (isEnvShellSupported && isExecutable(env_shell)) {
    supportedShells.unshift(env_shell)
  }

  const shellPath = supportedShells.find(shell => shell && isExecutable(shell))

  // If no valid shell found, throw a helpful error
  if (!shellPath) {
    const errorMsg =
      'No suitable shell found. Claude CLI requires a Posix shell environment. ' +
      'Please ensure you have a valid shell installed and the SHELL environment variable set.'
    logError(new Error(errorMsg))
    throw new Error(errorMsg)
  }

  return shellPath
}
function isExecutable(shellPath: string): boolean {
  try {
    accessSync(shellPath, fsConstants.X_OK)//能访问可以执行
    return true
  } catch (_err) {
    // Fallback for Nix and other environments where X_OK check might fail
    try {
      // Try to execute the shell with --version, which should exit quickly
      // Use execFileSync to avoid shell injection vulnerabilities
      execFileSync(shellPath, ['--version'], {
        timeout: 1000,
        stdio: 'ignore',
      })
      return true
    } catch {
      return false
    }
  }
}
