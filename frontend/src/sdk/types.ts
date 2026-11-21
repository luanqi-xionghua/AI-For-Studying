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
  sourceMissing?: boolean;
}
export interface Library {
  list(query?: string): Promise<Doc[]>;
  /** picked：选好文件、开始导入之前调用一次（界面据此提示「正在把 Word 转成 PDF」）。 */
  read(id: string): Promise<Uint8Array>;
  update(id: string, patch: Partial<Doc>): Promise<Doc>;
  relocateDocument(id: string, path: string): Promise<Doc>;
  backupDatabase(): Promise<string | null>;
  restoreDatabase(): Promise<boolean>;
  remove(id: string): Promise<void>;
  readAsset(id: string, relativePath: string): Promise<{data: Uint8Array; mime: string}>;
  index(id: string, text: string): Promise<void>;
  getStartupSettings(): Promise<{ stored: string | null; legacyTheme: string | null; fresh: boolean }>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  deleteSetting(key: string): Promise<void>;
}

/** 临时文档：后端调起原生对话框，只把不透明句柄、文件名和类型交给前端。 */
export interface TempDocItem {
  handle: string;
  name: string;
  kind: 'pdf' | 'markdown' | 'word';
  size: number;
  /** Word 需要后端转成 PDF（转换阶段只有 'office' / 'libreoffice'）。 */
  needsConvert: boolean;
}
export interface TempDocRejected {
  name: string;
  /** 形如「TEMP_TYPE：只能附加…」，不含路径。 */
  error: string;
}
export interface TempDocs {
  pick(limit: number): Promise<{ items: TempDocItem[]; rejected: TempDocRejected[] }>;
  prepare(handle: string, onStage?: (stage: string) => void): Promise<{ handle: string; kind: 'pdf' | 'markdown'; size: number }>;
  read(handle: string): Promise<Uint8Array>;
  release(handles: string[]): Promise<{ released: number }>;
}
