import React from 'react';
import { TOOL_SUMMARY_MAX_LENGTH } from '../../constants/toolLimits.js';
import { FallbackToolUseErrorMessage } from 'src/components/FallbackToolUseErrorMessage.js';
import { MessageResponse } from 'src/components/MessageResponse.js';
import { Box, Text } from 'src/ink.js';
import type { ToolResultBlockParam } from 'src/package/message.js';
import { truncate } from '../../utils/format.js';
import type { Input, Output } from './WebSearchTool.js';

export function getToolUseSummary(
	input: Partial<Input> | undefined,
): string | null {
	if (!input?.query) {
		return null;
	}
	return truncate(input.query, TOOL_SUMMARY_MAX_LENGTH);
}

export function renderToolUseMessage(
	{ query, category, limit, tbs }: Partial<Input>,
	{ verbose }: { verbose: boolean },
): React.ReactNode {
	if (!query) {
		return null;
	}

	if (!verbose) {
		return query;
	}

	const parts = [`query: "${query}"`];
	if (category) {
		parts.push(`category: "${category}"`);
	}
	if (limit) {
		parts.push(`limit: ${limit}`);
	}
	if (tbs) {
		parts.push(`tbs: "${tbs}"`);
	}
	return parts.join(', ');
}

export function renderToolResultMessage(
	{ results, durationSeconds }: Output,
	_progressMessagesForMessage: unknown[],
	{ verbose }: { verbose: boolean },
): React.ReactNode {
	const count = results.length;

	if (verbose) {
		return (
			<Box flexDirection="column">
				<MessageResponse height={1}>
					<Text>
						Found <Text bold>{count}</Text>{' '}
						{count === 1 ? 'result' : 'results'} in{' '}
						{durationSeconds.toFixed(2)}s
					</Text>
				</MessageResponse>
				<Box flexDirection="column">
					{results.map((result, index) => (
						<Text key={`${result.url}-${index}`}>
							{index + 1}. {result.title} - {result.url}
						</Text>
					))}
				</Box>
			</Box>
		);
	}

	return (
		<MessageResponse height={1}>
			<Text>
				Found <Text bold>{count}</Text> {count === 1 ? 'result' : 'results'}
			</Text>
		</MessageResponse>
	);
}

export function renderToolUseErrorMessage(
	result: ToolResultBlockParam['content'],
	{ verbose }: { verbose: boolean },
): React.ReactNode {
	if (!verbose) {
		return (
			<MessageResponse>
				<Text color="error">Error searching web</Text>
			</MessageResponse>
		);
	}
	return <FallbackToolUseErrorMessage result={result} verbose={verbose} />;
}
