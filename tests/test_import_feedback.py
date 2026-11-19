"""Per-file import errors, Word conversion reasons and progress stages (no Office needed)."""

import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import word
from backend.library import Library


class ImportErrorTests(unittest.TestCase):
    def setUp(self):
        td = tempfile.TemporaryDirectory()
        self.addCleanup(td.cleanup)
        self.root = Path(td.name)
        self.lib = Library(self.root / "data")

    def reason(self, path):
        with self.assertRaises(ValueError) as caught:
            self.lib.import_documents([str(path)])
        return str(caught.exception)

    def test_reasons_name_the_problem(self):
        self.assertIn("找不到这个文件", self.reason(self.root / "missing.pdf"))
        text = self.root / "notes.txt"
        text.write_text("x", encoding="utf-8")
        self.assertIn("不支持 .txt 文件", self.reason(text))
        fake = self.root / "fake.docx"
        fake.write_bytes(b"not a zip")
        self.assertIn("不是有效的 .docx 文件", self.reason(fake))
        gbk = self.root / "旧编码.md"
        gbk.write_bytes("中文笔记".encode("gbk"))
        self.assertIn("不是 UTF-8 编码", self.reason(gbk))
        self.assertEqual(self.lib.list_documents(), [])

    def test_progress_reports_adding(self):
        md = self.root / "笔记.md"
        md.write_text("内容", encoding="utf-8")
        events = []
        (d,) = self.lib.import_documents([str(md)], onProgress=events.append)
        self.assertEqual(events, [{"stage": "adding"}])
        self.assertEqual(d["kind"], "markdown")

    def test_word_stages_reach_progress(self):
        docx = self.root / "报告.docx"
        docx.write_bytes(b"PK\x03\x04synthetic")
        pdf = self.root / "converted.pdf"
        pdf.write_bytes(b"%PDF-1.7 synthetic")
        events = []

        def fake_render(source, cache, progress=None):
            progress("office")
            return pdf

        with patch.object(word, "render", side_effect=fake_render):
            (d,) = self.lib.import_documents([str(docx)], onProgress=events.append)
        self.assertEqual(
            events,
            [{"stage": "office", "path": str(docx.resolve())}, {"stage": "adding"}],
        )
        self.assertEqual(d["kind"], "word")


class WordReasonTests(unittest.TestCase):
    """render() explains why conversion failed, without running Word or LibreOffice."""

    def setUp(self):
        td = tempfile.TemporaryDirectory()
        self.addCleanup(td.cleanup)
        self.root = Path(td.name)
        self.source = self.root / "合同.docx"
        self.source.write_bytes(b"PK\x03\x04synthetic")
        self.cache = self.root / "converted"

    def render(self, office_result, libreoffice=None):
        stages = []

        def child(args, timeout=word.TIMEOUT):
            if "--office" in args:
                if office_result == "timeout":
                    raise subprocess.TimeoutExpired(args, timeout)
                return office_result
            if libreoffice == "timeout":
                raise subprocess.TimeoutExpired(args, timeout)
            return 1  # LibreOffice ran but produced no PDF

        soffice = self.root / "soffice.exe"
        if libreoffice:
            soffice.write_bytes(b"")
        with (
            patch.object(word, "_child", side_effect=child),
            patch.object(
                word.shutil, "which", return_value=str(soffice) if libreoffice else None
            ),
            patch.dict(word.os.environ, {"ProgramFiles": str(self.root / "none")}),
            patch.dict(word.os.environ, {"ProgramFiles(x86)": str(self.root / "none")}),
            self.assertRaises(ValueError) as caught,
        ):
            word.render(self.source, self.cache, stages.append)
        return str(caught.exception), stages

    def test_no_converter_installed(self):
        message, stages = self.render(word.OFFICE_MISSING)
        self.assertIn("没有找到可用的 Word 或 WPS", message)
        self.assertIn("也没有找到 LibreOffice", message)
        self.assertEqual(stages, ["office"])

    def test_protected_or_damaged_document(self):
        message, stages = self.render(word.OFFICE_FAILED, libreoffice="fails")
        self.assertIn("可能设有打开密码，或文件已损坏", message)
        self.assertIn("改用 LibreOffice 也没能生成 PDF", message)
        self.assertEqual(stages, ["office", "libreoffice"])

    def test_timeouts_and_busy_office(self):
        message, _ = self.render("timeout", libreoffice="timeout")
        self.assertIn(f"超过 {word.TIMEOUT} 秒仍未完成转换", message)
        self.assertIn("LibreOffice 转换也超过了", message)
        message, _ = self.render(word.OFFICE_BUSY)
        self.assertIn("正开着别的文档", message)


if __name__ == "__main__":
    unittest.main()
