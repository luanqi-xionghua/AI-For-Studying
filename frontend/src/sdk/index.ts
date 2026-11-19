import { invoke, open, Channel } from './python';
import type { Doc, Library } from './types';
import type { ImportStage } from '../library/importer';
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
/** 加入文档窗口里的「选择文件」：只选，不导入。 */
export async function selectDocuments(): Promise<string[]> {
  const chosen = await open({ multiple: true, title: '加入 PDF / Markdown / Word 文档' });
  return !chosen ? [] : Array.isArray(chosen) ? chosen : [chosen];
}
/** 加入一份文档；Word 会先转成 PDF，onStage 收到转换进行到的步骤。 */
export function importDocument(path: string, onStage?: (stage: ImportStage) => void): Promise<Doc[]> {
  if (!onStage) return call('import_documents', { paths: [path] });
  const channel = new Channel<{ stage: ImportStage }>();
  channel.onmessage = event => onStage(event.stage);
  return call('import_documents', { paths: [path], onProgress: channel });
}
