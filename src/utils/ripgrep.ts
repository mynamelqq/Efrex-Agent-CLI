import type { ChildProcess, ExecFileException } from 'child_process'
import { execFile, spawn } from 'child_process'
import { existsSync } from 'fs'
import memoize from 'lodash/memoize'
import { homedir } from 'os'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { getPlatform } from './platform.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.join(__filename, '../')

function isEnvDefinedFalsy(value: string | undefined): boolean {
  if (!value) return false
  return ['false', '0', 'no', 'off'].includes(value.trim().toLowerCase())
}

function countCharInString(str: string, char: string): number {
  let count = 0
  for (const c of str) {
    if (c === char) count++
  }
  return count
}

function execFileNoThrow(
  command: string,
  args: string[],
  options?: { timeout?: number },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(command, args, options ?? {}, (error, stdout, stderr) => {
      resolve({
        code: error?.code as number ?? 0,
        stdout: stdout ?? '',
        stderr: stderr ?? '',
      })
    })
  })
}

type RipgrepConfig = {
  mode: 'system' | 'builtin'
  command: string
  args: string[]
}

const getRipgerepConfig = memoize((): RipgrepConfig => {
  const userWantsSystem = isEnvDefinedFalsy(process.env.USE_BUILTIN_RIPGREP)

  if (userWantsSystem) {
    return { mode: 'system', command: 'rg', args: [] }
  }

  const rgRoot = path.resolve(__dirname, 'vendor', 'ripgrep')
  const builtinPath =
    process.platform === 'win32'
      ? path.resolve(rgRoot, `${process.arch}-win32`, 'rg.exe')
      : path.resolve(rgRoot, `${process.arch}-${process.platform}`, 'rg')

  // Fallback to system rg if builtin binary doesn't exist
  if (!existsSync(builtinPath)) {
    return { mode: 'system', command: 'rg', args: [] }
  }

  return { mode: 'builtin', command: builtinPath, args: [] }
})

export function ripgrepCommand(): {
  rgPath: string
  rgArgs: string[]
} {
  const config = getRipgerepConfig()
  return {
    rgPath: config.command,
    rgArgs: config.args,
  }
}

const MAX_BUFFER_SIZE = 20_000_000 // 20MB

/**
 * Custom error class for ripgrep timeouts.
 */
export class RipgrepTimeoutError extends Error {
  constructor(
    message: string,
    public readonly partialResults: string[],
  ) {
    super(message)
    this.name = 'RipgrepTimeoutError'
  }
}

function ripGrepRaw(
  args: string[],
  target: string,
  abortSignal: AbortSignal,
  callback: (
    error: ExecFileException | null,
    stdout: string,
    stderr: string,
  ) => void,
): ChildProcess {
  const { rgPath, rgArgs } = ripgrepCommand()
  const fullArgs = [...rgArgs, ...args, target]
  const defaultTimeout = getPlatform() === 'wsl' ? 60_000 : 20_000
  const parsedSeconds = parseInt(process.env.CLAUDE_CODE_GLOB_TIMEOUT_SECONDS || '', 10) || 0
  const timeout = parsedSeconds > 0 ? parsedSeconds * 1000 : defaultTimeout

  const child = spawn(rgPath, fullArgs, {
    signal: abortSignal,
    windowsHide: true,
  })

  let stdout = ''
  let stderr = ''
  let stdoutTruncated = false
  let stderrTruncated = false

  child.stdout?.on('data', (data: Buffer) => {
    if (!stdoutTruncated) {
      stdout += data.toString()
      if (stdout.length > MAX_BUFFER_SIZE) {
        stdout = stdout.slice(0, MAX_BUFFER_SIZE)
        stdoutTruncated = true
      }
    }
  })

  child.stderr?.on('data', (data: Buffer) => {
    if (!stderrTruncated) {
      stderr += data.toString()
      if (stderr.length > MAX_BUFFER_SIZE) {
        stderr = stderr.slice(0, MAX_BUFFER_SIZE)
        stderrTruncated = true
      }
    }
  })

  let killTimeoutId: ReturnType<typeof setTimeout> | undefined
  const timeoutId = setTimeout(() => {//设置超时，超时时执行回调杀死进程
    if (process.platform === 'win32') {
      child.kill()
    } else {
      child.kill('SIGTERM')
      killTimeoutId = setTimeout(c => c.kill('SIGKILL'), 5_000, child)//windows外的进程 5秒没退出就继续杀
    }
  }, timeout)

  let settled = false
  child.on('close', (code, signal) => {
    if (settled) return
    settled = true
    clearTimeout(timeoutId)
    clearTimeout(killTimeoutId)
    if (code === 0 || code === 1) {
      callback(null, stdout, stderr)
    } else {
      const error: ExecFileException = new Error(
        `ripgrep exited with code ${code}`,
      )
      error.code = code ?? undefined
      error.signal = signal ?? undefined
      callback(error, stdout, stderr)
    }
  })

  child.on('error', (err: NodeJS.ErrnoException) => {
    if (settled) return
    settled = true
    clearTimeout(timeoutId)
    clearTimeout(killTimeoutId)
    const error: ExecFileException = err
    callback(error, stdout, stderr)
  })

  return child
}

