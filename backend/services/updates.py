"""Only verified release assets of 阅迁星穹 can update this app."""

import asyncio
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import webbrowser
from pathlib import Path
from urllib.parse import urljoin, urlsplit

from packaging.version import InvalidVersion, Version

from .. import VERSION

# 发布仓库与文件名：Release 附件为 YueqianXingqiong-X.Y.Z-setup.exe / -portable.exe，标签 vX.Y.Z。
REPO = "luanqi-xionghua/AI-For-Studying"
APP = "YueqianXingqiong"
EXE = APP + ".exe"
UNINSTALLER = f"Uninstall-{APP}.exe"
MAX = 768 * 1024**2


class Updates:
    def __init__(self, client, root, emit, quit_app):
        self.client = client
        self.dir = Path(root) / "python-updates"
        self.emit = emit
        self.quit = quit_app
        self.assets = {}
        self.ready = {}
        self.task = None
        self.repo = os.environ.get("KAIZHI_RELEASE_REPO", REPO)
        if not re.fullmatch(r"[\w.-]+/[\w.-]+", self.repo) or any(
            s in (".", "..") for s in self.repo.split("/")
        ):
            raise ValueError("发布仓库名称无效")
        self.page = "https://github.com/" + self.repo

    def update_status(self):
        return dict(
            current=VERSION,
            installed=(
                Path(sys.executable).parent / UNINSTALLER
            ).is_file()
            and getattr(sys, "frozen", False),
        )

    async def response(self, url):
        for _ in range(6):
            p = urlsplit(url)
            if (
                p.scheme != "https"
                or p.username
                or p.password
                or p.port not in (None, 443)
                or p.hostname
                not in (
                    "github.com",
                    "api.github.com",
                    "release-assets.githubusercontent.com",
                    "objects.githubusercontent.com",
                )
            ):
                raise ValueError("更新来源无效")
            r = await self.client.get(
                url,
                allow_redirects=False,
                headers={"User-Agent": "YueqianXingqiong-Updater"},
            )
            if r.status in (301, 302, 303, 307, 308):
                url = urljoin(url, r.headers.get("Location", ""))
                r.release()
                continue
            if r.status != 200:
                r.release()
                raise ValueError(f"发布服务返回 HTTP {r.status}")
            return r
        raise ValueError("发布服务重定向过多")

    async def update_check(self, includePrerelease=False):
        async with await self.response(
            "https://api.github.com/repos/" + self.repo + "/releases?per_page=50"
        ) as r:
            data = bytearray()
            async for chunk in r.content.iter_chunked(65536):
                data.extend(chunk)
                if len(data) > 4 * 1024**2:
                    raise ValueError("发布信息过大")
        best = None
        for rel in json.loads(data):
            tag = rel.get("tag_name", "")
            m = re.fullmatch(r"(?:python-)?v(\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?)", tag)
            if not m or rel.get("draft"):
                continue
            try:
                version = Version(m[1])
            except InvalidVersion:
                continue
            if (
                version <= Version(VERSION)
                or not includePrerelease
                and (rel.get("prerelease") or version.is_prerelease)
            ):
                continue
            if not best or version > best[0]:
                best = (version, rel, m[1])
        if not best:
            return None
        _, rel, version = best
        tag = rel["tag_name"]
        info = None
        setup = self.update_status()["installed"]
        name = f"{APP}-{version}-" + ("setup.exe" if setup else "portable.exe")
        for a in rel.get("assets", []):
            url = f"{self.page}/releases/download/{tag}/{name}"
            digest = a.get("digest") or ""
            size = a.get("size", 0)
            if (
                a.get("name") == name
                and a.get("browser_download_url") == url
                and 0 < size <= MAX
                and re.fullmatch("sha256:[0-9a-f]{64}", digest)
            ):
                info = dict(
                    name=name,
                    url=url,
                    size=size,
                    sha256=digest[7:],
                    kind="setup" if setup else "portable",
                )
                self.assets[url] = info
                break
        return dict(
            version=version,
            tag=tag,
            name=rel.get("name") or tag,
            notes=(rel.get("body") or "")[:20000],
            publishedAt=rel.get("published_at"),
            prerelease=bool(rel.get("prerelease")),
            htmlUrl=f"{self.page}/releases/tag/{tag}",
            installer=info if getattr(sys, "frozen", False) else None,
        )

    async def update_download(self, url, sha256, onProgress):
        a = self.assets.get(url)
        if not a or sha256 != a["sha256"] or self.task:
            raise ValueError("更新未经检查或已有下载")
        self.dir.mkdir(exist_ok=True)
        dest = self.dir / a["name"]
        part = dest.with_suffix(".part")
        size = 0
        digest = hashlib.sha256()
        self.task = asyncio.current_task()
        last = 0
        try:
            async with await self.response(url) as r:
                with part.open("wb") as f:
                    async for chunk in r.content.iter_chunked(131072):
                        size += len(chunk)
                        if size > a["size"]:
                            raise ValueError("下载超过声明大小")
                        digest.update(chunk)
                        f.write(chunk)
                        if time.monotonic() - last > 0.15:
                            await self.emit(
                                onProgress, dict(downloaded=size, total=a["size"])
                            )
                            last = time.monotonic()
            if size != a["size"] or digest.hexdigest() != sha256:
                raise ValueError("更新校验失败")
            os.replace(part, dest)
            self.ready[str(dest)] = a
            await self.emit(onProgress, dict(downloaded=size, total=size))
            return str(dest)
        except asyncio.CancelledError:
            raise ValueError("已取消下载")
        finally:
            self.task = None
            part.unlink(missing_ok=True)

    async def update_cancel(self):
        if self.task:
            self.task.cancel()

    def update_open_page(self, url):
        if url != self.page and not url.startswith(self.page + "/"):
            raise ValueError("无效发布页面")
        webbrowser.open(url)

    async def update_install(self, path):
        a = self.ready.get(path)
        exe = Path(sys.executable).resolve()
        if not getattr(sys, "frozen", False) or exe.name != EXE or not a:
            raise ValueError("仅允许发行版安装已验证的 Python 更新")
        with open(path, "rb") as f:
            if hashlib.file_digest(f, "sha256").hexdigest() != a["sha256"]:
                raise ValueError("更新文件已改变")
        args = (
            [path, "/S"]
            if a["kind"] == "setup"
            else [path, "--replace-portable", str(exe), str(os.getpid()), a["sha256"]]
        )
        subprocess.Popen(
            args,
            close_fds=True,
            creationflags=subprocess.CREATE_NO_WINDOW,
            env=os.environ | {"PYINSTALLER_RESET_ENVIRONMENT": "1"},
        )
        await self.quit()


