// PDF.js 6 uses Map/WeakMap methods that are absent in older Qt WebEngine.
import './map-compat.mjs'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from './pdf-worker.ts?worker&url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
export { pdfjs }
