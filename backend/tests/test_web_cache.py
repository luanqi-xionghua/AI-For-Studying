"""1.2.8：升级后按版本清理 web-cache。"""

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import VERSION
from backend.core.desktop import purge_web_cache


class WebCacheTests(unittest.TestCase):
    def setUp(self):
        td = tempfile.TemporaryDirectory()
        self.addCleanup(td.cleanup)
        self.root = Path(td.name)

    def test_purges_once_per_version_and_keeps_user_data(self):
        cache = self.root / "web-cache" / "Cache" / "Cache_Data"
        cache.mkdir(parents=True)
        (cache / "data_1").write_bytes(b"stale index.html")
        web = self.root / "web" / "Local Storage"
        web.mkdir(parents=True)
        (web / "leveldb").write_bytes(b"user state")
        (self.root / "library.sqlite3").write_bytes(b"db")
        self.assertEqual(purge_web_cache(self.root, "1.2.8"), "purged")
        self.assertFalse((self.root / "web-cache").exists())
        self.assertEqual((self.root / "web" / "Local Storage" / "leveldb").read_bytes(), b"user state")
        self.assertEqual((self.root / "library.sqlite3").read_bytes(), b"db")
        self.assertEqual((self.root / "web-cache.version").read_text("utf-8"), "1.2.8")
        self.assertEqual(list(self.root.glob("web-cache.old-*")), [])
        # 同一版本再次启动：不动 Chromium 新建的缓存。
        (self.root / "web-cache").mkdir()
        (self.root / "web-cache" / "fresh").write_bytes(b"x")
        self.assertEqual(purge_web_cache(self.root, "1.2.8"), "kept")
        self.assertTrue((self.root / "web-cache" / "fresh").exists())
        # 换版本（含降级）再清一次。
        self.assertEqual(purge_web_cache(self.root, "1.2.9"), "purged")
        self.assertFalse((self.root / "web-cache").exists())

    def test_fresh_data_dir_and_locked_cache(self):
        self.assertEqual(purge_web_cache(self.root, VERSION), "fresh")
        self.assertEqual((self.root / "web-cache.version").read_text("utf-8"), VERSION)
        (self.root / "web-cache.version").write_text("0.0.1", "utf-8")
        (self.root / "web-cache").mkdir()
        with patch.object(Path, "rename", side_effect=PermissionError("in use")):
            self.assertEqual(purge_web_cache(self.root, VERSION), "locked")
        # 删不掉就保留原样、不写版本戳，下次启动再试。
        self.assertTrue((self.root / "web-cache").exists())
        self.assertEqual((self.root / "web-cache.version").read_text("utf-8"), "0.0.1")
        self.assertEqual(purge_web_cache(self.root, VERSION), "purged")


if __name__ == "__main__":
    unittest.main()
