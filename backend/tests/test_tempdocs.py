"""临时文档服务：路径校验、错误码、Word 转换、取消、清理与 HTTP 接线。"""

import asyncio
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from aiohttp import ClientSession

from backend.api.server import DesktopService
from backend.services import tempdocs
from backend.services.tempdocs import TempDocError, TempDocs

PDF = b"%PDF-1.4\n% test\n"
MD = "# 标题\n正文 UTF-8\n"
DOCX = b"PK\x03\x04" + b"word" * 8


class TempDocsTests(unittest.TestCase):
    def setUp(self):
        td = tempfile.TemporaryDirectory()
        self.addCleanup(td.cleanup)
        base = Path(td.name)
        self.root = base / "data"
        self.files = base / "files"
        self.files.mkdir()
        self.temp = TempDocs(self.root)
        self.addCleanup(self.temp.shutdown)

    def write(self, name, data):
        path = self.files / name
        path.write_bytes(data)
        return path

    def add(self, *paths, limit=3):
        return self.temp.add([str(path) for path in paths], limit)

    def test_add_returns_handles_and_rejects_over_the_limit_or_type(self):
        pdf = self.write("讲义.pdf", PDF)
        md = self.write("笔记.md", MD.encode("utf-8"))
        bad_type = self.write("说明.txt", b"text")
        docx = self.write("大纲.docx", DOCX)
        result = self.add(pdf, md, bad_type, docx, limit=2)
        self.assertEqual([item["kind"] for item in result["items"]], ["pdf", "markdown"])
        self.assertTrue(all(len(item["handle"]) == 32 for item in result["items"]))
        self.assertEqual(result["items"][0]["name"], "讲义.pdf")
        self.assertEqual(result["items"][1]["needsConvert"], False)
        self.assertEqual(len(result["rejected"]), 2)
        self.assertTrue(result["rejected"][0]["error"].startswith("TEMP_TYPE"))
        self.assertTrue(result["rejected"][1]["error"].startswith("TEMP_LIMIT"))

    def test_file_header_encoding_size_and_device_paths_are_rejected(self):
        disguised = self.write("坏.pdf", b"not a pdf")
        result = self.add(disguised)
        self.assertTrue(result["rejected"][0]["error"].startswith("TEMP_HEADER"))

        binary = self.write("乱码.md", b"\xff\xfe\x00\x01")
        result = self.add(binary)
        self.assertTrue(result["rejected"][0]["error"].startswith("TEMP_ENCODING"))

        with patch.dict(tempdocs.SIZES, {"markdown": 16}):
            big = self.write("大.md", b"x" * 64)
            result = self.add(big)
        self.assertTrue(result["rejected"][0]["error"].startswith("TEMP_SIZE"))

        result = self.temp.add([r"\\?\C:\Windows\notepad.exe"], 1)
        self.assertTrue(result["rejected"][0]["error"].startswith("TEMP_NOT_FILE"))

        inside = self.root / "chat-temp" / "x.pdf"
        inside.write_bytes(PDF)
        result = self.add(inside)
        self.assertTrue(result["rejected"][0]["error"].startswith("TEMP_NOT_FILE"))

    def test_handle_regex_and_missing_files(self):
        for handle in ("", "../x", "a" * 33, "A" * 32, None):
            with self.assertRaises(TempDocError) as caught:
                self.temp.read(handle)
            self.assertEqual(caught.exception.code, "TEMP_HANDLE")

        pdf = self.write("讲义.pdf", PDF)
        handle = self.add(pdf)["items"][0]["handle"]
        self.assertEqual(self.temp.read(handle), PDF)
        pdf.write_bytes(b"%PDF-1.4 changed")
        with self.assertRaises(TempDocError) as caught:
            self.temp.read(handle)
        self.assertEqual(caught.exception.code, "TEMP_MISSING")
        pdf.unlink()
        with self.assertRaises(TempDocError) as caught:
            self.temp.prepare(handle)
        self.assertEqual(caught.exception.code, "TEMP_MISSING")

    def test_release_is_idempotent_and_cleans_the_folder(self):
        pdf = self.write("讲义.pdf", PDF)
        handle = self.add(pdf)["items"][0]["handle"]
        folder = self.root / "chat-temp" / handle
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "junk.pdf").write_bytes(PDF)
        self.assertEqual(self.temp.release([handle, handle, "../bad"]), {"released": 1})
        self.assertFalse(folder.exists())
        self.assertEqual(self.temp.release([handle]), {"released": 0})
        with self.assertRaises(TempDocError) as caught:
            self.temp.read(handle)
        self.assertEqual(caught.exception.code, "TEMP_HANDLE")

    def test_init_clears_leftovers_and_limits_live_handles(self):
        leftover = self.root / "chat-temp" / "leftover"
        leftover.mkdir(parents=True)
        (leftover / "x.pdf").write_bytes(PDF)
        TempDocs(self.root)
        self.assertFalse(leftover.exists())

        handles = []
        for index in range(12):
            path = self.write(f"f{index}.md", MD.encode("utf-8"))
            result = self.add(path, limit=3)
            handles.extend(item["handle"] for item in result["items"])
        self.assertEqual(len(handles), 12)
        extra = self.write("f12.md", MD.encode("utf-8"))
        result = self.add(extra)
        self.assertTrue(result["rejected"][0]["error"].startswith("TEMP_LIMIT"))

    def test_word_conversion_reports_only_stage_and_serves_pdf(self):
        docx = self.write("大纲.docx", DOCX)
        handle = self.add(docx)["items"][0]["handle"]
        self.assertTrue(self.add(docx)["items"][0]["needsConvert"])
        events = []

        def fake_render(source, cache, progress=None):
            cache.mkdir(parents=True, exist_ok=True)
            if progress:
                progress("office")
                progress("libreoffice")
            dest = Path(cache) / "converted.pdf"
            dest.write_bytes(PDF)
            return dest

        with patch.object(tempdocs.word, "render", fake_render):
            prepared = self.temp.prepare(handle, events.append)
        self.assertEqual(prepared["kind"], "pdf")
        self.assertEqual(self.temp.read(handle), PDF)
        self.assertEqual({tuple(event) for event in events}, {("stage",)})
        self.assertEqual([event["stage"] for event in events], ["office", "libreoffice"])
        self.assertTrue((self.root / "chat-temp" / handle).is_dir())

    def test_word_conversion_failure_maps_to_temp_convert(self):
        docx = self.write("大纲.docx", DOCX)
        handle = self.add(docx)["items"][0]["handle"]

        def broken(source, cache, progress=None):
            raise ValueError("转换失败：Word / WPS 没能完成转换")

        with patch.object(tempdocs.word, "render", broken):
            with self.assertRaises(TempDocError) as caught:
                self.temp.prepare(handle)
        self.assertEqual(caught.exception.code, "TEMP_CONVERT")
        self.assertIn("Word / WPS", str(caught.exception))
        self.assertNotIn(str(self.files), str(caught.exception))

    def test_release_during_conversion_cancels_and_cleans_up(self):
        docx = self.write("大纲.docx", DOCX)
        handle = self.add(docx)["items"][0]["handle"]
        started = threading.Event()
        finish = threading.Event()

        def slow_render(source, cache, progress=None):
            cache.mkdir(parents=True, exist_ok=True)
            started.set()
            finish.wait(5)
            dest = Path(cache) / "converted.pdf"
            dest.write_bytes(PDF)
            return dest

        result = {}

        def run():
            try:
                self.temp.prepare(handle)
                result["ok"] = True
            except TempDocError as error:
                result["error"] = error.code

        with patch.object(tempdocs.word, "render", slow_render):
            worker = threading.Thread(target=run)
            worker.start()
            self.assertTrue(started.wait(5))
            self.temp.release([handle])
            finish.set()
            worker.join(5)
        self.assertEqual(result.get("error"), "TEMP_CANCELLED")
        self.assertFalse((self.root / "chat-temp" / handle).exists())

    def test_shutdown_removes_the_whole_chat_temp_folder(self):
        pdf = self.write("讲义.pdf", PDF)
        handle = self.add(pdf)["items"][0]["handle"]
        folder = self.root / "chat-temp" / handle
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "converted.pdf").write_bytes(PDF)
        self.temp.shutdown()
        self.assertFalse((self.root / "chat-temp").exists())

    def test_error_messages_never_contain_a_path(self):
        paths = [
            self.write("坏.pdf", b"nope"),
            self.files / "not-there.pdf",
            r"\\?\C:\Windows\notepad.exe",
        ]
        for path in paths:
            result = self.add(path)
            for item in result["rejected"]:
                self.assertNotIn(str(self.files), item["error"])
                self.assertNotIn("C:\\Windows", item["error"])


class TempHttpTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        base = Path(self.tmp.name)
        self.root = base / "data"
        self.files = base / "files"
        self.files.mkdir()
        self.pdf = self.files / "讲义.pdf"
        self.pdf.write_bytes(PDF)
        self.gui = AsyncMock(return_value=[str(self.pdf)])
        self.service = DesktopService(self.root, self.root, self.gui)
        await self.service.start()
        self.addAsyncCleanup(self.service.close)
        self.client = ClientSession()
        self.addAsyncCleanup(self.client.close)
        self.headers = {"Origin": self.service.origin, "X-Kaizhi-Token": self.service.token}

    async def call(self, name, args=None, headers=None):
        async with self.client.post(
            self.service.origin + "/api/" + name, headers=headers or self.headers, json=args or {}
        ) as response:
            body = await response.read()
            if response.content_type == "application/octet-stream":
                return response.status, body
            if response.content_type != "application/json":
                return response.status, body.decode("utf-8", "replace")
            return response.status, await response.json()

    async def test_pick_read_and_release_over_http(self):
        status, picked = await self.call("temp_doc_pick", {"limit": 1})
        self.assertEqual(status, 200, picked)
        self.assertEqual(len(picked["items"]), 1)
        self.assertEqual(picked["items"][0]["name"], "讲义.pdf")
        handle = picked["items"][0]["handle"]
        self.assertNotIn("path", picked["items"][0])

        status, catalog = await self.call("temp_doc_prepare", {"handle": handle})
        self.assertEqual((status, catalog["kind"]), (200, "pdf"))
        status, data = await self.call("temp_doc_read", {"handle": handle})
        self.assertEqual((status, data), (200, PDF))
        status, released = await self.call("temp_doc_release", {"handles": [handle]})
        self.assertEqual((status, released), (200, {"released": 1}))

    async def test_temp_commands_need_the_token(self):
        for command in ("temp_doc_pick", "temp_doc_prepare", "temp_doc_read", "temp_doc_release"):
            status, _ = await self.call(command, {}, headers={"Origin": self.service.origin})
            self.assertEqual(status, 403, command)

    async def test_pick_cancel_returns_empty_lists(self):
        self.gui.return_value = None
        status, picked = await self.call("temp_doc_pick", {"limit": 2})
        self.assertEqual(status, 200)
        self.assertEqual(picked, {"items": [], "rejected": []})

    async def test_prepare_progress_reaches_the_event_channel(self):
        docx = self.files / "大纲.docx"
        docx.write_bytes(DOCX)
        self.gui.return_value = [str(docx)]
        _, picked = await self.call("temp_doc_pick", {"limit": 1})
        handle = picked["items"][0]["handle"]
        ws = await self.client.ws_connect(self.service.origin + "/events", origin=self.service.origin)
        self.addAsyncCleanup(ws.close)
        await ws.send_str(self.service.token)
        self.assertEqual(await ws.receive_json(timeout=3), {"ready": True})

        def fake_render(source, cache, progress=None):
            cache.mkdir(parents=True, exist_ok=True)
            if progress:
                progress("office")
            dest = Path(cache) / "converted.pdf"
            dest.write_bytes(PDF)
            return dest

        channel = "channel-1"
        with patch.object(tempdocs.word, "render", fake_render):
            status, prepared = await self.call(
                "temp_doc_prepare", {"handle": handle, "onProgress": channel}
            )
        self.assertEqual((status, prepared["kind"]), (200, "pdf"))
        event = await ws.receive_json(timeout=3)
        self.assertEqual(event, {"channel": channel, "event": {"stage": "office"}})

    async def test_clear_releases_every_handle(self):
        _, picked = await self.call("temp_doc_pick", {"limit": 1})
        handle = picked["items"][0]["handle"]
        self.assertIn(handle, self.service.temp._handles)
        await self.service.clear()
        self.assertEqual(self.service.temp._handles, {})
        self.assertFalse((self.root / "chat-temp" / handle).exists())
