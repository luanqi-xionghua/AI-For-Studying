"""One loopback listener per desktop instance. The token is never in HTTP URLs."""

import asyncio
import inspect
import mimetypes
import secrets
import socket
from pathlib import Path

from aiohttp import ClientSession, DummyCookieJar, WSMsgType, web

from ..runtime.harness import Harness
from ..services.library import Library
from ..services.updates import Updates
from ..core.windows import Credentials

DATA = "list_documents import_documents relocate_document backup_database restore_database read_document update_document remove_document read_asset index_document get_setting set_setting delete_setting".split()
AI = {"ai_start", "ai_cancel", "ai_tool_result", "ai_set_key", "ai_has_key"}
UPDATE = "update_status update_check update_download update_cancel update_install update_open_page".split()
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
        self.creds = Credentials(root)
        self.dist = Path(dist).resolve()
        self.gui = gui
        self.token = secrets.token_urlsafe(40)
        self.ai = Harness(self.creds, self.emit)
        self.ws = None
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
        port = int(port_file.read_text("ascii")) if port_file.is_file() else 0
        if port and not 1024 <= port <= 65535:
            raise ValueError("无效的桌面端口配置")
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        try:
            sock.bind(("127.0.0.1", port))
        except OSError as e:
            sock.close()
            raise RuntimeError("应用正在运行，或已保存的本机端口被占用") from e
        port = sock.getsockname()[1]
        if not port_file.exists():
            port_file.write_text(str(port), "ascii")
        self.host = f"127.0.0.1:{port}"
        self.origin = "http://" + self.host
        self.client = ClientSession(trust_env=True, cookie_jar=DummyCookieJar())
        self.up = Updates(
            self.client, self.lib.root, self.emit, lambda: self.gui("quit", {})
        )
        self.runner = web.AppRunner(self.app, access_log=None, shutdown_timeout=5)
        await self.runner.setup()
        await web.SockSite(self.runner, sock).start()
        return self.origin + "/#desktop=" + self.token

    async def static(self, req):
        rel = req.match_info["file"] or "index.html"
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

    async def events(self, req):
        ws = web.WebSocketResponse(max_msg_size=1024, heartbeat=30)
        await ws.prepare(req)
        try:
            first = await asyncio.wait_for(ws.receive(), 5)
            if (
                first.type != WSMsgType.TEXT
                or not secrets.compare_digest(first.data, self.token)
                or self.ws is not None
            ):
                await ws.close(code=1008)
                return ws
            self.ws = ws
            await ws.send_json({"ready": True})
            async for _ in ws:
                break
        finally:
            if self.ws is ws:
                await self.clear()
                self.ws = None
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
            else:
                owner = (
                    self.lib
                    if cmd in DATA
                    else self.ai
                    if cmd in AI
                    else self.up
                    if cmd in UPDATE
                    else None
                )
                if owner is None:
                    raise web.HTTPNotFound()
                fn = getattr(owner, cmd)
                if cmd == "import_documents" and args.get("onProgress") is not None:
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
        await self.ai.close()
        await self.up.update_cancel()

    async def close(self):
        if self.ws is not None:
            await self.ws.close()
        await self.clear()
        await self.runner.cleanup()
        await self.client.close()
