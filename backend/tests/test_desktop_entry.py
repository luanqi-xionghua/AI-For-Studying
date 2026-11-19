"""An ordinary WebEngine page must not start a second, browser-only reader."""

import functools
import json
import threading
import unittest
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from PySide6.QtCore import QEventLoop, QTimer, QUrl
from PySide6.QtWebEngineCore import QWebEnginePage, QWebEngineProfile
from PySide6.QtWidgets import QApplication

from backend.core.desktop import startup_canvas


DIST = Path(__file__).resolve().parents[2] / 'frontend' / 'dist'


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


    def test_delayed_preferences_never_mount_a_default_shell(self):
        requested, release = threading.Event(), threading.Event()
        observed = []

        class Handler(SimpleHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                self.rfile.read(int(self.headers.get('Content-Length', 0)))
                value = None
                if self.path == '/api/get_startup_settings':
                    requested.set()
                    release.wait(10)
                    saved = {'appearance': {'style': 'sketch', 'theme': 'dark'}}
                    value = dict(stored=json.dumps(saved), legacyTheme=None, fresh=False)
                elif self.path == '/api/list_documents':
                    value = []
                payload = json.dumps(value).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

        app = QApplication.instance() or QApplication([])
        profile = QWebEngineProfile(app)
        page = QWebEnginePage(profile)
        loop, poll, deadline = QEventLoop(), QTimer(), QTimer()
        deadline.setSingleShot(True)
        deadline.timeout.connect(loop.quit)
        busy = False

        def checked(raw):
            nonlocal busy
            busy = False
            if not raw:
                return
            snapshot = json.loads(raw)
            if not release.is_set():
                observed.append(snapshot)
                release.set()
            elif snapshot[0]:
                observed.append(snapshot)
                loop.quit()

        def probe():
            nonlocal busy
            if busy or not requested.is_set():
                return
            busy = True
            page.runJavaScript("""(() => {
                if (!('startupTransitions' in window)) {
                    window.startupTransitions = 0;
                    const start = document.startViewTransition?.bind(document);
                    if (start) document.startViewTransition = (...args) => {
                        window.startupTransitions++; return start(...args);
                    };
                }
                const d = document.documentElement.dataset;
                return JSON.stringify([!!document.querySelector('.app-shell'), d.style, d.theme, window.startupTransitions]);
            })()""", 0, checked)

        poll.timeout.connect(probe)
        handler = functools.partial(Handler, directory=str(DIST))
        with ThreadingHTTPServer(('127.0.0.1', 0), handler) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                poll.start(40)
                deadline.start(15000)
                page.setUrl(QUrl(f'http://127.0.0.1:{server.server_port}/#desktop=' + 'a' * 48))
                loop.exec()
            finally:
                poll.stop()
                deadline.stop()
                release.set()
                server.shutdown()
                thread.join()
                del page
                del profile
        self.assertEqual(observed, [[False, None, None, 0], [True, 'sketch', 'dark', 0]])


class NativeCanvasTests(unittest.TestCase):
    def test_new_legacy_custom_and_system_themes(self):
        def canvas(saved=None, legacy=None, fresh=False, dark=False):
            return startup_canvas(dict(stored=saved, legacyTheme=legacy, fresh=fresh), dark)
        self.assertEqual(canvas(fresh=True), '#f5f4ed')
        self.assertEqual(canvas(fresh=True, dark=True), '#262624')
        self.assertEqual(canvas(legacy='dark'), '#1f2427')
        self.assertEqual(canvas('invalid json'), '#f6f8f8')
        self.assertEqual(canvas('{"appearance":{"theme":"light","style":"sketch"}}', dark=True), '#efe9db')
        self.assertEqual(canvas('{"appearance":{"theme":"dark","style":"crystal"}}'), '#1f2427')
