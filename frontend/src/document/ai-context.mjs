import { pdfjs } from './pdf-engine';
import { library } from '../sdk';
import { documentPassword } from './passwords.mjs';

// AI owns its source document for the duration of one RUNNING question.
// Switching/disposing the visible reader cannot destroy this document.
// descriptor.read 让「临时文档」也能复用同一条管道（对话模式的附件）；桌面版阅读助手不传，行为不变。
export async function openAiContext(descriptor, snapshot, signal) {
  signal.throwIfAborted();
  const bytes = descriptor.read ? await descriptor.read(signal) : await library.read(descriptor.id);
  signal.throwIfAborted();
  if (descriptor.kind === 'markdown') return { context: { ...snapshot, text: new TextDecoder().decode(bytes) }, close() {} };
  const task = pdfjs.getDocument({ data: bytes, password: documentPassword(descriptor.passwordId ?? descriptor.id), cMapUrl: '/vendor/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/vendor/pdfjs/standard_fonts/', wasmUrl: '/vendor/pdfjs/wasm/' });
  const abort = () => { void task.destroy(); };
  signal.addEventListener('abort', abort, { once: true });
  const close = async () => { signal.removeEventListener('abort', abort); await task.destroy(); };
  try {
    const pdf = await task.promise;
    signal.throwIfAborted();
    return { context: { ...snapshot, pdf }, close };
  } catch (error) { await close(); throw error; }
}
