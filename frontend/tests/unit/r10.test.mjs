import { test } from 'node:test'
import assert from 'node:assert/strict'
import MarkdownIt from 'markdown-it'
import { installCjkEmphasis, fixCjkEmphasis } from '../../src/components/markdown/markdown-cjk.ts'
import { protocolOf, PROVIDERS } from '../../src/ai/providers.mjs'

test('bold next to Chinese punctuation renders', () => {
  const markdown = new MarkdownIt(); installCjkEmphasis(markdown)
  const html = markdown.render('这里有个关键前提：**插入新牌之前，手里的牌已经排好了。**下文明确说。\n\n然后**“不用再整理”指不用重排。**如果原来乱')
  assert.equal((html.match(/<strong>/g) || []).length, 2, html)
  assert.doesNotMatch(html, /\*\*/)
  assert.equal(fixCjkEmphasis('`a**。**b`'), '`a**。**b`', 'inline code is untouched')
  assert.equal(fixCjkEmphasis('plain **bold** text'), 'plain **bold** text')
})

test('providers: Claude, Kimi, GLM, Qwen and a custom endpoint with its own protocol', () => {
  for (const id of ['anthropic', 'kimi', 'glm', 'qwen', 'custom']) assert.ok(PROVIDERS.some(item => item.id === id), id)
  assert.equal(protocolOf('anthropic'), 'anthropic')
  assert.equal(protocolOf('kimi'), 'chat')
  assert.equal(protocolOf('custom', 'responses'), 'responses')
  assert.equal(protocolOf('custom', 'bogus'), 'chat')
  assert.ok(!PROVIDERS.some(p=>p.id==='codex'))
})

test('bookmark navigation finds the nearest mark before or after the current spot', async () => {
  const { neighbour } = await import('../../src/library/bookmark-nav.ts')
  const list = [{ id: 'a', ratio: .1 }, { id: 'c', ratio: .7 }, { id: 'b', ratio: .4 }]
  assert.equal(neighbour(list, .4, 1).id, 'c')
  assert.equal(neighbour(list, .4, -1).id, 'a')
  assert.equal(neighbour(list, .05, -1), undefined)
  assert.equal(neighbour(list, .9, 1), undefined)
})
