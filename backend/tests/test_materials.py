"""资料检索：用假响应覆盖同步、过滤、去重、检索、闸门、白名单与容错。"""

import asyncio
import sqlite3
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from aiohttp import ClientSession

from backend.api.server import DesktopService
from backend.services import material_index as core
from backend.services.materials import Materials

NOW = int(time.time() * 1000)

OPENISE_TREE = {
    "sha": "tree-openise",
    "truncated": False,
    "tree": [
        {"path": "大一公共课程/大一下/线代/17线代期末试题答案.pdf", "type": "blob", "size": 1913880},
        {"path": "智能科学与技术/大二下/计算机网络/2021年秋季学期/真题/12级计网/期末考试答案-2014计算机网络A.pdf",
         "type": "blob", "size": 322939},
        {"path": "智能科学与技术/大二下/计算机网络/2021年秋季学期/复习资料/计算机网络复习提纲.pdf",
         "type": "blob", "size": 2211237},
        {"path": "智能科学与技术/大二上/数据结构与算法/2021年春季学期/大作业/main.cpp",
         "type": "blob", "size": 597},
        {"path": "README.md", "type": "blob", "size": 4096},
        {"path": ".github/workflows/sync.yml", "type": "blob", "size": 512},
    ],
}

SYSU_TREE = {
    "sha": "tree-sysu",
    "truncated": False,
    "tree": [
        {"path": "计算机网络/12级计网/期末考试答案-2014计算机网络A.pdf", "type": "blob", "size": 322939},
        {"path": "数据库系统原理/08数据库期中试卷/P5069868.JPG", "type": "blob", "size": 3145728},
        {"path": "数据库系统原理/08数据库期中试卷/P5069869.JPG", "type": "blob", "size": 3145728},
        {"path": "数据库系统原理/08数据库期中试卷/P5069870.JPG", "type": "blob", "size": 3145728},
    ],
}

ARXIV_PAGES = {
    1: {
        "items": [
            {"id": 3683, "title": "期末考试答案-2014计算机网络A",
             "file_name": "期末考试答案-2014计算机网络A.pdf", "file_size": 322939,
             "course_name": "计算机网络", "category": "study_material",
             "sub_category": "other", "year": 2014, "description": ""},
            {"id": 2260, "title": "自辨课后答案", "file_name": "自辨课后答案.pdf",
             "file_size": 390955, "course_name": "自然辩证法", "category": "study_material",
             "sub_category": "other", "year": None, "description": ""},
            {"id": 5291, "title": "计算机网络 PPT", "file_name": "计算机网络ppt.zip",
             "file_size": 2000000, "course_name": "计算机网络", "category": "study_material",
             "sub_category": "other", "year": None, "description": ""},
            {"id": 5320, "title": "zounty-unauth-material", "file_name": "mat.txt",
             "file_size": 40, "course_name": None, "category": "study_material",
             "sub_category": "other", "year": None, "description": ""},
        ],
        "total": 4, "page": 1, "page_size": 100, "total_pages": 1,
    },
}

ARXIV_PACKAGES = {
    1: {
        "items": [
            {"id": 46, "title": "计算机网络", "file_name": "计算机网络.zip",
             "file_size": 22283228, "course_name": "计算机网络", "description": ""},
            {"id": 200, "title": "zuno_../../../zountyWriteProbe_3",
             "file_name": "zuno_../../../zountyWriteProbe_3.zip", "file_size": 196,
             "course_name": "未分类", "description": ""},
        ],
        "total": 2, "page": 1, "page_size": 100, "total_pages": 1,
    },
}


class FakeLibrary:
    def __init__(self, root, documents=None):
        self.root = root
        self.documents = documents or []

    def list_documents(self, query=None):
        return list(self.documents)


