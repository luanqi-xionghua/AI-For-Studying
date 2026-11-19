"""Real Harness worker, synthetic keys, loopback provider only. No paid requests."""

import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from uuid import uuid4

from aiohttp import web

from backend.harness import Harness
from backend.windows import Credentials

PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cqQAAAABJRU5ErkJggg=="


class HarnessTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.events = asyncio.Queue()
        self.requests = []
        self.seen = asyncio.Event()
        self.release = asyncio.Event()

        async def emit(channel, event):
            await self.events.put(event)

        self.h = Harness(Credentials(self.tmp.name), emit)
        self.addAsyncCleanup(self.h.close)
        app = web.Application()
        app.router.add_route("*", "/{path:.*}", self.respond)
        runner = web.AppRunner(app)
        await runner.setup()
        self.addAsyncCleanup(runner.cleanup)
        site = web.TCPSite(runner, "127.0.0.1", 0)
        await site.start()
        self.url = "http://127.0.0.1:" + str(runner.addresses[0][1]) + "/v1"
        self.job = {
            "provider": "custom",
            "baseUrl": self.url,
            "model": "fixture",
            "protocol": "chat",
            "kind": "chat",
            "vision": True,
            "messages": [{"role": "user", "content": "hello"}],
        }

    async def respond(self, req):
        if req.method == "GET":
            return web.json_response({"data": [{"id": "fixture", "object": "model"}]})
        body = await req.json()
        self.requests.append((req.path, dict(req.headers), body))
        self.seen.set()
        if req.path == "/v1/messages":
            events = [
                (
                    "message_start",
                    {
                        "message": {
                            "id": "msg_1",
                            "type": "message",
                            "role": "assistant",
                            "model": "fixture",
                            "content": [],
                            "usage": {"input_tokens": 3, "output_tokens": 0},
                        }
                    },
                ),
                (
                    "content_block_start",
                    {"index": 0, "content_block": {"type": "text", "text": ""}},
                ),
                (
                    "content_block_delta",
                    {
                        "index": 0,
                        "delta": {"type": "text_delta", "text": "local reply"},
                    },
                ),
                ("content_block_stop", {"index": 0}),
                (
                    "message_delta",
                    {
                        "delta": {"stop_reason": "end_turn", "stop_sequence": None},
                        "usage": {"output_tokens": 2},
                    },
                ),
                ("message_stop", {}),
            ]
            return self.sse(events)
        if req.path == "/v1/responses":
            part = {"type": "output_text", "text": "local reply", "annotations": []}
            item = {
                "id": "msg_1",
                "type": "message",
                "role": "assistant",
                "status": "completed",
                "content": [part],
            }
            response = {
                "id": "resp_1",
                "object": "response",
                "model": "fixture",
                "status": "completed",
                "output": [item],
                "usage": {"input_tokens": 3, "output_tokens": 2, "total_tokens": 5},
            }
            return self.sse(
                [
                    (
                        "response.created",
                        {
                            "response": {
                                **response,
                                "status": "in_progress",
                                "output": [],
                            }
                        },
                    ),
                    (
                        "response.output_item.added",
                        {
                            "output_index": 0,
                            "item": {**item, "content": [], "status": "in_progress"},
                        },
                    ),
                    (
                        "response.content_part.added",
                        {
                            "output_index": 0,
                            "content_index": 0,
                            "item_id": "msg_1",
                            "part": {**part, "text": ""},
                        },
                    ),
                    (
                        "response.output_text.delta",
                        {
                            "output_index": 0,
                            "content_index": 0,
                            "item_id": "msg_1",
                            "delta": "local reply",
                        },
                    ),
                    ("response.output_item.done", {"output_index": 0, "item": item}),
                    ("response.completed", {"response": response}),
                ]
            )
        if body["model"] == "stall":
            await self.release.wait()
        if body["model"] == "bad":
            return web.json_response(
                {"error": {"message": "invalid demo-secret"}}, status=401
            )
        if body.get("tools") and not any(m["role"] == "tool" for m in body["messages"]):
            d = {
                "tool_calls": [
                    {
                        "index": 0,
                        "id": "call-1",
                        "type": "function",
                        "function": {
                            "name": "pdf_read",
                            "arguments": '{"start_page":1}',
                        },
                    }
                ]
            }
            reason = "tool_calls"
        else:
            d = {"content": "答复 [S1]"}
            reason = "stop"
        chunks = [
            {
                "id": "fixture",
                "model": body["model"],
                "choices": [{"index": 0, "delta": d, "finish_reason": None}],
            },
            {
                "id": "fixture",
                "choices": [{"index": 0, "delta": {}, "finish_reason": reason}],
                "usage": {
                    "prompt_tokens": 10,
                    "completion_tokens": 2,
                    "total_tokens": 12,
                },
            },
        ]
        return web.Response(
            content_type="text/event-stream",
            text="".join("data: " + json.dumps(x) + "\n\n" for x in chunks)
            + "data: [DONE]\n\n",
        )

    @staticmethod
    def sse(events):
        return web.Response(
            content_type="text/event-stream",
            text="".join(
                f"event: {event}\ndata: {json.dumps({'type': event, **data})}\n\n"
                for event, data in events
            ),
        )

    async def test_alternative_protocols(self):
        for protocol, path, header, value in [
            ("anthropic", "/v1/messages", "x-api-key", "fixture-key"),
            ("responses", "/v1/responses", "authorization", "Bearer fixture-key"),
        ]:
            with self.subTest(protocol=protocol):
                await self.start(protocol=protocol, apiKey="fixture-key")
                self.assertEqual(
                    (await self.until("text-delta"))["text"], "local reply"
                )
                await self.until("end")
                target, headers, body = self.requests[-1]
                self.assertEqual(target, path)
                self.assertEqual(
                    {k.lower(): v for k, v in headers.items()}[header], value
                )
                self.assertTrue(body["stream"])

    async def start(self, **kw):
        uid = str(uuid4())
        await self.h.ai_start(uid, str(uuid4()), dict(self.job, **kw))
        return uid

    async def until(self, kind):
        async with asyncio.timeout(15):
            while True:
                e = await self.events.get()
                if e["type"] == kind:
                    return e
                self.assertNotIn(e["type"], ("end", "error"), e)

    async def test_read_tools_image_citation_and_reuse(self):
        self.h.ai_set_key("custom", self.url, True, "demo-secret")
        self.assertTrue(self.h.ai_has_key("custom", self.url))
        self.assertFalse(self.h.ai_has_key("custom", self.url + "/other"))
        uid = await self.start(
            messages=[{"role": "user", "content": "看图", "images": [PNG]}],
            tools=[
                {
                    "name": "pdf_read",
                    "parameters": {"type": "object"},
                    "description": "read",
                }
            ],
            limits={"calls": 1, "rounds": 1, "images": 1},
        )
        ev = await self.until("tool")
        self.assertEqual(ev["name"], "pdf_read")
        await self.h.ai_tool_result(
            uid, ev["ticket"], {"evidence": [{"sourceId": "S1"}], "dataUrl": PNG}
        )
        self.assertIn("[S1]", (await self.until("text-delta"))["text"])
        await self.until("end")
        self.assertEqual(len(self.requests), 2)
        path, headers, body = self.requests[0]
        self.assertEqual(path, "/v1/chat/completions")
        self.assertEqual(headers["Authorization"], "Bearer demo-secret")
        self.assertIn("image_url", json.dumps(body))
        self.assertIn("S1", json.dumps(self.requests[1][2]))
        self.assertFalse(self.requests[1][2].get("tools"))
        p = self.h.idle[0][0]
        await self.start(kind="models")
        e = await self.until("end")
        self.assertEqual(e["value"]["models"][0]["id"], "fixture")
        self.assertIs(p, self.h.idle[0][0])
        self.h.ai_set_key("custom", self.url, False)
        self.assertFalse(list(Path(self.tmp.name).rglob("*.bin")))

    async def test_cancel_closes_worker(self):
        try:
            uid = await self.start(model="stall")
            await asyncio.wait_for(self.seen.wait(), 10)
            await self.h.ai_cancel(uid)
            self.assertFalse(self.h.active)
            self.assertFalse(self.h.idle)
        finally:
            self.release.set()

    async def test_redaction_and_no_ambient_fallback(self):
        await self.start(model="bad", apiKey="demo-secret")
        e = await self.until("error")
        self.assertNotIn("demo-secret", e["message"])
        with self.assertRaisesRegex(ValueError, "Key"):
            await self.start(baseUrl="https://unused.invalid/v1")

    async def test_deepseek_preset(self):
        for effort in ("high", "none", "max", ""):
            with self.subTest(effort=effort):
                await self.start(
                    provider="deepseek", effort=effort, apiKey="demo-secret"
                )
                await self.until("end")
                data = self.requests[-1][2]
                self.assertEqual(data["model"], "fixture")
                self.assertEqual(
                    data.get("reasoning_effort"),
                    effort if effort in ("high", "max") else None,
                )
                self.assertEqual(
                    data.get("thinking"),
                    {"type": "disabled" if effort == "none" else "enabled"}
                    if effort
                    else None,
                )
                self.assertLessEqual(data.get("max_tokens", 4096), 4096)
