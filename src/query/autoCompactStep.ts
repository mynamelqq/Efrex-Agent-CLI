import type { ToolUseContext } from '../Tool.js'
import type { Message } from 'src/package/message.js'
import type {
	AutoCompactTrackingState,
} from '../services/compact/autoCompact.js'
import type {
	CompactionResult,
} from '../services/compact/compact.js'
import type { QuerySource } from '../services/compact/querySource.js'

type AutoCompactIfNeededFn = (
	messages: Message[],
	toolUseContext: ToolUseContext,
	querySource?: QuerySource,
	tracking?: AutoCompactTrackingState,
	snipTokensFreed?: number,
) => Promise<{
	wasCompacted: boolean
	compactionResult?: CompactionResult
	consecutiveFailures?: number
}>

type BuildPostCompactMessagesFn = (result: CompactionResult) => Message[]

export type AutoCompactStepDeps = {
	autoCompactIfNeeded: AutoCompactIfNeededFn
	buildPostCompactMessages: BuildPostCompactMessagesFn
	createTurnId: () => string
}

export type AutoCompactStepInput = {
	messagesForQuery: Message[]
	toolUseContext: ToolUseContext
	autoCompactTracking: AutoCompactTrackingState | undefined
	autoCompactQuerySource: QuerySource
}

export type AutoCompactStepResult = {
	messagesForQuery: Message[]
	toolUseContext: ToolUseContext
	autoCompactTracking: AutoCompactTrackingState | undefined
	compactionResult?: CompactionResult
	consecutiveFailures?: number
	postCompactMessages?: Message[]
}

export async function runAutoCompactStep(
	input: AutoCompactStepInput,
	deps: AutoCompactStepDeps,
): Promise<AutoCompactStepResult> {
	const result = await deps.autoCompactIfNeeded(
		input.messagesForQuery,
		input.toolUseContext,
		input.autoCompactQuerySource,
		input.autoCompactTracking,
	)

	if (result.compactionResult) {
		const postCompactMessages = deps.buildPostCompactMessages(
			result.compactionResult,
		)

		return {
			...input,
			messagesForQuery: postCompactMessages,
			autoCompactTracking: {
				compacted: true,
				turnId: deps.createTurnId(),
				turnCounter: 0,
				consecutiveFailures: 0,
			},
			compactionResult: result.compactionResult,
			consecutiveFailures: 0,
			postCompactMessages,
		}
	}

	if (result.consecutiveFailures !== undefined) {
		return {
			...input,
			autoCompactTracking: {
				...(input.autoCompactTracking ?? {
					compacted: false,
					turnId: '',
					turnCounter: 0,
				}),
				consecutiveFailures: result.consecutiveFailures,
			},
			consecutiveFailures: result.consecutiveFailures,
		}
	}

	return {
		...input,
	}
}
