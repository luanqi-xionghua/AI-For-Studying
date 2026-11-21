"""临时文档：只读用户在本机原生对话框里选中的文件。

- 路径只留在后端：接口没有任何路径参数，前端拿到的是不透明句柄；
- PDF / Markdown 不复制；Word 转成 PDF 放在 <数据目录>/chat-temp/<handle>/；
- 应用启动、页面断开、退出、会话删除、移除 chip 时清理；
- 所有异常都换成固定文案（错误码 + 中文），不含路径。
"""

import os
import re
import shutil
import stat
import threading
import uuid
from pathlib import Path

from . import library, word

M = 1024 * 1024
SIZES = {"pdf": 64 * M, "markdown": 4 * M, "word": 32 * M}
HEADERS = {
    ".pdf": b"%PDF-",
    ".doc": bytes.fromhex("d0cf11e0a1b11ae1"),
    ".docx": b"PK\x03\x04",
}
HANDLE = re.compile(r"^[0-9a-f]{32}$")
MAX_HANDLES = 12

MESSAGES = {
    "TEMP_LIMIT": "每段对话最多 3 份文档 / 临时文档太多，请先移除一些",
    "TEMP_TYPE": "只能附加 PDF、Markdown 或 Word 文档",
    "TEMP_SIZE": "文件超过大小限制（PDF 64 MB / Markdown 4 MB / Word 32 MB）",
    "TEMP_HEADER": "文件内容与扩展名不符，可能已损坏",
    "TEMP_ENCODING": "Markdown 不是 UTF-8 编码，请先另存为 UTF-8",
    "TEMP_NOT_FILE": "这不是一个普通文件，或位于不允许的位置",
    "TEMP_MISSING": "临时文档已被移动、删除或修改，请重新上传",
    "TEMP_HANDLE": "临时文档已失效，请重新上传",
    "TEMP_CONVERT": "Word 转换失败",
    "TEMP_CANCELLED": "已取消",
    "TEMP_IO": "本机读取临时文档失败",
}


class TempDocError(ValueError):
    """固定错误码 + 固定中文；消息里永远没有路径。"""

    def __init__(self, code: str, detail: str = ""):
        self.code = code
        text = MESSAGES.get(code, MESSAGES["TEMP_IO"])
        super().__init__(f"{code}：{text}" + (f"：{detail}" if detail else ""))


