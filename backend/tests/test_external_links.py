"""1.2.8：target=_blank 的链接（AI 回答、Markdown 文档、PDF 链接注释）用系统浏览器打开。

以前 Page 没接 newWindowRequested，真实鼠标点击这类链接没有任何反应；不带 target 的链接
走 acceptNavigationRequest，一直是好的（这里当对照）。只放行 http(s)。
"""

import functools
import tempfile
import threading
import time
import unittest
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from backend.core import desktop

PAGE = (
    '<!doctype html><body style="margin:0">'
    '<a target="_blank" rel="noopener noreferrer" href="https://example.invalid/answer" style="display:block;width:300px;height:60px">blank</a>'
    '<a target="_blank" href="file:///C:/Windows/win.ini" style="display:block;width:300px;height:60px;margin-top:20px">file</a>'
    '<a href="https://example.invalid/same" style="display:block;width:300px;height:60px;margin-top:20px">same</a>'
    "</body>"
)


class ExternalLinkTests(unittest.TestCase):
    def test_blank_links_open_in_the_system_browser(self):
        from PySide6.QtCore import QPoint, Qt, QUrl
        from PySide6.QtTest import QTest
        from PySide6.QtWebEngineCore import QWebEngineProfile
        from PySide6.QtWebEngineWidgets import QWebEngineView
        from PySide6.QtWidgets import QApplication

        app = QApplication.instance() or QApplication([])
        with tempfile.TemporaryDirectory() as td:
            Path(td, "index.html").write_text(PAGE, "utf-8")

            class Quiet(SimpleHTTPRequestHandler):
                def log_message(self, *args):
                    pass

            server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory=td))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            origin = f"http://127.0.0.1:{server.server_port}"
            profile = QWebEngineProfile(app)
            view = QWebEngineView()
            view.setAttribute(Qt.WidgetAttribute.WA_DontShowOnScreen)
            view.resize(600, 400)
            page = desktop.Page(profile, origin, view)
            view.setPage(page)
            view.show()
            opened = []

            def spin(seconds, until=lambda: False):
                end = time.monotonic() + seconds
                while time.monotonic() < end and not until():
                    app.processEvents()
                    time.sleep(0.02)

            try:
                with patch.object(desktop.QDesktopServices, "openUrl", side_effect=lambda url: opened.append(url.toString())):
                    loaded = []
                    page.loadFinished.connect(loaded.append)
                    page.setUrl(QUrl(origin + "/"))
                    spin(15, lambda: bool(loaded))
                    spin(0.6)
                    target = view.focusProxy() or view
                    for y, expect in ((30, 1), (110, 1), (190, 2)):
                        QTest.mouseClick(target, Qt.MouseButton.LeftButton, Qt.KeyboardModifier.NoModifier, QPoint(100, y))
                        spin(2, lambda expect=expect: len(opened) >= expect)
                        spin(0.3)
                    final_url = page.url().toString()
            finally:
                view.close()
                page.deleteLater()
                view.deleteLater()
                app.processEvents()
                server.shutdown()
                thread.join()
        self.assertEqual(opened, ["https://example.invalid/answer", "https://example.invalid/same"])
        self.assertEqual(final_url, origin + "/", "应用自己的页面不跳走")


if __name__ == "__main__":
    unittest.main()
