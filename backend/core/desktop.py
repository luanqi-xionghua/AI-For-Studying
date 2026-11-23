import asyncio
import concurrent.futures
import json
import os
import shutil
import signal
import sys
import threading
import time
from pathlib import Path
from urllib.parse import urlsplit

from PySide6.QtCore import QEvent, QObject, Qt, QTimer, QUrl, Signal, Slot
from PySide6.QtGui import QColor, QDesktopServices, QIcon
from PySide6.QtWebEngineCore import QWebEnginePage, QWebEngineProfile, QWebEngineScript
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWidgets import QApplication, QFileDialog, QMessageBox

from .. import VERSION
from ..api.server import DesktopService, PortInUse


def startup_canvas(settings, system_dark):
    """Base canvas only; Vue owns the full theme, wallpaper, fonts and live previews."""
    try:
        appearance = json.loads(settings["stored"] or "{}").get("appearance", {})
    except (ValueError, AttributeError, RecursionError):
        appearance = {}
    if not isinstance(appearance, dict):
        appearance = {}
    style = "warm" if settings["fresh"] else appearance.get("style")
    theme = appearance.get("theme") or settings["legacyTheme"]
    dark = theme == "dark" if theme in ("light", "dark") else system_dark
    if style == "warm":
        return "#262624" if dark else "#f5f4ed"
    if style == "sketch":
        return "#22211e" if dark else "#efe9db"
    return "#1f2427" if dark else "#f6f8f8"


def purge_web_cache(root, version=VERSION):
    """升级（或降级）后第一次启动，先丢掉 Chromium 的 HTTP 缓存目录 web-cache。

    只动缓存：书库、设置、localStorage（web/）都不碰。≤1.2.7 写进缓存的 index.html 没有
    Cache-Control，会被启发式地当成“新鲜”继续使用，新版的缓存头来不及生效，所以要按版本清一次。
    必须在端口绑定成功（确认单实例）之后、创建 QWebEngineProfile 之前调用。
    返回 "fresh"（无缓存）/ "kept"（版本相同）/ "purged" / "locked"（删除失败，下次再试）。
    """
    root = Path(root)
    cache, stamp = root / "web-cache", root / "web-cache.version"
    try:
        if stamp.read_text("utf-8").strip() == version:
            return "kept"
    except OSError:
        pass
    state = "fresh"
    if cache.exists():
        # 先改名再删：改名是原子的，失败说明还有进程占着，就保留原样、不写版本戳，下次启动再试；
        # 改名成功后哪怕删不干净，Chromium 也只会看到一个全新的空目录。
        aside = root / f"web-cache.old-{os.getpid()}-{int(time.time())}"
        try:
            cache.rename(aside)
        except OSError:
            return "locked"
        shutil.rmtree(aside, ignore_errors=True)
        state = "purged"
    for leftover in root.glob("web-cache.old-*"):
        shutil.rmtree(leftover, ignore_errors=True)
    try:
        stamp.write_text(version, "utf-8")
    except OSError:
        pass
    return state


RECOVERED_SCRIPT = "kaizhi-recovered"


class Page(QWebEnginePage):
    def __init__(self, profile, origin, parent):
        super().__init__(profile, parent)
        self.origin = origin
        # 页面弹出 alert/confirm/prompt 时渲染线程是被它挂住的，看护不能把这当成“卡死”。
        self.dialogs = 0
        # target="_blank" 的链接（AI 回答、Markdown 文档、PDF 里的链接）走“新窗口”这条路，
        # 不经过 acceptNavigationRequest；不接这个信号时点了没有任何反应（1.2.8 实测）。
        self.newWindowRequested.connect(self.open_new_window_externally)

    def open_new_window_externally(self, request):
        url = request.requestedUrl()
        if url.scheme() in ("https", "http"):
            QDesktopServices.openUrl(url)
        # 不调用 request.openIn()：应用内不开第二个窗口。

    def javaScriptAlert(self, origin, msg):
        self.dialogs += 1
        try:
            return super().javaScriptAlert(origin, msg)
        finally:
            self.dialogs -= 1

    def javaScriptConfirm(self, origin, msg):
        self.dialogs += 1
        try:
            return super().javaScriptConfirm(origin, msg)
        finally:
            self.dialogs -= 1

    def javaScriptPrompt(self, origin, msg, default):
        self.dialogs += 1
        try:
            return super().javaScriptPrompt(origin, msg, default)
        finally:
            self.dialogs -= 1

    def acceptNavigationRequest(self, url, kind, is_main):
        u = urlsplit(url.toString())
        if u.scheme + "://" + u.netloc == self.origin and u.path in (
            "",
            "/",
            "/index.html",
        ):
            return True
        if (
            is_main
            and kind == QWebEnginePage.NavigationType.NavigationTypeLinkClicked
            and u.scheme in ("https", "http")
        ):
            QDesktopServices.openUrl(url)
        return False


