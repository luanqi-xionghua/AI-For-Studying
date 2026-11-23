"""1.2.8 Bug 2 回归：打开设置后，背景动画停下、界面不再持续重绘；关上后恢复。

用真实构建出来的前端（frontend/dist）和一个只回默认值的假后端，在不上屏的 QtWebEngine 视图里跑：
- 设置关着：背景画布每秒重画多次（动画在走）；
- 设置开着 2 秒：背景画布重画 ≤ 2 次、DOM 变更 ≤ 40 条（以前每秒 60 次全窗口重画，软件合成下掉到 5 帧，表现为整页一直闪）；
- 关上设置：背景接着动。
"""

import functools
import json
import threading
import time
import unittest
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"

SCENARIO = r"""
(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const draws = { main: 0 }
  const raw = CanvasRenderingContext2D.prototype.clearRect
  CanvasRenderingContext2D.prototype.clearRect = function (...args) {
    const host = this.canvas && this.canvas.closest && this.canvas.closest('.manifold-doodle')
    if (host && !host.classList.contains('preview')) draws.main++
    return raw.apply(this, args)
  }
  const sample = async ms => {
    draws.main = 0
    let muts = 0
    const mo = new MutationObserver(r => { muts += r.length })
    mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true })
    await wait(ms)
    mo.disconnect()
    return { draws: draws.main, muts }
  }
  for (let i = 0; i < 100 && !document.querySelector('.manifold-doodle canvas'); i++) await wait(100)
  await wait(1500)
  const before = await sample(1500)
  document.querySelector('.settings-button').click()
  for (let i = 0; i < 50 && !document.querySelector('.settings-dialog .style-card'); i++) await wait(100)
  await wait(900)
  const open = await sample(2000)
  const dialog = !!document.querySelector('.settings-dialog')
  document.querySelector('.settings-close').click()
  await wait(900)
  const after = await sample(1500)
  window.__settingsRender = { before, open, after, dialog }
})()
"""


@unittest.skipUnless((DIST / "index.html").is_file(), "build frontend first")
class SettingsRenderTests(unittest.TestCase):
    def test_background_stops_while_settings_are_open(self):
        from PySide6.QtCore import Qt, QUrl
        from PySide6.QtWebEngineCore import QWebEnginePage, QWebEngineProfile
        from PySide6.QtWebEngineWidgets import QWebEngineView
        from PySide6.QtWidgets import QApplication

        prefs = {"appearance": {"style": "warm", "theme": "light", "manifold": {"show": True, "reader": False}}}

        class Handler(SimpleHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                self.rfile.read(int(self.headers.get("Content-Length", 0)))
                value = None
                if self.path == "/api/get_startup_settings":
                    value = dict(stored=json.dumps(prefs), legacyTheme=None, fresh=False)
                elif self.path == "/api/list_documents":
                    value = []
                elif self.path == "/api/get_setting":
                    value = None
                payload = json.dumps(value).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

        app = QApplication.instance() or QApplication([])
        profile = QWebEngineProfile(app)  # off the record
        view = QWebEngineView()
        view.setAttribute(Qt.WidgetAttribute.WA_DontShowOnScreen)
        view.resize(1280, 800)
        page = QWebEnginePage(profile, view)
        view.setPage(page)
        view.show()  # 不上屏，但保持出帧与布局
        result = []
        handler = functools.partial(Handler, directory=str(DIST))
        with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                started = [False]
                page.loadFinished.connect(lambda ok: (started.__setitem__(0, ok), page.runJavaScript(SCENARIO, 0, lambda _: None)))
                page.setUrl(QUrl(f"http://127.0.0.1:{server.server_port}/#desktop=" + "s" * 48))
                end = time.monotonic() + 45
                polling = [False]

                def got(raw):
                    polling[0] = False
                    if raw:
                        result.append(json.loads(raw))

                while not result and time.monotonic() < end:
                    app.processEvents()
                    if started[0] and not polling[0]:
                        polling[0] = True
                        page.runJavaScript("window.__settingsRender ? JSON.stringify(window.__settingsRender) : ''", 0, got)
                    time.sleep(0.05)
            finally:
                server.shutdown()
                thread.join()
                view.close()
                page.deleteLater()
                view.deleteLater()
                app.processEvents()
        self.assertTrue(result, "场景没有跑完")
        r = result[0]
        self.assertTrue(r["dialog"], r)
        self.assertGreater(r["before"]["draws"], 10, f"设置关着时背景应在动：{r}")
        self.assertLessEqual(r["open"]["draws"], 2, f"设置开着时背景不应持续重画：{r}")
        self.assertLessEqual(r["open"]["muts"], 40, f"设置开着、无人操作时 DOM 不应持续变化：{r}")
        self.assertGreater(r["after"]["draws"], 10, f"关上设置后背景应恢复：{r}")


if __name__ == "__main__":
    unittest.main()