/**
 * Stream lines from ripgrep as they arrive, calling `onLines` per stdout chunk.
 */
export async function ripGrepStream(
  args: string[],
  target: string,
  abortSignal: AbortSignal,
  onLines: (lines: string[]) => void,
): Promise<void> {
  const { rgPath, rgArgs } = ripgrepCommand()

  return new Promise<void>((resolve, reject) => {
    const child = spawn(rgPath, [...rgArgs, ...args, target], {
      signal: abortSignal,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    })

    const stripCR = (l: string) => (l.endsWith('\r') ? l.slice(0, -1) : l)
    let remainder = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      const data = remainder + chunk.toString()
      const lines = data.split('\n')
      remainder = lines.pop() ?? ''
      if (lines.length) onLines(lines.map(stripCR))
    })

    let settled = false
    child.on('close', code => {
      if (settled) return
      if (abortSignal.aborted) return
      settled = true
      if (code === 0 || code === 1) {
        if (remainder) onLines([stripCR(remainder)])
        resolve()
      } else {
        reject(new Error(`ripgrep exited with code ${code}`))
      }
    })
    child.on('error', err => {
      if (settled) return
      settled = true
      reject(err)
    })
  })
}

export async function ripGrep(
  args: string[],
  target: string,
  abortSignal: AbortSignal,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const handleResult = (
      error: ExecFileException | null,
      stdout: string,
      stderr: string,
    ): void => {
      if (!error) {
        resolve(//表示成功
          stdout
            .trim()
            .split('\n')
            .map(line => line.replace(/\r$/, ''))//删除字符串末尾的回车符号
            .filter(Boolean),//删除空字符串，null，undefined
        )
        return
      }

      if (error.code === 1) {
        resolve([])//为空
        return
      }

      const CRITICAL_ERROR_CODES = ['ENOENT', 'EACCES', 'EPERM']
      if (CRITICAL_ERROR_CODES.includes(error.code as string)) {
        reject(error)
        return
      }

      const hasOutput = stdout && stdout.trim().length > 0
      const isTimeout =
        error.signal === 'SIGTERM' ||
        error.signal === 'SIGKILL' ||
        error.code === 'ABORT_ERR'
      const isBufferOverflow =
        error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'

      let lines: string[] = []
      if (hasOutput) {
        lines = stdout
          .trim()
          .split('\n')
          .map(line => line.replace(/\r$/, ''))
          .filter(Boolean)
        if (lines.length > 0 && (isTimeout || isBufferOverflow)) {
          lines = lines.slice(0, -1)
        }
      }

      if (isTimeout && lines.length === 0) {
        reject(
          new RipgrepTimeoutError(
            `Ripgrep search timed out after ${getPlatform() === 'wsl' ? 60 : 20} seconds.`,
            lines,
          ),
        )
        return
      }

      resolve(lines)
    }

    ripGrepRaw(args, target, abortSignal, (error, stdout, stderr) => {
      handleResult(error, stdout, stderr)
    })
  })
}

async function ripGrepFileCount(
  args: string[],
  target: string,
  abortSignal: AbortSignal,
): Promise<number> {
  const { rgPath, rgArgs } = ripgrepCommand()

  return new Promise<number>((resolve, reject) => {
    const child = spawn(rgPath, [...rgArgs, ...args, target], {
      signal: abortSignal,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    })

    let lines = 0
    child.stdout?.on('data', (chunk: Buffer) => {
      lines += countCharInString(chunk.toString(), '\n')
    })

    let settled = false
    child.on('close', code => {
      if (settled) return
      settled = true
      if (code === 0 || code === 1) resolve(lines)
      else reject(new Error(`rg --files exited ${code}`))
    })
    child.on('error', err => {
      if (settled) return
      settled = true
      reject(err)
    })
  })
}

/**
 * Count files in a directory recursively using ripgrep.
 */
export const countFilesRoundedRg = memoize(
  async (
    dirPath: string,
    abortSignal: AbortSignal,
    ignorePatterns: string[] = [],
  ): Promise<number | undefined> => {
    if (path.resolve(dirPath) === path.resolve(homedir())) {//防止递归攻击
      return undefined
    }

    try {
      const args = ['--files', '--hidden']
      ignorePatterns.forEach(pattern => {//忽略node_modules等等
        args.push('--glob', `!${pattern}`)
      })

      const count = await ripGrepFileCount(args, dirPath, abortSignal)
      if (count === 0) return 0

      const magnitude = Math.floor(Math.log10(count))
      const power = Math.pow(10, magnitude)
      return Math.round(count / power) * power
    } catch {
      // swallow errors
    }
  },
  (dirPath, _abortSignal, ignorePatterns = []) =>
    `${dirPath}|${ignorePatterns.join(',')}`,
)
