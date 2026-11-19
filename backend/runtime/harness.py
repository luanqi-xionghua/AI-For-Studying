"""Private stdio connection to the reader-only DeepSeek Harness model runtime."""

import asyncio
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID

from ..core.windows import ChildJob

PROVIDERS = {"deepseek", "openai", "anthropic", "kimi", "glm", "qwen", "custom"}
TOOLS = {"pdf_search", "pdf_read", "pdf_info", "pdf_view"}


def endpoint(provider, baseUrl):
    if (
        provider not in PROVIDERS
        or not isinstance(baseUrl, str)
        or len(baseUrl) > 2048
        or any(ord(c) <= 32 or c == "\\" for c in baseUrl)
    ):
        raise ValueError("服务商或 API 地址无效")
    u = urlsplit(baseUrl)
    if (
        not u.hostname
        or u.username is not None
        or u.password is not None
        or u.query
        or u.fragment
        or (
            u.scheme != "https"
            and not (
                u.scheme == "http" and u.hostname in ("localhost", "127.0.0.1", "::1")
            )
        )
    ):
        raise ValueError(
            "API 地址须为 HTTPS（本机可用 HTTP），不能包含凭据、查询或片段"
        )
    _ = u.port  # reject malformed ports
    return baseUrl.rstrip("/")


