import { rotateAnn, uid, type EditPage } from "./annotations";
import type { PDFDocumentProxy } from "./pdfjs";

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

  open(path: string, doc: PDFDocumentProxy, base: { w: number; h: number }[]) {
    void this.doc?.loadingTask.destroy();
    this.path = path;
    this.doc = doc;
    this.base = base;
    this.pages = base.map((_, i) => ({ id: uid(), src: i + 1, rotate: 0, anns: [] }));
    this.currentId = this.pages[0]?.id ?? null;
  }

  size(p: EditPage) {
    const b = this.base[p.src - 1];
    return p.rotate % 180 ? { w: b.h, h: b.w } : b;
  }

  rotate(p: EditPage, delta: 90 | -90) {
    const { w, h } = this.size(p);
    for (const a of p.anns) rotateAnn(a, delta, w, h);
    p.rotate = (p.rotate + delta + 360) % 360;
  }

  duplicate(p: EditPage) {
    const i = this.pages.indexOf(p);
    const anns = $state.snapshot(p.anns).map((a) => ({ ...a, id: uid() }));
    const copy: EditPage = { id: uid(), src: p.src, rotate: p.rotate, anns };
    this.pages.splice(i + 1, 0, copy);
    this.currentId = copy.id;
  }

  remove(p: EditPage) {
    if (this.pages.length <= 1) return false;
    const i = this.pages.indexOf(p);
    this.pages.splice(i, 1);
    if (this.currentId === p.id) this.currentId = this.pages[Math.min(i, this.pages.length - 1)].id;
    return true;
  }
}

export const editor = new EditorState();
