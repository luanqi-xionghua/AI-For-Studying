"""Opt-in real Office test using only a synthetic, temporary document."""

import hashlib
import os
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

from backend.library import Library


@unittest.skipUnless(
    os.environ.get("KAIZHI_TEST_OFFICE") == "1",
    "requires local Word, WPS or LibreOffice",
)
class WordTests(unittest.TestCase):
    def test_convert_cache_and_remove(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            src = root / "合成样本.docx"
            lib = Library(root / "data")
            with ZipFile(src, "w") as z:
                z.writestr(
                    "[Content_Types].xml",
                    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
                )
                z.writestr(
                    "_rels/.rels",
                    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
                )
                z.writestr(
                    "word/document.xml",
                    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Kaizhi synthetic test</w:t></w:r></w:p><w:sectPr/></w:body></w:document>',
                )
            digest = hashlib.sha256(src.read_bytes()).hexdigest()
            (d,) = lib.import_documents([str(src)])
            self.assertEqual(d["kind"], "word")
            pdf = lib.read_document(d["id"])
            self.assertTrue(pdf.startswith(b"%PDF-"))
            self.assertEqual(pdf, lib.read_document(d["id"]))
            lib.remove_document(d["id"])
            self.assertFalse(list(lib.converted.glob("*.pdf")))
            self.assertEqual(hashlib.sha256(src.read_bytes()).hexdigest(), digest)