class Gui(QObject):
    request = Signal(object)

    def __init__(self, view):
        super().__init__()
        self.view = view
        self.request.connect(self.handle)

    async def call(self, cmd, args):
        result = concurrent.futures.Future()
        self.request.emit((cmd, args, result))
        return await asyncio.wrap_future(result)

    @Slot(object)
    def handle(self, msg):
        cmd, args, f = msg
        try:
            if cmd == "select_files":
                title = args.get("title", "添加文档")
                file_filter = "文档 (*.pdf *.md *.markdown *.mdown *.docx *.doc)"
                if args.get("multiple", True):
                    value = QFileDialog.getOpenFileNames(
                        self.view, title, "", file_filter
                    )[0]
                else:
                    value = QFileDialog.getOpenFileName(
                        self.view, title, "", file_filter
                    )[0]
            elif cmd == "select_backup_destination":
                value = QFileDialog.getSaveFileName(
                    self.view,
                    "备份文档库",
                    str(Path.home() / "Documents" / "阅迁星穹文档库备份.sqlite3"),
                    "SQLite 文档库备份 (*.sqlite3)",
                )[0]
            elif cmd == "select_backup_source":
                value = QFileDialog.getOpenFileName(
                    self.view,
                    "选择文档库备份",
                    str(Path.home() / "Documents"),
                    "SQLite 文档库备份 (*.sqlite3)",
                )[0]
            elif cmd == "select_exam_export":
                name = str(args.get("name") or "模拟测试.md")[:120]
                value = QFileDialog.getSaveFileName(
                    self.view,
                    "导出模拟测试",
                    str(Path.home() / "Documents" / name),
                    "Markdown 文档 (*.md)",
                )[0]
            elif cmd == "set_fullscreen":
                if args["value"]:
                    self.view.showFullScreen()
                else:
                    self.view.showMaximized()
                value = None
            elif cmd == "is_fullscreen":
                value = self.view.isFullScreen()
            elif cmd == "quit":
                value = None
                QTimer.singleShot(300, QApplication.quit)
            else:
                raise ValueError("未知窗口操作")
            if not f.done():
                f.set_result(value)
        except Exception as e:
            if not f.done():
                f.set_exception(e)


class DropFilter(QObject):
    def __init__(self, view):
        super().__init__(view)
        self.view = view

    def eventFilter(self, obj, ev):
        types = {
            QEvent.Type.DragEnter: "enter",
            QEvent.Type.DragLeave: "leave",
            QEvent.Type.Drop: "drop",
            QEvent.Type.DragMove: "move",
        }
        if ev.type() not in types or not obj.isWidgetType():
            return False
        if obj != self.view and not self.view.isAncestorOf(obj):
            return False
        k = types[ev.type()]
        paths = (
            []
            if k == "leave"
            else [u.toLocalFile() for u in ev.mimeData().urls() if u.isLocalFile()]
        )
        if not paths and k != "leave":
            return False
        if k != "leave":
            ev.acceptProposedAction()
        if k != "move":
            self.view.page().runJavaScript(
                'window.dispatchEvent(new CustomEvent("kaizhi:native-drop",{detail:'
                + json.dumps({"type": k, "paths": paths})
                + "}))"
            )
        return True


