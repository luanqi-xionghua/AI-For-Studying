// User budgets are snapshotted per question. Transport and cache ceilings stay fixed.
/**
 * @typedef {{ key: string, label: string, min: number, max: number, default: number, step?: number, scale?: number }} DocumentLimitField
 */
/** @type {readonly DocumentLimitField[]} */
export const DOCUMENT_LIMIT_FIELDS = Object.freeze([
  { key: 'images', label: '页图次数 / 每次对话', min: 1, max: 10, default: 10 },
  { key: 'pages', label: '证据页数 / 每次对话', min: 1, max: 40, default: 40 },
  { key: 'characters', label: '证据文字 / 每次对话（字符）', min: 1000, max: 120000, default: 120000, step: 1000 },
  { key: 'calls', label: 'PDF 读取次数 / 每次对话', min: 1, max: 60, default: 60 },
  { key: 'rounds', label: 'API 检索轮次 / 每次对话', min: 1, max: 8, default: 8 },
  { key: 'searchPages', label: '搜索扫描页数 / 每次对话（按单次搜索）', min: 10, max: 500, default: 500 },
  { key: 'searchMilliseconds', label: '搜索时间 / 每次对话（按单次搜索，秒）', min: 1000, max: 30000, default: 30000, scale: 1000 },
].map(field => Object.freeze(field)));
/**
 * @typedef {{ images: number, pages: number, characters: number, calls: number, rounds: number, searchPages: number, searchMilliseconds: number, seedCharacters: number, pageBatch: number }} DocumentLimits
 */
/** @type {DocumentLimits} */
export const DOCUMENT_LIMITS = Object.freeze({ ...Object.fromEntries(DOCUMENT_LIMIT_FIELDS.map(field => [field.key, field.default])), seedCharacters: 8000, pageBatch: 3 });
export const MODEL_STATE_CHARACTERS = 16 * 1024 * 1024;
/** 缺键或不是有限 number 时取新默认；有限值只按范围夹取，不强行改成最大值。 */
export function normalizeDocumentLimits(value) {
  const clean = { ...DOCUMENT_LIMITS };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return clean;
  for (const field of DOCUMENT_LIMIT_FIELDS) {
    const number = value[field.key];
    if (typeof number === 'number' && Number.isFinite(number)) clean[field.key] = Math.max(field.min, Math.min(field.max, Math.trunc(number)));
  }
  return clean;
}
