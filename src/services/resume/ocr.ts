import type { PDFPageProxy } from 'pdfjs-dist/types/src/display/api';

const OCR_LANGUAGE = 'eng+rus';
const OCR_SCALE = 1.5;
const OCR_MAX_PAGES = 8;

export async function extractOcrText(pages: PDFPageProxy[]): Promise<string> {
  if (typeof document === 'undefined') throw new Error('OCR requires a browser document.');
  if (!pages.length) return '';

  const { createWorker } = await import('tesseract.js');
  const extensionUrl = chrome.runtime.getURL.bind(chrome.runtime);
  const worker = await createWorker(OCR_LANGUAGE, 1, {
    workerPath: extensionUrl('ocr/worker.min.js'),
    corePath: extensionUrl('ocr/tesseract-core.wasm.js'),
    langPath: extensionUrl('ocr/lang'),
    workerBlobURL: false,
    gzip: true,
    logger: () => undefined,
  });

  try {
    const text: string[] = [];
    for (const page of pages.slice(0, OCR_MAX_PAGES)) {
      const viewport = page.getViewport({ scale: OCR_SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) continue;
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const result = await worker.recognize(canvas);
      if (result.data.text.trim()) text.push(result.data.text);
      canvas.width = 1;
      canvas.height = 1;
    }
    return text.join('\n');
  } finally {
    await worker.terminate();
  }
}