def make_fakes(routes=None):
    calls = []
    routes = dict(routes or {})

    async def fake_get(url, *, limit, etag=None, extra=None):
        calls.append((url, etag))
        if "OpenISE/git/trees" in url:
            return routes.get("openise", (200, OPENISE_TREE, {"ETag": 'W/"oi"'}))
        if "SYSU-Exam/git/trees" in url:
            return routes.get("sysu", (200, SYSU_TREE, {"ETag": 'W/"sy"'}))
        if "/api/materials" in url:
            page = int(url.split("page=")[1].split("&")[0])
            return routes.get("arxiv", (200, ARXIV_PAGES[page], {}))
        if "/api/packages" in url:
            page = int(url.split("page=")[1].split("&")[0])
            return routes.get("packages", (200, ARXIV_PACKAGES[page], {}))
        raise core.MaterialError("MAT_NETWORK")

    return calls, fake_get


class FakeContent:
    def __init__(self, body):
        self.body = body

    async def iter_chunked(self, _size):
        yield self.body


class FakeResponse:
    def __init__(self, status, headers=None, body=b"{}"):
        self.status = status
        self.headers = headers or {}
        self.content = FakeContent(body)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class FakeClient:
    """只实现 _request_json 用到的那一点 aiohttp 接口。"""

    def __init__(self, responses):
        self.responses = list(responses)
        self.urls = []

    def get(self, url, **kwargs):
        self.urls.append(url)
        return self.responses.pop(0)


class MaterialsTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.emit = AsyncMock()
        self.calls, self.fake_get = make_fakes()
        self.service = self.make(self.root)

    def make(self, root, library=None):
        service = Materials(None, library or FakeLibrary(root), root, self.emit)
        service._get_json = self.fake_get
        return service

    async def sync(self, service=None):
        return await (service or self.service).material_sync("ch")

    # ---------------------------------------------------------- 同步

    async def test_sync_counts_and_progress(self):
        result = await self.sync()
        self.assertTrue(result["ok"])
        self.assertFalse(result["partial"])
        self.assertEqual(result["raw"], 9)
        self.assertEqual(result["total"], 7)
        counts = {item["key"]: item["count"] for item in result["sources"]}
        self.assertEqual(counts, {"openise": 3, "sysu": 2, "arxiv": 3, "arxiv-pkg": 1})
        phases = [event["phase"] for event in [c.args[1] for c in self.emit.await_args_list]]
        self.assertEqual(phases[0], "start")
        self.assertEqual(phases[-1], "done")
        self.assertTrue(all(event["type"] == "progress"
                            for event in [c.args[1] for c in self.emit.await_args_list]))

    async def test_filtering_rules(self):
        await self.sync()
        with self.service._db() as cx:
            titles = {row[0] for row in cx.execute("SELECT title FROM items")}
        self.assertNotIn("main", titles)
        self.assertNotIn("README", titles)
        self.assertNotIn("zounty-unauth-material", titles)
        self.assertNotIn("zuno_../../../zountyWriteProbe_3", titles)
        with self.service._db() as cx:
            row = cx.execute("SELECT ext,count,url FROM items WHERE ext='images'").fetchone()
        self.assertIsNotNone(row)
        self.assertEqual(row["count"], 3)
        self.assertTrue(row["url"].startswith("https://github.com/sysuexam/SYSU-Exam/tree/master/"))

    async def test_merge_and_mirror(self):
        await self.sync()
        result = self.service.material_search("2014 计算机网络 A卷 答案")
        self.assertTrue(result["found"])
        top = result["results"][0]
        self.assertEqual(top["title"], "期末考试答案-2014计算机网络A")
        self.assertEqual(len(top["links"]), 3)
        self.assertEqual([link["source"] for link in top["links"]],
                         ["openise", "sysu", "arxiv"])
        self.assertEqual(top["year"], 2014)
        self.assertEqual(top["course"], "计算机网络")

    async def test_course_weight_beats_other_course(self):
        await self.sync()
        result = self.service.material_search("线代 课后答案")
        self.assertTrue(result["found"])
        self.assertEqual(result["results"][0]["title"], "17线代期末试题答案")
        titles = [hit["title"] for hit in result["results"]]
        self.assertNotIn("自辨课后答案", titles)

    async def test_intent_weight_puts_exams_first(self):
        await self.sync()
        result = self.service.material_search("计算机网络 期末试卷")
        self.assertEqual(result["results"][0]["title"], "期末考试答案-2014计算机网络A")
        self.assertIn("exam", result["results"][0]["intents"])

    async def test_coverage_gate(self):
        await self.sync()
        for query in ("量子色动力学", "os exam", "Linux"):
            result = self.service.material_search(query)
            self.assertFalse(result["found"], query)
            self.assertEqual(result["results"], [])
            self.assertIn(result["reason"], ("low-coverage", "no-match"))

    async def test_query_bounds(self):
        await self.sync()
        for query in ("", "   ", "，。"):
            with self.assertRaises(core.MaterialError) as caught:
                self.service.material_search(query)
            self.assertEqual(caught.exception.code, "MAT_QUERY")
        long = self.service.material_search("计" * 300)
        self.assertEqual(len(long["normalized"]), 100)
        many = self.service.material_search("计算机网络", 999)
        self.assertLessEqual(len(many["results"]), 50)
        intents_only = self.service.material_search("期末")
        self.assertIn("intent-only", intents_only["hints"])

    async def test_document_library_hits_and_owned(self):
        docs = [{"id": "doc-1", "name": "期末考试答案-2014计算机网络A.md",
                 "kind": "markdown", "tags": [], "path": str(self.root / "a.md"),
                 "size": 10, "lastOpenedAt": 1, "sourceMissing": False}]
        service = self.make(self.root, FakeLibrary(self.root, docs))
        await self.sync(service)
        result = service.material_search("计算机网络 期末")
        self.assertEqual(result["library"][0]["docId"], "doc-1")
        self.assertEqual(result["results"][0]["owned"]["match"], "name")

    # ---------------------------------------------------------- 外部接口

    async def test_open_allows_whitelisted_host(self):
        await self.sync()
        with patch("backend.services.materials.webbrowser.open", return_value=True) as opened:
            result = self.service.material_open("axm:3683")
        self.assertEqual(result, {"opened": True, "host": "arxiv.jaison.ink"})
        opened.assert_called_once_with("https://arxiv.jaison.ink/material/3683")

    async def test_open_rejects_unknown_ids(self):
        await self.sync()
        with patch("backend.services.materials.webbrowser.open") as opened:
            for ident in ("../x", "axm:999999", "", "oi:0000000000000000"):
                with self.assertRaises(core.MaterialError) as caught:
                    self.service.material_open(ident)
                self.assertEqual(caught.exception.code, "MAT_NOT_FOUND")
        opened.assert_not_called()

    async def test_database_check_blocks_foreign_url(self):
        await self.sync()
        with self.assertRaises(sqlite3.IntegrityError):
            with self.service._db() as cx:
                cx.execute(
                    "INSERT INTO items(id,source,title,url,fetched_at) "
                    "VALUES('oi:deadbeefdeadbeef','openise','x','https://evil.example/x',1)")

    async def test_rate_limit_keeps_old_data(self):
        await self.sync()
        self.calls.clear()

        async def failing(url, *, limit, etag=None, extra=None):
            if "OpenISE" in url:
                raise core.MaterialError("MAT_RATE_LIMIT", "约 37 分钟后再试")
            return await self.fake_get(url, limit=limit, etag=etag, extra=extra)

        with patch.object(self.service, "_get_json", failing), \
                patch("backend.services.materials.now", return_value=NOW + 120_000):
            result = await self.sync()
        self.assertTrue(result["ok"])
        self.assertTrue(result["partial"])
        source = next(item for item in result["sources"] if item["key"] == "openise")
        self.assertFalse(source["ok"])
        self.assertEqual(source["count"], 3)
        self.assertTrue(source["error"].startswith("MAT_RATE_LIMIT"))
        fresh = self.service.material_search("线代")
        self.assertTrue(any(hit["source"] == "openise" for hit in fresh["results"]))

    async def test_all_sources_failing_keeps_index(self):
        await self.sync()
        before = self.service.material_status()

        async def down(url, *, limit, etag=None, extra=None):
            raise core.MaterialError("MAT_NETWORK")

        with patch.object(self.service, "_get_json", down), \
                patch("backend.services.materials.now", return_value=NOW + 120_000):
            with self.assertRaises(core.MaterialError) as caught:
                await self.sync()
        self.assertEqual(caught.exception.code, "MAT_NETWORK")
        self.assertEqual(self.service.material_status()["total"], before["total"])

    async def test_not_modified_updates_timestamp(self):
        await self.sync()
        second_calls = []

        async def cached(url, *, limit, etag=None, extra=None):
            second_calls.append((url, etag))
            if "git/trees" in url:
                self.assertEqual(etag, 'W/"oi"' if "OpenISE" in url else 'W/"sy"')
                return 304, None, {}
            return await self.fake_get(url, limit=limit, etag=etag, extra=extra)

        with patch.object(self.service, "_get_json", cached), \
                patch("backend.services.materials.now", return_value=NOW + 120_000):
            result = await self.sync()
        self.assertTrue(result["ok"])
        openise = next(item for item in result["sources"] if item["key"] == "openise")
        self.assertTrue(openise["notModified"])
        self.assertEqual(openise["count"], 3)
        self.assertEqual(self.service.material_status()["syncedAt"], NOW + 120_000)

    async def test_busy_and_too_soon(self):
        gate = asyncio.Event()

        async def slow(url, *, limit, etag=None, extra=None):
            if "/api/materials" in url:
                await gate.wait()
            return await self.fake_get(url, limit=limit, etag=etag, extra=extra)

        with patch.object(self.service, "_get_json", slow):
            task = asyncio.create_task(self.service.material_sync("ch"))
            await asyncio.sleep(0.05)
            with self.assertRaises(core.MaterialError) as caught:
                await self.service.material_sync("ch")
            self.assertEqual(caught.exception.code, "MAT_BUSY")
            gate.set()
            await task
        with self.assertRaises(core.MaterialError) as caught:
            await self.service.material_sync("ch")
        self.assertEqual(caught.exception.code, "MAT_TOO_SOON")

    async def test_cancel_keeps_database(self):
        gate = asyncio.Event()

        async def slow(url, *, limit, etag=None, extra=None):
            if "/api/materials" in url:
                await gate.wait()
            return await self.fake_get(url, limit=limit, etag=etag, extra=extra)

        with patch.object(self.service, "_get_json", slow):
            task = asyncio.create_task(self.service.material_sync("ch"))
            await asyncio.sleep(0.05)
            self.assertEqual(await self.service.material_cancel(), {"cancelled": True})
            with self.assertRaises(core.MaterialError) as caught:
                await task
        self.assertEqual(caught.exception.code, "MAT_CANCELLED")
        self.assertIsNone(self.service.task)
        status = self.service.material_status()
        self.assertEqual(status["state"], "empty")
        self.assertEqual(status["total"], 0)

    async def test_cancel_while_committing(self):
        self.service._committing = True
        self.assertEqual(await self.service.material_cancel(),
                         {"cancelled": False, "reason": "committing"})
        self.service._committing = False
        self.assertEqual(await self.service.material_cancel(),
                         {"cancelled": False, "reason": "idle"})

    async def test_redirect_outside_whitelist_is_rejected(self):
        self.service.__dict__.pop("_get_json", None)  # 用真实实现，只替换 client
        client = FakeClient([FakeResponse(302, {"Location": "https://evil.example/x"})])
        with patch.object(self.service, "client", client), \
                patch("backend.services.materials.asyncio.sleep", new=AsyncMock()):
            with self.assertRaises(core.MaterialError) as caught:
                await self.service._request_json("https://api.github.com/x", {}, 1024)
        self.assertEqual(caught.exception.code, "MAT_UPSTREAM")
        self.assertEqual(len(client.urls), 1)

    async def test_server_errors_retry_with_backoff(self):
        self.service.__dict__.pop("_get_json", None)
        client = FakeClient([FakeResponse(503), FakeResponse(503), FakeResponse(200, {}, b'{"ok":1}')])
        sleep = AsyncMock()
        with patch.object(self.service, "client", client), \
                patch("backend.services.materials.asyncio.sleep", new=sleep):
            status, data, _headers = await self.service._get_json(
                "https://api.github.com/x", limit=1024)
        self.assertEqual((status, data), (200, {"ok": 1}))
        self.assertEqual([call.args[0] for call in sleep.await_args_list], [1.0, 3.0])

    # ---------------------------------------------------------- 存储

    async def test_clear_resets_to_empty(self):
        await self.sync()
        self.assertEqual(self.service.material_clear(), {"cleared": True})
        status = self.service.material_status()
        self.assertEqual(status["state"], "empty")
        self.assertEqual(self.service.material_search("计算机网络")["reason"], "empty-index")

    async def test_corrupt_database_recovers_once(self):
        self.service.close()
        for suffix in ("", "-wal", "-shm"):
            path = Path(str(self.service.path) + suffix)
            if path.exists():
                path.unlink()
        self.service.path.write_bytes(b"not a database")
        service = self.make(self.root)
        status = service.material_status()
        self.assertEqual(status["state"], "empty")
        self.assertTrue(status["recovered"])
        self.assertFalse(service.material_status()["recovered"])
        self.assertTrue(Path(str(service.path) + ".corrupt").exists())

    async def test_unknown_schema_version_rebuilds(self):
        other = self.root / "other"
        other.mkdir()
        stub = Materials(None, FakeLibrary(other), other, self.emit)
        stub.close()
        with stub._db() as cx:
            cx.execute("PRAGMA user_version=99")
            cx.commit()
        service = Materials(None, FakeLibrary(other), other, self.emit)
        self.assertEqual(service.material_status()["state"], "empty")


