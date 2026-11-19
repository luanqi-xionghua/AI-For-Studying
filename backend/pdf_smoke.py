"""Test the real PDF import, worker, canvas and text layer in a temporary library."""

import json

from PySide6.QtGui import QPainter, QPdfWriter


def import_probe(root):
    path = root / "reader-smoke.pdf"
    writer = QPdfWriter(str(path))
    writer.setResolution(72)
    painter = QPainter(writer)
    painter.drawText(40, 65, "KaizhiPdfSmoke")
    painter.end()
    del writer  # Finalize the PDF before the desktop importer opens it.
    return r"""(() => {
      if (!window.__KAIZHI_PYTHON__ || !document.querySelector('.import-button')) return '';
      const toast = document.querySelector('.toast-message')?.textContent || '';
      const error = document.querySelector('.reader-overlay.error-state p')?.textContent ||
                    (toast.includes('is not a function') && toast);
      if (error) return 'error: ' + error;
      const slot = document.querySelector('.page-ready');
      if (slot?.querySelector('canvas.pdf-canvas')?.width > 0 &&
          slot.querySelector('.textLayer')?.textContent.includes('KaizhiPdfSmoke')) return 'pass';
      if (!window.__kaizhiSmokeDropped) {
        const type = document.querySelector('.file-drop-overlay') ? 'drop' : 'enter';
        if (type === 'drop') window.__kaizhiSmokeDropped = true;
        window.dispatchEvent(new CustomEvent('kaizhi:native-drop', {detail:{type, paths:[%s]}}));
      }
      return 'waiting: ' + JSON.stringify({dropped: !!window.__kaizhiSmokeDropped,
        pages: document.querySelectorAll('.page-slot').length, text: slot?.querySelector('.textLayer')?.textContent, toast});
    })()""" % json.dumps(str(path))
