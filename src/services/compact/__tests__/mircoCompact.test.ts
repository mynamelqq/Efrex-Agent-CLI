import assert from 'node:assert/strict'
import { afterEach, describe, mock, test } from 'bun:test'

type MockState = {
	logForDebuggingCalls: Array<{ message: string; meta: unknown }>
	now: number
}

const mockState: MockState = {
	logForDebuggingCalls: [],
	now: new Date('2026-05-25T12:00:00.000Z').getTime(),
}

const debugModule = {
	logForDebugging: (message: string, meta: unknown) => {
		mockState.logForDebuggingCalls.push({ message, meta })
	},
}

mock.module('../../utils/debug.js', () => debugModule)
mock.module('../../utils/debug.ts', () => debugModule)
mock.module('../../utils/debug', () => debugModule)

mock.module('../timeBasedMCConfig.js', () => ({
	getTimeBasedMCConfig: () => ({
		enabled: true,
		gapThresholdMinutes: 60,
		keepRecent: 1,
	}),
}))

const { microcompactMessages, TIME_BASED_MC_CLEARED_MESSAGE } = await import(
	'../mircoCompact.js'
)

describe('services/compact/mircoCompact', () => {
	afterEach(() => {
		mockState.logForDebuggingCalls = []
	})

	test('clears older compactable tool results when the time-based trigger fires', async () => {
		const messages = makeMessages()

		const originalNow = Date.now
		Date.now = () => mockState.now

		try {
			const result = await microcompactMessages(messages, undefined, 'chat')

			assert.equal(result.messages.length, 3)
			const userMessage = result.messages[1] as any
			assert.equal(
				userMessage.message.content[0].content,
				TIME_BASED_MC_CLEARED_MESSAGE,
			)
			assert.equal(userMessage.message.content[1].content, 'keep me')
			assert.deepEqual(result.clearedToolUseIds, ['tool-old'])
		} finally {
			Date.now = originalNow
		}
	})

	test('returns the original messages when querySource is missing', async () => {
		const messages = makeMessages()

		const result = await microcompactMessages(messages, undefined, undefined)

		assert.deepEqual(result, { messages })
		assert.equal(mockState.logForDebuggingCalls.length, 0)
	})
})

function makeMessages() {
	return [
		{
			type: 'assistant',
			uuid: 'assistant-1',
			timestamp: new Date('2026-05-25T10:00:00.000Z').toISOString(),
			message: {
				role: 'assistant',
				content: [
					{
						type: 'tool_use',
						id: 'tool-old',
						name: 'Read',
						input: {},
					},
					{
						type: 'tool_use',
						id: 'tool-new',
						name: 'Read',
						input: {},
					},
				],
			},
		},
		{
			type: 'user',
			uuid: 'user-1',
			message: {
				role: 'user',
				content: [
					{
						type: 'tool_result',
						tool_use_id: 'tool-old',
						content: 'clear me',
					},
					{
						type: 'tool_result',
						tool_use_id: 'tool-new',
						content: 'keep me',
					},
				],
			},
		},
		{
			type: 'user',
			uuid: 'user-2',
			message: {
				role: 'user',
				content: 'plain text',
			},
		},
	] as any
}
