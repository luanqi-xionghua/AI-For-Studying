"""One loopback listener per desktop instance. The token is never in HTTP URLs."""

import asyncio
import inspect
import mimetypes
import secrets
import socket
import time
from pathlib import Path

from aiohttp import ClientSession, DummyCookieJar, WSMsgType, web

from ..runtime.harness import Harness
from ..services.exams import ExamError, ExamExports, encode_markdown, suggested_filename
from ..services.library import Library
from ..services.materials import Materials
from ..services.tempdocs import TempDocs
from ..services.updates import Updates
from ..core.applog import AppLog
from ..core.windows import Credentials

DATA ="get_startup_settings list_documents import_documents relocate_document backup_database restore_database read_document update_document remove_document read_asset index_document get_setting set_setting delete_setting".split()
AI = {"ai_start", "ai_cancel", "ai_tool_result", "ai_set_key", "ai_has_key"}
UPDATE = "update_status update_check update_download update_cancel update_install update_open_page".split()
TEMP = {"temp_doc_pick", "temp_doc_prepare", "temp_doc_read", "temp_doc_release"}
MATERIAL = {"material_status", "material_sync", "material_cancel",
            "material_search", "material_open", "material_clear"}
EXAM = {"exam_export"}
# 页面上报的错误种类（见 frontend/src/ui/error-log.ts）；其余一律记成 other。
CLIENT_LOG_KINDS = {"error", "unhandledrejection", "chunk-load", "resource", "vue",
                    "recovered", "boot", "other"}
CLIENT_LOG_FIELDS = ("message", "stack", "source", "line", "column", "page", "version", "info")


class PortInUse(RuntimeError):
    """已保存的本机端口绑不上：另一个实例在用，或被别的程序 / 系统保留端口占着。"""

    def __init__(self, port, message):
        super().__init__(message)
        self.port = port


def saved_port(port_file):
    """读 desktop-port.txt：没有文件 → 0（随机分配）；内容无效 → None。"""
    try:
        text = Path(port_file).read_text("ascii").strip()
    except FileNotFoundError:
        return 0
    except (OSError, UnicodeDecodeError):
        return None
    if not text.isdigit() or not 1024 <= int(text) <= 65535:
        return None
    return int(text)


def static_path_is_safe(rel):
    """静态文件路径只做纯字符串判断，不访问文件系统。

    拒绝：反斜杠（%5C 解码后可拼出 \\\\host\\share 这类 UNC 路径）、冒号（盘符、备用数据流）、
    NUL、以 / 开头或含空段（///host/share 会被拼成 UNC）、. 与 .. 段。合法的前端资源
    （assets/*.js、vendor/..、samples/..）都只是普通的相对路径。
    """
    if not rel or any(ch in rel for ch in ("\\", ":", "\x00")) or rel.startswith("/"):
        return False
    parts = rel.split("/")
    return all(part and part not in (".", "..") for part in parts)


def static_cache_control(rel):
    """Vite 的 /assets/ 文件名带内容哈希，可以长缓存；其余（index.html、vendor、图标）每次都要重新验证。

    以前不发 Cache-Control，Chromium 会按 Last-Modified 启发式缓存 index.html（约为文件“年龄”的 10%），
    覆盖安装后的头一次启动仍拿到旧版 index.html，再去请求新版里已经不存在的懒加载 chunk（404），
    内容区就只剩外壳。no-cache 让它每次带 ETag 询问一次，没变时本机直接回 304。
    """
    parts = Path(rel).parts
    if len(parts) > 1 and parts[0] == "assets":
        return "public, max-age=31536000, immutable"
    return "no-cache"


GUI = [
    "select_files",
    "select_backup_destination",
    "select_backup_source",
    "is_fullscreen",
    "set_fullscreen",
]