class Watchdog(QObject):
    """渲染进程看护。

    - 渲染进程异常退出（崩溃、被杀、异常终止）：第一次就地重新加载；
    - 两分钟内再次出事：丢掉这张页面，换一张新的 QWebEnginePage（新的渲染进程）重新打开；
    - 两分钟内累计 4 次仍不行：停手并记日志，避免无限重启；
    - 页面主线程卡死：每 5 秒用 runJavaScript 问一次，连续 9 次（约 45 秒活动时间）没回音，
      先结束这个渲染进程，再按上面的“异常退出”处理。页面开着 alert/confirm 时不计时；
      电脑休眠时计时器不走，醒来后第一拍会收到回音，不会误判。
    每次恢复都在下一次加载的页面里留一个标记，界面据此提示“已自动重新加载”。
    """

    BEAT_MS = 5000
    HANG_BEATS = 9
    WINDOW_S = 120
    GIVE_UP = 4

    def __init__(self, view, url, make_page, log=None, parent=None):
        super().__init__(parent)
        self.view, self.url, self.make_page, self.log = view, url, make_page, log
        self.failures = []
        self.serial = 0
        self.pending = 0
        self.missed = 0
        self.loaded = False
        self.stopped = False
        self.killing = False  # 是看护自己结束了卡死的渲染进程：随后的退出按“无响应”处理
        self.attach(view.page())
        self.timer = QTimer(self)
        self.timer.timeout.connect(self.beat)
        self.timer.start(self.BEAT_MS)

    def note(self, event, level="info", **fields):
        if self.log is not None:
            self.log.write("qt", event, level, **fields)

    def attach(self, page):
        page.renderProcessTerminated.connect(self.terminated)
        page.loadFinished.connect(self.load_finished)
        self.loaded = False
        self.pending = 0
        self.missed = 0

    def stop(self):
        self.stopped = True
        self.timer.stop()

    def load_finished(self, ok):
        page = self.view.page()
        if self.sender() is not None and self.sender() is not page:
            return
        self.loaded = bool(ok)
        self.pending = 0
        self.missed = 0
        for script in page.scripts().find(RECOVERED_SCRIPT):
            page.scripts().remove(script)

    def beat(self):
        page = self.view.page()
        if self.stopped or not self.loaded or getattr(page, "dialogs", 0):
            self.missed = 0
            return
        if self.pending:
            self.missed += 1
            if self.missed >= self.HANG_BEATS:
                self.hung()
            return
        self.serial += 1
        serial = self.pending = self.serial
        page.runJavaScript("1", 0, lambda _value, serial=serial: self.answered(serial))

    def answered(self, serial):
        if serial == self.pending:
            self.pending = 0
            self.missed = 0

    def hung(self):
        page = self.view.page()
        pid = page.renderProcessPid()
        self.note("renderer-unresponsive", "error", seconds=self.missed * self.BEAT_MS // 1000, pid=pid)
        self.pending = 0
        self.missed = 0
        self.loaded = False
        if pid and pid > 0:
            try:
                self.killing = True
                os.kill(pid, signal.SIGTERM)  # Windows 上是 TerminateProcess；随后 renderProcessTerminated 接手
                return
            except OSError as error:
                self.killing = False
                self.note("renderer-kill-failed", "error", error=repr(error))
        self.recover("unresponsive")

    def terminated(self, status, code):
        if self.stopped or self.sender() is not self.view.page():
            return
        self.loaded = False
        if status == QWebEnginePage.RenderProcessTerminationStatus.NormalTerminationStatus:
            self.note("renderer-exited", code=int(code))
            return
        reason = "unresponsive" if self.killing else {
            QWebEnginePage.RenderProcessTerminationStatus.CrashedTerminationStatus: "crashed",
            QWebEnginePage.RenderProcessTerminationStatus.KilledTerminationStatus: "killed",
        }.get(status, "abnormal")
        self.killing = False
        self.note("renderer-terminated", "error", reason=reason, code=int(code))
        self.recover(reason)

    def recover(self, reason):
        now = time.monotonic()
        self.failures = [t for t in self.failures if now - t < self.WINDOW_S] + [now]
        count = len(self.failures)
        if count > self.GIVE_UP:
            self.note("renderer-recovery-gave-up", "error", reason=reason, failures=count)
            return
        action = "reload" if count == 1 else "rebuild"
        self.note("renderer-recover", "warn", reason=reason, action=action, failures=count)
        QTimer.singleShot(300, lambda: self.reload(reason) if action == "reload" else self.rebuild(reason))

    def mark(self, page, reason, action):
        script = QWebEngineScript()
        script.setName(RECOVERED_SCRIPT)
        script.setInjectionPoint(QWebEngineScript.InjectionPoint.DocumentCreation)
        script.setWorldId(QWebEngineScript.ScriptWorldId.MainWorld)
        script.setRunsOnSubFrames(False)
        script.setSourceCode(
            "window.__KAIZHI_RECOVERED__=" + json.dumps({"reason": reason, "action": action}) + ";"
        )
        page.scripts().insert(script)

    def reload(self, reason):
        if self.stopped:
            return
        page = self.view.page()
        self.mark(page, reason, "reload")
        page.triggerAction(QWebEnginePage.WebAction.Reload)

    def rebuild(self, reason):
        if self.stopped:
            return
        old = self.view.page()
        page = self.make_page()
        self.mark(page, reason, "rebuild")
        self.view.setPage(page)
        self.attach(page)
        # 新页面是新的标签上下文（sessionStorage 为空），要带着本次运行的 token 重新进入。
        page.setUrl(QUrl(self.url))
        old.deleteLater()


def running_instance(port, timeout=2.0):
    """这个端口上是不是另一个阅迁星穹：只读 GET /（不带 token、不调用接口），看标题。"""
    import http.client

    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=timeout)
    try:
        conn.request("GET", "/")
        reply = conn.getresponse()
        return reply.status == 200 and "阅迁星穹".encode() in reply.read(8192)
    except (OSError, http.client.HTTPException):
        return False
    finally:
        conn.close()


