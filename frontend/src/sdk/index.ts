import { invoke, open } from './python';
import type { Doc, Library } from './types';
import { DOCUMENT_PATTERN } from '../library/kinds';
export type { Doc, Library } from './types';
async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try { return await invoke<T>(command, args); }
  catch (error) { throw error instanceof Error ? error : new Error(String(error)); }
}
function bytes(value: ArrayBuffer | number[] | Uint8Array) { return value instanceof Uint8Array ? value : new Uint8Array(value); }
export function assetMime(path: string): string {
  const ext = path.split('.').at(-1)?.toLowerCase();
  return ({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',svg:'image/svg+xml',avif:'image/avif',bmp:'image/bmp'} as Record<string,string>)[ext || ''] || 'application/octet-stream';
}
export const library: Library = {
  list: (query = '') => call('list_documents', { query }),
  async importDocuments(picked) {
    const chosen = await open({ multiple: true, title: '添加 PDF / Markdown / Word 文档' });
    if (!chosen) return [];
    const paths = Array.isArray(chosen) ? chosen : [chosen];
    picked?.(paths);
    return call('import_documents', { paths });
  },
  async relocateDocument(id, path) { return call('relocate_document', { id, path }); },
  async backupDatabase() {
    const path = await invoke<string | null>('select_backup_destination');
    if (!path) return null;
    await call('backup_database', { path });
    return path;
  },
  async restoreDatabase() {
    const path = await invoke<string | null>('select_backup_source');
    if (!path) return false;
    await call('restore_database', { path });
    return true;
  },
  async read(id) { return bytes(await call<ArrayBuffer>('read_document', { id })); },
  update: (id, patch) => call('update_document', { id, patch }),
  remove: id => call('remove_document', { id }),
  async readAsset(id, relativePath) { return { data: bytes(await call<ArrayBuffer>('read_asset', { id, relativePath })), mime: assetMime(relativePath) }; },
  index: (id, text) => call('index_document', { id, text }),
  getSetting: key => call('get_setting', { key }),
  setSetting: (key, value) => call('set_setting', { key, value }),
  deleteSetting: key => call('delete_setting', { key }),
};
export async function selectDocumentFile() {
  const chosen = await open({ multiple: false, title: '重新定位原文件' });
  return Array.isArray(chosen) ? chosen[0] || null : chosen;
}
export async function importDroppedDocuments(files: string[]): Promise<Doc[]> {
  const paths = [...new Set(files.filter(path => DOCUMENT_PATTERN.test(path)))];
  if (!paths.length) throw new Error('请拖入 PDF、Markdown 或 Word 文件。');
  return call('import_documents', { paths });
}