class DesktopService:
    def __init__(self, root, dist, gui):
        self.lib = Library(root)
        self.temp = TempDocs(root)
        self.exams = ExamExports(self.lib)
        self.creds = Credentials(root)
        self.dist = Path(dist).resolve()
        self.gui = gui
        self.token = secrets.token_urlsafe(40)
        # 本机滚动日志（<数据目录>/logs/app.log），写入前会把本次 token 等敏感串替换掉。
        self.log = AppLog(root, [self.token])
        self.ai = Harness(self.creds, self.emit)
        self.ws = None
        self.clearing = None  # 旧事件通道收尾期间的 Future，新连接等它结束
        self.runner = None
        self.app = web.Application(
            client_max_size=18 * 1024**2, middlewares=[self.guard]
        )
        self.app.add_routes(
            [
                web.post("/api/{cmd}", self.api),
                web.get("/events", self.events),
                web.get("/{file:.*}", self.static),
            ]
        )

    @web.middleware
    async def guard(self, req, handler):
        if req.host != self.host:
            raise web.HTTPForbidden()
        if req.path.startswith("/api/") or req.path == "/events":
            if req.headers.get("Origin") != self.origin:
                raise web.HTTPForbidden()
            if req.path != "/events" and not secrets.compare_digest(
                req.headers.get("X-Kaizhi-Token", ""), self.token
            ):
                raise web.HTTPForbidden()
        return await handler(req)

    async def start(self):
        # The Vue application also uses origin-scoped browser storage. Keep this
        # port across launches rather than silently losing that part of its state.
        port_file = self.lib.root / "desktop-port.txt"
        port, rewrite = saved_port(port_file), not port_file.exists()
        if port is None:
            # 文件空了或被写坏（例如首次写入时断电）：原端口已无从得知，只能换新端口，
            # 否则以后每次启动都会直接报错退出。记一条日志说明原因。
            self.log.write("server", "port-file-invalid", "warn")
            port, rewrite = 0, True
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        try:
            sock.bind(("127.0.0.1", port))
        except OSError as e:
            sock.close()
            raise PortInUse(port, "应用正在运行，或已保存的本机端口被占用") from e
        port = sock.getsockname()[1]
        if rewrite:
            port_file.write_text(str(port), "ascii")
        self.host = f"127.0.0.1:{port}"
        self.origin = "http://" + self.host
        self.client = ClientSession(trust_env=True, cookie_jar=DummyCookieJar())
        self.up = Updates(
            self.client, self.lib.root, self.emit, lambda: self.gui("quit", {})
        )
        self.materials = Materials(self.client, self.lib, self.lib.root, self.emit)
        self.runner = web.AppRunner(self.app, access_log=None, shutdown_timeout=5)
        await self.runner.setup()
        await web.SockSite(self.runner, sock).start()
        return self.origin + "/#desktop=" + self.token

    async def static(self, req):
        rel = req.match_info["file"] or "index.html"
        if not static_path_is_safe(rel):
            # 必须在碰文件系统之前拦下：resolve() 遇到 \\host\share 会去连网络共享并发送 NTLM 凭据。
            raise web.HTTPNotFound()
        file = (self.dist / rel).resolve()
        if not file.is_relative_to(self.dist) or not file.is_file():
            raise web.HTTPNotFound()
        content_type = {
            ".mjs": "text/javascript",
            ".js": "text/javascript",
            ".wasm": "application/wasm",
        }.get(file.suffix, mimetypes.guess_type(file)[0] or "application/octet-stream")
        return web.FileResponse(
            file,
            headers={
                "Cache-Control": static_cache_control(file.relative_to(self.dist)),
                "Content-Type": content_type,
                "X-Content-Type-Options": "nosniff",
                "Referrer-Policy": "no-referrer",
                "Content-Security-Policy": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; font-src 'self' data:; connect-src 'self' https: http://localhost:* http://127.0.0.1:* ws://"
                + self.host
                + "; worker-src 'self' blob:; frame-ancestors 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'",
            },
        )

    async def emit(self, channel, event):
        if not self.ws or self.ws.closed:
            raise ConnectionError("阅读窗口已关闭")
        await self.ws.send_json(dict(channel=channel, event=event))

    def progress(self, channel):
        """A thread-safe callback that forwards progress events to a renderer channel."""
        if not isinstance(channel, str) or len(channel) > 100:
            raise ValueError("进度通道无效")
        loop = asyncio.get_running_loop()

        async def send(event):
            try:
                await self.emit(channel, event)
            except Exception:
                pass  # progress is informational; the import itself still finishes

        return lambda event: asyncio.run_coroutine_threadsafe(send(event), loop)

    async def temp_pick(self, args):
        """后端自己调起原生文件对话框；前端只拿到句柄、文件名与类型。"""
        try:
            limit = max(1, min(3, int(args.get("limit", 1))))
        except (TypeError, ValueError):
            limit = 1
        paths = await self.gui(
            "select_files",
            {"title": "选择要临时附加的文档（不会加入文档库）", "multiple": limit > 1},
        )
        if not paths:
            paths = []
        elif isinstance(paths, str):
            paths = [paths]
        return await asyncio.to_thread(self.temp.add, list(paths), limit)

    async def exam_export(self, args):
        """弹出原生「另存为」并写入，再把 md 加入文档库；路径不出后端。"""
        if set(args) - {"markdown", "title"}:
            raise ExamError("EXAM_ARGS")
        title = args.get("title")
        if not isinstance(title, str) or len(title) > 200:
            raise ExamError("EXAM_ARGS")
        encode_markdown(args.get("markdown"))
        name = suggested_filename(title, time.strftime("%Y-%m-%d"))
        path = await self.gui("select_exam_export", {"name": name})
        if not path:
            return {"cancelled": True}
        return await asyncio.to_thread(self.exams.export, path, args["markdown"])

    def client_log(self, args):
        """页面上报的未捕获异常、chunk 加载失败等，写进本机滚动日志（脱敏、限速在 AppLog 里）。"""
        kind = args.get("kind")
        kind = kind if kind in CLIENT_LOG_KINDS else "other"
        level = args.get("level") if args.get("level") in ("info", "warn", "error") else "error"
        fields = {}
        for key in CLIENT_LOG_FIELDS:
            value = args.get(key)
            if isinstance(value, bool) or value is None:
                continue
            if isinstance(value, (int, float)):
                fields[key] = value
            elif isinstance(value, str):
                fields[key] = value[:4000]
        return self.log.write("renderer", kind, level, **fields)

    async def events(self, req):
        ws = web.WebSocketResponse(max_msg_size=1024, heartbeat=30)
        await ws.prepare(req)
        try:
            first = await asyncio.wait_for(ws.receive(), 5)
            if first.type != WSMsgType.TEXT or not secrets.compare_digest(first.data, self.token):
                await ws.close(code=1008)
                return ws
            if self.clearing is not None:
                # 上一个页面刚断开（渲染进程被看护重新加载、整页刷新），旧通道还在收尾：
                # 等它做完再接管，而不是直接拒绝——否则新页面的第一次 AI 请求会失败。
                try:
                    await asyncio.wait_for(asyncio.shield(self.clearing), 10)
                except asyncio.TimeoutError:
                    pass
            if self.ws is not None:
                await ws.close(code=1008)
                return ws
            self.ws = ws
            await ws.send_json({"ready": True})
            async for _ in ws:
                break
        finally:
            if self.ws is ws:
                self.clearing = asyncio.get_running_loop().create_future()
                try:
                    await self.clear()
                finally:
                    self.ws = None
                    self.clearing.set_result(None)
                    self.clearing = None
            await ws.close()
        return ws

    async def api(self, req):
        cmd = req.match_info["cmd"]
        headers = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}
        try:
            if req.content_type != "application/json":
                raise ValueError("需要 JSON 请求")
            args = await req.json()
            if not isinstance(args, dict):
                raise ValueError("参数无效")
            if cmd == "ai_start" and (self.ws is None or self.ws.closed):
                raise ValueError("AI 事件通道尚未连接")
            if cmd in GUI:
                value = await self.gui(cmd, args)
            elif cmd == "temp_doc_pick":
                value = await self.temp_pick(args)
            elif cmd == "exam_export":
                value = await self.exam_export(args)
            elif cmd == "client_log":
                value = await asyncio.to_thread(self.client_log, args)
            else:
                owner = (
                    self.lib
                    if cmd in DATA
                    else self.ai
                    if cmd in AI
                    else self.up
                    if cmd in UPDATE
                    else self.temp
                    if cmd in TEMP
                    else self.materials
                    if cmd in MATERIAL
                    else None
                )
                if owner is None:
                    raise web.HTTPNotFound()
                fn = getattr(owner, cmd)
                if cmd == "import_documents" and args.get("onProgress") is not None:
                    args["onProgress"] = self.progress(args["onProgress"])
                if cmd == "temp_doc_prepare" and args.get("onProgress") is not None:
                    args["onProgress"] = self.progress(args["onProgress"])
                value = (
                    await fn(**args)
                    if inspect.iscoroutinefunction(fn)
                    else await asyncio.to_thread(fn, **args)
                )
            if isinstance(value, bytes):
                return web.Response(
                    body=value, content_type="application/octet-stream", headers=headers
                )
            return web.json_response(value, headers=headers)
        except web.HTTPException:
            raise
        except Exception as exc:
            if not isinstance(exc, (ValueError, FileNotFoundError)):
                # 预期内的错误（参数、文件不存在）直接回给界面；意外的才进日志，便于事后排查。
                self.log.write("server", "api-error", "error", cmd=cmd[:60],
                               error=f"{type(exc).__name__}: {exc}")
            return web.json_response(
                {
                    "error": str(exc)
                    if isinstance(exc, (ValueError, FileNotFoundError))
                    else f"本机操作失败：{type(exc).__name__}"
                },
                status=400,
                headers=headers,
            )

    async def clear(self):
        self.temp.release_all()
        await self.ai.close()
        await self.up.update_cancel()
        await self.materials.material_cancel()

    async def close(self):
        if self.ws is not None:
            await self.ws.close()
        await self.clear()
        self.temp.shutdown()
        self.materials.close()
        await self.runner.cleanup()
        await self.client.close()
        self.log.close()
