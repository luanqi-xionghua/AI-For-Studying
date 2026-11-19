"""阅迁星穹入口：源码运行 `python backend/main.py`，打包后即 YueqianXingqiong.exe。"""

import argparse
import sys
import tempfile
from pathlib import Path

# 源码运行时把项目根目录放进 sys.path，`backend.*` 才能按包导入；打包后由 PyInstaller 处理。
ROOT = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[1]))
if not getattr(sys, "frozen", False) and str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def main():
    parser = argparse.ArgumentParser(description="阅迁星穹 Python 桌面版")
    parser.add_argument("--data-dir", type=Path)
    parser.add_argument("--smoke", action="store_true")
    parser.add_argument(
        "--harness-smoke",
        action="store_true",
        help="test the AI runtime with a local mock provider",
    )
    parser.add_argument("--office", nargs=2)
    parser.add_argument("--replace-portable", nargs=3)
    a = parser.parse_args()
    if a.harness_smoke:
        import asyncio
        from backend.scripts.harness_smoke import smoke

        return asyncio.run(smoke())
    if a.office:
        from backend.services.word import office

        return office(*map(Path, a.office))
    if a.replace_portable:
        from backend.services.updates import replace_portable

        replace_portable(*a.replace_portable)
        return 0
    from backend.core.desktop import run

    dist = ROOT / "frontend/dist"
    if a.smoke:
        with tempfile.TemporaryDirectory(prefix="kaizhi-smoke-") as tmp:
            return run(dist, tmp, True)
    return run(dist, a.data_dir)


if __name__ == "__main__":
    raise SystemExit(main())
