/**
 * 附件的上限、按钮可用性与上下文估算。纯函数，Node 单测直接导入。
 * 文档（文档库 / 临时）相关的错误文案在 M4 / M5 补齐，这里先把画像与规则固定下来。
 */
import { CHAT_ATTACH_LIMITS } from './types.ts'

/** 一张图片大致折算的 token；与输入栏「用量」的上下文估算口径一致。 */
export const IMAGE_TOKENS = 1200
/** 多本文档时每本按 5400 字估算（见实施清单 §5.7）。 */
export const PER_DOC_CHARS = 5400

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
