// 文档类型。Word 文档（.docx / 老式 .doc）在加入文档库时已由后端转成 PDF（backend/src/word.rs），
// 读出来的就是 PDF：阅读器、页码、封面、阅读助手、搜索索引都按 PDF 处理，只是卡片和标签上注明它原来是 Word。
export type DocKind = 'pdf' | 'markdown' | 'word'

/** 能加入文档库的文件。 */
export const DOCUMENT_EXTENSIONS = ['pdf', 'md', 'markdown', 'docx', 'doc']
export const DOCUMENT_PATTERN = /\.(pdf|md|markdown|docx?)$/i
export const WORD_PATTERN = /\.docx?$/i

/** 按 PDF 阅读：PDF 本身，以及转成 PDF 的 Word。 */
export function readsAsPdf(kind: string | undefined): boolean { return kind === 'pdf' || kind === 'word' }

/** 显示用的标题：去掉扩展名。 */
export function documentTitle(name: string): string { return name.replace(DOCUMENT_PATTERN, '') }

/** 卡片、并排选择里的格式小标签。 */
export function formatLabel(doc: { kind: string; name: string }): string {
  if (doc.kind === 'word') return /\.doc$/i.test(doc.name) ? 'DOC' : 'DOCX'
  return doc.kind === 'pdf' ? 'PDF' : 'MD'
}

/** 文档详情里的类型名。 */
export function kindName(kind: string): string { return kind === 'word' ? 'Word（已转为 PDF）' : kind === 'pdf' ? 'PDF' : 'Markdown' }

/** 图标：AppIcon 的名字。 */
export function kindIcon(kind: string): string { return kind === 'word' ? 'word' : kind === 'pdf' ? 'file' : 'markdown' }
