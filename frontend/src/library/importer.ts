/**
 * 加入文档的队列：一份一份地交给后端（Word 转换本来就只能排队做），一份失败不影响其余的，
 * 每份的状态、Word 转换走到哪一步、失败原因都记在这里，「加入文档」窗口关了再开也还在。
 * 真正的导入函数由调用方传进来，这个模块不碰桌面接口，单元测试可以直接用。
 */
import { reactive } from 'vue'
import { DOCUMENT_PATTERN, WORD_PATTERN } from './kinds.ts'
import type { Doc } from '../sdk/types.ts'

/** Word 转换走到哪一步：先用 Word / WPS，不行再用 LibreOffice，最后写进文档库。 */
export type ImportStage = 'office' | 'libreoffice' | 'adding'
export type ImportStatus = 'waiting' | 'working' | 'done' | 'error'
export type ImportItem = {
  id: string; path: string; name: string; word: boolean; status: ImportStatus
  stage?: ImportStage; error?: string; docs?: Doc[]
  /** 开始处理、进入当前步骤、结束的时间（毫秒）。 */
  startedAt?: number; stageAt?: number; finishedAt?: number
  /** 进入当前步骤时进度条已经走到的位置：换步骤时进度条只往前走。 */
  base?: number
}
export type ImportOne = (path: string, onStage?: (stage: ImportStage) => void) => Promise<Doc[]>

export const UNSUPPORTED = '不支持这种文件：只能加入 PDF、Markdown 或 Word 文档。'
export const importer = reactive({ items: [] as ImportItem[], running: false })

export function fileName(path: string) { return path.split(/[\\/]/).pop() || path }

/** 排进队列，返回这次新排进去的条目。不支持的文件直接记成失败并写明原因；正在排队的同一个文件不重复排。 */
export function enqueue(paths: string[]): ImportItem[] {
  const added: ImportItem[] = []
  for (const path of new Set(paths.filter(Boolean))) {
    if (importer.items.some(item => item.path === path && (item.status === 'waiting' || item.status === 'working'))) continue
    const supported = DOCUMENT_PATTERN.test(path)
    importer.items.push({ id: crypto.randomUUID(), path, name: fileName(path), word: WORD_PATTERN.test(path), status: supported ? 'waiting' : 'error', ...(supported ? {} : { error: UNSUPPORTED }) })
    added.push(importer.items.at(-1)!)
  }
  return added
}

/** 依次处理还在等的文件，直到队列空了。每加入成功一份就调用 onImported。 */
export async function runQueue(importOne: ImportOne, onImported: (docs: Doc[], item: ImportItem) => void): Promise<void> {
  if (importer.running) return
  importer.running = true
  try {
    for (let item = next(); item; item = next()) {
      const current = item
      current.status = 'working'
      current.startedAt = current.stageAt = Date.now()
      current.base = 0.04
      try {
        const docs = await importOne(current.path, current.word ? stage => enterStage(current, stage) : undefined)
        current.docs = docs
        current.status = 'done'
        onImported(docs, current)
      } catch (error: any) {
        current.status = 'error'
        current.error = error?.message || String(error)
      } finally { current.finishedAt = Date.now() }
    }
  } finally { importer.running = false }
}
function next() { return importer.items.find(item => item.status === 'waiting') }
function enterStage(item: ImportItem, stage: ImportStage) {
  if (item.stage === stage) return
  const now = Date.now()
  item.base = wordProgress(item, now)
  item.stage = stage
  item.stageAt = now
}

/** 窗口关上时清掉已经结束的条目；还在转换的留着。 */
export function clearFinished() {
  const keep = importer.items.filter(item => item.status === 'waiting' || item.status === 'working')
  importer.items.splice(0, importer.items.length, ...keep)
}

/**
 * Word 的进度条（0–1）。Word / WPS / LibreOffice 都不报告百分比：每一步里按已用时间估一个慢慢逼近上限的值，
 * 换到下一步时从当前位置接着走，真正转换完、写进文档库后才到 100%。
 */
export function wordProgress(item: ImportItem, now = Date.now()): number {
  if (item.status === 'done') return 1
  if (item.status !== 'working') return 0
  const base = item.base ?? 0.04
  const [cap, pace] = item.stage === 'adding' ? [0.98, 0.6] : item.stage === 'libreoffice' ? [0.92, 10] : [0.92, 12]
  const seconds = Math.max(0, now - (item.stageAt ?? now)) / 1000
  return Math.max(base, base + (cap - base) * (1 - Math.exp(-seconds / pace)))
}

/** 进度条下面的那行字。 */
export function stageText(item: ImportItem): string {
  if (item.stage === 'adding') return '已转换为 PDF，正在加入文档库…'
  if (item.stage === 'libreoffice') return 'Word / WPS 没能完成，正在改用 LibreOffice 转换为 PDF…'
  return '正在用 Word / WPS 转换为 PDF…'
}

/** 失败后给的建议：Word 转换失败建议先手动另存为 PDF。 */
export function failureAdvice(item: ImportItem): string {
  if (item.error === UNSUPPORTED || item.error?.includes('找不到这个文件')) return ''
  if (item.word) return '建议先在 Word 或 WPS 里打开这份文档，用「另存为 → PDF」手动转换，再把 PDF 加入文档库。'
  return ''
}
