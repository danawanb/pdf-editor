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

export interface TextAnn extends Base {
  kind: "text";
  x: number;
  y: number;
  text: string;
  size: number;
  color: string;
}

export interface ImageAnn extends Base {
  kind: "image";
  x: number;
  y: number;
  w: number;
  h: number;
  /** data: URL (PNG or JPEG) */
  src: string;
}

export interface BoxAnn extends Base {
  kind: "highlight";
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

/** Rectangle, ellipse or triangle (apex at the top) inside its bounding box. */
export interface ShapeAnn extends Base {
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
    const longest = Math.max(1, ...lines.map((l) => l.length));
    return { x: a.x, y: a.y, w: longest * a.size * 0.55, h: lines.length * a.size * TEXT_LINE_HEIGHT };
  }
  return { x: a.x, y: a.y, w: a.w, h: a.h };
}
