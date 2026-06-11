import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { has1mContext, strip1mContextSuffix } from '../modelName.js';

describe('modelName', () => {
	test('detects a trailing [1m] suffix case-insensitively', () => {
		assert.equal(has1mContext('gpt-4.1[1m]'), true);
		assert.equal(has1mContext('gpt-4.1[1M]'), true);
		assert.equal(has1mContext('gpt-4.1'), false);
	});

	test('strips only the trailing [1m] suffix', () => {
		assert.equal(strip1mContextSuffix('gpt-4.1[1m]'), 'gpt-4.1');
		assert.equal(strip1mContextSuffix('gpt-4.1[1M]'), 'gpt-4.1');
		assert.equal(strip1mContextSuffix('gpt-4.1'), 'gpt-4.1');
	});
});
