/**
 * 图片附件的采集、压缩与预算。
 * 预算函数是纯函数，Node 单测可以直接导入；`toDataUrl` 只在浏览器里用。
 */
import { cropImageAsync } from '../reader/crop.ts'
import { CHAT_ATTACH_LIMITS } from './types.ts'

/** 允许的图片类型：与阅读助手一致，但不收 SVG（脚本内容不该发给模型）。 */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'] as const
const ALLOWED = new Set<string>(IMAGE_TYPES)

export type RejectedImage = { name: string; reason: 'type' | 'size' }
export type ImageFiles = { files: File[]; rejected: RejectedImage[] }

/** 从 DataTransfer / FileList / 文件数组里挑出可用的图片；类型不对、原文件太大都放进 rejected。 */
export function imageFilesFrom(input: FileList | readonly File[] | { files?: FileList | null } | null | undefined): ImageFiles {
  const source = input && typeof input === 'object' && 'files' in input ? (input as { files?: FileList | null }).files : input
  const files: File[] = []
  const rejected: RejectedImage[] = []
  for (const file of source ? [...(source as FileList | readonly File[])] : []) {
    if (!file || typeof file.type !== 'string') continue
    if (!ALLOWED.has(file.type.toLowerCase())) { rejected.push({ name: file.name || '图片', reason: 'type' }); continue }
    if (file.size > CHAT_ATTACH_LIMITS.imageSourceBytes) { rejected.push({ name: file.name || '图片', reason: 'size' }); continue }
    files.push(file)
  }
  return { files, rejected }
}

export type ImageBudget = {
  count: number
  /** data URL 字符数合计，按压缩后计。 */
  chars: number
  ok: boolean
  reason?: 'count' | 'chars'
}

export function imageBudget(images: readonly string[]): ImageBudget {
  const count = images.length
  const chars = images.reduce((sum, image) => sum + image.length, 0)
  if (count > CHAT_ATTACH_LIMITS.images) return { count, chars, ok: false, reason: 'count' }
  if (chars > CHAT_ATTACH_LIMITS.imageTotalChars) return { count, chars, ok: false, reason: 'chars' }
  return { count, chars, ok: true }
}

/** 往草稿里加一张压缩后的图片；超出张数或总量时返回原因，原数组不变。 */
export function addImageToDraft(draft: readonly string[], dataUrl: string): { images: string[]; reason?: 'count' | 'chars' } {
  if (!dataUrl) return { images: [...draft] }
  if (draft.length >= CHAT_ATTACH_LIMITS.images) return { images: [...draft], reason: 'count' }
  const chars = draft.reduce((sum, image) => sum + image.length, 0) + dataUrl.length
  if (chars > CHAT_ATTACH_LIMITS.imageTotalChars) return { images: [...draft], reason: 'chars' }
  return { images: [...draft, dataUrl] }
}

const megabytes = (chars: number) => (chars / (1024 * 1024)).toFixed(1)

/** 预览条上的预算文案：「图片 3/6 · 2.4 MB / 8 MB」。 */
export function imageBudgetText(images: readonly string[]): string {
  const chars = images.reduce((sum, image) => sum + image.length, 0)
  return `图片 ${images.length}/${CHAT_ATTACH_LIMITS.images} · ${megabytes(chars)} MB / ${megabytes(CHAT_ATTACH_LIMITS.imageTotalChars)} MB`
}

/**
 * 把选中的图片压成长边 ≤1600 的 PNG data URL：与框选截图同一条管道
 * （主线程只 drawImage，编码交给浏览器后台线程）。
 */
export async function toDataUrl(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
  bitmap.close()
  try {
    return await cropImageAsync(canvas, { x: 0, y: 0, width: canvas.width, height: canvas.height }, canvas.width, canvas.height)
  } finally {
    canvas.width = canvas.height = 0
  }
}
