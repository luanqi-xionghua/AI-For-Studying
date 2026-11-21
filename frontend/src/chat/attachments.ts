/**
 * 附件的上限、按钮可用性与上下文估算。纯函数，Node 单测直接导入。
 * 文档（文档库 / 临时）相关的错误文案在 M4 / M5 补齐，这里先把画像与规则固定下来。
 */
import { normalizeDocumentLimits } from '../shared/document-limits.mjs'
import { CHAT_ATTACH_LIMITS } from './types.ts'

/** 一张图片大致折算的 token；与输入栏「用量」的上下文估算口径一致。 */
export const IMAGE_TOKENS = 1200
/** 多本文档时每本按 5400 字估算（见实施清单 §5.7）。 */
export const PER_DOC_CHARS = 5400

/** 文档库选择弹层里的可选项（App.vue 的 chatDocuments 计算属性给的形状）。 */
export type PickableDoc = {
  id: string
  title: string
  kind: 'pdf' | 'markdown' | 'word'
  size?: number
  pageCount?: number
  sourceMissing?: boolean
}

export type AttachButton = { disabled: boolean; tip: string }
export type AttachAvailability = { image: AttachButton; library: AttachButton; temp: AttachButton }

export type AttachAvailabilityInput = {
  /** 正在回答。 */
  busy: boolean
  /** 有可用的模型预设。 */
  hasPreset: boolean
  /** 当前模型是否识图（未知按识图处理）。 */
  vision: boolean
  modelName?: string
  images: number
  docs: number
  libraryEmpty: boolean
  /** 临时文档选择框正在打开。 */
  picking?: boolean
}

const TIPS = {
  image: '添加图片（也可以 Ctrl+V 粘贴）',
  library: '从文档库选择文档（本会话有效，最多 3 份）',
  temp: '上传电脑上的文档（临时，不进文档库）',
} as const

/** 三个附件按钮的可用性与原因；不可用时用 aria-disabled，提示文案换成原因。 */
export function attachAvailability(input: AttachAvailabilityInput): AttachAvailability {
  const base = (full: boolean, fullTip: string): string | undefined => {
    if (input.busy) return '正在回答，结束后再添加附件'
    if (!input.hasPreset) return '先在 设置 → AI 新建模型预设'
    if (full) return fullTip
    return undefined
  }
  const imageReason = base(input.images >= CHAT_ATTACH_LIMITS.images, `一次最多 ${CHAT_ATTACH_LIMITS.images} 张图片`)
    ?? (!input.vision ? `当前模型「${input.modelName || '这个模型'}」不支持图片，请在模型按钮里换识图模型` : undefined)
  const docReason = base(input.docs >= CHAT_ATTACH_LIMITS.docs, '每段对话最多附 3 份文档')
  return {
    image: { disabled: Boolean(imageReason), tip: imageReason || TIPS.image },
    library: {
      disabled: Boolean(docReason) || input.libraryEmpty,
      tip: docReason || (input.libraryEmpty ? '文档库还是空的，先加入文档' : TIPS.library),
    },
    temp: {
      disabled: Boolean(docReason) || Boolean(input.picking),
      tip: docReason || (input.picking ? '正在选择文件…' : TIPS.temp),
    },
  }
}

export function hasAttachments(images: readonly unknown[] | undefined, docs: readonly unknown[] | undefined): boolean {
  return Boolean(images?.length) || Boolean(docs?.length)
}

/** 输入栏「用量」里附件占的上下文：图片按张折算，文档按每本 5400 字折算。 */
export function attachmentContextTokens(images: number, docs = 0): number {
  return Math.max(0, images) * IMAGE_TOKENS + Math.max(0, docs) * PER_DOC_CHARS
}

export type PerDocLimits = {
  calls: number
  rounds: number
  pages: number
  characters: number
  images: number
  searchPages: number
  searchMilliseconds: number
  seedCharacters: number
}

/**
 * 多本文档时按本数拆分预算（实施清单 §5.3）：
 * 单本用原值；N≥2 时调用次数/页数/字数/图片按本均分，N≥3 时检索轮次收到 2。
 */
