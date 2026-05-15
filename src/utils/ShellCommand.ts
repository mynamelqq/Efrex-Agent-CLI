import type { ChildProcess } from 'child_process'
import treeKill from 'tree-kill'
import { formatDuration } from './format.js'
import { errorMessage } from './errors.js'

export type ExecResult = {
	stdout: string
	stderr: string
	code: number
	interrupted: boolean
	/** Present only in file-backed implementations. The simplified runner leaves it unset. */
	outputFilePath?: string
	outputFileSize?: number
	outputTaskId?: string
	/** Error message when the command failed before spawning (e.g., deleted cwd). */
	preSpawnError?: string
}

export type ShellCommand = {
	result: Promise<ExecResult>
	kill: () => void
	status: 'running' | 'completed' | 'killed'
	cleanup: () => void
}

const SIGKILL = 137
const SIGTERM = 143

function prependStderr(prefix: string, stderr: string): string {
	return stderr ? `${prefix} ${stderr}` : prefix
}

class ShellCommandImpl implements ShellCommand {
	#status: 'running' | 'completed' | 'killed' = 'running'
	#childProcess: ChildProcess | null
	#abortSignal: AbortSignal | null
	#timeout: number
	#timeoutId: NodeJS.Timeout | null = null
	#boundAbortHandler: (() => void) | null = null
	#stdout = ''
	#stderr = ''
	#combinedOutput = ''
	#settled = false
	#forcedExitCode: number | null = null
	#stdoutHandler = (chunk: Buffer | string): void => {
		const text = typeof chunk === 'string' ? chunk : chunk.toString()
		this.#stdout += text
		this.#combinedOutput += text
	}
	#stderrHandler = (chunk: Buffer | string): void => {
		const text = typeof chunk === 'string' ? chunk : chunk.toString()
		this.#stderr += text
		this.#combinedOutput += text
	}

	readonly result: Promise<ExecResult>

	constructor(
		childProcess: ChildProcess,
		abortSignal: AbortSignal,
		timeout: number,
	) {
		this.#childProcess = childProcess
		this.#abortSignal = abortSignal
		this.#timeout = timeout

		childProcess.stdout?.setEncoding('utf8')
		childProcess.stderr?.setEncoding('utf8')
		childProcess.stdout?.on('data', this.#stdoutHandler)
		childProcess.stderr?.on('data', this.#stderrHandler)

		this.result = this.#createResultPromise()
	}

	get status(): 'running' | 'completed' | 'killed' {
		return this.#status
	}

	#createResultPromise(): Promise<ExecResult> {
		this.#boundAbortHandler = this.kill.bind(this)
		this.#abortSignal?.addEventListener('abort', this.#boundAbortHandler, {
			once: true,
		})

		this.#timeoutId = setTimeout(() => {
			this.#doKill(SIGTERM)
		}, this.#timeout) as NodeJS.Timeout

		return new Promise<ExecResult>(resolve => {
			this.#childProcess?.once('error', error => {
				this.#resolve(
					resolve,
					1,
					prependStderr(errorMessage(error), this.#stderr),
					false,
				)
			})
			this.#childProcess?.once('exit', (code, signal) => {
				const exitCode =
					this.#forcedExitCode ??
					(code !== null && code !== undefined
						? code
						: signal === 'SIGTERM'
							? SIGTERM
							: signal === 'SIGKILL'
								? SIGKILL
								: 1)
				this.#resolve(
					resolve,
					exitCode,
					this.#stderr,
					this.#status === 'killed' || exitCode === SIGKILL,
				)
			})
		})
	}

	#resolve(
		resolve: (result: ExecResult) => void,
		code: number,
		stderr: string,
		interrupted: boolean,
	): void {
		if (this.#settled) {
			return
		}
		this.#settled = true
		this.#cleanupListeners()

		if (this.#status === 'running') {
			this.#status = 'completed'
		}

		const result: ExecResult = {
			code,
			stdout: this.#combinedOutput,
			stderr,
			interrupted,
		}

		if (code === SIGTERM) {
			result.stderr = prependStderr(
				`Command timed out after ${formatDuration(this.#timeout)}`,
				result.stderr,
			)
			result.interrupted = true
		}

		resolve(result)
	}

	#cleanupListeners(): void {
		if (this.#timeoutId) {
			clearTimeout(this.#timeoutId)
			this.#timeoutId = null
		}
		if (this.#abortSignal && this.#boundAbortHandler) {
			this.#abortSignal.removeEventListener('abort', this.#boundAbortHandler)
			this.#boundAbortHandler = null
		}
	}

	#doKill(code = SIGKILL): void {
		if (this.#status !== 'running') {
			return
		}
		this.#status = 'killed'
		this.#forcedExitCode = code
		if (this.#childProcess?.pid) {
			treeKill(this.#childProcess.pid, 'SIGKILL')
		}
	}

	kill(): void {
		this.#doKill()
	}

	cleanup(): void {
		this.#cleanupListeners()
		this.#childProcess?.stdout?.removeListener('data', this.#stdoutHandler)
		this.#childProcess?.stderr?.removeListener('data', this.#stderrHandler)
		this.#childProcess = null
		this.#abortSignal = null
		this.#stdout = ''
		this.#stderr = ''
		this.#combinedOutput = ''
	}
}

export function wrapSpawn(
	childProcess: ChildProcess,
	abortSignal: AbortSignal,
	timeout: number,
): ShellCommand {
	return new ShellCommandImpl(childProcess, abortSignal, timeout)
}

class StaticShellCommand implements ShellCommand {
	readonly status: 'completed' | 'killed'
	readonly result: Promise<ExecResult>

	constructor(status: 'completed' | 'killed', result: ExecResult) {
		this.status = status
		this.result = Promise.resolve(result)
	}

	kill(): void {}

	cleanup(): void {}
}

export function createAbortedCommand(opts?: {
	stderr?: string
	code?: number
}): ShellCommand {
	return new StaticShellCommand('killed', {
		code: opts?.code ?? 145,
		stdout: '',
		stderr: opts?.stderr ?? 'Command aborted before execution',
		interrupted: true,
	})
}

export function createFailedCommand(preSpawnError: string): ShellCommand {
	return new StaticShellCommand('completed', {
		code: 1,
		stdout: '',
		stderr: preSpawnError,
		interrupted: false,
		preSpawnError,
	})
}
