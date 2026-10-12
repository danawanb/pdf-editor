import {
  BlendMode,
  LineCapStyle,
  PDFDocument,
  StandardFonts,
  concatTransformationMatrix,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import { TEXT_BASELINE, TEXT_LINE_HEIGHT, type Ann } from "./annotations";

function hexToRgb(hex: string) {
  const n = parseInt(hex.replace("#", ""), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function dataUrlBytes(url: string): { bytes: Uint8Array; png: boolean } {
  const [head, b64] = url.split(",");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, png: head.includes("image/png") };
}

/**
 * Set up a coordinate system on `page` that matches how the page is displayed:
 * origin at the bottom-left of the visible (rotated) page, y up, in points.
 * Returns the displayed height so callers can flip editor y-down coordinates.
 */
function enterDisplaySpace(page: PDFPage): number {
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  const { x, y, width: W, height: H } = page.getCropBox();
  const m: Record<number, [number, number, number, number, number, number]> = {
    0: [1, 0, 0, 1, x, y],
    90: [0, 1, -1, 0, W + x, y],
    180: [-1, 0, 0, -1, W + x, H + y],
    270: [0, -1, 1, 0, x, H + y],
  };
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...(m[rotation] ?? m[0])));
  return rotation % 180 === 0 ? H : W;
}

/** Replace characters the standard font cannot encode. */
function encodable(font: PDFFont, text: string): string {
  const supported = new Set(font.getCharacterSet());
  return [...text].map((c) => (supported.has(c.codePointAt(0)!) ? c : "?")).join("");
}

/**
 * Rotate everything drawn after this call clockwise (as seen on screen) by
 * `deg` around `(cx, cy)`, given in display space with y up.
 */
function enterRotation(page: PDFPage, deg: number, cx: number, cy: number) {
  const r = (-deg * Math.PI) / 180; // clockwise on screen = negative angle with y up
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy),
  );
}

/** Centre of an annotation's box in display space (y down), using the PDF font's metrics for text. */
function center(a: Exclude<Ann, { kind: "draw" }>, font: PDFFont): [number, number] {
  if (a.kind === "text") {
    const lines = a.text.split("\n");
    const w = Math.max(0, ...lines.map((l) => font.widthOfTextAtSize(encodable(font, l), a.size)));
    return [a.x + w / 2, a.y + (lines.length * a.size * TEXT_LINE_HEIGHT) / 2];
  }
  return [a.x + a.w / 2, a.y + a.h / 2];
}

/** Draw `annsPerPage[i]` onto page i of `pdfBytes` and return the new bytes. */
export async function applyAnnotations(pdfBytes: Uint8Array, annsPerPage: Ann[][]): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(pdfBytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const images = new Map<string, PDFImage>();
  const pages = pdf.getPages();

  for (const [i, anns] of annsPerPage.entries()) {
    if (!anns.length) continue;
    const page = pages[i];
    const H = enterDisplaySpace(page);

    for (const a of anns) {
      const angle = a.kind === "draw" ? 0 : (a.angle ?? 0);
      if (angle) {
        const [cx, cy] = center(a as Exclude<Ann, { kind: "draw" }>, font);
        enterRotation(page, angle, cx, H - cy);
      }
      switch (a.kind) {
        case "text": {
          a.text.split("\n").forEach((line, li) => {
            if (!line) return;
            const baseline = a.y + li * a.size * TEXT_LINE_HEIGHT + a.size * TEXT_BASELINE;
            page.drawText(encodable(font, line), {
              x: a.x,
              y: H - baseline,
              size: a.size,
              font,
              color: hexToRgb(a.color),
            });
          });
          break;
        }
        case "image": {
          let img = images.get(a.src);
          if (!img) {
            const { bytes, png } = dataUrlBytes(a.src);
            img = png ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
            images.set(a.src, img);
          }
          page.drawImage(img, { x: a.x, y: H - a.y - a.h, width: a.w, height: a.h });
          break;
        }
        case "rect":
        case "ellipse":
        case "triangle": {
          const style = {
            color: a.fill ? hexToRgb(a.fill) : undefined,
            opacity: a.fillOpacity,
            borderColor: a.stroke > 0 ? hexToRgb(a.color) : undefined,
            borderWidth: a.stroke,
          };
          if (a.kind === "rect") {
            page.drawRectangle({ x: a.x, y: H - a.y - a.h, width: a.w, height: a.h, ...style });
          } else if (a.kind === "ellipse") {
            page.drawEllipse({ x: a.x + a.w / 2, y: H - a.y - a.h / 2, xScale: a.w / 2, yScale: a.h / 2, ...style });
          } else {
            // drawSvgPath uses y-down path coordinates anchored at (x, y).
            page.drawSvgPath(`M ${a.w / 2} 0 L ${a.w} ${a.h} L 0 ${a.h} Z`, { x: a.x, y: H - a.y, ...style });
          }
          break;
        }
        case "highlight":
          page.drawRectangle({
            x: a.x,
            y: H - a.y - a.h,
            width: a.w,
            height: a.h,
            color: hexToRgb(a.color),
            opacity: 0.4,
            blendMode: BlendMode.Multiply,
          });
          break;
        case "draw": {
          const color = hexToRgb(a.color);
          const pts = a.points.length === 1 ? [a.points[0], a.points[0]] : a.points;
          for (let k = 1; k < pts.length; k++) {
            page.drawLine({
              start: { x: pts[k - 1][0], y: H - pts[k - 1][1] },
              end: { x: pts[k][0], y: H - pts[k][1] },
              thickness: a.stroke,
              color,
              lineCap: LineCapStyle.Round,
            });
          }
          break;
        }
      }
      if (angle) page.pushOperators(popGraphicsState());
    }
    page.pushOperators(popGraphicsState());
  }
  return pdf.save();
}
