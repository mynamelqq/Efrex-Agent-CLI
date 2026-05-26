import assert from 'node:assert/strict'
import { describe, test } from 'bun:test'
import {
	getToolUseSummary,
	renderToolUseMessage,
} from '../UI.js'

describe('tools/WebSearchTool/UI', () => {
	test('renders the compact summary when not verbose', () => {
		const input = {
			query: 'how to inspect tool rendering in fullscreen mode',
		}

		assert.equal(
			renderToolUseMessage(input, { verbose: false }),
			getToolUseSummary(input),
		)
	})

	test('renders the full tool input when verbose', () => {
		const rendered = renderToolUseMessage(
			{
				query: 'web search behavior',
				category: 'news',
				limit: 5,
				tbs: 'qdr:w',
			},
			{ verbose: true },
		)

		assert.equal(
			rendered,
			'query: "web search behavior", category: "news", limit: 5, tbs: "qdr:w"',
		)
	})
})