def replace_portable(target, pid, checksum):
    import win32api
    import win32event

    target = Path(target).resolve(strict=True)
    source = Path(sys.executable).resolve()
    if (
        not getattr(sys, "frozen", False)
        or target.name != EXE
        or target == source
        or not re.fullmatch("[a-f0-9]{64}", checksum)
    ):
        raise ValueError("便携更新目标无效")
    with source.open("rb") as f:
        if hashlib.file_digest(f, "sha256").hexdigest() != checksum:
            raise ValueError("更新文件校验失败")
    try:
        parent = win32api.OpenProcess(0x00100000, False, int(pid))
    except Exception:
        parent = None
    if parent:
        try:
            if win32event.WaitForSingleObject(parent, 60000) != 0:
                raise ValueError("等待旧版本退出超时")
        finally:
            parent.Close()
    with tempfile.TemporaryDirectory(dir=target.parent) as td:
        new = Path(td) / "new.exe"
        shutil.copyfile(source, new)
        backup = Path(td) / "previous.exe"
        shutil.copyfile(target, backup)
        try:
            os.replace(new, target)
            subprocess.Popen(
                [str(target)], env=os.environ | {"PYINSTALLER_RESET_ENVIRONMENT": "1"}
            )
        except OSError:
            os.replace(backup, target)
            raise
