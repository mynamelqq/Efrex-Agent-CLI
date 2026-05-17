import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, mock, test } from 'bun:test'
import { getFileModificationTime } from 'src/utils/file.js'

mock.module('../UI.js', () => ({
	getToolUseSummary: () => null,
	isResultTruncated: () => false,
	renderToolResultMessage: () => null,
	renderToolUseErrorMessage: () => null,
	renderToolUseMessage: () => null,
	renderToolUseRejectedMessage: () => null,
	userFacingName: () => 'Write',
}))

const { FileWriteTool } = await import('../FileWriteTool.js')

describe('tools/FileWriteTool', () => {
	afterEach(() => {
		delete process.env.DISABLE_FILE_CHECKPOINTING
	})

	test('call creates a new file and returns create metadata', async () => {
		process.env.DISABLE_FILE_CHECKPOINTING = '1'

		const dir = mkdtempSync(join(tmpdir(), 'file-write-tool-'))
		const filePath = join(dir, 'created.txt')
		const readFileState = new Map<string, any>()
		const updateFileHistoryState = () => {}

		const result = await FileWriteTool.call(
			{
				file_path: filePath,
				content: 'hello\nworld\n',
			},
			{
				readFileState,
				updateFileHistoryState,
			} as any,
			{ uuid: 'assistant-1' } as any,
		)

		assert.deepEqual(result.data, {
			type: 'create',
			filePath,
			content: 'hello\nworld\n',
			structuredPatch: [],
			originalFile: null,
		})
		assert.equal(readFileSync(filePath, 'utf8'), 'hello\nworld\n')
		assert.equal(readFileState.get(filePath)?.content, 'hello\nworld\n')
		assert.equal(readFileState.get(filePath)?.timestamp, getFileModificationTime(filePath))
	})

	test('call updates an existing file and returns update metadata', async () => {
		process.env.DISABLE_FILE_CHECKPOINTING = '1'

		const dir = mkdtempSync(join(tmpdir(), 'file-write-tool-'))
		const filePath = join(dir, 'existing.txt')
		writeFileSync(filePath, 'old\ncontent\n', 'utf8')

		const readFileState = new Map<string, any>([
			[
				filePath,
				{
					content: 'old\ncontent\n',
					timestamp: getFileModificationTime(filePath),
					offset: undefined,
					limit: undefined,
				},
			],
		])
		const updateFileHistoryState = () => {}

		const result = await FileWriteTool.call(
			{
				file_path: filePath,
				content: 'new\ncontent\n',
			},
			{
				readFileState,
				updateFileHistoryState,
			} as any,
			{ uuid: 'assistant-2' } as any,
		)

		assert.equal(readFileSync(filePath, 'utf8'), 'new\ncontent\n')
		assert.deepEqual(result.data, {
			type: 'update',
			filePath,
			content: 'new\ncontent\n',
			originalFile: 'old\ncontent\n',
			structuredPatch: result.data.structuredPatch,
		})
		assert.equal(readFileState.get(filePath)?.content, 'new\ncontent\n')
		assert.equal(readFileState.get(filePath)?.timestamp, getFileModificationTime(filePath))
		assert.ok(Array.isArray(result.data.structuredPatch))
	})

	test('call returns correct structuredPatch hunks for multi-line diff', async () => {
		process.env.DISABLE_FILE_CHECKPOINTING = '1'

		const dir = mkdtempSync(join(tmpdir(), 'file-write-tool-'))
		const filePath = join(dir, 'multi-line.txt')
		const originalContent = [
			'line 1',
			'line 2 old',
			'line 3 old',
			'line 4',
			'line 5',
			'line 6',
			'line 7',
		].join('\n') + '\n'
		writeFileSync(filePath, originalContent, 'utf8')

		const readFileState = new Map<string, any>([
			[
				filePath,
				{
					content: originalContent,
					timestamp: getFileModificationTime(filePath),
					offset: undefined,
					limit: undefined,
				},
			],
		])
		const updateFileHistoryState = () => {}

		const newContent = [
			'line 1',
			'line 2 new',
			'line 3 new',
			'line 4',
			'line 5',
			'line 6',
			'line 7',
		].join('\n') + '\n'

		const result = await FileWriteTool.call(
			{
				file_path: filePath,
				content: newContent,
			},
			{
				readFileState,
				updateFileHistoryState,
			} as any,
			{ uuid: 'assistant-3' } as any,
		)

		assert.equal(result.data.type, 'update')
		const patch = result.data.structuredPatch
		assert.ok(patch.length > 0, 'structuredPatch should contain at least one hunk')

		const hunk = patch[0]!
		assert.ok(typeof hunk.oldStart === 'number', 'hunk should have oldStart')
		assert.ok(typeof hunk.newStart === 'number', 'hunk should have newStart')
		assert.ok(Array.isArray(hunk.lines), 'hunk should have lines array')

		// Verify diff markers exist
		const removeLines = hunk.lines.filter((l: string) => l.startsWith('-'))
		const addLines = hunk.lines.filter((l: string) => l.startsWith('+'))
		assert.ok(removeLines.length > 0, 'should have removed lines')
		assert.ok(addLines.length > 0, 'should have added lines')

		// Verify specific content
		assert.ok(
			hunk.lines.some((l: string) => l === '-line 2 old'),
			'should contain removed line 2',
		)
		assert.ok(
			hunk.lines.some((l: string) => l === '+line 2 new'),
			'should contain added line 2',
		)
	})
})
