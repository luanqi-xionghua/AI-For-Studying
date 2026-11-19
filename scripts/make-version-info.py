"""Write the Windows version resource for the EXE (File Explorer → Properties → Details).

Usage (project root): python scripts\\make-version-info.py build\\version-info.txt
The version comes from backend/__init__.py, so it matches the updater and the installer.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = "YueqianXingqiong"
NAME = "阅迁星穹"


def version():
    text = (ROOT / "backend/__init__.py").read_text("utf-8")
    match = re.search(r'^VERSION = "(\d+)\.(\d+)\.(\d+)"$', text, re.M)
    if not match:
        raise SystemExit("VERSION in backend/__init__.py must look like 1.2.3")
    return match[0].split('"')[1], tuple(int(part) for part in match.groups()) + (0,)


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    text, numbers = version()
    holder = re.search(r"Copyright \(c\) (.+)", (ROOT / "LICENSE").read_text("utf-8"))[1].strip()
    strings = {
        "CompanyName": holder,
        "FileDescription": NAME,
        "FileVersion": text,
        "InternalName": APP,
        "LegalCopyright": f"Copyright (c) {holder} · MIT License",
        "OriginalFilename": f"{APP}.exe",
        "ProductName": NAME,
        "ProductVersion": text,
    }
    items = ",\n          ".join(f"StringStruct({key!r}, {value!r})" for key, value in strings.items())
    resource = f"""VSVersionInfo(
  ffi=FixedFileInfo(filevers={numbers}, prodvers={numbers}, mask=0x3f, flags=0x0, OS=0x40004, fileType=0x1, subtype=0x0, date=(0, 0)),
  kids=[
    StringFileInfo([
      StringTable('080404b0', [
          {items}
      ])
    ]),
    VarFileInfo([VarStruct('Translation', [2052, 1200])])
  ]
)
"""
    target = Path(sys.argv[1])
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(resource, "utf-8")
    print(f"wrote {target} for {NAME} {text}")


if __name__ == "__main__":
    main()
