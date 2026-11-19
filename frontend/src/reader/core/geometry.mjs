// PDF viewport, selection and image-crop geometry.
export const MAX_CANVAS_PIXELS = 16_000_000;
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024 - 128;
export const MAX_IMAGE_DATA_URL_LENGTH = 4 * 1024 * 1024;

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function selectionRect(start, end, width, height) {
  const x1 = clamp(start.x, 0, width);
  const y1 = clamp(start.y, 0, height);
  const x2 = clamp(end.x, 0, width);
  const y2 = clamp(end.y, 0, height);
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}

// Map CSS pixels to source pixels; floor the start and ceil the end so the
// visible selection is not truncated on high DPI displays or fractional zoom.
export function canvasCrop(rect, displayWidth, displayHeight, canvasWidth, canvasHeight) {
  if (!(displayWidth > 0 && displayHeight > 0 && canvasWidth > 0 && canvasHeight > 0)) {
    throw new Error('图片尺寸无效。');
  }
  const x = clamp(Math.floor(rect.x * canvasWidth / displayWidth), 0, canvasWidth);
  const y = clamp(Math.floor(rect.y * canvasHeight / displayHeight), 0, canvasHeight);
  const endX = clamp(Math.ceil((rect.x + rect.width) * canvasWidth / displayWidth), x, canvasWidth);
  const endY = clamp(Math.ceil((rect.y + rect.height) * canvasHeight / displayHeight), y, canvasHeight);
  return { x, y, width: endX - x, height: endY - y };
}

export function renderPixelRatio(width, height, deviceRatio = 1, maxPixels = MAX_CANVAS_PIXELS) {
  if (!(width > 0 && height > 0)) throw new Error('PDF 页面尺寸无效。');
  return Math.min(Math.max(1, deviceRatio), Math.sqrt(maxPixels / (width * height)));
}

export function dataUrlBytes(dataUrl) {
  const encoded = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return Math.floor(encoded.length * 3 / 4) - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
}

export async function destinationPage(pdf, destination) {
  const dest = typeof destination === 'string' ? await pdf.getDestination(destination) : destination;
  if (!Array.isArray(dest) || !dest.length) return null;
  const ref = dest[0];
  const page = Number.isInteger(ref) ? ref + 1 : ref && typeof ref === 'object' ? await pdf.getPageIndex(ref) + 1 : null;
  return page && page >= 1 && page <= pdf.numPages ? page : null;
}
