"""本机滚动日志：<数据目录>/logs/app.log（512 KB × 4 份）。

只记排查用的事件：渲染进程退出/无响应与恢复、页面未捕获异常、懒加载 chunk 失败、缓存清理。
写入前一律脱敏：会话 token、类似 API Key 的串、Authorization、用户目录路径都会被替换；
单条截断到 2000 字。日志只留在本机，不上传。
"""

import json
import logging
import os
import re
import threading
import time
from logging.handlers import RotatingFileHandler
from pathlib import Path

MAX_BYTES = 512 * 1024
BACKUPS = 3
MAX_FIELD = 2000

_SECRETS = [
    (re.compile(r"#desktop=[A-Za-z0-9_-]+"), "#desktop=<token>"),
    (re.compile(r"(?i)(bearer\s+)[A-Za-z0-9._~+/=-]{6,}"), r"\1<redacted>"),
    (re.compile(r"(?i)(x-kaizhi-token|authorization|api[-_]?key|x-api-key|token|secret|password)(\"?\s*[:=]\s*\"?)[^\s\"',;&]+"), r"\1\2<redacted>"),
    (re.compile(r"\b(sk|rk|pk)-[A-Za-z0-9_-]{8,}"), r"\1-<redacted>"),
    (re.compile(r"\bAIza[0-9A-Za-z_-]{20,}"), "<redacted>"),
    (re.compile(r"\b[A-Za-z0-9_-]{48,}\b"), "<long-id>"),
]


def scrub(text, extra_secrets=()):
    """去掉日志文本里的敏感片段。extra_secrets：本次运行已知的秘密串（会话 token 等），原样替换。"""
    text = str(text)
    for secret in extra_secrets:
        if secret:
            text = text.replace(secret, "<token>")
    for pattern, repl in _SECRETS:
        text = pattern.sub(repl, text)
    home = os.path.expanduser("~")
    if home and home != "~":
        text = re.sub(re.escape(home), "~", text, flags=re.IGNORECASE)
        text = text.replace(home.replace("\\", "/"), "~")
    if len(text) > MAX_FIELD:
        text = text[:MAX_FIELD] + "…"
    return text


class AppLog:
    """线程安全；写失败（磁盘满、只读）静默丢弃，日志永远不影响应用本身。"""

    def __init__(self, root, secrets=(), per_minute=60):
        self.path = Path(root) / "logs" / "app.log"
        self.secrets = [s for s in secrets if s]
        self.per_minute = per_minute
        self._window = (0.0, 0)
        self._dropped = 0
        self._lock = threading.Lock()
        self._logger = logging.getLogger(f"kaizhi.applog.{id(self)}")
        self._logger.propagate = False
        self._logger.setLevel(logging.INFO)
        self._handler = None
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self._handler = RotatingFileHandler(
                self.path, maxBytes=MAX_BYTES, backupCount=BACKUPS, encoding="utf-8", delay=True
            )
            self._handler.setFormatter(logging.Formatter("%(message)s"))
            self._logger.addHandler(self._handler)
        except OSError:
            self._handler = None

    def add_secret(self, secret):
        if secret and secret not in self.secrets:
            self.secrets.append(secret)

    def write(self, source, event, level="info", /, **fields):
        """source：qt / renderer / server；event：短事件名；fields 会逐个脱敏。返回是否写入。"""
        if self._handler is None:
            return False
        now = time.monotonic()
        with self._lock:
            start, count = self._window
            if now - start >= 60:
                if self._dropped:
                    self._emit("server", "log-throttled", "warn", {"dropped": self._dropped})
                    self._dropped = 0
                start, count = now, 0
            if count >= self.per_minute:
                self._dropped += 1
                self._window = (start, count)
                return False
            self._window = (start, count + 1)
            return self._emit(source, event, level, fields)

    def _emit(self, source, event, level, fields):
        record = {
            "at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "src": scrub(source, self.secrets)[:40],
            "event": scrub(event, self.secrets)[:80],
            "level": level if level in ("debug", "info", "warn", "error") else "info",
        }
        for key, value in fields.items():
            if value is None:
                continue
            if isinstance(value, (int, float, bool)):
                record[str(key)[:40]] = value
            else:
                record[str(key)[:40]] = scrub(value, self.secrets)
        try:
            self._logger.info(json.dumps(record, ensure_ascii=False))
            return True
        except Exception:
            return False

    def close(self):
        if self._handler is not None:
            self._logger.removeHandler(self._handler)
            self._handler.close()
            self._handler = None
