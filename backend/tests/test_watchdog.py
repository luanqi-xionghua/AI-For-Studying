"""1.2.8：渲染进程看护（崩溃重载、连续失败换新页面、主线程卡死判定）。"""

import functools
import json
import os
import signal
import tempfile
import threading
import time
import unittest
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from backend.core.desktop import Page, Watchdog


@unittest.skipIf(os.environ.get("KAIZHI_SKIP_QT_TESTS"), "Qt disabled")
class WatchdogTests(unittest.TestCase):
    """真实的 QtWebEngine 渲染进程：杀掉 → 重新加载；再杀 → 换新页面；死循环 → 判定卡死并恢复。"""

    def setUp(self):
        from PySide6.QtCore import Qt
        from PySide6.QtWebEngineCore import QWebEngineProfile
        from PySide6.QtWebEngineWidgets import QWebEngineView
        from PySide6.QtWidgets import QApplication

        self.app = QApplication.instance() or QApplication([])
        td = tempfile.TemporaryDirectory()
        self.addCleanup(td.cleanup)
        (Path(td.name) / "index.html").write_text("<!doctype html><title>t</title><p>ok</p>", "utf-8")

        class Quiet(SimpleHTTPRequestHandler):
            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=td.name))
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join)
        self.addCleanup(self.server.shutdown)
        origin = f"http://127.0.0.1:{self.server.server_port}"
        self.url = origin + "/#desktop=" + "t" * 48
        self.profile = QWebEngineProfile(self.app)  # off the record
        self.view = QWebEngineView()
        self.view.setAttribute(Qt.WidgetAttribute.WA_DontShowOnScreen)
        self.view.show()
        self.make_page = lambda: Page(self.profile, origin, self.view)
        self.view.setPage(self.make_page())
        self.events = []

        class Log:
            def write(_, source, event, level="info", **fields):
                self.events.append((event, fields.get("action") or fields.get("reason")))

        class FastWatchdog(Watchdog):
            BEAT_MS = 150
            HANG_BEATS = 6

        self.watchdog = FastWatchdog(self.view, self.url, self.make_page, Log())
        self.addCleanup(self.teardown_view)

    def teardown_view(self):
        self.watchdog.stop()
        self.view.close()
        self.view.page().deleteLater()
        self.view.deleteLater()
        self.app.processEvents()

    def spin(self, predicate, timeout=20):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            self.app.processEvents()
            if predicate():
                return True
            time.sleep(0.02)
        return False

    def js(self, source, timeout=10):
        box = []
        self.view.page().runJavaScript(source, 0, box.append)
        self.assertTrue(self.spin(lambda: bool(box), timeout), f"no answer to {source}")
        return box[0]

    def loaded(self):
        self.assertTrue(self.spin(lambda: self.watchdog.loaded and self.view.page().renderProcessPid() > 0))

    def kill(self):
        os.kill(self.view.page().renderProcessPid(), signal.SIGTERM)

    def test_crash_reload_then_rebuild_then_hang(self):
        self.view.setUrl(__import__("PySide6.QtCore", fromlist=["QUrl"]).QUrl(self.url))
        self.loaded()
        self.assertFalse(self.js("window.__KAIZHI_RECOVERED__ || null"))
        first = self.view.page()
        self.kill()
        self.assertTrue(self.spin(lambda: ("renderer-recover", "reload") in self.events))
        self.loaded()
        self.assertIs(self.view.page(), first, "第一次只就地重新加载")
        marker = json.loads(self.js("JSON.stringify(window.__KAIZHI_RECOVERED__)"))
        self.assertEqual(marker["action"], "reload")
        self.assertIn(marker["reason"], ("killed", "crashed", "abnormal"))  # Windows 上外部结束常报成 crashed
        self.kill()
        self.assertTrue(self.spin(lambda: ("renderer-recover", "rebuild") in self.events))
        self.assertTrue(self.spin(lambda: self.view.page() is not first))
        self.loaded()
        self.assertIn('"action":"rebuild"', self.js("JSON.stringify(window.__KAIZHI_RECOVERED__)"))
        self.assertEqual(self.js("location.hash"), "#desktop=" + "t" * 48, "新页面带着 token 重新进入")
        # 主线程死循环：心跳收不到回音 → 判定无响应 → 结束渲染进程 → 恢复。
        self.view.page().runJavaScript("setTimeout(() => { for (;;) {} }, 0)", 0, lambda _: None)
        self.assertTrue(self.spin(lambda: any(e[0] == "renderer-unresponsive" for e in self.events), 30))
        self.loaded()
        self.assertEqual(self.js("1 + 1"), 2)
        self.assertIn('"reason":"unresponsive"', self.js("JSON.stringify(window.__KAIZHI_RECOVERED__)"))

    def test_open_js_dialog_is_not_a_hang(self):
        page = self.view.page()
        self.view.setUrl(__import__("PySide6.QtCore", fromlist=["QUrl"]).QUrl(self.url))
        self.loaded()
        page.dialogs = 1  # 相当于 confirm() 正挂着渲染线程
        page.runJavaScript("setTimeout(() => { const end = Date.now() + 2500; while (Date.now() < end) {} }, 0)", 0, lambda _: None)
        self.spin(lambda: False, 3.5)
        page.dialogs = 0
        self.assertFalse(any(e[0] == "renderer-unresponsive" for e in self.events), self.events)
        self.assertEqual(self.js("2 + 2"), 4)


if __name__ == "__main__":
    unittest.main()
