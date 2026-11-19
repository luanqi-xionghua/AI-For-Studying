"""SQLite library; preserve the original on-disk schema and frontend field names."""

import json
import os
import re
import sqlite3
import threading
import time
import uuid
from contextlib import closing, contextmanager
from pathlib import Path

from . import word

M = 1024 * 1024
KINDS = dict.fromkeys((".md", ".markdown", ".mdown"), "markdown") | {
    ".pdf": "pdf",
    ".doc": "word",
    ".docx": "word",
}
LIMITS = {"pdf": 256 * M, "markdown": 16 * M, "word": 128 * M}
IMAGES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp", ".svg"}
KEY = re.compile(r"[a-zA-Z0-9._-]{1,100}")
now = lambda: time.time_ns() // 1_000_000


def bounded(path, limit):
    with path.open("rb") as f:
        if not path.is_file() or os.fstat(f.fileno()).st_size > limit:
            raise ValueError("文件超过大小限制或不是普通文件")
        data = f.read(limit + 1)
    if len(data) > limit:
        raise ValueError("文件超过大小限制")
    return data


def doc(row):
    if row is None:
        raise ValueError("文档不在文档库中")
    data = dict(row)
    for old, new in [
        ("added_at", "addedAt"),
        ("modified_at", "modifiedAt"),
        ("last_opened_at", "lastOpenedAt"),
        ("page_count", "pageCount"),
    ]:
        data[new] = data.pop(old) or 0
    data["tags"] = json.loads(data["tags"])
    data["starred"] = bool(data["starred"])
    data["sourceMissing"] = not Path(data["path"]).is_file()
    return data


def refresh(cx, id):
    cx.execute("DELETE FROM document_search WHERE id=?", [id])
    cx.execute(
        "INSERT INTO document_search SELECT d.id,d.name,d.tags,coalesce(t.text,'') FROM documents d LEFT JOIN document_text t ON d.id=t.id WHERE d.id=?",
        [id],
    )