class TempDocs:
    def __init__(self, root):
        self.root = Path(root).expanduser().resolve()
        self.dir = self.root / "chat-temp"
        self._lock = threading.Lock()
        self._handles: dict[str, dict] = {}
        # 应用启动：清掉上次崩溃遗留的临时目录。
        shutil.rmtree(self.dir, ignore_errors=True)
        self.dir.mkdir(parents=True, exist_ok=True)

    # ---------- 句柄表 ----------
    def _entry(self, handle: str) -> dict:
        if not isinstance(handle, str) or not HANDLE.fullmatch(handle):
            raise TempDocError("TEMP_HANDLE")
        with self._lock:
            entry = self._handles.get(handle)
        if not entry or entry["released"]:
            raise TempDocError("TEMP_HANDLE")
        return entry

    def _folder(self, handle: str) -> Path:
        target = (self.dir / handle).resolve()
        if not target.is_relative_to(self.dir):
            raise TempDocError("TEMP_HANDLE")
        return target

    @staticmethod
    def _fingerprint(path: Path) -> tuple[int, int]:
        try:
            st = path.stat()
        except OSError:
            raise TempDocError("TEMP_MISSING") from None
        if not stat.S_ISREG(st.st_mode):
            raise TempDocError("TEMP_NOT_FILE")
        return st.st_size, st.st_mtime_ns

    def _verify(self, entry: dict) -> Path:
        path = entry["path"]
        size, modified = self._fingerprint(path)
        if size != entry["size"] or modified != entry["mtime_ns"]:
            raise TempDocError("TEMP_MISSING")
        return path

    # ---------- 校验 ----------
    def _validate(self, raw) -> tuple[Path, str, int, int]:
        text = str(raw or "")
        if not text or text.startswith("\\\\?\\") or text.startswith("\\\\.\\"):
            raise TempDocError("TEMP_NOT_FILE")
        try:
            path = Path(text).expanduser().resolve(strict=True)
        except (OSError, RuntimeError, ValueError):
            raise TempDocError("TEMP_MISSING") from None
        resolved = str(path)
        if resolved.startswith("\\\\?\\") or resolved.startswith("\\\\.\\"):
            raise TempDocError("TEMP_NOT_FILE")
        if path.is_relative_to(self.root):
            raise TempDocError("TEMP_NOT_FILE")
        size, modified = self._fingerprint(path)
        kind = library.KINDS.get(path.suffix.lower())
        if not kind:
            raise TempDocError("TEMP_TYPE")
        if size > SIZES[kind]:
            raise TempDocError("TEMP_SIZE")
        if kind == "markdown":
            try:
                library.bounded(path, SIZES["markdown"]).decode("utf-8")
            except UnicodeDecodeError:
                raise TempDocError("TEMP_ENCODING") from None
        else:
            expected = HEADERS[path.suffix.lower()]
            try:
                with path.open("rb") as f:
                    head = f.read(len(expected))
            except OSError:
                raise TempDocError("TEMP_IO") from None
            if not head.startswith(expected):
                raise TempDocError("TEMP_HEADER")
        return path, kind, size, modified

    # ---------- 命令 ----------
    # 命令名与 server.py 白名单一致；内部实现用短名，测试直接调用。
    def temp_doc_prepare(self, handle, onProgress=None):
        return self.prepare(handle, onProgress)

    def temp_doc_read(self, handle):
        return self.read(handle)

    def temp_doc_release(self, handles=None):
        return self.release(handles)

    def add(self, paths, limit=1):
        """把用户在原生对话框里选中的文件登记成临时文档；只返回句柄、文件名与类型。"""
        try:
            count = max(1, min(3, int(limit)))
        except (TypeError, ValueError):
            count = 1
        items, rejected = [], []
        for raw in list(paths or []):
            try:
                path, kind, size, modified = self._validate(raw)
                with self._lock:
                    if len(self._handles) >= MAX_HANDLES:
                        raise TempDocError("TEMP_LIMIT")
                    if len(items) >= count:
                        raise TempDocError("TEMP_LIMIT")
                    handle = uuid.uuid4().hex
                    self._handles[handle] = {
                        "path": path,
                        "kind": kind,
                        "size": size,
                        "mtime_ns": modified,
                        "pdf": None,
                        "released": False,
                        "cancelled": False,
                        "preparing": False,
                    }
                items.append(
                    {
                        "handle": handle,
                        "name": path.name[:120],
                        "kind": kind,
                        "size": size,
                        "needsConvert": kind == "word",
                    }
                )
            except TempDocError as error:
                rejected.append({"name": Path(str(raw)).name[:120], "error": str(error)})
        return {"items": items, "rejected": rejected}

    def prepare(self, handle, onProgress=None):
        """PDF / Markdown 复核指纹后立即返回；Word 转成 PDF 并报告阶段。"""
        entry = self._entry(handle)
        self._verify(entry)
        if entry["kind"] != "word":
            return {"handle": handle, "kind": entry["kind"], "size": entry["size"]}
        folder = self._folder(handle)
        folder.mkdir(parents=True, exist_ok=True)
        with self._lock:
            entry = self._handles.get(handle, entry)
            entry["preparing"] = True

        def note(stage):
            if onProgress:
                try:
                    onProgress({"stage": str(stage)})
                except Exception:
                    pass  # 进度只是提示

        try:
            pdf = word.render(entry["path"], folder, note)
        except ValueError as error:
            with self._lock:
                entry = self._handles.get(handle, entry)
                entry["preparing"] = False
                cancelled = entry["cancelled"]
            if cancelled:
                self._cleanup_handle(handle, folder)
                raise TempDocError("TEMP_CANCELLED") from None
            self._cleanup_handle(handle, folder)
            raise TempDocError("TEMP_CONVERT", str(error)) from None
        except Exception:
            with self._lock:
                entry = self._handles.get(handle, entry)
                entry["preparing"] = False
            self._cleanup_handle(handle, folder)
            raise TempDocError("TEMP_IO") from None
        with self._lock:
            entry = self._handles.get(handle, entry)
            entry["preparing"] = False
            cancelled = entry["cancelled"]
            released = entry["released"]
            if not cancelled and not released:
                entry["pdf"] = pdf
        if cancelled or released:
            self._cleanup_handle(handle, folder)
            raise TempDocError("TEMP_CANCELLED")
        return {"handle": handle, "kind": "pdf", "size": Path(pdf).stat().st_size}

    def read(self, handle):
        """按指纹读取原始字节；Word 返回转换后的 PDF。"""
        entry = self._entry(handle)
        if entry["kind"] == "word":
            pdf = entry.get("pdf")
            if not pdf:
                raise TempDocError("TEMP_HANDLE")
            target = Path(pdf)
            if not target.is_file():
                raise TempDocError("TEMP_MISSING")
            try:
                return library.bounded(target, 256 * M)
            except ValueError as error:
                raise TempDocError("TEMP_SIZE" if "大小" in str(error) else "TEMP_IO") from None
        path = self._verify(entry)
        try:
            return library.bounded(path, SIZES[entry["kind"]])
        except ValueError as error:
            raise TempDocError("TEMP_SIZE" if "大小" in str(error) else "TEMP_IO") from None

    def release(self, handles=None):
        """幂等；转换中的句柄只打取消标记，等转换结束再清理。"""
        released = 0
        for handle in list(handles or []):
            if not isinstance(handle, str) or not HANDLE.fullmatch(handle):
                continue
            with self._lock:
                entry = self._handles.get(handle)
                if not entry or entry["released"]:
                    continue
                entry["released"] = True
                entry["cancelled"] = True
                preparing = bool(entry.get("preparing"))
            released += 1
            if not preparing:
                self._cleanup_handle(handle, self._folder(handle))
        return {"released": released}

    def release_all(self):
        with self._lock:
            handles = list(self._handles)
            for entry in self._handles.values():
                entry["released"] = True
                entry["cancelled"] = True
            self._handles.clear()
        for handle in handles:
            shutil.rmtree(self.dir / handle, ignore_errors=True)
        return {"released": len(handles)}

    def shutdown(self):
        """应用退出：释放全部句柄并删掉 chat-temp/。"""
        self.release_all()
        shutil.rmtree(self.dir, ignore_errors=True)

    # ---------- 清理 ----------
    def _cleanup_handle(self, handle, folder):
        shutil.rmtree(folder, ignore_errors=True)
        with self._lock:
            self._handles.pop(handle, None)
