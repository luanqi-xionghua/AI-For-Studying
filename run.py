import argparse
import tempfile
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description="开智 Python 桌面版")
    parser.add_argument("--data-dir", type=Path)
    parser.add_argument("--smoke", action="store_true")
    parser.add_argument("--office", nargs=2)
    parser.add_argument("--replace-portable", nargs=3)
    a = parser.parse_args()
    if a.office:
        from backend.word import office

        return office(*map(Path, a.office))
    if a.replace_portable:
        from backend.updates import replace_portable

        replace_portable(*a.replace_portable)
        return 0
    from backend.desktop import run

    dist = Path(__file__).resolve().parent / "frontend/dist"
    if a.smoke:
        with tempfile.TemporaryDirectory(prefix="kaizhi-smoke-") as tmp:
            return run(dist, tmp, True)
    return run(dist, a.data_dir)


if __name__ == "__main__":
    raise SystemExit(main())
