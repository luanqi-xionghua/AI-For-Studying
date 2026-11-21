/**
 * 引用：[sourceId] ↔ 〔《书名》第 N 页 / 第 N 行〕。
 * 纯函数；证据表只在内存里，落库的只有 id、文档下标与页码/行号。
 */
import { CHAT_ATTACH_LIMITS, type ChatCitation, type ChatCitationDoc, type ChatCitationSnippet, type ChatMessageRefs } from './types.ts'

/** 模型输出里的 sourceId：`S` + uuid 前 6 位 + `-` + 序号。 */
export const CITATION_PATTERN = /\[(S[0-9a-f]{6}-\d+)\]/g

export type EvidenceEntry = { d: number; p?: number; l?: number; text?: string }
export type EvidenceIndex = Map<string, EvidenceEntry>

/** 文档会话的回调：`{ sourceId, page, line, text }`，按附件下标记下来。 */
export type EvidenceItem = { sourceId: string; page?: number; pageLabel?: string | null; line?: number; text?: string }

export function createEvidenceIndex(): EvidenceIndex {
  return new Map()
}

export function addEvidence(index: EvidenceIndex, d: number, items: readonly EvidenceItem[] | null | undefined): void {
  for (const item of items || []) {
    if (!item || typeof item.sourceId !== 'string' || !item.sourceId) continue
    const entry: EvidenceEntry = { d }
    if (typeof item.page === 'number' && item.page > 0) entry.p = Math.round(item.page)
    if (typeof item.line === 'number' && item.line > 0) entry.l = Math.round(item.line)
    if (typeof item.text === 'string' && item.text) entry.text = item.text.slice(0, CHAT_ATTACH_LIMITS.evidenceChars)
    index.set(item.sourceId, entry)
  }
}

/** 只留正文里真正引用过的 sourceId（最多 40 条），认不出的丢弃。 */
export function collectCitations(
  content: string,
  index: EvidenceIndex,
  limit: number = CHAT_ATTACH_LIMITS.citesPerMessage,
): ChatCitation[] {
  const cites: ChatCitation[] = []
  const seen = new Set<string>()
  for (const match of (content || '').matchAll(CITATION_PATTERN)) {
    const id = match[1]
    if (seen.has(id)) continue
    const entry = index.get(id)
    if (!entry) continue
    seen.add(id)
    cites.push({
      id,
      d: entry.d,
      ...(entry.p ? { p: entry.p } : {}),
      ...(entry.l ? { l: entry.l } : {}),
    })
    if (cites.length >= limit) break
  }
  return cites
}

/** 「参考原文」的片段；只在本次运行内有原文。 */
export function collectSnippets(
  cites: readonly ChatCitation[],
  index: EvidenceIndex,
  limit: number = CHAT_ATTACH_LIMITS.citesPerMessage,
): ChatCitationSnippet[] {
  const snippets: ChatCitationSnippet[] = []
  for (const cite of cites.slice(0, limit)) {
    const text = index.get(cite.id)?.text
    if (!text) continue
    snippets.push({ ...cite, text })
  }
  return snippets
}

function label(cite: ChatCitation, doc: ChatCitationDoc | undefined): string {
  const title = doc?.title || '文档'
  if (cite.l) return `〔《${title}》第 ${cite.l} 行〕`
  if (cite.p) return `〔《${title}》第 ${cite.p} 页〕`
  return `〔《${title}》〕`
}

/** 把正文里的 [sourceId] 换成书名 + 页码/行号；认不出的 id 原样保留。 */
export function renderCitations(content: string, refs: ChatMessageRefs | undefined): string {
  if (!content || !refs?.cites?.length) return content || ''
  const byId = new Map(refs.cites.map(cite => [cite.id, cite]))
  return content.replace(CITATION_PATTERN, (whole, id: string) => {
    const cite = byId.get(id)
    if (!cite) return whole
    const doc = refs.docs[cite.d]
    if (!doc) return whole
    return label(cite, doc)
  })
}

/** 历史里再发给模型时用同一套纯文本引用，避免模型复用已失效的旧 sourceId。 */
export const plainCitations = renderCitations

/** 「参考原文」按文档分组：每组带书名与条目（有原文就带原文）。 */
export type CitationGroup = { doc: ChatCitationDoc; items: { cite: ChatCitation; text?: string; label: string }[] }

export function citationGroups(refs: ChatMessageRefs | undefined): CitationGroup[] {
  if (!refs?.docs?.length || !refs.cites?.length) return []
  const snippets = new Map((refs.snippets || []).map(item => [item.id, item.text]))
  const groups: CitationGroup[] = []
  for (const cite of refs.cites) {
    const doc = refs.docs[cite.d]
    if (!doc) continue
    let group = groups.find(item => item.doc === doc)
    if (!group) { group = { doc, items: [] }; groups.push(group) }
    group.items.push({ cite, text: snippets.get(cite.id), label: label(cite, doc) })
  }
  return groups
}

/** 引用总数，用于「参考原文 · N 段」。 */
export function citationCount(refs: ChatMessageRefs | undefined): number {
  return refs?.cites?.length || 0
}
