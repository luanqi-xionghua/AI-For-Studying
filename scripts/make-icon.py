"""Render frontend/public/favicon.svg into the Windows icon used by the EXE, the window and the installer.

Usage (project root): .venv\\Scripts\\python.exe scripts\\make-icon.py
Writes frontend/public/app.ico with PNG-compressed 16–256 px images (Windows Vista+ ICO format).
"""

import struct
import sys
from pathlib import Path

from PySide6.QtCore import QBuffer, QByteArray, QIODevice, Qt
from PySide6.QtGui import QGuiApplication, QImage, QPainter
from PySide6.QtSvg import QSvgRenderer

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "frontend/public/favicon.svg"
TARGET = ROOT / "frontend/public/app.ico"
SIZES = (16, 20, 24, 32, 40, 48, 64, 128, 256)


def png(renderer, size):
    image = QImage(size, size, QImage.Format.Format_ARGB32)
    image.fill(Qt.GlobalColor.transparent)
    painter = QPainter(image)
    painter.setRenderHint(QPainter.RenderHint.Antialiasing)
    painter.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform)
    renderer.render(painter)
    painter.end()
    data = QByteArray()
    buffer = QBuffer(data)
    buffer.open(QIODevice.OpenModeFlag.WriteOnly)
    image.save(buffer, "PNG")
    return bytes(data)


def main():
    app = QGuiApplication.instance() or QGuiApplication(sys.argv[:1])  # noqa: F841 - Qt needs an app for SVG rendering
    renderer = QSvgRenderer(str(SOURCE))
    if not renderer.isValid():
        raise SystemExit(f"cannot render {SOURCE}")
    images = [png(renderer, size) for size in SIZES]
    header = struct.pack("<HHH", 0, 1, len(images))
    offset = len(header) + 16 * len(images)
    entries, blobs = b"", b""
    for size, blob in zip(SIZES, images):
        side = 0 if size >= 256 else size  # 0 means 256 in the ICO directory
        entries += struct.pack("<BBBBHHII", side, side, 0, 0, 1, 32, len(blob), offset + len(blobs))
        blobs += blob
    TARGET.write_bytes(header + entries + blobs)
    print(f"wrote {TARGET.relative_to(ROOT)} ({TARGET.stat().st_size // 1024} KB, {len(SIZES)} sizes)")


if __name__ == "__main__":
    main()
