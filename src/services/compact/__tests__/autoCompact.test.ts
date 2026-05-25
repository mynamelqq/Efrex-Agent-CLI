import assert from 'node:assert/strict'
import { afterEach, describe, mock, test } from 'bun:test'

type MockState = {
	compactConversationCalls: number
	compactConversationArgs: unknown[][]
	compactConversationMode: 'resolve' | 'throw'
	logErrorCalls: unknown[]
	logForDebuggingCalls: Array<{ message: string; meta: unknown }>
}

const mockState: MockState = {
	compactConversationCalls: 0,
	compactConversationArgs: [],
	compactConversationMode: 'resolve',
	logErrorCalls: [],
	logForDebuggingCalls: [],
}

const trackedEnvKeys = [
	'DISABLE_COMPACT',
	'DISABLE_AUTO_COMPACT',
	'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE',
	'AUTO_COMPACT_WINDOW',
	'CLAUDE_CODE_BLOCKING_LIMIT_OVERRIDE',
] as const

const originalEnv = Object.fromEntries(
	trackedEnvKeys.map(key => [key, process.env[key]]),
) as Record<(typeof trackedEnvKeys)[number], string | undefined>

mock.module('src/utils/config.js', () => ({
	createDefaultGlobalConfig: () => ({
		autoCompactEnabled: true,
	}),
}))

const tokensModule = {
	getTokenCountFromUsage: () => 0,
	getTokenUsage: () => undefined,
	tokenCountFromLastAPIResponse: () => 0,
	tokenCountWithEstimation: () => 0,
}

mock.module('src/utils/tokens.js', () => tokensModule)
mock.module('src/utils/tokens.ts', () => tokensModule)
mock.module('src/utils/tokens', () => tokensModule)

mock.module('src/context.js', () => ({
	getContextWindowForModel: () => 1_000,
	getModelMaxOutputTokens: () => ({ default: 100 }),
}))

const errorsModule = {
	AbortError: class AbortError extends Error {},
	MalformedCommandError: class MalformedCommandError extends Error {},
	ShellError: class ShellError extends Error {
		constructor(
			public readonly stdout: string,
			public readonly stderr: string,
			public readonly code: number,
			public readonly interrupted: boolean,
		) {
			super('Shell command failed')
			this.name = 'ShellError'
		}
	},
	errorMessage: (error: unknown) =>
		error instanceof Error ? error.message : String(error),
	getErrnoCode: (error: unknown) =>
		error &&
		typeof error === 'object' &&
		'code' in error &&
		typeof error.code === 'string'
			? error.code
			: undefined,
	hasExactErrorMessage: (error: unknown, message: string) =>
		error instanceof Error && error.message === message,
	isAbortError: (error: unknown) => error instanceof Error && error.name === 'AbortError',
	isENOENT: (error: unknown) => false,
	toError: (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
}

mock.module('src/utils/errors.js', () => errorsModule)
mock.module('src/utils/errors.ts', () => errorsModule)
mock.module('src/utils/errors', () => errorsModule)

const logModule = {
	logError: (error: unknown) => {
		mockState.logErrorCalls.push(error)
	},
}

const debugModule = {
	logForDebugging: (message: string, meta: unknown) => {
		mockState.logForDebuggingCalls.push({ message, meta })
	},
}

mock.module('../../utils/log.js', () => logModule)
mock.module('../../utils/log.ts', () => logModule)
mock.module('../../utils/log', () => logModule)

mock.module('../../utils/debug.js', () => debugModule)
mock.module('../../utils/debug.ts', () => debugModule)
mock.module('../../utils/debug', () => debugModule)

const compactModule = {
	compactConversation: async (...args: unknown[]) => {
		mockState.compactConversationCalls += 1
		mockState.compactConversationArgs.push(args)

		if (mockState.compactConversationMode === 'throw') {
			throw new Error('boom')
		}

		return {
			boundaryMarker: { type: 'system' },
			summaryMessages: [],
			attachments: [],
		}
	},
	ERROR_MESSAGE_USER_ABORT: 'API Error: Request was aborted.',
}

mock.module('./compact.js', () => compactModule)
mock.module('./compact.ts', () => compactModule)
mock.module('../compact.js', () => compactModule)
mock.module('../compact.ts', () => compactModule)

const { autoCompactIfNeeded } = await import('../autoCompact.js')

describe('services/compact/autoCompactIfNeeded', () => {
	afterEach(() => {
		for (const key of trackedEnvKeys) {
			const value = originalEnv[key]
			if (value === undefined) {
				delete process.env[key]
			} else {
				process.env[key] = value
			}
		}

		mockState.compactConversationCalls = 0
		mockState.compactConversationArgs = []
		mockState.compactConversationMode = 'resolve'
		mockState.logErrorCalls = []
		mockState.logForDebuggingCalls = []
	})

	test('returns early when compacting is disabled', async () => {
		process.env.DISABLE_COMPACT = '1'

		const result = await autoCompactIfNeeded(
			makeMessages(),
			makeToolUseContext(),
		)

		assert.deepEqual(result, { wasCompacted: false })
		assert.equal(mockState.compactConversationCalls, 0)
	})

	test('compacts and forwards recompaction metadata', async () => {
		const result = await autoCompactIfNeeded(
			makeMessages(),
			makeToolUseContext('claude-sonnet-4-6'),
			'chat',
			{
				compacted: true,
				turnCounter: 7,
				turnId: 'turn-7',
			},
		)

		assert.equal(result.wasCompacted, true)
		assert.equal(result.consecutiveFailures, 0)
		assert.ok(result.compactionResult)
		assert.equal(mockState.compactConversationCalls, 1)

		const [messages, context, suppressQuestions, customInstructions, isAutoCompact, recompactionInfo] =
			mockState.compactConversationArgs[0]!

		assert.deepEqual(messages, makeMessages())
		assert.deepEqual(context, makeToolUseContext('claude-sonnet-4-6'))
		assert.equal(suppressQuestions, true)
		assert.equal(customInstructions, undefined)
		assert.equal(isAutoCompact, true)
		assert.deepEqual(recompactionInfo, {
			isRecompactionInChain: true,
			turnsSincePreviousCompact: 7,
			previousCompactTurnId: 'turn-7',
			autoCompactThreshold: 900 - 13_000,
			querySource: 'chat',
		})
	})

	test('increments consecutiveFailures and logs when compaction fails', async () => {
		mockState.compactConversationMode = 'throw'

		const result = await autoCompactIfNeeded(
			makeMessages(),
			makeToolUseContext(),
			undefined,
			{ compacted: false, turnCounter: 0, turnId: 'turn-0', consecutiveFailures: 2 },
		)

		assert.equal(result.wasCompacted, false)
		assert.equal(result.consecutiveFailures, 3)
		assert.equal(mockState.compactConversationCalls, 1)
	})

	test('stops retrying after the circuit breaker threshold', async () => {
		const result = await autoCompactIfNeeded(
			makeMessages(),
			makeToolUseContext(),
			undefined,
			{ compacted: false, turnCounter: 0, turnId: 'turn-0', consecutiveFailures: 3 },
		)

		assert.deepEqual(result, { wasCompacted: false })
		assert.equal(mockState.compactConversationCalls, 0)
	})
})

function makeMessages() {
	return [
		{
			type: 'user',
			uuid: 'msg-1',
			message: {
				role: 'user',
				content: 'hello',
			},
		},
	] as any
}

function makeToolUseContext(model = 'claude-sonnet-4-6') {
	return {
		options: {
			mainLoopModel: model,
		},
	} as any
}
