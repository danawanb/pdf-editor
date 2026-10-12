import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy };

export function loadPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  // pdf.js transfers the buffer to its worker, so hand it a copy.
  return pdfjs.getDocument({ data: bytes.slice() }).promise;
}

/** Size in PDF points of a page as displayed with `extraRotation` applied. */
export async function displaySize(doc: PDFDocumentProxy, pageNumber: number, extraRotation = 0) {
  const page = await doc.getPage(pageNumber);
  const vp = page.getViewport({ scale: 1, rotation: (page.rotate + extraRotation) % 360 });
  return { width: vp.width, height: vp.height };
}

/**
 * Render a page into `canvas` so that it is `cssWidth` CSS pixels wide.
 * Returns a cancel function.
 */
export function renderPage(
  doc: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  cssWidth: number,
  extraRotation = 0,
): () => void {
  let task: { cancel(): void; promise: Promise<void> } | null = null;
  let cancelled = false;
  (async () => {
    const page = await doc.getPage(pageNumber);
    if (cancelled) return;
    const rotation = (page.rotate + extraRotation) % 360;
    const base = page.getViewport({ scale: 1, rotation });
    const dpr = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: (cssWidth / base.width) * dpr, rotation });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${(cssWidth * base.height) / base.width}px`;
    task = page.render({ canvas, viewport });
    await task.promise.catch(() => {});
  })();
  return () => {
    cancelled = true;
    task?.cancel();
  };
}
