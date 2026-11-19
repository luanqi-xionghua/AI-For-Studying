import test from 'node:test'
import assert from 'node:assert/strict'
import { clearSaveFailure, reportSaveFailure, retrySave, saveFailures } from '../../src/ui/save-errors.ts'

test('failed saves stay visible and retry clears the failure only after success', async () => {
  const id = `test:${crypto.randomUUID()}`
  let attempts = 0
  reportSaveFailure(id, '测试书签', new Error('磁盘暂不可写'), async () => {
    attempts++
    if (attempts === 1) throw new Error('仍然无法写入')
  })

  await retrySave(id)
  assert.equal(saveFailures.get(id)?.error, '仍然无法写入')
  assert.equal(saveFailures.get(id)?.retrying, false)
  await retrySave(id)
  assert.equal(saveFailures.has(id), false)
  assert.equal(attempts, 2)
  clearSaveFailure(id)
})
