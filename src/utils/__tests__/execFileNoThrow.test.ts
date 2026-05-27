import { describe, expect, test } from 'bun:test'
import { execFileNoThrow } from '../execFileNoThrow.js'
import { gitExe } from '../git.js'

describe('utils/execFileNoThrow', () => {
	test('runs git when the executable path contains spaces', async () => {
		const result = await execFileNoThrow(gitExe(), ['--version'])

		expect(result.code).toBe(0)
		expect(result.stdout.trim().toLowerCase()).toContain('git version')
	})
})
