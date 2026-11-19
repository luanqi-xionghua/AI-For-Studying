import os
import re
import tempfile
from pathlib import Path

PROVIDERS = {
    "openai",
    "deepseek",
    "codex",
    "anthropic",
    "kimi",
    "glm",
    "qwen",
    "custom",
    "youdao",
    "google",
}


class Credentials:
    def __init__(self, root):
        self.root = Path(root) / "credentials"

    def path(self, provider):
        if provider not in PROVIDERS and not re.fullmatch(
            r"harness-[a-f0-9]{64}", provider
        ):
            raise ValueError("服务名称无效")
        return self.root / (provider + ".bin")

    def get_credential(self, provider):
        path = self.path(provider)
        if not path.exists():
            return None
        import win32crypt

        from .library import bounded

        return win32crypt.CryptUnprotectData(bounded(path, 65536), None, None, None, 1)[
            1
        ].decode()

    def set_credential(self, provider, key):
        path = self.path(provider)
        if key == "":
            path.unlink(missing_ok=True)
            return
        if len(key.encode()) > 8192 or any(ord(c) < 32 or ord(c) == 127 for c in key):
            raise ValueError("密钥格式无效")
        import win32crypt

        blob = win32crypt.CryptProtectData(key.encode(), None, None, None, None, 1)
        self.root.mkdir(parents=True, exist_ok=True)
        fd, name = tempfile.mkstemp(dir=self.root)
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(blob)
            os.replace(name, path)
        finally:
            Path(name).unlink(missing_ok=True)


class ChildJob:
    """Closing the job kills its owned child process tree, including on app exit."""

    def __init__(self, pid):
        import win32api
        import win32job

        from uuid import uuid4

        self.handle = win32job.CreateJobObject(
            None, "Local\\KaizhiPython-" + uuid4().hex
        )
        info = win32job.QueryInformationJobObject(
            self.handle, win32job.JobObjectExtendedLimitInformation
        )
        info["BasicLimitInformation"]["LimitFlags"] |= (
            win32job.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        )
        win32job.SetInformationJobObject(
            self.handle, win32job.JobObjectExtendedLimitInformation, info
        )
        process = win32api.OpenProcess(0x0100 | 0x0001, False, pid)
        try:
            win32job.AssignProcessToJobObject(self.handle, process)
        finally:
            process.Close()

    def close(self):
        if self.handle:
            self.handle.Close()
            self.handle = None
