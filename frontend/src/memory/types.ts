/** 记忆核心类型与常量。纯类型模块：没有运行时依赖，Node 单测可以直接导入。 */

export const MEMORY_VERSION = 1 as const

/** 存储键。docId 是后端生成的 uuid4（36 个字符），清洗后最长取 64 个字符，整键不超过 78 个字符。 */
export const MEMORY_KEYS = {
  index: 'memory.v1.index',
  global: 'memory.v1.global',
  settings: 'memory.v1.settings',
  docPrefix: 'memory.v1.doc.',
} as const
export const docMemoryKey = (docId: string) =>
  MEMORY_KEYS.docPrefix + docId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64)

/** 全部上限。字数按 JS 字符串长度（UTF-16 码元）算，字节上限按 UTF-8 算。 */
export const LIMITS = {
  title: 200,
  indexTitle: 60,
  summary: 1200,
  globalSummary: 1500,
  level: 60,
  item: 40,
  goals: 6, interests: 8, strengths: 8, weaknesses: 8, misconceptions: 6, preferences: 6,
  questions: 10,
  questionItem: 40,
  themes: 12, themeItem: 30,
  note: 200,
  goal: 100,
  preference: 200,
  evidence: 30, evidenceText: 160, evidenceRef: 60,
  pending: 24, pendingQuestion: 500, pendingAnswer: 300,
  suppressed: 60,
  sources: 60, sourceNote: 80,
  removed: 20,
  indexDocs: 2000,
  docBytes: 256 * 1024,
  globalBytes: 256 * 1024,
  indexBytes: 900 * 1024,
  settingBytes: 900 * 1024,
} as const

/** 四档自评：1 最低，4 最高。两道题共用同一组数值，显示文字各自一套（见 5.2）。 */
export type SelfLevel = 1 | 2 | 3 | 4

/** 导入自评（或在记忆页手动补建时填写的同一组回答）。 */
export type OnboardingAnswers = {
  /** 对这份文档内容的了解程度。 */
  docLevel: SelfLevel
  /** 对文档相关专业 / 行业的了解程度。 */
  fieldLevel: SelfLevel
  /** 学习目标（必填），≤ LIMITS.goal 字；1.1.0 及更早的数据可能为空串。 */
  goal: string
  /** 学习偏好说明（选填），≤ LIMITS.preference 字。 */
  preference: string
  /** 可选的一句话补充，≤ LIMITS.note 字；没填是空串。 */
  note: string
  answeredAt: number
  /** import：导入弹窗里填的；manual：记忆管理页手动补建。 */
  source: 'import' | 'manual'
}

export type ProfileListField = 'goals' | 'interests' | 'strengths' | 'weaknesses' | 'misconceptions' | 'preferences'
export const PROFILE_LIST_FIELDS: readonly ProfileListField[] =
  ['goals', 'interests', 'strengths', 'weaknesses', 'misconceptions', 'preferences']

/** 用户画像。数组每项 ≤ LIMITS.item 字，条数上限见 LIMITS 同名字段。 */
export type MemoryProfile = {
  goals: string[]
  level: string
  interests: string[]
  strengths: string[]
  weaknesses: string[]
  misconceptions: string[]
  preferences: string[]
}

/** 证据：记忆页里可追溯的一条来源。 */
export type MemoryEvidence = {
  id: string
  kind: 'onboarding' | 'assistant' | 'chat' | 'reading' | 'manual'
  at: number
  text: string
  ref?: string
}

/** 待总结的一轮问答。只有问答进这个队列；自评、阅读行为是规则直接写入的。 */
export type MemoryEvent = {
  id: string
  kind: 'assistant-turn' | 'chat-turn'
  at: number
  question: string
  answer: string
  conversationId?: string
  /** 对话模式的幂等键：同一个 turnId 再次到达（重新回答）时替换原待总结项，不再追加。 */
  turnId?: string
}

/** 阅读行为快照：全部是数字，由规则维护，不经过模型。 */
export type ReadingSnapshot = {
  page: number
  pageCount: number
  progress: number
  maxProgress: number
  sessions: number
  firstOpenedAt: number
  lastOpenedAt: number
  activeDays: number
  lastDay: string
  questions: number
}

