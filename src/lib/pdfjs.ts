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

/** Upper bound on canvas backing pixels; WebKit refuses very large canvases. */
const MAX_CANVAS_PIXELS = 16_000_000;

/**
 * Render a page into `canvas` so that it is `cssWidth` CSS pixels wide.
 * Draws into an off-screen buffer first and swaps it in when done, so the old
 * image stays visible (just stretched) while re-rendering at a new zoom.
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
    let scale = (cssWidth / base.width) * (window.devicePixelRatio || 1);
    const pixels = base.width * base.height * scale * scale;
    if (pixels > MAX_CANVAS_PIXELS) scale *= Math.sqrt(MAX_CANVAS_PIXELS / pixels);
    const viewport = page.getViewport({ scale, rotation });

    const buffer = document.createElement("canvas");
    buffer.width = Math.floor(viewport.width);
    buffer.height = Math.floor(viewport.height);
    task = page.render({ canvas: buffer, viewport });
    try {
      await task.promise;
    } catch {
      return; // cancelled
    }
    if (cancelled) return;
    canvas.width = buffer.width;
    canvas.height = buffer.height;
    canvas.getContext("2d")!.drawImage(buffer, 0, 0);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${(cssWidth * base.height) / base.width}px`;
  })();
  return () => {
    cancelled = true;
    task?.cancel();
  };
}
