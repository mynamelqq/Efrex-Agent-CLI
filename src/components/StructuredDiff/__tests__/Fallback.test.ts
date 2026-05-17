import { describe, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

// Mock ink dependencies so we can import the pure functions without pulling
// in the full terminal rendering stack and its transitive dependencies.
mock.module('@anthropic/ink', () => ({
  Box: () => null,
  Text: () => null,
  NoSelect: () => null,
  useTheme: () => ['dark'],
  stringWidth: (s: string) => s.length,
  wrapText: (s: string) => s,
}))

const {
  transformLinesToObjects,
  processAdjacentLines,
  numberDiffLines,
  calculateWordDiffs,
} = await import('../Fallback.js')

describe('StructuredDiffFallback', () => {
  describe('transformLinesToObjects', () => {
    test('identifies added, removed, and unchanged lines', () => {
      const lines = [
        ' context line',
        '-removed line',
        '+added line',
        ' another context',
      ]
      const result = transformLinesToObjects(lines)

      assert.equal(result.length, 4)
      assert.deepEqual(result[0], {
        code: 'context line',
        i: 0,
        type: 'nochange',
        originalCode: 'context line',
      })
      assert.deepEqual(result[1], {
        code: 'removed line',
        i: 0,
        type: 'remove',
        originalCode: 'removed line',
      })
      assert.deepEqual(result[2], {
        code: 'added line',
        i: 0,
        type: 'add',
        originalCode: 'added line',
      })
      assert.deepEqual(result[3], {
        code: 'another context',
        i: 0,
        type: 'nochange',
        originalCode: 'another context',
      })
    })
  })

  describe('processAdjacentLines', () => {
    test('pairs adjacent remove/add lines for word-level diff', () => {
      const lines = [
        { code: 'context', i: 0, type: 'nochange' as const, originalCode: 'context' },
        { code: 'old name', i: 0, type: 'remove' as const, originalCode: 'old name' },
        { code: 'new name', i: 0, type: 'add' as const, originalCode: 'new name' },
        { code: 'trailing', i: 0, type: 'nochange' as const, originalCode: 'trailing' },
      ]
      const result = processAdjacentLines(lines)

      assert.equal(result.length, 4)
      assert.equal(result[0]!.type, 'nochange')

      const removeLine = result[1]!
      const addLine = result[2]!
      assert.equal(removeLine.type, 'remove')
      assert.equal(addLine.type, 'add')
      assert.equal(removeLine.wordDiff, true)
      assert.equal(addLine.wordDiff, true)
      assert.strictEqual(removeLine.matchedLine, addLine)
      assert.strictEqual(addLine.matchedLine, removeLine)

      assert.equal(result[3]!.type, 'nochange')
    })

    test('handles multiple consecutive remove/add pairs', () => {
      const lines = [
        { code: 'old1', i: 0, type: 'remove' as const, originalCode: 'old1' },
        { code: 'old2', i: 0, type: 'remove' as const, originalCode: 'old2' },
        { code: 'new1', i: 0, type: 'add' as const, originalCode: 'new1' },
        { code: 'new2', i: 0, type: 'add' as const, originalCode: 'new2' },
      ]
      const result = processAdjacentLines(lines)

      assert.equal(result.length, 4)
      assert.equal(result[0]!.wordDiff, true)
      assert.equal(result[1]!.wordDiff, true)
      assert.equal(result[2]!.wordDiff, true)
      assert.equal(result[3]!.wordDiff, true)
    })

    test('passes through unpaired remove lines', () => {
      const lines = [
        { code: 'removed only', i: 0, type: 'remove' as const, originalCode: 'removed only' },
        { code: 'context', i: 0, type: 'nochange' as const, originalCode: 'context' },
      ]
      const result = processAdjacentLines(lines)

      assert.equal(result.length, 2)
      assert.equal(result[0]!.type, 'remove')
      assert.equal(result[0]!.wordDiff, undefined)
    })
  })

  describe('numberDiffLines', () => {
    test('numbers lines with old file line numbers', () => {
      const lines = [
        { code: 'ctx1', i: 0, type: 'nochange' as const, originalCode: 'ctx1' },
        { code: 'old', i: 0, type: 'remove' as const, originalCode: 'old' },
        { code: 'new', i: 0, type: 'add' as const, originalCode: 'new' },
        { code: 'ctx2', i: 0, type: 'nochange' as const, originalCode: 'ctx2' },
      ]
      const result = numberDiffLines(lines, 1)

      assert.equal(result[0]!.i, 1) // nochange
      assert.equal(result[1]!.i, 2) // remove (old line number)
      assert.equal(result[2]!.i, 2) // add (reuses old line number)
      assert.equal(result[3]!.i, 3) // nochange
    })

    test('numbers multi-line removes correctly', () => {
      const lines = [
        { code: 'old1', i: 0, type: 'remove' as const, originalCode: 'old1' },
        { code: 'old2', i: 0, type: 'remove' as const, originalCode: 'old2' },
        { code: 'new', i: 0, type: 'add' as const, originalCode: 'new' },
      ]
      const result = numberDiffLines(lines, 5)

      assert.equal(result[0]!.i, 5)
      assert.equal(result[1]!.i, 6)
      assert.equal(result[2]!.i, 5) // add gets the first removed line number
    })
  })

  describe('calculateWordDiffs', () => {
    test('detects word-level changes between two strings', () => {
      const result = calculateWordDiffs('function oldName()', 'function newName()')

      const removed = result.find(r => r.removed)
      const added = result.find(r => r.added)

      assert.ok(removed, 'should have a removed part')
      assert.ok(added, 'should have an added part')
      assert.equal(removed!.value, 'oldName')
      assert.equal(added!.value, 'newName')
    })

    test('preserves common parts', () => {
      const result = calculateWordDiffs('const x = 1', 'const x = 2')

      const common = result.filter(r => !r.added && !r.removed)
      assert.ok(common.length > 0, 'should have common parts')
    })
  })
})
