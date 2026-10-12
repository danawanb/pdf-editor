import type { PageRange } from "./api";

/** Parse "1-3, 5, 8-10" into ranges, validating against `count` pages. */
export function parseRanges(text: string, count: number): PageRange[] | string {
  const parts = text.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return "Enter page ranges, e.g. 1-3, 5, 8-10";
  const ranges: PageRange[] = [];
  for (const part of parts) {
    const m = part.match(/^(\d+)\s*(?:-\s*(\d+))?$/);
    if (!m) return `Invalid format: "${part}"`;
    const start = Number(m[1]);
    const end = m[2] ? Number(m[2]) : start;
    if (start < 1 || end < 1 || start > count || end > count)
      return `"${part}" is out of range (1–${count})`;
    ranges.push({ start: Math.min(start, end), end: Math.max(start, end) });
  }
  return ranges;
}

export function everyN(n: number, count: number): PageRange[] {
  const ranges: PageRange[] = [];
  for (let s = 1; s <= count; s += n) ranges.push({ start: s, end: Math.min(s + n - 1, count) });
  return ranges;
}

export const formatRange = (r: PageRange) => (r.start === r.end ? `${r.start}` : `${r.start}–${r.end}`);
