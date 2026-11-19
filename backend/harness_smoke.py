"""Exercise the bundled AI worker against a loopback model with synthetic data."""

import asyncio
import tempfile
from uuid import uuid4

from aiohttp import web

from .harness import Harness
from .windows import Credentials


async def smoke():
    calls = []

    async def complete(req):
        calls.append(await req.json())
        return web.Response(
            content_type="text/event-stream",
            text=(
                'data: {"id":"smoke","choices":[{"index":0,"delta":{"content":"KAIZHI_OK"},"finish_reason":"stop"}]}\n\n'
                "data: [DONE]\n\n"
            ),
        )

    app = web.Application()
    app.router.add_post("/v1/chat/completions", complete)
    runner = web.AppRunner(app, access_log=None)
    await runner.setup()
    try:
        await web.TCPSite(runner, "127.0.0.1", 0).start()
        with tempfile.TemporaryDirectory(prefix="kaizhi-ai-smoke-") as tmp:
            events = asyncio.Queue()

            async def emit(_, event):
                await events.put(event)

            harness = Harness(Credentials(tmp), emit)
            try:
                await harness.ai_start(
                    str(uuid4()),
                    str(uuid4()),
                    {
                        "provider": "custom",
                        "model": "fixture",
                        "protocol": "chat",
                        "kind": "chat",
                        "baseUrl": f"http://127.0.0.1:{runner.addresses[0][1]}/v1",
                        "apiKey": "synthetic-test-only",
                        "messages": [{"role": "user", "content": "ping"}],
                    },
                )
                text = ""
                async with asyncio.timeout(30):
                    while True:
                        event = await events.get()
                        if event["type"] == "error":
                            return 1
                        if event["type"] == "end":
                            break
                        if event["type"] == "text-delta":
                            text += event["text"]
                return 0 if text == "KAIZHI_OK" and len(calls) == 1 else 1
            finally:
                await harness.close()
    finally:
        await runner.cleanup()
