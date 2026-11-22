import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from aiohttp import ClientSession

from backend.api import server
from backend.api.server import DesktopService
from backend.services.exams import (
    ExamError, ExamExports, MAX_BYTES, encode_markdown, resolve_destination, suggested_filename, write_atomic,
)
from backend.services.library import Library

MARKDOWN = "# 模拟测试：高等数学（上）\n\n## 成绩概览\n\n| 项目 | 值 |\n| --- | --- |\n| 总分 | 10 / 200 |\n"


class ExamUnitTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        base = Path(self.tmp.name)
        self.root = base / "data"
        self.files = base / "files"
        self.files.mkdir()
        self.lib = Library(self.root)
        self.exports = ExamExports(self.lib)

    def test_suggested_filename_strips_extension_and_illegal_characters(self):
        self.assertEqual(suggested_filename("高等数学（上）.pdf", "2026-11-22"), "模拟测试-高等数学（上）-2026-11-22.md")
        self.assertEqual(suggested_filename("a/b:c?.md", "2026-11-22"), "模拟测试-a_b_c_-2026-11-22.md")
        self.assertNotIn("/", suggested_filename("a/b", "2026-11-22"))

    def test_reserved_names_and_empty_titles(self):
        self.assertEqual(suggested_filename("CON", "2026-11-22"), "模拟测试-_CON-2026-11-22.md")
        self.assertEqual(suggested_filename("", "2026-11-22"), "模拟测试-未命名-2026-11-22.md")
        self.assertEqual(suggested_filename("   ", "2026-11-22"), "模拟测试-未命名-2026-11-22.md")

    def test_encode_markdown_rejects_empty_large_and_nul(self):
        with self.assertRaises(ExamError) as empty:
            encode_markdown("   ")
        self.assertEqual(empty.exception.code, "EXAM_EMPTY")
        with self.assertRaises(ExamError) as nul:
            encode_markdown("a\x00b")
        self.assertEqual(nul.exception.code, "EXAM_ENCODING")
        with patch("backend.services.exams.MAX_BYTES", 4):
            with self.assertRaises(ExamError) as large:
                encode_markdown("12345")
        self.assertEqual(large.exception.code, "EXAM_TOO_LARGE")
        with self.assertRaises(ExamError):
            encode_markdown(123)

    def test_destination_appends_md_and_rejects_bad_locations(self):
        dest = resolve_destination(str(self.files / "试卷"), self.root)
        self.assertEqual(dest.name, "试卷.md")
        with self.assertRaises(ExamError) as inside:
            resolve_destination(str(self.root / "试卷.md"), self.root)
        self.assertEqual(inside.exception.code, "EXAM_LOCATION")
        with self.assertRaises(ExamError) as missing:
            resolve_destination(str(self.files / "nodir" / "a.md"), self.root)
        self.assertEqual(missing.exception.code, "EXAM_DIR")
        folder = self.files / "folder.md"
        folder.mkdir()
        with self.assertRaises(ExamError) as not_file:
            resolve_destination(str(folder), self.root)
        self.assertEqual(not_file.exception.code, "EXAM_NOT_FILE")
        with self.assertRaises(ExamError) as relative:
            resolve_destination("a.md", self.root)
        self.assertEqual(relative.exception.code, "EXAM_ARGS")

    def test_atomic_write_leaves_no_temporary_file(self):
        dest = self.files / "a.md"
        write_atomic(dest, MARKDOWN.encode("utf-8"))
        self.assertEqual(dest.read_text(encoding="utf-8"), MARKDOWN)
        self.assertEqual([item.name for item in self.files.iterdir()], ["a.md"])

    def test_export_imports_markdown_and_reuses_id_on_second_export(self):
        dest = self.files / "试卷.md"
        first = self.exports.export(str(dest), MARKDOWN)
        self.assertEqual(first["document"]["kind"], "markdown")
        self.assertEqual(first["name"], "试卷.md")
        self.assertTrue(dest.is_file())
        second = self.exports.export(str(dest), MARKDOWN + "\n\n补充一行\n")
        self.assertEqual(second["document"]["id"], first["document"]["id"])
        self.assertEqual(len(self.lib.list_documents()), 1)

    def test_permission_error_maps_to_exam_denied(self):
        with patch("backend.services.exams.os.replace", side_effect=PermissionError):
            with self.assertRaises(ExamError) as denied:
                self.exports.export(str(self.files / "a.md"), MARKDOWN)
        self.assertEqual(denied.exception.code, "EXAM_DENIED")
        self.assertEqual([item.name for item in self.files.iterdir()], [])

    def test_import_failure_maps_to_exam_import_and_keeps_the_file(self):
        with patch.object(self.lib, "import_documents", side_effect=ValueError("x")):
            with self.assertRaises(ExamError) as failed:
                self.exports.export(str(self.files / "a.md"), MARKDOWN)
        self.assertEqual(failed.exception.code, "EXAM_IMPORT")
        self.assertTrue((self.files / "a.md").is_file())

    def test_error_messages_never_contain_a_path(self):
        errors = []
        for raw in ["", "a.md", str(self.root / "x.md"), str(self.files / "nodir" / "x.md")]:
            try:
                resolve_destination(raw, self.root)
            except ExamError as error:
                errors.append(str(error))
        for message in errors:
            self.assertNotIn(str(self.files), message)
            self.assertNotIn(str(self.root), message)
        self.assertTrue(errors)


class ExamHttpTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        base = Path(self.tmp.name)
        self.root = base / "data"
        self.files = base / "files"
        self.files.mkdir()
        self.dest = self.files / "导出的试卷.md"
        self.gui = AsyncMock(return_value=str(self.dest))
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
            if response.content_type == "application/json":
                return response.status, await response.json()
            return response.status, await response.text()

    async def test_export_over_http_returns_the_document(self):
        status, body = await self.call("exam_export", {"markdown": MARKDOWN, "title": "高等数学（上）.pdf"})
        self.assertEqual(status, 200, body)
        self.assertEqual(body["name"], "导出的试卷.md")
        self.assertEqual(body["bytes"], len(MARKDOWN.encode("utf-8")))
        self.assertEqual(body["document"]["kind"], "markdown")
        self.assertTrue(self.dest.is_file())
        self.gui.assert_awaited_once()
        name = self.gui.await_args.args[1]["name"]
        self.assertTrue(name.startswith("模拟测试-高等数学（上）-"))
        self.assertTrue(name.endswith(".md"))

    async def test_cancel_returns_cancelled(self):
        self.gui.return_value = ""
        status, body = await self.call("exam_export", {"markdown": MARKDOWN, "title": "x"})
        self.assertEqual((status, body), (200, {"cancelled": True}))
        self.assertFalse(self.dest.exists())

    async def test_oversized_markdown_fails_before_the_dialog(self):
        with patch("backend.services.exams.MAX_BYTES", 10):
            status, body = await self.call("exam_export", {"markdown": MARKDOWN, "title": "x"})
        self.assertEqual(status, 400)
        self.assertIn("EXAM_TOO_LARGE", body["error"])
        self.gui.assert_not_awaited()

    async def test_unknown_arguments_are_rejected(self):
        status, body = await self.call("exam_export", {"markdown": MARKDOWN, "title": "x", "path": "/tmp/a.md"})
        self.assertEqual(status, 400)
        self.assertIn("EXAM_ARGS", body["error"])
        self.gui.assert_not_awaited()

    async def test_export_needs_the_token(self):
        status, _ = await self.call("exam_export", {"markdown": MARKDOWN, "title": "x"}, headers={"Origin": self.service.origin})
        self.assertEqual(status, 403)

    async def test_dialog_is_not_exposed_to_the_page(self):
        self.assertNotIn("select_exam_export", server.GUI)
        status, _ = await self.call("select_exam_export", {"name": "a.md"})
        self.assertEqual(status, 404)
        self.assertNotIn("exam_export", server.DATA)
        self.assertNotIn("exam_export", server.GUI)
        self.assertIn("exam_export", server.EXAM)
