"""1.2.8：本机滚动日志（脱敏、轮转、限速）与页面错误上报接口。"""

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock

from aiohttp import ClientSession

from backend.api.server import DesktopService
from backend.core.applog import AppLog, scrub


class AppLogTests(unittest.TestCase):
    def setUp(self):
        td = tempfile.TemporaryDirectory()
        self.addCleanup(td.cleanup)
        self.root = Path(td.name)

    def test_scrub_removes_secrets_and_home(self):
        token = "Q" * 54
        home = os.path.expanduser("~")
        text = (
            f"GET http://127.0.0.1:5/#desktop={token} Authorization: Bearer abcdefghijkl "
            f"key=sk-proj-0123456789abcdef {home}\\Documents\\书.pdf token={token[:20]} "
            f"AIzaSyA0123456789012345678901234567"
        )
        clean = scrub(text, [token])
        for secret in (token, "abcdefghijkl", "sk-proj-0123456789abcdef", home, "AIzaSyA0123"):
            self.assertNotIn(secret, clean)
        self.assertIn("~\\Documents\\书.pdf", clean)
        self.assertLessEqual(len(scrub("x" * 9000)), 2001)

    def test_rotation_throttle_and_close(self):
        log = AppLog(self.root, ["secret-token-value"], per_minute=5)
        for k in range(8):
            log.write("renderer", "error", "error", message=f"boom {k} secret-token-value")
        log.close()
        lines = (self.root / "logs" / "app.log").read_text("utf-8").splitlines()
        self.assertEqual(len(lines), 5, "每分钟超过上限的条目被丢弃")
        record = json.loads(lines[0])
        self.assertEqual((record["src"], record["event"], record["level"]), ("renderer", "error", "error"))
        self.assertNotIn("secret-token-value", "\n".join(lines))
        big = AppLog(self.root, per_minute=10**9)
        for k in range(5000):
            big.write("qt", "fill", message="yy " * 140)
        big.close()
        files = sorted(p.name for p in (self.root / "logs").iterdir())
        self.assertEqual(files, ["app.log", "app.log.1", "app.log.2", "app.log.3"])
        self.assertTrue(all((self.root / "logs" / f).stat().st_size <= 600 * 1024 for f in files))

    def test_unwritable_directory_never_raises(self):
        (self.root / "logs").write_bytes(b"not a directory")
        log = AppLog(self.root)
        self.assertFalse(log.write("qt", "start"))
        log.close()


class ClientLogEndpointTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.service = DesktopService(self.root, self.root, AsyncMock(return_value=False))
        await self.service.start()
        self.addAsyncCleanup(self.service.close)
        self.client = ClientSession()
        self.addAsyncCleanup(self.client.close)

    async def test_renderer_errors_reach_the_log_without_the_token(self):
        headers = {"Origin": self.service.origin, "X-Kaizhi-Token": self.service.token}
        body = {
            "kind": "chunk-load", "level": "error",
            "message": "Failed to fetch dynamically imported module: /assets/SettingsDialog-x.js",
            "page": f"{self.service.origin}/#desktop={self.service.token}",
            "line": 12, "evil": {"nested": True}, "source": "http://127.0.0.1:1/assets/a.js",
        }
        async with self.client.post(self.service.origin + "/api/client_log", json=body, headers=headers) as r:
            self.assertEqual(r.status, 200)
            self.assertIs(await r.json(), True)
        async with self.client.post(self.service.origin + "/api/client_log", json={"kind": "x"}, headers={}) as r:
            self.assertEqual(r.status, 403, "没有 token 不能写日志")
        self.service.log.close()
        text = (self.root / "logs" / "app.log").read_text("utf-8")
        self.assertIn("SettingsDialog-x.js", text)
        self.assertIn('"event": "chunk-load"', text)
        self.assertNotIn(self.service.token, text)
        self.assertNotIn("nested", text)
        self.assertIn('"source": "/assets/a.js"', text.replace("http://127.0.0.1:1", ""))
        self.assertNotIn("api-error", text, "页面字段名与 write() 形参重名时不能出错")


if __name__ == "__main__":
    unittest.main()
