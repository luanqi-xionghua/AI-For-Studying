import hashlib
import os
import shutil
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

from ..core.windows import ChildJob

_lock = threading.Lock()
TIMEOUT = 100
# Exit codes of the `--office` helper process.
OFFICE_OK, OFFICE_MISSING, OFFICE_FAILED, OFFICE_BUSY = 0, 2, 3, 4
OFFICE_REASONS = {
    OFFICE_MISSING: "没有找到可用的 Word 或 WPS",
    OFFICE_FAILED: "Word / WPS 无法打开或导出这份文档，它可能设有打开密码，或文件已损坏",
    OFFICE_BUSY: "Word / WPS 正开着别的文档，为了不打扰你的工作没有使用它",
    "timeout": f"Word / WPS 超过 {TIMEOUT} 秒仍未完成转换",
}


def _child(args, timeout=TIMEOUT):
    p = subprocess.Popen(
        args,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    try:
        job = ChildJob(p.pid)
        try:
            return p.wait(timeout)
        finally:
            job.close()
    finally:
        if p.poll() is None:
            p.kill()
        p.wait()


def office(source, target):
    import pythoncom
    import win32com.client

    pythoncom.CoInitialize()
    found = busy = tried = False
    try:
        for prog in ("Word.Application", "KWps.Application", "Wps.Application"):
            app = doc = None
            owned = False
            opened = False
            try:
                app = win32com.client.DispatchEx(prog)
                found = True
                if app.Documents.Count:
                    busy = True
                    continue  # never change an existing user's Office session
                owned = tried = True
                app.Visible = False
                app.DisplayAlerts = 0
                app.AutomationSecurity = 3
                doc = app.Documents.Open(
                    str(source),
                    False,
                    True,
                    False,
                    "kaizhi-protected",
                    "kaizhi-protected",
                )
                opened = True
                try:
                    doc.ExportAsFixedFormat(str(target), 17)
                except Exception:
                    doc.SaveAs(str(target), 17)
                if _valid(target):
                    return OFFICE_OK
            except Exception:
                pass
            finally:
                if opened:
                    try:
                        doc.Close(0)
                    except Exception:
                        pass
                if owned:
                    try:
                        app.Quit(0)
                    except Exception:
                        pass
        # The parent turns this into a reason the user can act on.
        if busy and not tried:
            return OFFICE_BUSY
        return OFFICE_FAILED if found else OFFICE_MISSING
    finally:
        pythoncom.CoUninitialize()


def _valid(path):
    if not path.is_file() or not 5 <= path.stat().st_size <= 256 * 1024**2:
        return False
    with path.open("rb") as f:
        return f.read(5) == b"%PDF-"


def _identity(source):
    return hashlib.sha256(os.path.normcase(str(source.resolve())).encode()).hexdigest()


def forget(source, cache):
    with _lock:
        for p in cache.glob(_identity(source) + "-*.pdf"):
            p.unlink(missing_ok=True)


def _note(progress, stage):
    if progress:
        try:
            progress(stage)
        except Exception:
            pass  # progress is informational only


def render(source, cache, progress=None):
    """Convert a Word file to a cached PDF. `progress(stage)` reports "office" / "libreoffice"."""
    source = source.resolve(strict=True)
    st = source.stat()
    if st.st_size > 128 * 1024**2:
        raise ValueError("Word 文件过大")
    cache.mkdir(exist_ok=True, parents=True)
    identity = _identity(source)
    dest = cache / f"{identity}-{st.st_size}-{st.st_mtime_ns}.pdf"
    with _lock:
        if _valid(dest):
            return dest
        with tempfile.TemporaryDirectory(dir=cache) as td:
            tmp = Path(td)
            pdf = tmp / (source.stem + ".pdf")
            prefix = (
                [sys.executable]
                if getattr(sys, "frozen", False)
                else [
                    sys.executable,
                    str(Path(__file__).resolve().parents[1] / "main.py"),
                ]
            )
            _note(progress, "office")
            try:
                code = _child([*prefix, "--office", str(source), str(pdf)])
            except subprocess.TimeoutExpired:
                code = "timeout"
            if not _valid(pdf):
                reason = OFFICE_REASONS.get(code, "Word / WPS 没能完成转换")
                exe = next(
                    (
                        p
                        for p in [
                            shutil.which("soffice"),
                            *(
                                str(
                                    Path(os.environ[k])
                                    / "LibreOffice/program/soffice.exe"
                                )
                                for k in ("ProgramFiles", "ProgramFiles(x86)")
                                if k in os.environ
                            ),
                        ]
                        if p and Path(p).is_file()
                    ),
                    None,
                )
                if not exe:
                    raise ValueError(f"转换失败：{reason}，也没有找到 LibreOffice")
                _note(progress, "libreoffice")
                try:
                    _child(
                        [
                            exe,
                            "-env:UserInstallation=" + (tmp / "profile").as_uri(),
                            "--headless",
                            "--convert-to",
                            "pdf",
                            "--outdir",
                            str(tmp),
                            str(source),
                        ]
                    )
                except subprocess.TimeoutExpired:
                    raise ValueError(
                        f"转换失败：{reason}；改用 LibreOffice 转换也超过了 {TIMEOUT} 秒"
                    ) from None
                if not _valid(pdf):
                    raise ValueError(
                        f"转换失败：{reason}；改用 LibreOffice 也没能生成 PDF"
                    )
            os.replace(pdf, dest)
        for old in cache.glob(identity + "-*.pdf"):
            if old != dest:
                old.unlink(missing_ok=True)
        return dest
