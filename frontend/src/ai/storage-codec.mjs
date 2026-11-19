export const MAX_SETTING_CHUNK_BYTES = 900 * 1024
export const MAX_SETTING_CHUNKS = 256

export function splitUtf8(value, maxBytes = MAX_SETTING_CHUNK_BYTES, maxChunks = MAX_SETTING_CHUNKS) {
  if (!Number.isInteger(maxBytes) || maxBytes < 4) throw new RangeError('maxBytes must be at least 4')
  if (!Number.isInteger(maxChunks) || maxChunks < 1) throw new RangeError('maxChunks must be a positive integer')
  const encoder = new TextEncoder()
  const chunks = []
  let chunk = '', bytes = 0
  for (const character of value) {
    const size = encoder.encode(character).length
    if (size > maxBytes) throw new RangeError('A Unicode code point exceeds maxBytes')
    if (bytes + size > maxBytes && chunk) {
      if (chunks.length >= maxChunks) throw new RangeError('AI 对话历史超过本机保存上限，请删除部分对话后重试。')
      chunks.push(chunk)
      chunk = ''
      bytes = 0
    }
    chunk += character
    bytes += size
  }
  if (chunk || !chunks.length) {
    if (chunks.length >= maxChunks) throw new RangeError('AI 对话历史超过本机保存上限，请删除部分对话后重试。')
    chunks.push(chunk)
  }
  return chunks
}
