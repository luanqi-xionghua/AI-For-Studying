"""模拟测试导出：文件名、校验、原子写入与加入文档库。消息里永远没有路径。"""

import os
import re
import time
import uuid
from pathlib import Path

from .library import LIMITS

M = 1024 * 1024
MAX_BYTES = LIMITS["markdown"]
TITLE_CHARS = 60
MD_SUFFIXES = (".md", ".markdown", ".mdown")
INVALID_NAME = re.compile(r'[\\/:*?"<>|\x00-\x1f]')
RESERVED = {
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}
TITLE_EXT = re.compile(r"\.(pdf|md|markdown|mdown|docx?)$", re.I)

EXAM_MESSAGES = {
    "EXAM_ARGS": "导出参数无效",
    "EXAM_EMPTY": "试卷内容为空",
    "EXAM_TOO_LARGE": "导出内容超过 16 MB",
    "EXAM_ENCODING": "试卷内容含无法保存的字符",
    "EXAM_DIR": "保存位置不存在",
    "EXAM_LOCATION": "不能保存到应用的数据目录",
    "EXAM_NOT_FILE": "目标已存在且不是普通文件",
    "EXAM_DENIED": "没有写入权限，文件可能正被其他程序占用",
    "EXAM_WRITE": "写入文件失败",
    "EXAM_IMPORT": "文件已保存，但没能加入文档库",
}


class ExamError(ValueError):
    def __init__(self, code, detail=""):
        self.code = code
        message = f"{code}：{EXAM_MESSAGES.get(code, EXAM_MESSAGES['EXAM_WRITE'])}"
        if detail:
            message = f"{message}：{detail}"
        super().__init__(message)


def suggested_filename(title, day):
    """书名 → 对话框默认文件名；只保留文件名允许的字符，永远不含目录。"""
    name = TITLE_EXT.sub("", str(title or ""))
    name = INVALID_NAME.sub("_", name)
    name = re.sub(r"\s+", " ", name).strip(" .")
    name = name[:TITLE_CHARS] or "未命名"
    if name.upper() in RESERVED:
        name = f"_{name}"
    return f"模拟测试-{name}-{day}.md"


def encode_markdown(markdown):
    if not isinstance(markdown, str):
        raise ExamError("EXAM_ARGS")
    if not markdown.strip():
        raise ExamError("EXAM_EMPTY")
    if "\x00" in markdown:
        raise ExamError("EXAM_ENCODING")
    try:
        data = markdown.encode("utf-8")
    except UnicodeEncodeError:
        raise ExamError("EXAM_ENCODING") from None
    if len(data) > MAX_BYTES:
        raise ExamError("EXAM_TOO_LARGE", str(len(data)))
    return data


def resolve_destination(raw, data_root):
    if not isinstance(raw, str) or not raw.strip():
        raise ExamError("EXAM_ARGS")
    path = Path(raw).expanduser()
    if not path.is_absolute():
        raise ExamError("EXAM_ARGS")
    dest = path.resolve(strict=False)
    if dest.suffix.lower() not in MD_SUFFIXES:
        dest = dest.with_name(dest.name + ".md")
    try:
        if dest.is_relative_to(Path(data_root).resolve()):
            raise ExamError("EXAM_LOCATION")
    except OSError:
        raise ExamError("EXAM_DIR") from None
    if not dest.parent.is_dir():
        raise ExamError("EXAM_DIR")
    if dest.exists() and not dest.is_file():
        raise ExamError("EXAM_NOT_FILE")
    return dest


def write_atomic(path, data):
    tmp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        with open(tmp, "xb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    except PermissionError:
        raise ExamError("EXAM_DENIED") from None
    except OSError:
        raise ExamError("EXAM_WRITE") from None
    finally:
        tmp.unlink(missing_ok=True)


class ExamExports:
    def __init__(self, lib):
        self.lib = lib
        self.root = lib.root

    def export(self, raw_path, markdown):
        data = encode_markdown(markdown)
        dest = resolve_destination(raw_path, self.root)
        write_atomic(dest, data)
        try:
            docs = self.lib.import_documents([str(dest)])
        except ValueError:
            raise ExamError("EXAM_IMPORT") from None
        return {"document": docs[0], "name": dest.name, "bytes": len(data)}


def today():
    return time.strftime("%Y-%m-%d")