/** 手动编辑留下的约束，自动 / 手动总结都必须遵守。 */
export type MemoryManual = {
  /** 被锁定的文本字段 → 锁定时间。存在即锁定：总结不改写该字段。 */
  locked: { summary?: number; level?: number }
  /** 用户确认过的条目：总结后始终排在对应数组最前。键可以是 ProfileListField、'questions'、'themes'。 */
  pinned: Record<string, string[]>
  /** 用户删掉的条目（规范化后：去首尾空白、压缩空白、转小写），≤ LIMITS.suppressed 条。 */
  suppressed: string[]
}

/** 持久化的失败状态。「更新中」只存在于内存（engine 的响应式状态），不落库。 */
export type MemoryStatus = {
  state: 'idle' | 'failed'
  error: string
  failedAt: number
  failures: number
  nextRetryAt: number
}

/** 文档记忆：每本书一份，键 memory.v1.doc.<docId>。 */
export type DocumentMemory = {
  version: 1
  docId: string
  title: string
  createdAt: number
  updatedAt: number
  summarizedAt: number
  onboarding: OnboardingAnswers | null
  summary: string
  profile: MemoryProfile
  questions: string[]
  reading: ReadingSnapshot
  evidence: MemoryEvidence[]
  pending: MemoryEvent[]
  dirty: boolean
  dirtyAt: number
  manual: MemoryManual
  status: MemoryStatus
  revision: number
}

/** 全局记忆里的一条来源：最近一次全局总结纳入了哪些书。 */
export type GlobalSource = {
  docId: string
  title: string
  summarizedAt: number
  note: string
}

/** 全局记忆：只有一份，键 memory.v1.global。 */
export type GlobalMemory = {
  version: 1
  createdAt: number
  updatedAt: number
  summarizedAt: number
  summary: string
  profile: MemoryProfile
  themes: string[]
  sources: GlobalSource[]
  removed: string[]
  pending: MemoryEvent[]
  evidence: MemoryEvidence[]
  manual: MemoryManual
  status: MemoryStatus
  revision: number
}

export type MemoryIndexEntry = {
  docId: string
  title: string
  updatedAt: number
  summarizedAt: number
  pending: number
  dirty: boolean
  hasOnboarding: boolean
  failed: boolean
}

/** 记忆索引：只有一份，键 memory.v1.index。记忆页列表与对话模式选书只读它，不必逐本加载。 */
export type MemoryIndex = {
  version: 1
  updatedAt: number
  docs: MemoryIndexEntry[]
  /** 全局记忆是否过期：有文档记忆在全局总结之后更新，或有书被移除 / 清空。 */
  globalStale: boolean
  docUpdatesSinceGlobal: number
  /** 最近一次记忆请求，供设置区显示「上次更新」。 */
  lastRun: { at: number; kind: 'doc' | 'global'; docId: string; title: string; ok: boolean; error: string } | null
}

/** 记忆设置：只有一份，键 memory.v1.settings。预设与强度不在这里（在 AI 设置里）。 */
export type MemorySettings = {
  version: 1
  autoUpdate: boolean
  /** 第一次自动总结前弹过一次说明后置 true。 */
  noticeShown: boolean
  /** 每日自动请求计数。day 是本地日期 'YYYY-MM-DD'。 */
  budget: { day: string; runs: number }
  /** 连续失败触发的暂停截止时间；0 = 未暂停。 */
  pausedUntil: number
  consecutiveFailures: number
  updatedAt: number
}

/** 对话模式的记忆范围。 */
export type MemoryScope =
  | { kind: 'none' }
  | { kind: 'global' }
  | { kind: 'doc'; docId: string; title: string }

/**
 * 注入用途：记忆正文相同，只换最后一行「使用要求」。
 * chat 是对话模式；assistant 是阅读助手；translate / explain / predict 是旁路 AI 功能。
 */
export type MemoryPurpose = 'chat' | 'assistant' | 'translate' | 'explain' | 'predict' | 'exam'