def activate_window(title="阅迁星穹"):
    """把已经开着的主窗口带到前台（最小化的先还原）。找不到窗口返回 False。"""
    if sys.platform != "win32":
        return False
    import ctypes

    user32 = ctypes.windll.user32
    hwnd = user32.FindWindowW(None, title)
    if not hwnd:
        return False
    if user32.IsIconic(hwnd):
        user32.ShowWindow(hwnd, 9)  # SW_RESTORE
    user32.SetForegroundWindow(hwnd)
    return True


def second_launch(app, root, error, log):
    """启动时端口绑不上：已有实例就把它叫到前台、安静退出；否则给一句看得懂的话，不弹 Python 堆栈。"""
    port = getattr(error, "port", 0)
    if port and running_instance(port):
        log.write("qt", "second-instance", port=port, activated=activate_window())
        return 0
    log.write("qt", "port-unavailable", "error", port=port, error=repr(error.__cause__ or error))
    QMessageBox.critical(
        None,
        "阅迁星穹",
        f"阅迁星穹没能启动：本机端口 {port} 被其他程序占用（也可能是系统为 Hyper-V / WSL 保留了这一段端口）。\n\n"
        "请关闭占用该端口的程序，或重启电脑后再打开。文档库与设置都没有受到影响。\n"
        f"详情已写入 {Path(root) / 'logs' / 'app.log'}",
    )
    return 1


