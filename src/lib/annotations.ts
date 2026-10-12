/**
 * Annotation model. All geometry is in PDF points in the page's *displayed*
 * orientation, with the origin at the top-left and y growing downwards — the
 * same space the editor draws in (times the zoom scale).
 */

export type Tool =
  | "select"
  | "text"
  | "rect"
  | "ellipse"
  | "triangle"
  | "highlight"
  | "draw"
  | "image"
  | "signature";

export type ShapeKind = "rect" | "ellipse" | "triangle";
export const SHAPES: readonly string[] = ["rect", "ellipse", "triangle"] satisfies ShapeKind[];

interface Base {
  id: string;
}

/**
 * Objects with a box can be rotated around the box centre. Freehand strokes
 * have their rotation applied to the points directly instead.
 */
interface Rotatable {
  /** clockwise rotation in degrees, 0–360 (absent = 0) */
  angle?: number;
}

export interface TextAnn extends Base, Rotatable {
  kind: "text";
  x: number;
  y: number;
  text: string;
  size: number;
  color: string;
}

export interface ImageAnn extends Base, Rotatable {
  kind: "image";
  x: number;
  y: number;
  w: number;
  h: number;
  /** data: URL (PNG or JPEG) */
  src: string;
}

export interface BoxAnn extends Base, Rotatable {
  kind: "highlight";
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

/** Rectangle, ellipse or triangle (apex at the top) inside its bounding box. */
export interface ShapeAnn extends Base, Rotatable {
  kind: ShapeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** border colour */
  color: string;
  /** border width in points; 0 = no border */
  stroke: number;
  /** fill colour, or null for no fill */
  fill: string | null;
  /** fill opacity, 0–1 */
  fillOpacity: number;
}

export interface DrawAnn extends Base {
  kind: "draw";
  points: [number, number][];
  color: string;
  stroke: number;
}

export type Ann = TextAnn | ImageAnn | BoxAnn | ShapeAnn | DrawAnn;

export interface EditPage {
  id: string;
  /** 1-based page number in the source file */
  src: number;
  /** extra clockwise rotation applied in the editor */
  rotate: number;
  anns: Ann[];
}

export const uid = () => Math.random().toString(36).slice(2, 10);

export const TEXT_LINE_HEIGHT = 1.2;
/** Distance from the top of a line box to the baseline, as a fraction of font size. */
export const TEXT_BASELINE = 0.95;

/**
 * Re-map an annotation after its page is rotated by `delta` (±90) degrees.
 * `w`/`h` are the page's displayed size *before* the rotation. Text and images
 * keep their size and stay upright; shapes and strokes follow the content.
 */
export function rotateAnn(a: Ann, delta: number, w: number, h: number): void {
  const map = ([x, y]: [number, number]): [number, number] => (delta > 0 ? [h - y, x] : [y, w - x]);
  switch (a.kind) {
    case "draw":
      a.points = a.points.map(map);
      break;
    case "rect":
    case "ellipse":
    case "triangle":
    case "highlight": {
      const [x1, y1] = map([a.x, a.y]);
      const [x2, y2] = map([a.x + a.w, a.y + a.h]);
      a.x = Math.min(x1, x2);
      a.y = Math.min(y1, y2);
      a.w = Math.abs(x2 - x1);
      a.h = Math.abs(y2 - y1);
      break;
    }
    case "image": {
      const [cx, cy] = map([a.x + a.w / 2, a.y + a.h / 2]);
      a.x = cx - a.w / 2;
      a.y = cy - a.h / 2;
      break;
    }
    case "text": {
      [a.x, a.y] = map([a.x, a.y]);
      break;
    }
  }
}

export function moveAnn(a: Ann, dx: number, dy: number): void {
  if (a.kind === "draw") a.points = a.points.map(([x, y]) => [x + dx, y + dy]);
  else {
    a.x += dx;
    a.y += dy;
  }
}

export function bounds(a: Ann): { x: number; y: number; w: number; h: number } {
  if (a.kind === "draw") {
    const xs = a.points.map((p) => p[0]);
    const ys = a.points.map((p) => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  if (a.kind === "text") {
    const lines = a.text.split("\n");
    const w = Math.max(a.size * 0.5, ...lines.map((l) => textWidth(l, a.size)));
    return { x: a.x, y: a.y, w, h: lines.length * a.size * TEXT_LINE_HEIGHT };
  }
  return { x: a.x, y: a.y, w: a.w, h: a.h };
}

export const TEXT_FONT = "Helvetica, Arial, sans-serif";
let measureCtx: CanvasRenderingContext2D | null | undefined;

/** Width in points of one line of text, as the editor renders it. */
export function textWidth(line: string, size: number): number {
  if (measureCtx === undefined) {
    measureCtx = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  }
  if (!measureCtx) return line.length * size * 0.55;
  measureCtx.font = `${size}px ${TEXT_FONT}`;
  return measureCtx.measureText(line).width;
}

export const normAngle = (deg: number) => ((Math.round(deg * 10) / 10) % 360 + 360) % 360;

/** Rotate `[x, y]` clockwise (on screen, y down) by `deg` around `c`. */
export function rotatePoint([x, y]: [number, number], c: [number, number], deg: number): [number, number] {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const dx = x - c[0];
  const dy = y - c[1];
  return [c[0] + dx * cos - dy * sin, c[1] + dx * sin + dy * cos];
}

export const centerOf = (a: Ann): [number, number] => {
  const b = bounds(a);
  return [b.x + b.w / 2, b.y + b.h / 2];
};

/** Rotate an annotation clockwise by `deg` around its own centre. */
export function rotateAnnBy(a: Ann, deg: number): void {
  if (a.kind === "draw") {
    const c = centerOf(a);
    a.points = a.points.map((p) => rotatePoint(p, c, deg));
  } else {
    a.angle = normAngle((a.angle ?? 0) + deg);
  }
}
