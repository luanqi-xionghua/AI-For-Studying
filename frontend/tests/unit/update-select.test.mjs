import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isRepoPage, shouldOffer } from '../../src/ui/update-select.ts'

test('update notes only open pages within the repository', () => {
  const repo = 'https://github.com/luanqi-xionghua/AI-For-Studying'
  assert.ok(isRepoPage(`${repo}/releases/tag/v1.2.3`))
  for (const url of [`${repo}-evil/releases`, `${repo}/../other`, `${repo}?x=1`, 'javascript:alert(1)']) {
    assert.equal(isRepoPage(url), false, url)
  }
})

test('automatic checks respect a skipped version; manual checks offer it again', () => {
  const info = { version: '0.3.0' }
  assert.equal(shouldOffer(info, '0.3.0', false), false)
  assert.equal(shouldOffer(info, '0.3.0', true), true)
  assert.equal(shouldOffer(info, '0.2.9', false), true)
  assert.equal(shouldOffer(null, null, true), false)
})
