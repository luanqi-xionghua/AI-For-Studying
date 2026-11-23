"""1.2.8：关窗前先让页面把防抖中的保存写完；页面卡死也照样按时关窗。"""

import functools
import tempfile
import threading
import time
import unittest
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from backend.core.desktop import QuitFlush

PAGES = {
    "slow.html": "<script>window.__kaizhiBeforeQuit = () => new Promise(r => setTimeout(() => fetch('/flushed').finally(r), 300))</script>",
    "hung.html": "<script>window.__kaizhiBeforeQuit = () => { for (;;) {} }</script>",
    "none.html": "<p>no hook</p>",
}


class QuitFlushTests(unittest.TestCase):
    def setUp(self):
        from PySide6.QtWidgets import QApplication

        self.app = QApplication.instance() or QApplication([])
        td = tempfile.TemporaryDirectory()
        self.addCleanup(td.cleanup)
        for name, body in PAGES.items():
            Path(td.name, name).write_text("<!doctype html>" + body, "utf-8")
        self.requests = []
        requests = self.requests

        class Recorder(SimpleHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                requests.append((time.monotonic(), self.path))
                return super().do_GET()

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Recorder, directory=td.name))
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(thread.join)
        self.addCleanup(self.server.shutdown)

    def spin(self, seconds, until):
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            self.app.processEvents()
            if until():
                return True
            time.sleep(0.02)
        return False

    def open(self, name, timeout_ms):
        from PySide6.QtCore import Qt, QUrl
        from PySide6.QtWebEngineCore import QWebEnginePage, QWebEngineProfile
        from PySide6.QtWebEngineWidgets import QWebEngineView

        profile = QWebEngineProfile(self.app)
        view = QWebEngineView()
        view.setAttribute(Qt.WidgetAttribute.WA_DontShowOnScreen)
        page = QWebEnginePage(profile, view)
        view.setPage(page)
        view.show()
        flush = QuitFlush(view, timeout_ms=timeout_ms)
        loaded = []
        page.loadFinished.connect(loaded.append)
        page.setUrl(QUrl(f"http://127.0.0.1:{self.server.server_port}/{name}"))
        self.assertTrue(self.spin(10, lambda: bool(loaded)))
        self.addCleanup(lambda: (view.deleteLater(), self.app.processEvents()))
        return view, flush

    def test_close_waits_for_the_page_to_flush(self):
        view, flush = self.open("slow.html", 3000)
        asked = time.monotonic()
        view.close()
        self.assertTrue(view.isVisible(), "第一次关窗先拦下，等页面保存")
        self.assertTrue(self.spin(5, lambda: not view.isVisible()))
        closed = time.monotonic()
        flushed = [at for at, path in self.requests if path == "/flushed"]
        self.assertEqual(len(flushed), 1, "页面的保存在关窗前完成")
        self.assertLess(flushed[0], closed)
        self.assertLess(closed - asked, 2.5)

    def test_hung_page_still_closes_on_time(self):
        view, flush = self.open("hung.html", 800)
        asked = time.monotonic()
        view.close()
        self.assertTrue(self.spin(5, lambda: not view.isVisible()), "页面卡死也要按时关窗")
        self.assertLess(time.monotonic() - asked, 2.5)

    def test_page_without_hook_closes_promptly(self):
        view, flush = self.open("none.html", 3000)
        asked = time.monotonic()
        view.close()
        self.assertTrue(self.spin(5, lambda: not view.isVisible()))
        self.assertLess(time.monotonic() - asked, 1.0)


if __name__ == "__main__":
    unittest.main()
