import test from 'node:test'
import assert from 'node:assert/strict'

test('PDF.js collection methods are polyfilled before loading on older WebEngines', async () => {
  const methods = [
    [Map.prototype, 'getOrInsertComputed'],
    [Map.prototype, 'getOrInsert'],
    [WeakMap.prototype, 'getOrInsertComputed'],
    [WeakMap.prototype, 'getOrInsert'],
  ]
  const originals = methods.map(([prototype, name]) => prototype[name])

  try {
    for (const [prototype, name] of methods) prototype[name] = undefined
    await import('../../src/document/map-compat.mjs?compat-test')

    let calls = 0
    const map = new Map()
    assert.equal(map.getOrInsertComputed('key', key => { calls++; return `${key}-value` }), 'key-value')
    assert.equal(map.getOrInsertComputed('key', () => { calls++; return 'wrong' }), 'key-value')
    assert.equal(map.getOrInsert('other', 42), 42)
    assert.equal(calls, 1)

    const weakMap = new WeakMap()
    const key = {}
    assert.equal(weakMap.getOrInsertComputed(key, value => ({ value } )).value, key)
    assert.equal(weakMap.getOrInsert(key, 'unused').value, key)
    assert.throws(() => weakMap.getOrInsertComputed(1, () => 'invalid'), TypeError)
  } finally {
    methods.forEach(([prototype, name], index) => {
      if (typeof originals[index] === 'function') prototype[name] = originals[index]
      else delete prototype[name]
    })
  }
})