if __name__ == "__main__":
    unittest.main()

class MaterialsServiceTests(unittest.IsolatedAsyncioTestCase):
    """HTTP 层：命令分派、鉴权与错误格式。"""

    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.service = DesktopService(self.root, self.root, AsyncMock(return_value=False))
        await self.service.start()
        self.addAsyncCleanup(self.service.close)
        self.client = ClientSession()
        self.addAsyncCleanup(self.client.close)
        self.headers = {"Origin": self.service.origin, "X-Kaizhi-Token": self.service.token}

    async def call(self, name, args=None, headers=None):
        async with self.client.post(self.service.origin + "/api/" + name,
                                    headers=headers or self.headers, json=args or {}) as r:
            if r.content_type != "application/json":
                return r.status, await r.text()
            return r.status, await r.json()

    async def test_startup_does_not_network(self):
        with patch.object(self.service.materials, "_request_json", new=AsyncMock()) as request:
            status, body = await self.call("material_status")
        self.assertEqual(status, 200)
        self.assertEqual(body["state"], "empty")
        self.assertEqual(len(body["sources"]), 4)
        request.assert_not_awaited()

    async def test_unknown_id_returns_fixed_error(self):
        status, body = await self.call("material_open", {"id": "nope"})
        self.assertEqual(status, 400)
        self.assertTrue(body["error"].startswith("MAT_NOT_FOUND："))

    async def test_command_needs_token(self):
        status, _body = await self.call(
            "material_search", {"query": "计算机网络"},
            headers={"Origin": self.service.origin})
        self.assertEqual(status, 403)

    async def test_search_without_index_only_uses_library(self):
        status, body = await self.call("material_search", {"query": "计算机网络"})
        self.assertEqual(status, 200)
        self.assertEqual(body["reason"], "empty-index")
        self.assertEqual(body["results"], [])
