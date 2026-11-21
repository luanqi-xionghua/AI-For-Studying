/**
 * 会话附属栏的纯逻辑：搜索过滤、行列表、收起偏好的读写。
 * 没有运行时依赖（只有类型），Node 单测直接导入。
 */
import type { MemoryScope } from '../memory/types.ts'
import type { ChatModeIndexEntry } from './types.ts'

export const CHAT_RAIL_KEY = 'kaizhi.chatmode.rail.v1'

export type ChatRailPreference = { version: 1; collapsed: boolean }

/** 附属栏里的一行：索引条目 + 「还没开始的新对话」标记。 */
export type ChatRailRow = ChatModeIndexEntry & { draft?: true }

/** 当前会话的轻量快照；没有消息时以「新对话 · 未开始」置顶。 */
export type RailLive = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  scope: MemoryScope
  messageCount: number
}

const emptyPreference = (): ChatRailPreference => ({ version: 1, collapsed: false })

export function normalizeRailPreference(raw: unknown): ChatRailPreference {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyPreference()
  return { version: 1, collapsed: (raw as Record<string, unknown>).collapsed === true }
}

export function loadRailPreference(
  storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage,
): ChatRailPreference {
  try {
    const raw = storage?.getItem(CHAT_RAIL_KEY)
    return raw ? normalizeRailPreference(JSON.parse(raw)) : emptyPreference()
  } catch {
    return emptyPreference()
  }
}

export function saveRailPreference(
  preference: ChatRailPreference,
  storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage,
): void {
  try {
    storage?.setItem(CHAT_RAIL_KEY, JSON.stringify({ version: 1, collapsed: preference.collapsed === true }))
  } catch { /* 存不下就只在这次有效 */ }
}

/** 搜索用的归一化：不区分大小写，全角/半角空白一律去掉（「线性 代数」也能搜到「线性代数」）。 */
export function normalizeSearchText(text: string): string {
  return text.toLowerCase().replace(/[\s\u3000]+/g, '')
}

/** 只按标题搜索；空查询返回全部（保持原顺序）。 */
export function filterConversations<T extends ChatModeIndexEntry>(list: T[], query: string): T[] {
  const needle = normalizeSearchText(query)
  if (!needle) return [...list]
  return list.filter(entry => normalizeSearchText(entry.title || '').includes(needle))
}

/**
 * 行列表：按更新时间倒序；当前会话不在清单里（刚新建 / 还没落库）时补一行置顶，
 * 没有消息的那一行标成 draft，显示「新对话 · 未开始」。
 */
export function railRows(list: ChatModeIndexEntry[], activeId: string, live: RailLive | null): ChatRailRow[] {
  const rows: ChatRailRow[] = list
    .filter(entry => entry.count > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(entry => ({ ...entry }))
  if (live && live.id === activeId && !rows.some(entry => entry.id === live.id)) {
    const row: ChatRailRow = {
      id: live.id,
      title: live.title,
      createdAt: live.createdAt,
      updatedAt: live.updatedAt,
      scope: live.scope,
      count: live.messageCount,
      ...(live.messageCount === 0 ? { draft: true as const } : {}),
    }
    rows.unshift(row)
  }
  return rows
}
