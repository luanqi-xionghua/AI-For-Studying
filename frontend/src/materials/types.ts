/** 资料检索的前端契约：类型、常量、错误文案映射。纯类型和纯函数，不 import 任何东西。 */

export type SourceKey = 'openise' | 'sysu' | 'arxiv' | 'arxiv-pkg'
export type IntentKey = 'exam' | 'answer' | 'notes' | 'slides' | 'report'
export type SyncPhase = 'start' | 'fetch' | 'store' | 'index' | 'done'

export type MaterialSourceStatus = {
  key: SourceKey; label: string; count: number; syncedAt: number; error: string; warning: string
}
export type MaterialStatus = {
  state: 'empty' | 'ready'; total: number; raw: number; syncedAt: number; attemptedAt: number
  stale: boolean; syncing: boolean; recovered: boolean; sources: MaterialSourceStatus[]
}
export type MaterialProgress = {
  type: 'progress'; phase: SyncPhase; source?: SourceKey
  done: number; total: number; message: string
}
export type MaterialSyncSource = {
  key: SourceKey; label: string; ok: boolean; count: number
  notModified: boolean; error: string; warning: string
}
export type MaterialSyncResult = {
  ok: true; partial: boolean; total: number; raw: number
  syncedAt: number; tookMs: number; sources: MaterialSyncSource[]
}
export type MaterialLink = {
  id: string; source: SourceKey; label: string; host: 'github.com' | 'arxiv.jaison.ink'
}
export type MaterialHit = {
  id: string; title: string; course: string; courseKey: string; category: string
  ext: string; format: string; size: number; count: number; year: number | null
  source: SourceKey; url: string; links: MaterialLink[]
  owned: { docId: string; name: string; match: 'name' | 'size' } | null
  score: number; coverage: number; intents: IntentKey[]
}
export type LibraryHit = {
  docId: string; name: string; kind: 'pdf' | 'markdown' | 'word'
  score: number; sourceMissing: boolean
}
export type MaterialSearchResult = {
  query: string; normalized: string; found: boolean
  reason: '' | 'no-match' | 'low-coverage' | 'empty-index'
  courses: { text: string; key: string }[]; intents: IntentKey[]; content: string[]
  library: LibraryHit[]; results: MaterialHit[]; total: number
  tookMs: number; indexSyncedAt: number
  hints: ('intent-only' | 'stale' | 'partial')[]
}

export const MATERIALS_STORAGE_KEY = 'kaizhi.materials.v1'

export const MATERIALS_LIMITS = Object.freeze({
  query: 100,
  recent: 8,
  results: 30,
  rerankCandidates: 12,
  rerankTimeoutMs: 15_000,
  rerankOutputChars: 2000,
  reasonChars: 40,
  rerankCache: 20,
  rewriteChars: 60,
  rewriteTimeoutMs: 8000,
})

export const INTENT_LABELS: Record<IntentKey, string> = {
  exam: '考试真题', answer: '答案解析', notes: '笔记总结', slides: '课件讲义', report: '实验与作业',
}

export const SOURCE_LABELS: Record<SourceKey, string> = {
  openise: 'OpenISE', sysu: 'SYSU-Exam', arxiv: '破壁计划', 'arxiv-pkg': '破壁计划 · 课程包',
}

/** 本机 RPC 的接口形状；放在这里是为了让 state.ts 不必 import client.ts。 */
export type MaterialsClient = {
  status(): Promise<MaterialStatus>
  sync(onProgress: (event: MaterialProgress) => void): Promise<MaterialSyncResult>
  cancel(): Promise<{ cancelled: boolean; reason?: 'idle' | 'committing' }>
  search(query: string, limit?: number): Promise<MaterialSearchResult>
  open(id: string): Promise<{ opened: true; host: string }>
  clear(): Promise<{ cleared: true }>
}

const FRIENDLY: Record<string, string> = {
  MAT_BUSY: '正在同步，请等这一次完成。',
  MAT_TOO_SOON: '刚刚更新过，请 1 分钟后再试。',
  MAT_CANCELLED: '已取消同步，继续使用原来的索引。',
  MAT_NETWORK: '连不上资料来源，请检查网络后重试。已有的索引仍可继续搜索。',
  MAT_TIMEOUT: '资料来源响应太慢，已停止。请稍后重试。',
  MAT_UPSTREAM: '资料来源返回的数据和预期不符，可能接口有变化。已保留原来的索引。',
  MAT_TOO_LARGE: '资料来源返回的数据过大，已停止读取。',
  MAT_QUERY: '请输入要找的课程或关键词。',
  MAT_NOT_FOUND: '这条资料已不在索引里，请重新搜索。',
  MAT_LINK: '这个链接不在允许打开的网站范围内。',
  MAT_OPEN: '无法调用系统浏览器打开链接。可以点「复制链接」后自己粘贴到浏览器。',
  MAT_DB: '本机资料索引读写失败，可在右上角「⋯」里清空本地索引后重新同步。',
}

/** 从 "MAT_xxx：中文说明" 里取出错误码；取不到返回 ''。 */
export function materialErrorCode(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error ?? '')
  const match = /^(MAT_[A-Z_]+)：(.*)$/s.exec(text.trim())
  return match ? match[1] : ''
}

export function friendlyMaterialError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error ?? '')
  const match = /^(MAT_[A-Z_]+)：(.*)$/s.exec(text.trim())
  if (!match) return '本机连接出错，请重新打开资料检索页。'
  const [, code, detail] = match
  if (code === 'MAT_RATE_LIMIT') {
    const extra = (detail ?? '').replace(/^GitHub 暂时限制了访问次数[：:]?/, '').trim()
    return extra
      ? `GitHub 暂时限制了访问次数，${extra}。破壁计划的资料不受影响。`
      : 'GitHub 暂时限制了访问次数。破壁计划的资料不受影响。'
  }
  return FRIENDLY[code] || '本机连接出错，请重新打开资料检索页。'
}
