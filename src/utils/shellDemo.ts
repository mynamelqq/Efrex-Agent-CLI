import { pathToFileURL } from 'url'
import { exec } from './Shell.js'
import type { ExecResult } from './ShellCommand.js'
import type { ShellType } from './shell/shellProvider.js'

export type ShellDemoOptions = {
	command: string
	shellType?: ShellType
	timeout?: number
	preventCwdChanges?: boolean
	abortSignal?: AbortSignal
}

export async function runShellDemo({
	command,
	shellType = 'bash',
	timeout,
	preventCwdChanges = true,
	abortSignal,
}: ShellDemoOptions): Promise<ExecResult> {
	const signal = abortSignal ?? new AbortController().signal
	const shellCommand = await exec(command, signal, shellType, {
		timeout,
		preventCwdChanges,
	})

	try {
		return await shellCommand.result
	} finally {
		shellCommand.cleanup()
	}
}

async function main(): Promise<void> {
	const command = process.argv.slice(2).join(' ').trim() || 'echo shellDemo'
	const result = await runShellDemo({ command })
	console.log(
		JSON.stringify(
			{
				command,
				code: result.code,
				stdout: result.stdout,
				stderr: result.stderr,
				interrupted: result.interrupted,
			},
			null,
			2,
		),
	)
	if (result.code !== 0) {
		process.exitCode = result.code
	}
}

const invokedAsScript =
	process.argv[1] !== undefined &&
	import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedAsScript) {
	void main().catch(error => {
		console.error(error)
		process.exitCode = 1
	})
}
