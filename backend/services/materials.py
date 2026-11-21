"""资料检索服务：缓存三个公开来源的目录，并在本机做检索。

数据放在独立的 ``materials.sqlite3``：不进书库备份，也不影响
``library.sqlite3`` 的 schema 与 ``user_version``。索引是纯缓存，坏了就重建。
"""

from __future__ import annotations

import asyncio
import json
import re
import sqlite3
import time
import webbrowser
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import aiohttp

from .. import VERSION
from . import material_index as core
from .material_index import (GITHUB_REPOS, MaterialError, build_index, parse_query,
                             records_from_arxiv, records_from_github_tree, search,
                             validate_open_url)

DB_NAME = "materials.sqlite3"
SCHEMA_VERSION = 1
USER_AGENT = "YueqianXingqiong-Materials/%s" % VERSION
FETCH_HOSTS = frozenset({"api.github.com", "arxiv.jaison.ink"})
REQUEST_TIMEOUT = aiohttp.ClientTimeout(total=30, sock_connect=10, sock_read=20)
SYNC_BUDGET_S = 180
RETRY_BACKOFF_S = (1.0, 3.0)
RETRY_STATUS = frozenset({500, 502, 503, 504})
ARXIV_CONCURRENCY = 3
ARXIV_PAGE_SIZE = 100
ARXIV_MAX_PAGES = 200
MAX_TREE_BYTES = 16 * 1024**2
MAX_PAGE_BYTES = 4 * 1024**2
MAX_RECORDS_PER_SOURCE = 20000
MIN_SYNC_INTERVAL_MS = 60_000
STALE_AFTER_MS = 7 * 24 * 3600 * 1000
PROGRESS_THROTTLE_S = 0.15

SOURCE_ORDER = ("openise", "sysu", "arxiv", "arxiv-pkg")

ID_PATTERN = re.compile(r"^(?:oi|sy):d?[0-9a-f]{15,16}$|^ax[mp]:\d{1,10}$")

COLUMNS = ("id", "source", "title", "course", "category", "path", "file_name",
           "ext", "size", "count", "year", "url", "remote_updated", "fetched_at")

DDL = """
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
CREATE TABLE IF NOT EXISTS sync_meta(
  key   TEXT PRIMARY KEY CHECK (length(key) BETWEEN 1 AND 64),
  value TEXT NOT NULL    CHECK (length(value) <= 4096)
);
CREATE TABLE IF NOT EXISTS items(
  id             TEXT PRIMARY KEY CHECK (length(id) BETWEEN 4 AND 24),
  source         TEXT NOT NULL CHECK (source IN ('openise','sysu','arxiv','arxiv-pkg')),
  title          TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  course         TEXT NOT NULL DEFAULT '' CHECK (length(course) <= 60),
  category       TEXT NOT NULL DEFAULT '' CHECK (length(category) <= 120),
  path           TEXT NOT NULL DEFAULT '' CHECK (length(path) <= 500),
  file_name      TEXT NOT NULL DEFAULT '' CHECK (length(file_name) <= 200),
  ext            TEXT NOT NULL DEFAULT '' CHECK (length(ext) <= 10),
  size           INTEGER NOT NULL DEFAULT 0 CHECK (size >= 0),
  count          INTEGER NOT NULL DEFAULT 1 CHECK (count >= 1),
  year           INTEGER CHECK (year IS NULL OR year BETWEEN 1950 AND 2100),
  url            TEXT NOT NULL CHECK (url LIKE 'https://github.com/%' OR url LIKE 'https://arxiv.jaison.ink/%'),
  remote_updated TEXT NOT NULL DEFAULT '',
  fetched_at     INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS items_by_source ON items(source);
PRAGMA user_version=1;
"""

INSERT_ITEMS = "INSERT INTO items(%s) VALUES (%s)" % (
    ",".join(COLUMNS), ",".join("?" * len(COLUMNS)))


