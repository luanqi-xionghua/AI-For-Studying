import { test } from 'node:test'
import assert from 'node:assert/strict'
import { harnessRequest, READER_SYSTEM } from '../../src/ai/providers.mjs'

const base = { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', messages: [] }

test('system prefix: the default is the reader prefix, unchanged', () => {
  const request = harnessRequest({ ...base })
  assert.equal(request.system, READER_SYSTEM)
  assert.ok(request.system.startsWith('你是阅读助手。说人话'))
  assert.ok(!('tools' in request))
})

test('system prefix: extra instructions are appended to the reader prefix', () => {
  assert.equal(harnessRequest({ ...base, extraInstructions: 'X' }).system, READER_SYSTEM + 'X')
})

test('system prefix: a custom prefix replaces the reader prefix', () => {
  const request = harnessRequest({ ...base, systemPrefix: 'A\n', extraInstructions: 'B' })
  assert.equal(request.system, 'A\nB')
  assert.ok(!request.system.includes('阅读助手'))
})

test('system prefix: an empty string is still a custom prefix', () => {
  assert.equal(harnessRequest({ ...base, systemPrefix: '' }).system, '')
})

test('system prefix: non-strings are ignored', () => {
  assert.equal(harnessRequest({ ...base, systemPrefix: null }).system, READER_SYSTEM)
})
