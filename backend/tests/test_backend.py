import asyncio
import hashlib
import json
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, patch

from aiohttp import ClientSession, web

from backend import VERSION
from backend.services.library import Library
from backend.api.server import DesktopService
from backend.core.windows import Credentials


class DataTests(unittest.TestCase):
    def setUp(self):
        td = tempfile.TemporaryDirectory()
        self.addCleanup(td.cleanup)
        self.root = Path(td.name)
        self.lib = Library(self.root / "data")
        self.md = self.root / "合成文档.md"
        self.md.write_text("工具：测试中文索引", encoding="utf-8")

    def test_import_search_persistence(self):
        (d,) = self.lib.import_documents([str(self.md)] * 2)
        self.assertEqual(self.lib.read_document(d["id"]), self.md.read_bytes())
        self.lib.update_document(
            d["id"], {"pageCount": 9, "page": 3, "starred": True, "tags": [" a ", "a"]}
        )
        self.lib.set_setting("demo.key", "一")
        lib = Library(self.lib.root)
        self.assertEqual(lib.get_setting("demo.key"), "一")
        self.assertEqual(lib.list_documents("中文索")[0]["id"], d["id"])
        self.assertEqual(lib.list_documents("索引")[0]["page"], 3)
        self.assertEqual(lib.get(d["id"])["tags"], ["a"])
        lib.remove_document(d["id"])
        self.assertEqual(lib.list_documents(), [])
        self.assertTrue(self.md.is_file())

    def test_invalid_batch_atomic(self):
        bad = self.root / "bad.pdf"
        bad.write_bytes(b"not PDF")
        self.assertRaises(
            ValueError, self.lib.import_documents, [str(self.md), str(bad)]
        )
        self.assertEqual(self.lib.list_documents(), [])

    def test_assets_and_validation(self):
        (d,) = self.lib.import_documents([str(self.md)])
        (self.root / "img.png").write_bytes(b"image")
        self.assertEqual(self.lib.read_asset(d["id"], "img.png"), b"image")
        self.assertRaises(ValueError, self.lib.read_asset, d["id"], "../outside.png")
        self.assertRaises(ValueError, self.lib.update_document, d["id"], {"page": 9})
        self.assertRaises(
            ValueError, self.lib.update_document, d["id"], {"path": "bogus"}
        )
        self.assertRaises(ValueError, self.lib.set_setting, "../key", "v")

    def test_relocate_preserves_document_identity_and_metadata(self):
        (document,) = self.lib.import_documents([str(self.md)])
        self.lib.update_document(
            document["id"],
            {
                "pageCount": 12,
                "page": 4,
                "progress": 0.35,
                "starred": True,
                "tags": ["保留"],
            },
        )
        bookmark_key = f"bookmarks.v1.{document['id']}"
        self.lib.set_setting(bookmark_key, '[{"id":"mark-1","position":{"page":4}}]')
        moved = self.root / "整理后" / "新名字.md"
        moved.parent.mkdir()
        self.md.rename(moved)

        self.assertTrue(self.lib.get(document["id"])["sourceMissing"])
        updated = self.lib.relocate_document(document["id"], str(moved))

        self.assertEqual(updated["id"], document["id"])
        self.assertEqual(updated["name"], moved.name)
        self.assertFalse(updated["sourceMissing"])
        self.assertEqual(updated["page"], 4)
        self.assertEqual(updated["progress"], 0.35)
        self.assertEqual(updated["tags"], ["保留"])
        self.assertTrue(updated["starred"])
        self.assertIn('"mark-1"', self.lib.get_setting(bookmark_key))
        self.assertEqual(self.lib.read_document(document["id"]), moved.read_bytes())

    def test_database_backup_restore_round_trip(self):
        (document,) = self.lib.import_documents([str(self.md)])
        self.lib.update_document(
            document["id"], {"pageCount": 7, "page": 5, "progress": 0.6}
        )
        self.lib.set_setting("bookmarks.test", '[{"id":"saved"}]')
        self.lib.set_setting("ai.conversations.test", '{"list":[{"id":"saved-chat"}]}')
        backup = self.root / "library backup.sqlite3"

        result = self.lib.backup_database(str(backup))
        self.assertEqual(result["size"], backup.stat().st_size)
        self.lib.update_document(document["id"], {"page": 1, "progress": 0})
        self.lib.set_setting("bookmarks.test", "changed")
        extra_path = self.root / "extra.md"
        extra_path.write_text("另一份文档", encoding="utf-8")
        self.lib.import_documents([str(extra_path)])

        self.assertTrue(self.lib.restore_database(str(backup)))
        self.assertEqual(
            [item["id"] for item in self.lib.list_documents()], [document["id"]]
        )
        restored = self.lib.get(document["id"])
        self.assertEqual((restored["page"], restored["progress"]), (5, 0.6))
        self.assertEqual(self.lib.get_setting("bookmarks.test"), '[{"id":"saved"}]')
        self.assertIn("saved-chat", self.lib.get_setting("ai.conversations.test"))
        self.assertRaises(ValueError, self.lib.restore_database, str(self.lib.path))
        self.assertRaises(
            ValueError, self.lib.set_setting, "too-large", "x" * (1024 * 1024 + 1)
        )

    def test_invalid_database_backup_does_not_change_library(self):
        (document,) = self.lib.import_documents([str(self.md)])
        self.lib.update_document(
            document["id"], {"pageCount": 5, "page": 3, "progress": 0.25}
        )
        invalid_backup = self.root / "invalid.sqlite3"
        invalid_backup.write_bytes(b"not a SQLite database")

        with self.assertRaisesRegex(ValueError, "无法读取备份"):
            self.lib.restore_database(str(invalid_backup))

        restored = self.lib.get(document["id"])
        self.assertEqual(
            (restored["page"], restored["pageCount"], restored["progress"]),
            (3, 5, 0.25),
        )
        self.assertEqual(self.lib.list_documents()[0]["id"], document["id"])

    def test_document_list_and_search_exceed_one_thousand(self):
        many = self.root / "many"
        many.mkdir()
        paths = []
        for index in range(1001):
            path = many / f"document-{index:04}.md"
            path.write_text("共享内容用于超过一千本文档的搜索测试", encoding="utf-8")
            paths.append(str(path))
        for start in range(0, len(paths), 200):
            self.lib.import_documents(paths[start : start + 200])

        self.assertEqual(len(self.lib.list_documents()), 1001)
        self.assertEqual(len(self.lib.list_documents("超过一千本")), 1001)

    def test_index_replaced_on_file_change(self):
        p = self.root / "file.pdf"
        p.write_bytes(b"%PDF-1 test")
        (d,) = self.lib.import_documents([str(p)])
        self.lib.index_document(d["id"], "已索引内容")
        self.assertTrue(self.lib.list_documents("索引内容"))
        p.write_bytes(b"%PDF-1 changed")
        self.assertEqual(self.lib.import_documents([str(p)])[0]["id"], d["id"])
        self.assertFalse(self.lib.list_documents("索引内容"))

    def test_dpapi_original_format(self):
        import win32crypt

        c = Credentials(self.root)
        c.root.mkdir()
        sample = b"synthetic-not-a-real-key"
        c.path("openai").write_bytes(
            win32crypt.CryptProtectData(sample, None, None, None, None, 1)
        )
        self.assertEqual(c.get_credential("openai"), sample.decode())
        c.set_credential("openai", "replacement")
        self.assertEqual(
            win32crypt.CryptUnprotectData(
                c.path("openai").read_bytes(), None, None, None, 1
            )[1],
            b"replacement",
        )
        c.set_credential("openai", "")
        self.assertIsNone(c.get_credential("openai"))


class ServiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.service = DesktopService(
            self.root, self.root, AsyncMock(return_value=False)
        )
        await self.service.start()
        self.addAsyncCleanup(self.service.close)
        self.client = ClientSession()
        self.addAsyncCleanup(self.client.close)
        self.headers = {
            "Origin": self.service.origin,
            "X-Kaizhi-Token": self.service.token,
        }

    async def call(self, name, args=None):
        async with self.client.post(
            self.service.origin + "/api/" + name, headers=self.headers, json=args or {}
        ) as r:
            if r.status >= 400:
                raise AssertionError(await r.text())
            return (
                await r.read()
                if r.content_type == "application/octet-stream"
                else await r.json()
            )

    async def channel(self):
        ws = await self.client.ws_connect(
            self.service.origin + "/events", origin=self.service.origin
        )
        await ws.send_str(self.service.token)
        self.assertEqual(await ws.receive_json(timeout=3), {"ready": True})
        self.addAsyncCleanup(ws.close)
        return ws

    async def test_harness_desktop_roundtrip(self):
        # Exercise the same authenticated HTTP and WebSocket calls the renderer uses.
        upstream = web.Application()
        seen = []

        async def models(request):
            seen.append(request.headers.get("Authorization"))
            return web.json_response({"data": [{"id": "fixture", "object": "model"}]})

        upstream.router.add_get("/v1/models", models)
        runner = web.AppRunner(upstream, access_log=None)
        await runner.setup()
        self.addAsyncCleanup(runner.cleanup)
        await web.TCPSite(runner, "127.0.0.1", 0).start()
        slot = {
            "provider": "custom",
            "baseUrl": f"http://127.0.0.1:{runner.addresses[0][1]}/v1",
        }
        await self.call(
            "ai_set_key", {**slot, "key": "local-fixture-only", "remember": False}
        )
        self.assertIs(await self.call("ai_has_key", slot), True)
        query = {
            "id": str(uuid.uuid4()),
            "channel": str(uuid.uuid4()),
            "request": {
                **slot,
                "kind": "models",
                "protocol": "chat",
                "model": "discovery",
            },
        }
        async with self.client.post(
            self.service.origin + "/api/ai_start", headers=self.headers, json=query
        ) as reply:
            self.assertEqual(
                reply.status, 400, "must authenticate the event channel first"
            )
        ws = await self.channel()
        await self.call("ai_start", query)
        result = await ws.receive_json(timeout=10)
        self.assertEqual(result["channel"], query["channel"])
        self.assertEqual(result["event"]["type"], "end")
        self.assertEqual(result["event"]["value"]["models"][0]["id"], "fixture")
        self.assertNotIn("local-fixture-only", json.dumps(result))
        self.assertEqual(seen, ["Bearer local-fixture-only"])

    async def test_permission_and_binary(self):
        for headers in (
            {},
            {"Origin": "http://example.invalid", "X-Kaizhi-Token": self.service.token},
        ):
            async with self.client.post(
                self.service.origin + "/api/list_documents", json={}, headers=headers
            ) as r:
                self.assertEqual(r.status, 403)
        p = self.root / "sample.pdf"
        p.write_bytes(b"%PDF-1.7\x00\xfe")
        (d,) = await self.call("import_documents", dict(paths=[str(p)]))
        self.assertEqual(
            await self.call("read_document", dict(id=d["id"])), p.read_bytes()
        )
        self.assertFalse(await self.call("is_fullscreen"))

    async def test_import_progress_reaches_the_event_channel(self):
        ws = await self.channel()
        note = self.root / "进度.md"
        note.write_text("内容", encoding="utf-8")
        channel = str(uuid.uuid4())
        (d,) = await self.call(
            "import_documents", {"paths": [str(note)], "onProgress": channel}
        )
        self.assertEqual(d["kind"], "markdown")
        self.assertEqual(
            await ws.receive_json(timeout=3),
            {"channel": channel, "event": {"stage": "adding"}},
        )

    async def test_relocation_and_backup_http_commands(self):
        original = self.root / "original.md"
        original.write_text("原文内容", encoding="utf-8")
        (document,) = await self.call("import_documents", {"paths": [str(original)]})
        moved = self.root / "renamed.md"
        original.rename(moved)
        self.assertTrue((await self.call("list_documents"))[0]["sourceMissing"])
        restored = await self.call(
            "relocate_document", {"id": document["id"], "path": str(moved)}
        )
        self.assertEqual(restored["id"], document["id"])
        await self.call("set_setting", {"key": "bookmarks.http", "value": "saved"})
        backup = self.root / "http-backup.sqlite3"
        await self.call("backup_database", {"path": str(backup)})
        await self.call("set_setting", {"key": "bookmarks.http", "value": "changed"})
        await self.call("restore_database", {"path": str(backup)})
        self.assertEqual(
            await self.call("get_setting", {"key": "bookmarks.http"}), "saved"
        )

    async def test_removed_ai_routes(self):
        for command in ("http_start", "native_connect", "get_credential"):
            async with self.client.post(
                self.service.origin + "/api/" + command, headers=self.headers, json={}
            ) as response:
                self.assertEqual(response.status, 404)

    async def test_update_unverified_rejected(self):
        self.assertEqual((await self.call("update_status"))["current"], VERSION)
        self.assertRaises(
            ValueError, self.service.up.update_open_page, "https://example.invalid"
        )
        await self.call("update_cancel")
        with self.assertRaises(ValueError):
            await self.service.up.update_install(str(self.root / "unverified.exe"))

    async def test_updates_select_verify(self):
        up = self.service.up
        data = b"synthetic package"
        h = hashlib.sha256(data).hexdigest()
        name = "YueqianXingqiong-1.0.1-portable.exe"
        url = f"{up.page}/releases/download/v1.0.1/{name}"
        releases = [
            {"tag_name": "desktop-v99.0.0"},
            {"tag_name": "v1.0.0"},  # the running version is never offered again
            {
                "tag_name": "v1.0.1",
                "assets": [
                    dict(
                        name=name,
                        browser_download_url=url,
                        size=len(data),
                        digest="sha256:" + h,
                    )
                ],
            },
        ]

        class Content:
            def __init__(self, data):
                self.data = data
                self.content = self

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                pass

            async def iter_chunked(self, n):
                yield self.data

        with (
            patch.object(
                up,
                "response",
                AsyncMock(
                    side_effect=[
                        Content(json.dumps(releases).encode()),
                        Content(b"wrong"),
                        Content(data),
                    ]
                ),
            ),
            patch.object(up, "emit", AsyncMock()),
        ):
            info = await up.update_check()
            self.assertEqual(info["version"], "1.0.1")
            self.assertIsNone(info["installer"])
            with self.assertRaises(ValueError):
                await up.update_download(url, h, "ch")
            out = await up.update_download(url, h, "ch")
            self.assertEqual(Path(out).read_bytes(), data)
