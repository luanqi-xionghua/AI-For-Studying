import asyncio
import ipaddress
import re
import uuid
from urllib.parse import urlsplit

from aiohttp import ClientError, ClientTimeout

M = 1024**2
FORBIDDEN = {
    "host",
    "connection",
    "content-length",
    "transfer-encoding",
    "upgrade",
    "proxy-authorization",
    "cookie",
    "expect",
    "te",
    "trailer",
    "proxy-connection",
    "keep-alive",
}


class Streams:
    def __init__(self, client, emit):
        self.client = client
        self.emit = emit
        self.active = {}

    async def http_start(self, id, url, method, headers, channel, body=None):
        uuid.UUID(id)
        uuid.UUID(channel)
        p = urlsplit(url)
        host = p.hostname
        try:
            loop = ipaddress.ip_address(host).is_loopback
        except ValueError:
            loop = host == "localhost"
        if (
            not host
            or p.username is not None
            or p.password is not None
            or p.fragment
            or (p.scheme != "https" and not (p.scheme == "http" and loop))
            or any(ord(c) < 32 for c in url)
        ):
            raise ValueError("网络地址无效")
        if method not in ("GET", "POST") or (
            body is not None
            and (
                method == "GET"
                or not isinstance(body, str)
                or len(body.encode()) > 16 * M
            )
        ):
            raise ValueError("请求方法或正文无效")
        if not isinstance(headers, list) or len(headers) > 64:
            raise ValueError("请求头太多")
        size = 0
        for name, val in headers:
            size += len(name.encode()) + len(val.encode())
            low = name.lower()
            if (
                low in FORBIDDEN
                or low.startswith(("proxy-", "sec-"))
                or not re.fullmatch(r"[!#$%&'*+.^_`|~0-9A-Za-z-]+", name)
                or any(ord(c) < 32 or ord(c) == 127 for c in val)
                or size > 32768
            ):
                raise ValueError("请求头无效")
        if id in self.active or len(self.active) >= 8:
            raise ValueError("网络请求重复或并发数过多")

        async def work():
            try:
                async with self.client.request(
                    method,
                    url,
                    headers=headers,
                    data=body.encode() if body is not None else None,
                    allow_redirects=False,
                    timeout=ClientTimeout(total=900, connect=30),
                ) as r:
                    await self.emit(
                        channel,
                        dict(
                            type="headers",
                            status=r.status,
                            statusText=r.reason or "",
                            headers=[
                                (k, v)
                                for k, v in r.headers.items()
                                if k.lower() not in ("set-cookie", "set-cookie2")
                            ],
                        ),
                    )
                    total = 0
                    async for chunk in r.content.iter_chunked(65536):
                        total += len(chunk)
                        if total > 32 * M:
                            raise ValueError("响应超过 32 MiB")
                        await self.emit(channel, dict(type="chunk", data=list(chunk)))
                    await self.emit(channel, dict(type="end"))
            except (ClientError, ValueError, OSError, TimeoutError):
                await self.emit(
                    channel, dict(type="error", message="网络请求失败、超时或响应过大")
                )
            finally:
                self.active.pop(id, None)

        self.active[id] = asyncio.create_task(work())

    async def http_cancel(self, id):
        task = self.active.get(id)
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            self.active.pop(id, None)

    async def close(self):
        await asyncio.gather(*(self.http_cancel(i) for i in list(self.active)))
