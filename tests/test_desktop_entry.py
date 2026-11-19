"""An ordinary WebEngine page must not start a second, browser-only reader."""

import functools
import threading
import unittest
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from PySide6.QtCore import QEventLoop, QTimer, QUrl
from PySide6.QtWebEngineCore import QWebEnginePage, QWebEngineProfile
from PySide6.QtWidgets import QApplication


DIST = Path(__file__).resolve().parents[1] / 'frontend' / 'dist'


@unittest.skipUnless((DIST / 'index.html').is_file(), 'build frontend first')
class DesktopEntryTests(unittest.TestCase):
    def test_page_without_desktop_token_only_shows_launch_hint(self):
        requests = []

        class Handler(SimpleHTTPRequestHandler):
            def log_request(self, code='-', size='-'):
                requests.append(self.path)

        app = QApplication.instance() or QApplication([])
        profile = QWebEngineProfile(app)  # off the record: never read the user's profile
        page = QWebEnginePage(profile)
        loop = QEventLoop()
        checks = []

        def checked(result):
            checks.append(result)
            loop.quit()

        def loaded(ok):
            if not ok:
                checked(False)
                return
            page.runJavaScript("""Boolean(document.querySelector('#app')?.textContent.includes('Start.cmd')
                && !document.querySelector('.app-shell') && !window.__KAIZHI_PYTHON__)""", 0, checked)

        timer = QTimer()
        timer.setSingleShot(True)
        timer.timeout.connect(loop.quit)
        page.loadFinished.connect(loaded)
        handler = functools.partial(Handler, directory=str(DIST))
        with ThreadingHTTPServer(('127.0.0.1', 0), handler) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                timer.start(15000)
                page.setUrl(QUrl(f'http://127.0.0.1:{server.server_port}/'))  # no secret fragment
                loop.exec()
            finally:
                timer.stop()
                server.shutdown()
                thread.join()
                del page
                del profile
        self.assertEqual(checks, [True])
        self.assertFalse(any(p.startswith(('/api/', '/events')) for p in requests), requests)