def run(dist, data_dir=None, smoke=False):
    if not (dist / "index.html").is_file():
        raise SystemExit("请先在 frontend 目录运行 npm ci 和 npm run build。")
    app = QApplication([])
    app.setApplicationName("KaizhiPython")  # 内部名：Qt 的缓存与配置路径保持既有名称
    app.setApplicationDisplayName("阅迁星穹")
    icon = Path(dist) / "app.ico"  # frontend/public/app.ico，由 scripts/make-icon.py 生成
    if icon.is_file():
        app.setWindowIcon(QIcon(str(icon)))
    view = QWebEngineView()
    gui = Gui(view)
    root = Path(
        data_dir
        or os.environ.get("KAIZHI_DATA_DIR")
        or Path(os.environ["APPDATA"]) / "com.phydog.reading.python"
    )
    service = DesktopService(root, dist, gui.call)
    loop = asyncio.new_event_loop()
    ready = concurrent.futures.Future()

    def worker():
        asyncio.set_event_loop(loop)
        try:
            ready.set_result(loop.run_until_complete(service.start()))
            loop.run_forever()
        except Exception as e:
            if not ready.done():
                ready.set_exception(e)
        finally:
            loop.run_until_complete(loop.shutdown_default_executor())
            loop.close()

    thread = threading.Thread(target=worker, daemon=True)
    thread.start()
    try:
        url = ready.result(timeout=15)
    except PortInUse as error:
        # 双击了两次快捷方式、或端口被占：以前这里直接抛出，用户看到的是 PyInstaller 的堆栈弹窗。
        return second_launch(app, root, error, service.log)
    log = service.log
    log.write("qt", "start", version=VERSION, smoke=bool(smoke))
    if not smoke:
        # 端口已绑定成功 = 确认只有这一个实例在用这个数据目录；此时清缓存不会和别的进程抢文件。
        cache_state = purge_web_cache(root)
        if cache_state != "kept":
            log.write("qt", "web-cache", "warn" if cache_state == "locked" else "info", state=cache_state)
    profile = (
        QWebEngineProfile(app) if smoke else QWebEngineProfile("kaizhi-python", app)
    )
    if not smoke:
        profile.setPersistentStoragePath(str(root / "web"))
        profile.setCachePath(str(root / "web-cache"))
    canvas = startup_canvas(service.lib.get_startup_settings(),
                            app.styleHints().colorScheme() == Qt.ColorScheme.Dark)

    def make_page():
        made = Page(profile, service.origin, view)
        made.setBackgroundColor(QColor(canvas))
        return made

    page = make_page()
    view.setPage(page)
    view.setWindowTitle("阅迁星穹")
    view.resize(1440, 940)
    view.setAcceptDrops(True)
    drops = DropFilter(view)
    app.installEventFilter(drops)
    result = [not smoke]
    if smoke:
        from ..scripts.pdf_smoke import import_probe

        js = import_probe(root)
        last_status = ['waiting for application']
        view.setAttribute(Qt.WidgetAttribute.WA_DontShowOnScreen)
        view.show()  # Keep animation frames and layout active without a visible window.

        def probe():
            def checked(v):
                if v:
                    last_status[0] = v
                if v == "pass":
                    result[0] = True
                    app.quit()
                elif isinstance(v, str) and v.startswith("error: "):
                    app.quit()

            page.runJavaScript(js, 0, checked)

        timer = QTimer(app)
        timer.timeout.connect(probe)
        timer.start(400)
        QTimer.singleShot(40000, app.quit)
    watchdog = None if smoke else Watchdog(view, url, make_page, log, app)
    if watchdog is not None:
        app.aboutToQuit.connect(watchdog.stop)
    view.setUrl(QUrl(url))
    if not smoke:
        view.showMaximized()
    try:
        app.exec()
        if smoke and not result[0] and sys.stderr:
            print(last_status[0], file=sys.stderr)
        if smoke and not result[0] and os.environ.get("KAIZHI_SMOKE_DIAGNOSTICS"):
            Path(os.environ["KAIZHI_SMOKE_DIAGNOSTICS"]).write_text(
                str(last_status[0]), encoding="utf-8"
            )
    finally:
        asyncio.run_coroutine_threadsafe(service.close(), loop).result(12)
        loop.call_soon_threadsafe(loop.stop)
        thread.join(12)
    return 0 if result[0] else 1
