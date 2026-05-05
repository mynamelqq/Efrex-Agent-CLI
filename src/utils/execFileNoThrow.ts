// This file represents useful wrappers over node:child_process
// These wrappers ease error handling and cross-platform compatbility

import { spawn } from 'child_process'
import { getCwd } from '../utils/cwd.js'


const MS_IN_SECOND = 1000
const SECONDS_IN_MINUTE = 60

type ExecFileOptions = {
  abortSignal?: AbortSignal
  timeout?: number
  preserveOutputOnError?: boolean
  // Setting useCwd=false avoids circular dependencies during initialization
  // getCwd() -> PersistentShell -> logEvent() -> execFileNoThrow
  useCwd?: boolean
  env?: NodeJS.ProcessEnv
  stdin?: 'ignore' | 'inherit' | 'pipe'
  input?: string
}

export function execFileNoThrow(
  file: string,
  args: string[],
  options: ExecFileOptions = {
    timeout: 10 * SECONDS_IN_MINUTE * MS_IN_SECOND,
    preserveOutputOnError: true,
    useCwd: true,
  },
): Promise<{ stdout: string; stderr: string; code: number; error?: string }> {
  return execFileNoThrowWithCwd(file, args, {
    abortSignal: options.abortSignal,
    timeout: options.timeout,
    preserveOutputOnError: options.preserveOutputOnError,
    cwd: options.useCwd ? getCwd() : undefined,
    env: options.env,
    stdin: options.stdin,
    input: options.input,
  })
}

type ExecFileWithCwdOptions = {
  abortSignal?: AbortSignal
  timeout?: number
  preserveOutputOnError?: boolean
  maxBuffer?: number
  cwd?: string
  env?: NodeJS.ProcessEnv
  shell?: boolean | string | undefined
  stdin?: 'ignore' | 'inherit' | 'pipe'
  input?: string
}

/**
 * execFile, but always resolves (never throws)
 */
export function execFileNoThrowWithCwd(
  file: string,
  args: string[],
  {
    abortSignal,
    timeout: finalTimeout = 10 * SECONDS_IN_MINUTE * MS_IN_SECOND,
    preserveOutputOnError: finalPreserveOutput = true,
    cwd: finalCwd,
    env: finalEnv,
    maxBuffer,
    shell,
    stdin: finalStdin,
    input: finalInput,
  }: ExecFileWithCwdOptions = {
    timeout: 10 * SECONDS_IN_MINUTE * MS_IN_SECOND,
    preserveOutputOnError: true,
    maxBuffer: 1_000_000,
  },
): Promise<{ stdout: string; stderr: string; code: number; error?: string }> {
  return new Promise(resolve => {
    let settled = false
    let stdout = ''
    let stderr = ''

    const child = spawn(file, args, {
      cwd: finalCwd,
      env: finalEnv,
      shell: shell ?? process.platform === 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
      signal: abortSignal,
    })

    const finish = (result: {
      stdout: string
      stderr: string
      code: number
      error?: string
    }) => {
      if (settled) return
      settled = true
      if (timeout) clearTimeout(timeout)
      resolve(result)
    }

    const append = (current: string, chunk: Buffer): string => {
      if (maxBuffer !== undefined && Buffer.byteLength(current) >= maxBuffer) {
        return current
      }
      const next = current + chunk.toString()
      if (maxBuffer === undefined) return next
      return Buffer.byteLength(next) > maxBuffer
        ? next.slice(0, maxBuffer)
        : next
    }

    const timeout =
      finalTimeout > 0
        ? setTimeout(() => {
            child.kill()
            finish({
              stdout: finalPreserveOutput ? stdout : '',
              stderr: finalPreserveOutput ? stderr : '',
              code: 1,
              error: `Command timed out after ${finalTimeout}ms`,
            })
          }, finalTimeout)
        : undefined

    child.stdout?.on('data', chunk => {
      stdout = append(stdout, chunk)
    })
    child.stderr?.on('data', chunk => {
      stderr = append(stderr, chunk)
    })

    child.on('error', error => {
      finish({
        stdout: finalPreserveOutput ? stdout : '',
        stderr: finalPreserveOutput ? stderr : '',
        code: 1,
        error: error.message,
      })
    })

    child.on('close', (code, signal) => {
      const exitCode = code ?? (signal ? 1 : 0)
      if (exitCode === 0) {
        finish({ stdout, stderr, code: 0 })
        return
      }
      finish({
        stdout: finalPreserveOutput ? stdout : '',
        stderr: finalPreserveOutput ? stderr : '',
        code: exitCode,
        error: signal ?? String(exitCode),
      })
    })

    if (finalInput !== undefined) {
      child.stdin?.end(finalInput)
    } else if (finalStdin !== 'inherit') {
      child.stdin?.end()
    }
  })
}
