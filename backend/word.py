import hashlib
import os
import shutil
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

from .windows import ChildJob

_lock = threading.Lock()


def _child(args, timeout=100):
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
    try:
        for prog in ("Word.Application", "KWps.Application", "Wps.Application"):
            app = doc = None
            owned = False
            opened = False
            try:
                app = win32com.client.DispatchEx(prog)
                if app.Documents.Count:
                    continue  # never change an existing user's Office session
                owned = True
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
                    return 0
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
        return 1
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


def render(source, cache):
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
                    str(Path(__file__).resolve().parents[1] / "run.py"),
                ]
            )
            try:
                _child([*prefix, "--office", str(source), str(pdf)])
            except subprocess.TimeoutExpired:
                pass
            if not _valid(pdf):
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
                    raise ValueError(
                        "转换失败：需要可用的 Word、WPS 或 LibreOffice；不支持密码保护的文档"
                    )
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
            if not _valid(pdf):
                raise ValueError("未生成有效 PDF")
            os.replace(pdf, dest)
        for old in cache.glob(identity + "-*.pdf"):
            if old != dest:
                old.unlink(missing_ok=True)
        return dest
