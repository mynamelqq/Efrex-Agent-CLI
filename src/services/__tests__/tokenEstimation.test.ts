import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { Message } from 'src/package/message.js'
import {
	roughTokenCountEstimation,
	roughTokenCountEstimationForMessages,
} from '../tokenEstimation.js'

describe('services/tokenEstimation', () => {
	test('counts OpenAI-style content arrays, tool calls, and image parts', () => {
		const toolCalls = [
			{
				id: 'call_1',
				type: 'function' as const,
				function: {
					name: 'search',
					arguments: '{"query":"hello"}',
				},
			},
		]

		const messages: Pick<Message, 'type' | 'message' | 'attachment'>[] = [
			{
				type: 'assistant',
				message: {
					role: 'assistant',
					content: [
						{ type: 'text', text: 'hello' },
						{
							type: 'image_url',
							image_url: { url: 'data:image/png;base64,AAAA' },
						},
					],
					tool_calls: toolCalls,
					refusal: 'no',
					reasoning_content: 'think',
				},
			},
		]

		const expected =
			roughTokenCountEstimation('hello') +
			2000 +
			roughTokenCountEstimation(JSON.stringify(toolCalls)) +
			roughTokenCountEstimation('no') +
			roughTokenCountEstimation('think')

		assert.equal(roughTokenCountEstimationForMessages(messages), expected)
	})

	test('counts attachment content directly', () => {
		const messages: Pick<Message, 'type' | 'message' | 'attachment'>[] = [
			{
				type: 'attachment',
				attachment: {
					type: 'edited_text_file',
					filename: 'example.ts',
					snippet: 'const answer = 42',
				},
			},
		]

		assert.equal(
			roughTokenCountEstimationForMessages(messages),
			roughTokenCountEstimation('const answer = 42'),
		)
	})
})
