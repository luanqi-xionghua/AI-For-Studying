/**
 * 设置页预算输入的纯换算。秒/毫秒只在显示边界换算：
 * 存储与运行一直用整数毫秒，输入框显示秒；解析用十进制整数字符串构造毫秒，
 * 不做「浮点乘 1000 再截尾」，所以 10.025 秒往返仍是 10025 毫秒。
 *
 * 本文件被 Node 26 直接 `node --test` 与 vue-tsc(strict + allowJs) 同时检查，
 * 参数与返回值都用显式类型，不靠 any 透传。
 */

/** 预算字段：与 shared/document-limits.mjs、shared/request-queue.mjs 的字段表结构一致。 */
export type LimitField = {
  readonly key: string
  readonly label: string
  readonly min: number
  readonly max: number
  /** 字段表的缺省值（存储单位）；显示草稿缺键时用它兜底。 */
  readonly default?: number
  /** 存储单位下的快调步长（例如字符预算 1000）；缺省为 1。 */
  readonly step?: number
  /** 显示单位与存储单位的比例（搜索时间 1000：存毫秒、显示秒）；缺省为 1。 */
  readonly scale?: number
}

/** 存储值 → 输入框显示字符串。10025 毫秒显示为 "10.025"，不截成 "10"。 */
export function displayValue(field: LimitField, stored: number): string {
  return String(stored / (field.scale ?? 1))
}

/**
 * 输入框的 step（显示单位）。
 * 带快调步长的整数预算如果存着不在步进格点上的有效值（例如 24567 字符），
 * 改用 step=1 才不会被浏览器的原生校验拦住；其他情况保持字段原步长。
 */
export function displayStep(field: LimitField, raw: string): number {
  const step = field.step ?? 1
  const value = Number(raw)
  const offGrid = (value - field.min) % step !== 0
  if (step > 1 && raw.trim() && Number.isInteger(value) && value >= field.min && value <= field.max && offGrid) return 1
  return step / (field.scale ?? 1)
}

/** 输入框文本 → 存储整数。空串、超过精度、非十进制整数、越界都抛出可直接展示的中文说明。 */
export function parseLimit(field: LimitField, raw: string): number {
  const text = String(raw ?? '').trim()
  const seconds = field.scale === 1000
  const match = (seconds ? /^(\d+)(?:\.(\d{1,3}))?$/ : /^(\d+)$/).exec(text)
  const value = !match ? NaN : seconds
    ? Number(match[1]) * 1000 + Number((match[2] ?? '').padEnd(3, '0'))
    : Number(match[1])
  if (!Number.isSafeInteger(value) || value < field.min || value > field.max) {
    throw new Error(seconds ? '搜索时间须为 1–30 秒，最多 3 位小数。' : `${field.label}须为 ${field.min}–${field.max} 的整数。`)
  }
  return value
}

/** 整组字段的显示草稿（挂载、保存成功、显式重置后都用它刷新）。 */
export function displayDraft(fields: readonly LimitField[], stored: Readonly<Record<string, number>>): Record<string, string> {
  return Object.fromEntries(fields.map(field => {
    const number = stored?.[field.key]
    return [field.key, displayValue(field, Number.isFinite(number) ? number : field.default ?? field.min)]
  }))
}

export type DraftParse =
  | { ok: true; values: Record<string, number> }
  | { ok: false; key: string; message: string }

/** 解析整组草稿到临时对象；失败时返回第一个出错字段，调用方据此展开 details、标 aria-invalid 并聚焦。 */
export function parseDraft(fields: readonly LimitField[], draft: Readonly<Record<string, string>>): DraftParse {
  const values: Record<string, number> = {}
  for (const field of fields) {
    try {
      values[field.key] = parseLimit(field, draft?.[field.key] ?? '')
    } catch (error) {
      return { ok: false, key: field.key, message: error instanceof Error ? error.message : String(error) }
    }
  }
  return { ok: true, values }
}
