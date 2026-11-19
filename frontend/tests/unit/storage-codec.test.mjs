import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_SETTING_CHUNK_BYTES, MAX_SETTING_CHUNKS, splitUtf8 } from '../../src/ai/storage-codec.mjs'

test('AI setting chunks stay below the SQLite setting limit without splitting Unicode', () => {
  const value = `${'文'.repeat(300000)}🙂${'abc'.repeat(100000)}`
  const chunks = splitUtf8(value)
  const encoder = new TextEncoder()
  assert.ok(chunks.length > 1)
  assert.ok(chunks.every(chunk => encoder.encode(chunk).length <= MAX_SETTING_CHUNK_BYTES))
  assert.equal(chunks.join(''), value)
})

test('AI history above the bounded chunk count is rejected before persistence', () => {
  assert.equal(MAX_SETTING_CHUNKS, 256)
  assert.throws(
    () => splitUtf8('abcdefghijklmn', 4, 3),
    /AI 对话历史超过本机保存上限/,
  )
  assert.equal(splitUtf8('abcdefghijkl', 4, 3).join(''), 'abcdefghijkl')
})
