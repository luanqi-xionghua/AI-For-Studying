export interface Doc {
  id: string;
  name: string;
  /** word：Word 文档，加入时已转成 PDF，read() 读到的是 PDF。 */
  kind: 'pdf' | 'markdown' | 'word';
  path: string;
  size: number;
  modifiedAt: number;
  addedAt: number;
  lastOpenedAt: number;
  progress: number;
  page: number;
  pageCount: number;
  tags: string[];
  starred: boolean;
}
export interface Library {
  list(query?: string): Promise<Doc[]>;
  /** picked：选好文件、开始导入之前调用一次（界面据此提示「正在把 Word 转成 PDF」）。 */
  importDocuments(picked?: (paths: string[]) => void): Promise<Doc[]>;
  read(id: string): Promise<Uint8Array>;
  update(id: string, patch: Partial<Doc>): Promise<Doc>;
  remove(id: string): Promise<void>;
  readAsset(id: string, relativePath: string): Promise<{data: Uint8Array; mime: string}>;
  index(id: string, text: string): Promise<void>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
}
