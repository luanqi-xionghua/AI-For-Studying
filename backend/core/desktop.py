import asyncio
import concurrent.futures
import json
import os
import shutil
import sys
import threading
import time
from pathlib import Path
from urllib.parse import urlsplit

from PySide6.QtCore import QEvent, QObject, Qt, QTimer, QUrl, Signal, Slot
from PySide6.QtGui import QColor, QDesktopServices, QIcon
from PySide6.QtWebEngineCore import QWebEnginePage, QWebEngineProfile
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWidgets import QApplication, QFileDialog

from .. import VERSION
from ..api.server import DesktopService


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


class Page(QWebEnginePage):
    def __init__(self, profile, origin, parent):
        super().__init__(profile, parent)
        self.origin = origin

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
    url = ready.result(timeout=15)
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
