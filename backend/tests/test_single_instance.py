"""1.2.8：重复启动与端口文件损坏——不再弹 Python 堆栈。"""

import socket
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from backend.api.server import DesktopService, PortInUse, saved_port
from backend.core import desktop


class PortFileTests(unittest.TestCase):
    def test_saved_port_parsing(self):
        with tempfile.TemporaryDirectory() as td:
            f = Path(td) / "desktop-port.txt"
            self.assertEqual(saved_port(f), 0, "没有文件：随机分配")
            for text, expected in (("54209", 54209), ("54209\n", 54209), ("", None), ("abc", None), ("80", None), ("70000", None), ("-1", None)):
                f.write_text(text, "ascii")
                self.assertEqual(saved_port(f), expected, repr(text))
            f.write_bytes(b"\xff\xfe")
            self.assertIsNone(saved_port(f))


class StartTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / "index.html").write_text("<!doctype html><title>阅迁星穹</title>", "utf-8")

    def service(self):
        service = DesktopService(self.root, self.root, AsyncMock(return_value=False))
        return service

    async def test_corrupt_port_file_falls_back_to_a_new_port(self):
        (self.root / "desktop-port.txt").write_text("", "ascii")  # 首次写入时断电留下的空文件
        service = self.service()
        await service.start()
        self.addAsyncCleanup(service.close)
        port = int(service.host.rsplit(":", 1)[1])
        self.assertEqual((self.root / "desktop-port.txt").read_text("ascii"), str(port))
        service.log.close()
        self.assertIn("port-file-invalid", (self.root / "logs" / "app.log").read_text("utf-8"))

    async def test_second_instance_is_detected_and_other_programs_are_not(self):
        first = self.service()
        await first.start()
        self.addAsyncCleanup(first.close)
        port = int(first.host.rsplit(":", 1)[1])
        second = self.service()
        with self.assertRaises(PortInUse) as caught:
            await second.start()
        self.assertEqual(caught.exception.port, port)
        second.log.close()
        self.assertTrue(await __import__("asyncio").to_thread(desktop.running_instance, port))
        # 端口上是别的程序（不回我们的页面）→ 不是“已在运行”。
        other = socket.socket()
        other.bind(("127.0.0.1", 0))
        other.listen(1)
        self.addCleanup(other.close)
        self.assertFalse(await __import__("asyncio").to_thread(desktop.running_instance, other.getsockname()[1], 0.5))
        closed = socket.socket()
        closed.bind(("127.0.0.1", 0))
        free = closed.getsockname()[1]
        closed.close()
        self.assertFalse(await __import__("asyncio").to_thread(desktop.running_instance, free, 0.5))


class SecondLaunchTests(unittest.TestCase):
    def test_existing_instance_is_activated_quietly(self):
        log = MagicMock()
        with patch.object(desktop, "running_instance", return_value=True), \
             patch.object(desktop, "activate_window", return_value=True) as activate, \
             patch.object(desktop.QMessageBox, "critical") as box:
            code = desktop.second_launch(None, "C:/data", PortInUse(54209, "x"), log)
        self.assertEqual(code, 0)
        activate.assert_called_once()
        box.assert_not_called()
        self.assertEqual(log.write.call_args[0][1], "second-instance")

    def test_port_taken_by_another_program_shows_a_readable_message(self):
        log = MagicMock()
        with patch.object(desktop, "running_instance", return_value=False), \
             patch.object(desktop.QMessageBox, "critical") as box:
            code = desktop.second_launch(None, "C:/data", PortInUse(54209, "x"), log)
        self.assertEqual(code, 1)
        text = box.call_args[0][2]
        self.assertIn("54209", text)
        self.assertIn("重启电脑", text)
        self.assertNotIn("Traceback", text)
        self.assertEqual(log.write.call_args[0][1], "port-unavailable")


if __name__ == "__main__":
    unittest.main()
