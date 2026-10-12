import { bounds, moveAnn, rotateAnn, uid, type Ann, type EditPage } from "./annotations";
import type { PDFDocumentProxy } from "./pdfjs";

const HISTORY_LIMIT = 100;

/**
 * Detached copy of the page list. Objects and arrays are fresh, but large
 * strings (image data URLs) are shared, so snapshots stay cheap.
 */
function clonePages(pages: EditPage[]): EditPage[] {
  return pages.map((p) => ({
    id: p.id,
    src: p.src,
    rotate: p.rotate,
    anns: p.anns.map((a): Ann => (a.kind === "draw" ? { ...a, points: a.points.map(([x, y]) => [x, y]) } : { ...a })),
  }));
}

function groupBounds(anns: Ann[]) {
  const bs = anns.map(bounds);
  const x = Math.min(...bs.map((b) => b.x));
  const y = Math.min(...bs.map((b) => b.y));
  const w = Math.max(...bs.map((b) => b.x + b.w)) - x;
  const h = Math.max(...bs.map((b) => b.y + b.h)) - y;
  return { x, y, w, h };
}

/** Comparable fingerprint of a snapshot; image data never changes, so skip it. */
const fingerprint = (pages: EditPage[]) => JSON.stringify(pages, (k, v) => (k === "src" && typeof v === "string" ? undefined : v));

/**
 * Editor state lives at module level so switching to another tool and back
 * doesn't lose unsaved work.
 */
class EditorState {
  path = $state<string | null>(null);
  doc = $state.raw<PDFDocumentProxy | null>(null);
  /** displayed size (points) of each source page, without editor rotation */
  base = $state.raw<{ w: number; h: number }[]>([]);
  pages = $state<EditPage[]>([]);
  currentId = $state<string | null>(null);

  current = $derived(this.pages.find((p) => p.id === this.currentId) ?? this.pages[0] ?? null);

  /** copied annotations (detached), and how many times they have been pasted */
  clipboard = $state.raw<Ann[]>([]);
  #pasteCount = 0;

  copy(anns: Ann[]) {
    this.clipboard = clonePages([{ id: "", src: 0, rotate: 0, anns }])[0].anns;
    this.#pasteCount = 0;
  }

  /**
   * Paste the clipboard onto page `p`, offset a little more on each paste so
   * copies don't stack exactly, and kept inside the page (as a group, so the
   * layout between the objects is preserved). Returns the new ids.
   */
  paste(p: EditPage): string[] {
    if (!this.clipboard.length) return [];
    const copies = clonePages([{ id: "", src: 0, rotate: 0, anns: this.clipboard }])[0].anns;
    const step = 12 * ++this.#pasteCount;
    for (const a of copies) {
      a.id = uid();
      moveAnn(a, step, step);
    }
    const { w, h } = this.size(p);
    const b = groupBounds(copies);
    // Pull back inside the page: right/bottom edge first, then left/top wins.
    const fit = (pos: number, len: number, max: number) => Math.max(-pos, Math.min(0, max - (pos + len)));
    const dx = fit(b.x, b.w, w);
    const dy = fit(b.y, b.h, h);
    if (dx || dy) for (const a of copies) moveAnn(a, dx, dy);
    p.anns.push(...copies);
    this.commit();
    return copies.map((a) => a.id);
  }

  // Undo history: `committed` is the state after the last finished action;
  // `past`/`future` hold the states before/after it.
  #committed: EditPage[] = [];
  #committedKey = "";
  past = $state.raw<EditPage[][]>([]);
  future = $state.raw<EditPage[][]>([]);
  canUndo = $derived(this.past.length > 0);
  canRedo = $derived(this.future.length > 0);

  #resetHistory() {
    this.#committed = clonePages(this.pages);
    this.#committedKey = fingerprint(this.#committed);
    this.past = [];
    this.future = [];
  }

  /**
   * Record the current state as one undo step. Call after every finished user
   * action; calls that changed nothing are ignored.
   */
  commit() {
    const now = clonePages(this.pages);
    const key = fingerprint(now);
    if (key === this.#committedKey) return;
    this.past = [...this.past, this.#committed].slice(-HISTORY_LIMIT);
    this.future = [];
    this.#committed = now;
    this.#committedKey = key;
  }

  #restore(state: EditPage[]) {
    this.#committed = state;
    this.#committedKey = fingerprint(state);
    this.pages = clonePages(state);
    if (!this.pages.some((p) => p.id === this.currentId)) this.currentId = this.pages[0]?.id ?? null;
  }

  undo() {
    if (!this.past.length) return;
    this.future = [...this.future, this.#committed];
    const prev = this.past[this.past.length - 1];
    this.past = this.past.slice(0, -1);
    this.#restore(prev);
  }

  redo() {
    if (!this.future.length) return;
    this.past = [...this.past, this.#committed];
    const next = this.future[this.future.length - 1];
    this.future = this.future.slice(0, -1);
    this.#restore(next);
  }

  open(path: string, doc: PDFDocumentProxy, base: { w: number; h: number }[]) {
    void this.doc?.loadingTask.destroy();
    this.path = path;
    this.doc = doc;
    this.base = base;
    this.pages = base.map((_, i) => ({ id: uid(), src: i + 1, rotate: 0, anns: [] }));
    this.currentId = this.pages[0]?.id ?? null;
    this.#resetHistory();
  }

  size(p: EditPage) {
    const b = this.base[p.src - 1];
    return p.rotate % 180 ? { w: b.h, h: b.w } : b;
  }

  rotate(p: EditPage, delta: 90 | -90) {
    const { w, h } = this.size(p);
    for (const a of p.anns) rotateAnn(a, delta, w, h);
    p.rotate = (p.rotate + delta + 360) % 360;
    this.commit();
  }

  duplicate(p: EditPage) {
    const i = this.pages.indexOf(p);
    const anns = $state.snapshot(p.anns).map((a) => ({ ...a, id: uid() }));
    const copy: EditPage = { id: uid(), src: p.src, rotate: p.rotate, anns };
    this.pages.splice(i + 1, 0, copy);
    this.currentId = copy.id;
    this.commit();
  }

  remove(p: EditPage) {
    if (this.pages.length <= 1) return false;
    const i = this.pages.indexOf(p);
    this.pages.splice(i, 1);
    if (this.currentId === p.id) this.currentId = this.pages[Math.min(i, this.pages.length - 1)].id;
    this.commit();
    return true;
  }
}

export const editor = new EditorState();