class Library:
    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.path = self.root / "library.sqlite3"
        self.converted = self.root / "converted"
        self._lock = threading.RLock()
        with self.connection() as cx:
            if cx.execute("PRAGMA user_version").fetchone()[0] not in (0, 1):
                raise ValueError("不支持的文档库版本")
            cx.executescript("""PRAGMA journal_mode=WAL;
              CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,path TEXT NOT NULL UNIQUE,name TEXT NOT NULL,kind TEXT NOT NULL,size INTEGER NOT NULL,modified_at INTEGER NOT NULL,added_at INTEGER NOT NULL,last_opened_at INTEGER,progress REAL NOT NULL DEFAULT 0,page INTEGER NOT NULL DEFAULT 1,page_count INTEGER NOT NULL DEFAULT 1,tags TEXT NOT NULL DEFAULT '[]',starred INTEGER NOT NULL DEFAULT 0);
              CREATE TABLE IF NOT EXISTS document_text(id TEXT PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,text TEXT NOT NULL);
              CREATE VIRTUAL TABLE IF NOT EXISTS document_search USING fts5(id UNINDEXED,name,tags,text,tokenize='trigram');
              CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL); PRAGMA user_version=1;""")

    @contextmanager
    def connection(self):
        with self._lock:
            cx = sqlite3.connect(self.path, timeout=5)
            cx.row_factory = sqlite3.Row
            try:
                cx.execute("PRAGMA foreign_keys=ON")
                with cx:
                    yield cx
            finally:
                cx.close()

    def list_documents(self, query=None):
        q = (query or "").strip()
        if len(q.encode()) > 1024:
            raise ValueError("搜索词过长")
        sql = "SELECT d.* FROM documents d"
        order = " ORDER BY coalesce(d.last_opened_at,d.added_at) DESC"
        args = []
        if len(q) >= 3:
            sql += " JOIN document_search s ON d.id=s.id WHERE document_search MATCH ?"
            args = ['"' + q.replace('"', '""') + '"']
            order = " ORDER BY bm25(document_search),d.added_at DESC"
        elif q:
            sql += " LEFT JOIN document_text t ON t.id=d.id WHERE instr(lower(d.name),lower(?1)) OR instr(lower(d.tags),lower(?1)) OR instr(lower(t.text),lower(?1))"
            args = [q]
        with self.connection() as cx:
            return [doc(r) for r in cx.execute(sql + order, args)]

    def relocate_document(self, id, path):
        p = Path(path).expanduser().resolve(strict=True)
        if not p.is_file():
            raise ValueError("请选择一个普通文档文件")
        kind = KINDS.get(p.suffix.lower())
        st = p.stat()
        if not kind or st.st_size > LIMITS[kind]:
            raise ValueError("文档类型或大小无效")
        text = None
        if kind == "markdown":
            text = bounded(p, LIMITS[kind]).decode("utf-8")
        else:
            with p.open("rb") as f:
                head = f.read(8)
            expected = {
                ".pdf": b"%PDF-",
                ".doc": bytes.fromhex("d0cf11e0a1b11ae1"),
                ".docx": b"PK\x03\x04",
            }[p.suffix.lower()]
            if not head.startswith(expected):
                raise ValueError("文档文件头无效")
        canonical = str(p)
        verbatim = (
            "\\\\?\\UNC\\" + canonical[2:]
            if canonical.startswith("\\\\")
            else "\\\\?\\" + canonical
        )
        with self.connection() as cx:
            cx.execute("BEGIN IMMEDIATE")
            row = cx.execute("SELECT kind FROM documents WHERE id=?", [id]).fetchone()
            if row is None:
                raise ValueError("文档不在文档库中")
            if row["kind"] != kind:
                raise ValueError("所选文件格式与原文档不一致")
            collision = cx.execute(
                "SELECT id FROM documents WHERE path IN (?,?) AND id<>?",
                (canonical, verbatim, id),
            ).fetchone()
            if collision:
                raise ValueError("该文件已关联到文档库中的另一条记录")
            cx.execute(
                "UPDATE documents SET path=?,name=?,size=?,modified_at=? WHERE id=?",
                (canonical, p.name, st.st_size, st.st_mtime_ns // 1_000_000, id),
            )
            if text is not None:
                cx.execute(
                    "INSERT OR REPLACE INTO document_text VALUES(?,?)",
                    (id, text.encode()[: 10 * M].decode("utf8", "ignore")),
                )
            refresh(cx, id)
            return doc(cx.execute("SELECT * FROM documents WHERE id=?", [id]).fetchone())

    @staticmethod
    def _validate_backup(path):
        uri = Path(path).resolve().as_uri() + "?mode=ro"
        try:
            with closing(sqlite3.connect(uri, uri=True, timeout=5)) as cx:
                if cx.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                    raise ValueError("文档库备份完整性检查未通过")
                if cx.execute("PRAGMA user_version").fetchone()[0] != 1:
                    raise ValueError("不支持的文档库备份版本")
                objects = cx.execute(
                    "SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'"
                ).fetchall()
                names = {name for kind, name, _ in objects if kind == "table"}
                if not {"documents", "document_text", "document_search", "settings"}.issubset(names):
                    raise ValueError("文件不是有效的开智文档库备份")
                search_sql = next(sql for kind, name, sql in objects if kind == "table" and name == "document_search")
                if "using fts5" not in (search_sql or "").lower():
                    raise ValueError("文档库备份缺少有效的全文检索表")
                if any(kind in ("view", "trigger") for kind, _, _ in objects):
                    raise ValueError("文档库备份包含不支持的数据库对象")
                columns = {
                    table: {row[1] for row in cx.execute(f'PRAGMA table_info("{table}")')}
                    for table in ("documents", "document_text", "settings")
                }
                required = {
                    "documents": {"id", "path", "name", "kind", "size", "modified_at", "added_at", "last_opened_at", "progress", "page", "page_count", "tags", "starred"},
                    "document_text": {"id", "text"},
                    "settings": {"key", "value"},
                }
                if any(not expected.issubset(columns[table]) for table, expected in required.items()):
                    raise ValueError("文档库备份结构不完整")
                if cx.execute("PRAGMA foreign_key_check").fetchone() is not None:
                    raise ValueError("文档库备份存在无效的关联记录")
        except sqlite3.DatabaseError as exc:
            raise ValueError("无法读取备份：文件不是有效的 SQLite 文档库") from exc

    def backup_database(self, path):
        destination = Path(path).expanduser().resolve(strict=False)
        if destination == self.path.resolve():
            raise ValueError("备份文件不能覆盖正在使用的文档库")
        if not destination.parent.is_dir():
            raise ValueError("备份目录不存在")
        temporary = destination.with_name(f".{destination.name}.{uuid.uuid4().hex}.tmp")
        try:
            with self._lock:
                with self.connection() as source, closing(sqlite3.connect(temporary)) as target:
                    source.backup(target)
                    target.commit()
                self._validate_backup(temporary)
                os.replace(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)
        return {"path": str(destination), "size": destination.stat().st_size}

    def restore_database(self, path):
        source = Path(path).expanduser().resolve(strict=True)
        if source == self.path.resolve():
            raise ValueError("不能把当前文档库本身作为恢复来源")
        self._validate_backup(source)
        staged = self.root / f".library-restore-{uuid.uuid4().hex}.sqlite3"
        try:
            with self._lock:
                with closing(sqlite3.connect(source.as_uri() + "?mode=ro", uri=True)) as src, closing(sqlite3.connect(staged)) as dest:
                    src.backup(dest)
                    dest.commit()
                self._validate_backup(staged)
                with closing(sqlite3.connect(self.path, timeout=5)) as current:
                    checkpoint = current.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
                    if checkpoint and checkpoint[0]:
                        raise ValueError("文档库仍被其他进程使用，无法安全恢复")
                Path(str(self.path) + "-wal").unlink(missing_ok=True)
                Path(str(self.path) + "-shm").unlink(missing_ok=True)
                os.replace(staged, self.path)
        finally:
            staged.unlink(missing_ok=True)
        return True

    def import_documents(self, paths):
        if not isinstance(paths, list) or len(paths) > 200:
            raise ValueError("一次最多导入 200 份文档")
        batch = []
        total = 0
        for item in paths:
            p = Path(item).resolve(strict=True)
            k = KINDS.get(p.suffix.lower())
            st = p.stat()
            if not k or not p.is_file() or st.st_size > LIMITS[k]:
                raise ValueError("文档类型或大小无效")
            text = None
            if k == "markdown":
                total += st.st_size
                if total > 64 * M:
                    raise ValueError("Markdown 批次超过 64 MiB")
                text = bounded(p, LIMITS[k]).decode("utf-8")
            else:
                with p.open("rb") as f:
                    head = f.read(8)
                expected = {
                    ".pdf": b"%PDF-",
                    ".doc": bytes.fromhex("d0cf11e0a1b11ae1"),
                    ".docx": b"PK\x03\x04",
                }[p.suffix.lower()]
                if not head.startswith(expected):
                    raise ValueError("文档文件头无效")
            batch.append((p, k, st, text))
        for p, k, _, _ in batch:
            if k == "word":
                word.render(p, self.converted)
        ids = []
        with self.connection() as cx:
            cx.execute("BEGIN IMMEDIATE")
            for p, k, st, text in batch:
                path = str(p)
                modified = st.st_mtime_ns // 1_000_000
                # Imported Windows paths can contain a verbatim prefix.
                verbatim = (
                    "\\\\?\\UNC\\" + path[2:]
                    if path.startswith("\\\\")
                    else "\\\\?\\" + path
                )
                old = cx.execute(
                    "SELECT id,path,size,modified_at FROM documents WHERE path IN (?,?)",
                    (path, verbatim),
                ).fetchone()
                id = old["id"] if old else str(uuid.uuid4())
                path = old["path"] if old else path
                cx.execute(
                    "INSERT INTO documents(id,path,name,kind,size,modified_at,added_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET name=excluded.name,size=excluded.size,modified_at=excluded.modified_at",
                    (id, path, p.name, k, st.st_size, modified, now()),
                )
                if text is not None:
                    cx.execute(
                        "INSERT OR REPLACE INTO document_text VALUES(?,?)",
                        (id, text.encode()[: 10 * M].decode("utf8", "ignore")),
                    )
                elif old and (old["size"], old["modified_at"]) != (
                    st.st_size,
                    modified,
                ):
                    cx.execute("DELETE FROM document_text WHERE id=?", [id])
                refresh(cx, id)
                if id not in ids:
                    ids.append(id)
            return [
                doc(cx.execute("SELECT * FROM documents WHERE id=?", [id]).fetchone())
                for id in ids
            ]

    def get(self, id):
        with self.connection() as cx:
            return doc(
                cx.execute("SELECT * FROM documents WHERE id=?", [id]).fetchone()
            )

    def read_document(self, id):
        d = self.get(id)
        p = Path(d["path"])
        k = d["kind"]
        return bounded(
            word.render(p, self.converted) if k == "word" else p,
            LIMITS["pdf" if k == "word" else k],
        )

    def read_asset(self, id, relativePath):
        root = Path(self.get(id)["path"]).resolve().parent
        rel = Path(relativePath)
        if rel.anchor or ".." in rel.parts or ":" in relativePath:
            raise ValueError("资源路径越界")
        p = (root / rel).resolve(strict=True)
        if not p.is_relative_to(root) or p.suffix.lower() not in IMAGES:
            raise ValueError("不是文档目录内的图片")
        return bounded(p, 16 * M)

    def update_document(self, id, patch):
        if not isinstance(patch, dict) or patch.keys() - {
            "progress",
            "page",
            "pageCount",
            "tags",
            "starred",
            "lastOpenedAt",
        }:
            raise ValueError("无效文档字段")
        with self.connection() as cx:
            cx.execute("BEGIN IMMEDIATE")
            d = doc(cx.execute("SELECT * FROM documents WHERE id=?", [id]).fetchone())
            d.update(patch)
            if (
                type(d["progress"]) not in (int, float)
                or not 0 <= d["progress"] <= 1
                or type(d["pageCount"]) != int
                or not 1 <= d["pageCount"] <= 100000
                or type(d["page"]) != int
                or not 1 <= d["page"]
                or ("page" in patch and d["page"] > d["pageCount"])
            ):
                raise ValueError("页码或阅读进度无效")
            if (
                type(d["starred"]) != bool
                or type(d["lastOpenedAt"]) != int
                or d["lastOpenedAt"] < 0
            ):
                raise ValueError("文档字段无效")
            tags = d["tags"]
            if (
                not isinstance(tags, list)
                or len(tags) > 32
                or any(not isinstance(t, str) or len(t.strip()) > 64 for t in tags)
            ):
                raise ValueError("标签无效")
            tags = list(dict.fromkeys(t.strip() for t in tags if t.strip()))
            cx.execute(
                "UPDATE documents SET page=?,page_count=?,progress=?,tags=?,starred=?,last_opened_at=? WHERE id=?",
                (
                    min(d["page"], d["pageCount"]),
                    d["pageCount"],
                    d["progress"],
                    json.dumps(tags, ensure_ascii=False),
                    d["starred"],
                    min(now() + 60000, d["lastOpenedAt"]) or None,
                    id,
                ),
            )
            refresh(cx, id)
            return doc(
                cx.execute("SELECT * FROM documents WHERE id=?", [id]).fetchone()
            )

    def index_document(self, id, text):
        if len(text.encode()) > 10 * M:
            raise ValueError("索引超过 10 MiB")
        with self.connection() as cx:
            cx.execute("INSERT OR REPLACE INTO document_text VALUES(?,?)", (id, text))
            refresh(cx, id)

    def remove_document(self, id):
        with self.connection() as cx:
            old = cx.execute(
                "SELECT path,kind FROM documents WHERE id=?", [id]
            ).fetchone()
            cx.execute("DELETE FROM document_search WHERE id=?", [id])
            cx.execute("DELETE FROM documents WHERE id=?", [id])
        if old and old["kind"] == "word":
            word.forget(Path(old["path"]), self.converted)

    def get_setting(self, key):
        if not KEY.fullmatch(key):
            raise ValueError("无效设置名")
        with self.connection() as cx:
            row = cx.execute("SELECT value FROM settings WHERE key=?", [key]).fetchone()
            return row[0] if row else None

    def set_setting(self, key, value):
        if not KEY.fullmatch(key) or len(value.encode()) > M:
            raise ValueError("无效设置")
        with self.connection() as cx:
            cx.execute("INSERT OR REPLACE INTO settings VALUES(?,?)", (key, value))

    def delete_setting(self, key):
        if not KEY.fullmatch(key):
            raise ValueError("无效设置名")
        with self.connection() as cx:
            cx.execute("DELETE FROM settings WHERE key=?", [key])