export function perDocLimits(limits: unknown, count: number, vision: boolean): PerDocLimits {
  const base = normalizeDocumentLimits(limits) as unknown as PerDocLimits
  const n = Math.max(1, Math.round(count) || 1)
  return {
    ...base,
    calls: Math.max(3, Math.ceil(base.calls / n)),
    rounds: n >= 3 ? Math.min(base.rounds, 2) : base.rounds,
    pages: Math.max(3, Math.ceil(base.pages / n)),
    characters: Math.max(6000, Math.floor(base.characters / n)),
    images: vision ? Math.max(1, Math.floor(base.images / n)) : 0,
    seedCharacters: base.seedCharacters,
  }
}

/** 附件文档合计大小是否超过上限（按 Doc.size 或临时文件大小）。 */
export function docsWithinBudget(sizes: readonly number[]): boolean {
  return sizes.reduce((sum, size) => sum + Math.max(0, size), 0) <= CHAT_ATTACH_LIMITS.docBytesTotal
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error ?? ''))

/**
 * 文档读取失败的固定文案：**永远不透出原始报错**（后端会把带完整路径的 FileNotFoundError 原样返回）。
 */
export function friendlyDocError(error: unknown, title: string): string {
  const name = error instanceof Error ? error.name : ''
  const text = messageOf(error)
  const doc = title || '文档'
  if (name === 'PasswordException' || /PasswordException/i.test(text)) {
    return `《${doc}》已加密：请先在阅读器里打开并输入密码（本次运行内有效），再回来提问。`
  }
  if (/TEMP_MISSING|No such file|Errno 2|找不到|文件不存在|源文件缺失/i.test(text)) {
    return `《${doc}》的原文件找不到或已被修改：文档库文档请在文档库里重新定位；临时文档请重新上传。`
  }
  if (/扫描件|没有文字层|no text layer/i.test(text)) {
    return `《${doc}》是扫描件、没有文字层，当前模型不支持图片：请换识图模型。`
  }
  if (/TimeoutError|timed? ?out|超时/i.test(text)) {
    return `《${doc}》读取超时（150 秒）。`
  }
  return `《${doc}》读取失败，请稍后重试。`
}

const TEMP_MESSAGES: Record<string, string> = {
  TEMP_LIMIT: '每段对话最多附 3 份文档，或临时文档太多，请先移除一些。',
  TEMP_TYPE: '只能附加 PDF、Markdown 或 Word 文档。',
  TEMP_SIZE: '文件超过大小限制（PDF 64 MB / Markdown 4 MB / Word 32 MB）。',
  TEMP_HEADER: '文件内容与扩展名不符，可能已损坏。',
  TEMP_ENCODING: 'Markdown 不是 UTF-8 编码，请先另存为 UTF-8。',
  TEMP_NOT_FILE: '这不是一个普通文件，或位于不允许的位置。',
  TEMP_MISSING: '临时文档已被移动、删除或修改，请重新上传。',
  TEMP_HANDLE: '临时文档已失效，请重新上传。',
  TEMP_CONVERT: 'Word 转换失败。',
  TEMP_CANCELLED: '已取消。',
  TEMP_IO: '本机读取临时文档失败。',
}

/** 临时文档的错误码 → 固定中文文案（后端只给码和中文原因，不含路径）。 */
export function friendlyTempError(error: unknown): string {
  const text = messageOf(error)
  const code = Object.keys(TEMP_MESSAGES).find(key => text.includes(key))
  if (!code) return '本机读取临时文档失败。'
  if (code === 'TEMP_CONVERT') {
    const detail = text.replace(/^.*?TEMP_CONVERT[：:]\s*/, '').trim()
    return `Word 转换失败${detail ? `：${detail}` : '。'}`
  }
  return TEMP_MESSAGES[code]
}

/** 附件运行时状态对应的固定文案；ready 返回 null。 */
export function attachmentStatusText(
  status: 'ready' | 'preparing' | 'error' | 'stale' | 'expired' | 'removed' | 'missing',
  title: string,
  error?: string,
): string | null {
  if (status === 'ready') return null
  const doc = title || '文档'
  if (status === 'preparing') return `《${doc}》还在转换，请稍候。`
  if (status === 'expired') return `临时文档「${doc}」· 已失效（重开应用后需重新上传）。`
  if (status === 'removed') return `《${doc}》已从文档库移除，请在文档库里重新定位。`
  if (status === 'missing' || status === 'stale') return `《${doc}》的原文件找不到或已被修改：文档库文档请在文档库里重新定位；临时文档请重新上传。`
  return error || `《${doc}》读取失败，请稍后重试。`
}
