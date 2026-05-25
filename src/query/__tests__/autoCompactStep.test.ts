import assert from 'node:assert/strict'
import { describe, test } from 'bun:test'
import { runAutoCompactStep } from '../autoCompactStep.js'

describe('query/autoCompactStep', () => {
	test('threads tracking into autoCompactIfNeeded and yields post-compact messages', async () => {
		const calls: unknown[] = []

		const result = await runAutoCompactStep(
			{
				messagesForQuery: [makeMessage('user-1', 'hello')],
				toolUseContext: makeToolUseContext(),
				autoCompactTracking: {
					compacted: true,
					turnCounter: 7,
					turnId: 'turn-7',
				},
				autoCompactQuerySource: {
					systemPrompt: 'sys',
					userContext: { locale: 'en' },
					systemContext: { mode: 'chat' },
					toolUseContext: makeToolUseContext(),
					forkContextMessages: [makeMessage('user-1', 'hello')],
				} as any,
			},
			{
				autoCompactIfNeeded: async (...args) => {
					calls.push(args)
					return {
						wasCompacted: true,
						compactionResult: {
							boundaryMarker: makeMessage('boundary', 'boundary'),
							summaryMessages: [makeMessage('summary', 'summary')],
							messagesToKeep: [makeMessage('keep', 'keep')],
							attachments: [],
						} as any,
					}
				},
				buildPostCompactMessages: result => [
					result.boundaryMarker,
					...result.summaryMessages,
					...(result.messagesToKeep ?? []),
					...result.attachments,
				],
				createTurnId: () => 'turn-8',
			},
		)

		assert.equal(calls.length, 1)
		assert.deepEqual(calls[0], [
			[makeMessage('user-1', 'hello')],
			makeToolUseContext(),
			{
				systemPrompt: 'sys',
				userContext: { locale: 'en' },
				systemContext: { mode: 'chat' },
				toolUseContext: makeToolUseContext(),
				forkContextMessages: [makeMessage('user-1', 'hello')],
			},
			{
				compacted: true,
				turnCounter: 7,
				turnId: 'turn-7',
			},
		])
		assert.deepEqual(result.messagesForQuery, [
			makeMessage('boundary', 'boundary'),
			makeMessage('summary', 'summary'),
			makeMessage('keep', 'keep'),
		])
		assert.deepEqual(result.postCompactMessages, [
			makeMessage('boundary', 'boundary'),
			makeMessage('summary', 'summary'),
			makeMessage('keep', 'keep'),
		])
		assert.deepEqual(result.autoCompactTracking, {
			compacted: true,
			turnId: 'turn-8',
			turnCounter: 0,
			consecutiveFailures: 0,
		})
		assert.equal(result.consecutiveFailures, 0)
	})

	test('propagates consecutive failure counts without compacting', async () => {
		const result = await runAutoCompactStep(
			{
				messagesForQuery: [makeMessage('user-1', 'hello')],
				toolUseContext: makeToolUseContext(),
				autoCompactTracking: {
					compacted: false,
					turnCounter: 2,
					turnId: 'turn-2',
					consecutiveFailures: 1,
				},
				autoCompactQuerySource: {
					systemPrompt: 'sys',
					userContext: {},
					systemContext: {},
					toolUseContext: makeToolUseContext(),
					forkContextMessages: [makeMessage('user-1', 'hello')],
				} as any,
			},
			{
				autoCompactIfNeeded: async () => ({
					wasCompacted: false,
					consecutiveFailures: 2,
				}),
				buildPostCompactMessages: () => [],
				createTurnId: () => 'unused',
			},
		)

		assert.deepEqual(result.messagesForQuery, [makeMessage('user-1', 'hello')])
		assert.deepEqual(result.autoCompactTracking, {
			compacted: false,
			turnCounter: 2,
			turnId: 'turn-2',
			consecutiveFailures: 2,
		})
		assert.equal(result.consecutiveFailures, 2)
		assert.equal(result.postCompactMessages, undefined)
	})
})

function makeMessage(uuid: string, content: string) {
	return {
		type: 'user',
		uuid,
		message: {
			role: 'user',
			content,
		},
	}
}

function makeToolUseContext() {
	return {
		options: {
			tools: [],
		},
	} as any
}