def now():
    """当前毫秒时间戳；测试里可以替换。"""
    return int(time.time() * 1000)


class Materials:
    def __init__(self, client, library, root, emit):
        self.client = client
        self.lib = library
        self.root = Path(root)
        self.emit = emit
        self.path = self.root / DB_NAME
        self.task = None
        self.broken = False
        self.recovered = False
        self._index = None
        self._committing = False
        self._last_report = 0.0
        import threading

        self._lock = threading.RLock()
        self._index_lock = threading.Lock()
        self._open_db()

    # ------------------------------------------------------------ 数据库

    def _connect(self):
        cx = sqlite3.connect(str(self.path), timeout=5)
        cx.row_factory = sqlite3.Row
        cx.execute("PRAGMA foreign_keys=ON")
        return cx

    @contextmanager
    def _db(self):
        cx = self._connect()
        try:
            yield cx
        finally:
            cx.close()

    def _open_db(self):
        with self._lock:
            if self.broken:
                raise MaterialError("MAT_DB")
            try:
                with self._db() as cx:
                    version = cx.execute("PRAGMA user_version").fetchone()[0]
                    if version == 0:
                        cx.executescript(DDL)
                        cx.commit()
                        return
                    if version != SCHEMA_VERSION:
                        raise sqlite3.DatabaseError("版本不符")
                    if cx.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                        raise sqlite3.DatabaseError("quick_check")
                    columns = {row[1] for row in cx.execute("PRAGMA table_info(items)")}
                    if not set(COLUMNS) <= columns:
                        raise sqlite3.DatabaseError("缺列")
                    tables = {row[0] for row in cx.execute(
                        "SELECT name FROM sqlite_master WHERE type='table'")}
                    if not {"items", "sync_meta"} <= tables:
                        raise sqlite3.DatabaseError("缺表")
            except (sqlite3.DatabaseError, OSError):
                self._reset_db()

    def _reset_db(self):
        """把坏库改名留档，然后建一个空库。"""
        with self._lock:
            self.recovered = True
            for suffix in ("-wal", "-shm"):
                extra = Path(str(self.path) + suffix)
                try:
                    if extra.exists():
                        extra.unlink()
                except OSError:
                    pass
            try:
                if self.path.exists():
                    self.path.replace(Path(str(self.path) + ".corrupt"))
            except OSError:
                pass
            try:
                with self._db() as cx:
                    cx.executescript(DDL)
                    cx.commit()
            except (sqlite3.DatabaseError, OSError):
                self.broken = True
                raise MaterialError("MAT_DB")

    def _write_meta(self, values):
        if not values:
            return
        with self._lock, self._db() as cx:
            cx.executemany(
                "INSERT INTO sync_meta(key,value) VALUES(?,?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                [(key, str(value)) for key, value in values.items()])
            cx.commit()

    def _read_meta(self):
        with self._db() as cx:
            return {row[0]: row[1] for row in cx.execute("SELECT key,value FROM sync_meta")}

    def _source_meta(self, key):
        raw = self._read_meta().get("source:" + key) or "{}"
        try:
            value = json.loads(raw)
        except json.JSONDecodeError:
            value = {}
        return value if isinstance(value, dict) else {}

    def _meta_int(self, key):
        try:
            return int(self._read_meta().get(key) or 0)
        except (TypeError, ValueError):
            return 0

    # ------------------------------------------------------------ 索引

    def _ensure_index(self):
        if self._index is not None:
            return self._index
        with self._index_lock:
            if self._index is not None:
                return self._index
            with self._lock:
                if self.broken:
                    raise MaterialError("MAT_DB")
                try:
                    with self._db() as cx:
                        rows = cx.execute("SELECT * FROM items").fetchall()
                        meta = {row[0]: row[1] for row in cx.execute(
                            "SELECT key,value FROM sync_meta")}
                except sqlite3.DatabaseError:
                    raise MaterialError("MAT_DB")
            if not rows:
                return None
            records = [dict(row) for row in rows]
            synced = int(meta.get("last_success_at") or 0)
            self._index = build_index(records, synced)
            return self._index

    def _has_source_error(self):
        try:
            meta = self._read_meta()
        except MaterialError:
            return False
        for key in SOURCE_ORDER:
            raw = meta.get("source:" + key) or ""
            if not raw:
                continue
            try:
                value = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if isinstance(value, dict) and value.get("error"):
                return True
        return False

    # ------------------------------------------------------------ 命令：状态

    def material_status(self):
        if self.broken:
            raise MaterialError("MAT_DB")
        try:
            with self._db() as cx:
                counts = {row[0]: row[1] for row in cx.execute(
                    "SELECT source,COUNT(*) FROM items GROUP BY source")}
                meta = {row[0]: row[1] for row in cx.execute("SELECT key,value FROM sync_meta")}
        except sqlite3.DatabaseError:
            raise MaterialError("MAT_DB")

        def number(key):
            try:
                return int(meta.get(key) or 0)
            except (TypeError, ValueError):
                return 0

        sources = []
        for key in SOURCE_ORDER:
            raw = meta.get("source:" + key) or "{}"
            try:
                value = json.loads(raw)
            except json.JSONDecodeError:
                value = {}
            if not isinstance(value, dict):
                value = {}
            sources.append({
                "key": key, "label": core.SOURCES[key]["label"],
                "count": counts.get(key, 0), "syncedAt": int(value.get("syncedAt") or 0),
                "error": str(value.get("error") or ""),
                "warning": str(value.get("warning") or ""),
            })

        total = number("index_total")
        synced_at = number("last_success_at")
        stale = bool(synced_at) and now() - synced_at > STALE_AFTER_MS
        snapshot = {
            "state": "ready" if total > 0 else "empty",
            "total": total,
            "raw": sum(counts.values()),
            "syncedAt": synced_at,
            "attemptedAt": number("last_attempt_at"),
            "stale": stale,
            "syncing": self.task is not None and not self.task.done(),
            "recovered": self.recovered,
            "sources": sources,
        }
        self.recovered = False
        return snapshot

    # ------------------------------------------------------------ 命令：同步

    async def material_sync(self, onProgress=None):
        if self.broken:
            raise MaterialError("MAT_DB")
        if self.task is not None and not self.task.done():
            raise MaterialError("MAT_BUSY")
        last = self._meta_int("last_success_at")
        if last and now() - last < MIN_SYNC_INTERVAL_MS:
            raise MaterialError("MAT_TOO_SOON")

        state = {"done": 0, "total": 4, "pages": {}}
        started = now()
        self.task = asyncio.current_task()
        self._write_meta({"last_attempt_at": started})
        await self._emit_progress(onProgress, state, "start", "正在连接资料来源…", force=True)
        try:
            try:
                async with asyncio.timeout(SYNC_BUDGET_S):
                    fetches = await self._fetch_all(onProgress, state)
            except TimeoutError:
                raise MaterialError("MAT_TIMEOUT")
            except asyncio.CancelledError:
                raise MaterialError("MAT_CANCELLED")

            if not any(item["ok"] for item in fetches):
                first = next((item for item in fetches if item.get("code")), None)
                raise MaterialError(first["code"] if first else "MAT_NETWORK",
                                    first.get("detail", "") if first else "")

            self._committing = True
            await self._emit_progress(onProgress, state, "store", "正在写入本机索引…",
                                      force=True)
            try:
                records, counts, synced_at = await asyncio.to_thread(self._commit, fetches)
                await self._emit_progress(onProgress, state, "index", "正在整理检索索引…",
                                          force=True)
                index = await asyncio.to_thread(build_index, records, synced_at)
                self._index = index
                self._write_meta({"index_total": index.n})
            except (sqlite3.DatabaseError, OSError):
                raise MaterialError("MAT_DB")

            await self._emit_progress(onProgress, state, "done",
                                      "同步完成，共 %s 条资料" % format(index.n, ","),
                                      force=True)
            return {
                "ok": True,
                "partial": any(not item["ok"] for item in fetches),
                "total": index.n,
                "raw": sum(counts.values()),
                "syncedAt": synced_at,
                "tookMs": synced_at - started,
                "sources": [{
                    "key": item["key"], "label": core.SOURCES[item["key"]]["label"],
                    "ok": item["ok"], "count": counts.get(item["key"], 0),
                    "notModified": bool(item.get("notModified")),
                    "error": item.get("error") or "",
                    "warning": item.get("warning") or "",
                } for item in fetches],
            }
        finally:
            self._committing = False
            self.task = None

    async def material_cancel(self):
        if self._committing:
            return {"cancelled": False, "reason": "committing"}
        task = self.task
        if task is None or task.done():
            return {"cancelled": False, "reason": "idle"}
        task.cancel()
        return {"cancelled": True}

    async def _fetch_all(self, channel, state):
        semaphore = asyncio.Semaphore(ARXIV_CONCURRENCY)
        return list(await asyncio.gather(
            self._fetch_github("openise", channel, state),
            self._fetch_github("sysu", channel, state),
            self._fetch_arxiv("material", channel, state, semaphore),
            self._fetch_arxiv("package", channel, state, semaphore),
        ))

    async def _fetch_github(self, key, channel, state):
        repo, branch = GITHUB_REPOS[key]
        label = core.SOURCES[key]["label"]
        meta = self._source_meta(key)
        etag = meta.get("etag") if meta.get("count") else None
        branch = meta.get("branch") or branch
        url = "https://api.github.com/repos/%s/git/trees/%s?recursive=1" % (repo, branch)
        extra = {"Accept": "application/vnd.github+json",
                 "X-GitHub-Api-Version": "2022-11-28"}
        result = {"key": key, "ok": False, "notModified": False, "records": [],
                  "warning": "", "error": "", "code": "", "detail": ""}
        try:
            try:
                status, data, headers = await self._get_json(
                    url, limit=MAX_TREE_BYTES, etag=etag, extra=extra)
            except MaterialError as exc:
                if "HTTP 404" not in str(exc):
                    raise
                status, repo_data, _ = await self._get_json(
                    "https://api.github.com/repos/%s" % repo, limit=MAX_PAGE_BYTES,
                    extra=extra)
                branch = (repo_data or {}).get("default_branch") or branch
                url = "https://api.github.com/repos/%s/git/trees/%s?recursive=1" % (repo, branch)
                status, data, headers = await self._get_json(
                    url, limit=MAX_TREE_BYTES, etag=None, extra=extra)

            state["done"] += 1
            if status == 304:
                result.update(ok=True, notModified=True)
                await self._emit_progress(channel, state, "fetch",
                                          "%s 文件目录没有变化" % label, key, force=True)
                return result

            tree = data.get("tree") if isinstance(data, dict) else None
            if not isinstance(tree, list):
                raise MaterialError("MAT_UPSTREAM", "tree 结构")
            records, stats = await asyncio.to_thread(
                records_from_github_tree, key, repo, branch, tree, now())
            if len(records) > MAX_RECORDS_PER_SOURCE:
                raise MaterialError("MAT_TOO_LARGE")
            if data.get("truncated"):
                result["warning"] = "目录过大，GitHub 只返回了一部分"
            result.update(ok=True, records=records, etag=headers.get("ETag") or "",
                          branch=branch, treeSha=data.get("sha") or "")
            await self._emit_progress(channel, state, "fetch", "已读取 %s 文件目录" % label,
                                      key, force=True)
        except MaterialError as exc:
            message = str(exc).split("：", 1)[-1]
            result.update(ok=False, code=exc.code, error="%s：%s" % (exc.code, message))
            state["done"] += 1
            await self._emit_progress(channel, state, "fetch", "%s 这次没有连上" % label,
                                      key, force=True)
        return result

    async def _fetch_arxiv(self, kind, channel, state, semaphore):
        key = "arxiv" if kind == "material" else "arxiv-pkg"
        label = core.SOURCES[key]["label"]
        path = "materials" if kind == "material" else "packages"
        noun = "资料列表" if kind == "material" else "课程包"
        result = {"key": key, "ok": False, "notModified": False, "records": [],
                  "warning": "", "error": "", "code": "", "detail": ""}

        async def page(number):
            url = "%s/api/%s?page=%d&page_size=%d" % (
                core.ARXIV_ORIGIN, path, number, ARXIV_PAGE_SIZE)
            status, data, _headers = await self._get_json(url, limit=MAX_PAGE_BYTES)
            if not isinstance(data, dict) or not isinstance(data.get("items"), list):
                raise MaterialError("MAT_UPSTREAM", "items 结构")
            if int(data.get("page") or 0) != number:
                raise MaterialError("MAT_UPSTREAM", "页码回显")
            if int(data.get("page_size") or 0) != ARXIV_PAGE_SIZE:
                raise MaterialError("MAT_UPSTREAM", "page_size 回显")
            if len(data["items"]) > ARXIV_PAGE_SIZE:
                raise MaterialError("MAT_UPSTREAM", "单页条数")
            state["done"] += 1
            await self._emit_progress(
                channel, state, "fetch",
                "正在读取破壁计划%s %d / %d" % (noun, number, state["pages"].get(key, number)),
                key)
            return data

        try:
            first = await page(1)
            total_pages = int(first.get("total_pages") or 1)
            if total_pages > ARXIV_MAX_PAGES:
                raise MaterialError("MAT_TOO_LARGE")
            state["pages"][key] = total_pages
            state["total"] += max(0, total_pages - 1)
            batches = [first]
            if total_pages > 1:
                batches.extend(await asyncio.gather(
                    *(self._page_with(page, number, semaphore)
                      for number in range(2, total_pages + 1))))
            items = []
            seen = set()
            for batch in batches:
                for item in batch["items"]:
                    ident = item.get("id") if isinstance(item, dict) else None
                    if ident in seen:
                        continue
                    seen.add(ident)
                    items.append(item)
            declared = int(first.get("total") or 0)
            if declared and abs(len(items) - declared) > max(2, declared * 0.02):
                result["warning"] = "同步期间资料有增减"
            records, _stats = await asyncio.to_thread(
                records_from_arxiv, kind, items, now())
            if len(records) > MAX_RECORDS_PER_SOURCE:
                raise MaterialError("MAT_TOO_LARGE")
            result.update(ok=True, records=records)
            await self._emit_progress(channel, state, "fetch",
                                      "已读取破壁计划%s" % noun, key, force=True)
        except MaterialError as exc:
            result.update(ok=False, code=exc.code)
            result["error"] = "%s：%s" % (exc.code, str(exc).split("：", 1)[-1])
            await self._emit_progress(channel, state, "fetch", "%s 这次没有连上" % label,
                                      key, force=True)
        return result

    async def _page_with(self, page, number, semaphore):
        async with semaphore:
            return await page(number)

    # ------------------------------------------------------------ 网络

    def _check_fetch_url(self, url):
        parts = urlsplit(url)
        try:
            port = parts.port
        except ValueError:
            raise MaterialError("MAT_UPSTREAM")
        if (parts.scheme != "https" or parts.hostname not in FETCH_HOSTS
                or parts.username or parts.password or port not in (None, 443)):
            raise MaterialError("MAT_UPSTREAM")

    async def _get_json(self, url, *, limit, etag=None, extra=None):
        headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
        headers.update(extra or {})
        if etag:
            headers["If-None-Match"] = etag
        for attempt in range(len(RETRY_BACKOFF_S) + 1):
            try:
                return await self._request_json(url, headers, limit)
            except MaterialError as exc:
                retryable = exc.code in ("MAT_NETWORK", "MAT_TIMEOUT") or (
                    exc.code == "MAT_UPSTREAM" and ("HTTP 5" in str(exc)
                                                    or "重定向" in str(exc)))
                if not retryable or attempt >= len(RETRY_BACKOFF_S):
                    raise
                await asyncio.sleep(RETRY_BACKOFF_S[attempt])
        raise MaterialError("MAT_NETWORK")

    async def _request_json(self, url, headers, limit):
        target = url
        for _hop in range(4):
            self._check_fetch_url(target)
            try:
                async with self.client.get(
                        target, allow_redirects=False, timeout=REQUEST_TIMEOUT,
                        headers=headers) as response:
                    status = response.status
                    if status in (301, 302, 303, 307, 308):
                        target = urljoin(target, response.headers.get("Location") or "")
                        continue
                    if status == 304:
                        return 304, None, dict(response.headers)
                    if status == 200:
                        chunks = []
                        size = 0
                        async for chunk in response.content.iter_chunked(65536):
                            size += len(chunk)
                            if size > limit:
                                raise MaterialError("MAT_TOO_LARGE")
                            chunks.append(chunk)
                        try:
                            return 200, json.loads(b"".join(chunks).decode("utf-8")), \
                                dict(response.headers)
                        except (UnicodeDecodeError, json.JSONDecodeError):
                            raise MaterialError("MAT_UPSTREAM", "JSON 解析失败")
                    if status in (403, 429):
                        remaining = response.headers.get("X-RateLimit-Remaining")
                        if remaining == "0" or status == 429:
                            detail = ""
                            reset = response.headers.get("X-RateLimit-Reset")
                            if reset and reset.isdigit():
                                minutes = max(1, int(
                                    (int(reset) * 1000 - now()) / 60000 + 0.999))
                                detail = "约 %d 分钟后再试" % minutes
                            raise MaterialError("MAT_RATE_LIMIT", detail)
                    raise MaterialError("MAT_UPSTREAM", "HTTP %d" % status)
            except (aiohttp.ClientConnectionError, aiohttp.ClientPayloadError,
                    aiohttp.ClientError):
                raise MaterialError("MAT_NETWORK")
            except (asyncio.TimeoutError, TimeoutError):
                raise MaterialError("MAT_TIMEOUT")
        raise MaterialError("MAT_UPSTREAM", "重定向次数过多")

    # ------------------------------------------------------------ 落库

    def _commit(self, fetches):
        synced_at = now()
        records = []
        counts = {}
        with self._lock:
            cx = self._connect()
            try:
                cx.execute("BEGIN IMMEDIATE")
                for fetch in fetches:
                    key = fetch["key"]
                    previous = self._source_meta_cx(cx, key)
                    if fetch["ok"] and not fetch.get("notModified"):
                        rows = fetch["records"]
                        cx.execute("DELETE FROM items WHERE source=?", (key,))
                        cx.executemany(INSERT_ITEMS, [
                            tuple(row.get(column) for column in COLUMNS) for row in rows])
                        counts[key] = len(rows)
                        records.extend(rows)
                        previous.update({
                            "syncedAt": synced_at, "count": len(rows), "error": "",
                            "warning": fetch.get("warning") or "",
                        })
                        for field in ("etag", "branch", "treeSha"):
                            if fetch.get(field):
                                previous[field] = fetch[field]
                    else:
                        counts[key] = int(previous.get("count") or 0)
                        records.extend(self._records_cx(cx, key))
                        if fetch["ok"]:
                            previous.update({"syncedAt": synced_at, "error": "",
                                             "warning": ""})
                        else:
                            previous["error"] = fetch.get("error") or ""
                    cx.execute(
                        "INSERT INTO sync_meta(key,value) VALUES(?,?) "
                        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                        ("source:" + key, json.dumps(previous, ensure_ascii=False)))
                cx.execute(
                    "INSERT INTO sync_meta(key,value) VALUES(?,?) "
                    "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    ("last_success_at", str(synced_at)))
                cx.execute(
                    "INSERT INTO sync_meta(key,value) VALUES(?,?) "
                    "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    ("app_version", VERSION))
                cx.commit()
            finally:
                cx.close()
        return records, counts, synced_at

    def _source_meta_cx(self, cx, key):
        row = cx.execute("SELECT value FROM sync_meta WHERE key=?", ("source:" + key,)).fetchone()
        try:
            value = json.loads(row[0]) if row else {}
        except json.JSONDecodeError:
            value = {}
        return value if isinstance(value, dict) else {}

    def _records_cx(self, cx, key):
        return [dict(row) for row in
                cx.execute("SELECT * FROM items WHERE source=?", (key,)).fetchall()]

    # ------------------------------------------------------------ 命令：检索

    def material_search(self, query, limit=core.RESULT_LIMIT_DEFAULT):
        if not isinstance(query, str):
            raise MaterialError("MAT_QUERY")
        started = time.perf_counter()
        index = self._ensure_index()
        # 还没同步过时用一张空索引解析查询，保证「只搜文档库」也能正常工作
        parsed = parse_query(query, index if index is not None else core.Index())
        try:
            documents = self.lib.list_documents()
        except (ValueError, sqlite3.DatabaseError):
            documents = []
        result = search(index, parsed, limit=limit, library=documents,
                        partial=self._has_source_error())
        result["query"] = query
        result["tookMs"] = round((time.perf_counter() - started) * 1000, 1)
        return result

    # ------------------------------------------------------------ 命令：打开

    def material_open(self, id):  # noqa: A002 - 与前端契约保持一致
        ident = id if isinstance(id, str) else ""
        if not ID_PATTERN.match(ident):
            raise MaterialError("MAT_NOT_FOUND")
        try:
            with self._db() as cx:
                row = cx.execute("SELECT url FROM items WHERE id=?", (ident,)).fetchone()
        except sqlite3.DatabaseError:
            raise MaterialError("MAT_DB")
        if row is None:
            raise MaterialError("MAT_NOT_FOUND")
        url = validate_open_url(row["url"])
        host = urlsplit(url).hostname
        try:
            opened = webbrowser.open(url)
        except Exception:  # noqa: BLE001 - 任何异常都归为「打不开浏览器」
            raise MaterialError("MAT_OPEN")
        if not opened:
            raise MaterialError("MAT_OPEN")
        return {"opened": True, "host": host}

    # ------------------------------------------------------------ 命令：清空

    def material_clear(self):
        if self.task is not None and not self.task.done():
            raise MaterialError("MAT_BUSY")
        with self._lock:
            self._index = None
            for suffix in ("", "-wal", "-shm"):
                path = Path(str(self.path) + suffix)
                try:
                    if path.exists():
                        path.unlink()
                except OSError:
                    raise MaterialError("MAT_DB")
            self._open_db()
        return {"cleared": True}

    def close(self):
        self._index = None

    # ------------------------------------------------------------ 进度

    async def _report(self, channel, event, force=False):
        if not channel:
            return
        moment = time.monotonic()
        if not force and moment - self._last_report < PROGRESS_THROTTLE_S:
            return
        self._last_report = moment
        try:
            await self.emit(channel, dict({"type": "progress"}, **event))
        except Exception:  # noqa: BLE001 - 进度只是提示，失败不影响同步
            pass

    async def _emit_progress(self, channel, state, phase, message, source=None, force=False):
        await self._report(channel, {
            "phase": phase, "source": source, "done": state["done"],
            "total": max(state["total"], state["done"]), "message": message,
        }, force=force)