class Harness:
    def __init__(self, creds, emit):
        self.creds, self.emit = creds, emit
        self.keys, self.active, self.waiting = {}, {}, {}
        self.idle = []

    def scope(self, provider, baseUrl):
        return (
            "harness-"
            + hashlib.sha256(
                (provider + "\0" + endpoint(provider, baseUrl)).encode()
            ).hexdigest()
        )

    def ai_set_key(self, provider, baseUrl, remember, key=None):
        slot = self.scope(provider, baseUrl)
        if (
            key is None
        ):  # change persistence without exposing a saved key to the renderer
            key = self.keys.get(slot) or self.creds.get_credential(slot) or ""
        if not isinstance(key, str) or len(key) > 8192 or any(ord(c) < 32 for c in key):
            raise ValueError("密钥格式无效")
        self.creds.set_credential(slot, key if remember else "")
        if key:
            self.keys[slot] = key
        else:
            self.keys.pop(slot, None)

    def ai_has_key(self, provider, baseUrl):
        slot = self.scope(provider, baseUrl)
        return bool(self.keys.get(slot) or self.creds.get_credential(slot))

    async def acquire(self):
        while self.idle:
            p, job = self.idle.pop()
            if p.returncode is None:
                return p, job
            if job:
                job.close()
        root = (
            Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[2]))
            / "harness"
        )
        if getattr(sys, "frozen", False):
            exe, script = root / "dist/node.exe", root / "dist/worker.mjs"
        else:
            exe, script = shutil.which("node"), root / "worker.mjs"
            if not (root / "node_modules/@deepseek-ai/dsh-llm").is_dir():
                raise ValueError(
                    "DeepSeek Harness 未安装，请在项目中执行 npm.cmd --prefix harness ci"
                )
        if not exe or not Path(exe).is_file() or not script.is_file():
            raise ValueError("未找到 DeepSeek Harness 运行时；请检查安装包或 Node.js")
        env = {
            k: v
            for k, v in os.environ.items()
            if k.upper()
            in {
                "SYSTEMROOT",
                "WINDIR",
                "TEMP",
                "TMP",
                "PATH",
                "LANG",
                "SSL_CERT_FILE",
                "NODE_EXTRA_CA_CERTS",
            }
        }
        p = await asyncio.create_subprocess_exec(
            str(exe),
            str(script),
            cwd=script.parent,
            stdin=-1,
            stdout=-1,
            stderr=subprocess.DEVNULL,
            limit=2 * 1024 * 1024,
            env=env,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        try:
            return p, ChildJob(p.pid) if os.name == "nt" else None
        except BaseException:
            p.kill()
            await p.wait()
            raise

    @staticmethod
    async def write(p, value):
        p.stdin.write(
            json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()
            + b"\n"
        )
        await p.stdin.drain()

    async def ai_start(self, id, channel, request):
        UUID(id)
        UUID(channel)
        if id in self.active or len(self.active) >= 8:
            raise ValueError("AI 请求过多，请稍后重试")
        req = dict(request)
        provider = req.get("provider")
        url = endpoint(provider, req.get("baseUrl"))
        slot = self.scope(provider, url)
        key = (
            req.pop("apiKey", None)
            or self.keys.get(slot)
            or self.creds.get_credential(slot)
        )
        if (
            not key
            and provider == "custom"
            and urlsplit(url).hostname in ("localhost", "127.0.0.1", "::1")
        ):
            key = "local-no-key"
        if not isinstance(key, str) or not key:
            raise ValueError("请在 AI 设置中为这个 API 地址填写自己的 Key")
        if (
            req.get("protocol") not in ("chat", "responses", "anthropic")
            or req.get("kind") not in ("chat", "models", "ping")
            or not isinstance(req.get("model"), str)
            or not req["model"].strip()
        ):
            raise ValueError("模型配置无效")
        req.update(baseUrl=url, apiKey=key)
        self.active[id] = asyncio.create_task(self.run(id, channel, req))

    async def run(self, id, channel, req):
        p = handle = None
        try:
            async with asyncio.timeout(600):
                # Keep ownership even if cancellation lands during OS process creation.
                spawning = asyncio.create_task(self.acquire())
                try:
                    p, handle = await asyncio.shield(spawning)
                except asyncio.CancelledError:
                    p, handle = await spawning
                    raise
                await self.write(p, {"type": "run", "job": req})
                while True:
                    raw = await p.stdout.readline()
                    if not raw:
                        raise ValueError(
                            "DeepSeek Harness 已退出，请检查安装与模型配置"
                        )
                    msg = json.loads(raw)
                    kind = msg["type"]
                    if kind == "tool":
                        if msg.get("name") not in TOOLS:
                            raise ValueError("未知文档工具")
                        future = asyncio.get_running_loop().create_future()
                        self.waiting[id] = (msg["ticket"], future)
                        await self.emit(channel, msg)
                        result = await future
                        self.waiting.pop(id, None)
                        await self.write(
                            p,
                            {
                                "type": "tool-result",
                                "ticket": msg["ticket"],
                                "result": result,
                            },
                        )
                        continue
                    if kind not in (
                        "text-delta",
                        "reasoning-delta",
                        "usage",
                        "end",
                        "error",
                    ):
                        raise ValueError("Harness 事件格式无效")
                    await self.emit(channel, msg)
                    if kind in ("end", "error"):
                        if len(self.idle) < 2:
                            self.idle.append((p, handle))
                            p = handle = None
                        return
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001 - convert worker failures at the RPC boundary
            try:
                await self.emit(
                    channel,
                    {
                        "type": "error",
                        "message": str(e)
                        if isinstance(e, ValueError)
                        else "DeepSeek Harness 超时或连接已中断",
                    },
                )
            except ConnectionError:
                pass
        finally:
            self.waiting.pop(id, None)
            self.active.pop(id, None)
            if p is not None:
                await self.kill(p, handle)

    async def ai_tool_result(self, id, ticket, result):
        pending = self.waiting.get(id)
        if (
            not pending
            or pending[0] != ticket
            or pending[1].done()
            or not isinstance(result, dict)
        ):
            raise ValueError("工具请求已结束")
        pending[1].set_result(result)

    async def ai_cancel(self, id):
        task = self.active.get(id)
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            self.active.pop(id, None)

    @staticmethod
    async def kill(p, handle):
        if handle:
            handle.close()
        if p.returncode is None:
            try:
                p.kill()
            except (ProcessLookupError, PermissionError):
                pass
        await p.wait()

    async def close(self):
        await asyncio.gather(*(self.ai_cancel(i) for i in list(self.active)))
        idle, self.idle = self.idle, []
        await asyncio.gather(*(self.kill(*item) for item in idle))
