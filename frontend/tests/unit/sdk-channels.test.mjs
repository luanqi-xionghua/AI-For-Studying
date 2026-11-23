import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../../src/sdk/python.ts', import.meta.url), 'utf8')

test('只用于进度的通道（含临时文档转换）在请求结束后释放，事件通道断开时不会再收到 disconnect', () => {
  const list = /export const PROGRESS_ONLY = new Set\(\[([^\]]*)\]\)/.exec(source)
  assert.ok(list, 'PROGRESS_ONLY 存在')
  for (const cmd of ['update_download', 'import_documents', 'material_sync', 'temp_doc_prepare']) assert.ok(list[1].includes(`'${cmd}'`), cmd)
  assert.match(source, /finally\{[^\n]*if\(PROGRESS_ONLY\.has\(cmd\)\)forget\(ch\?\.id\)\}/)
  // ai_start 的通道仍由 end/error/ai_cancel 释放，不能在 finally 里提前丢掉。
  assert.ok(!list[1].includes('ai_start'))
})
