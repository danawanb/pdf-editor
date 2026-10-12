import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open, save } from "@tauri-apps/plugin-dialog";

export interface Pick {
  doc: number;
  /** 1-based page number in the source document */
  page: number;
  /** extra clockwise rotation in degrees (multiple of 90) */
  rotate: number;
}

export interface PageRange {
  start: number;
  end: number;
}

const PDF_FILTER = [{ name: "PDF", extensions: ["pdf"] }];

export const pageCount = (path: string) => invoke<number>("page_count", { path });

export const mergePdfs = (inputs: string[], output: string) =>
  invoke<void>("merge_pdfs", { inputs, output });

export const splitPdf = (input: string, ranges: PageRange[], outDir: string) =>
  invoke<string[]>("split_pdf", { input, ranges, outDir });

export async function applyPageOps(input: string, picks: Pick[]): Promise<Uint8Array> {
  return new Uint8Array(await invoke<ArrayBuffer>("apply_page_ops", { input, picks }));
}

export async function readFile(path: string): Promise<Uint8Array> {
  return new Uint8Array(await invoke<ArrayBuffer>("read_file", { path }));
}

export const writeFile = (path: string, data: Uint8Array) =>
  invoke<void>("write_file", data, { headers: { path: encodeURIComponent(path) } });

export async function pickPdfs(multiple: boolean): Promise<string[]> {
  const res = await open({ multiple, filters: PDF_FILTER });
  if (!res) return [];
  return Array.isArray(res) ? res : [res];
}

export async function pickImage(): Promise<string | null> {
  const res = await open({
    multiple: false,
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg"] }],
  });
  return typeof res === "string" ? res : null;
}

export const pickFolder = async () => {
  const res = await open({ directory: true });
  return typeof res === "string" ? res : null;
};

export const pickSavePath = (defaultPath: string) =>
  save({ defaultPath, filters: PDF_FILTER });

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function stem(path: string): string {
  return fileName(path).replace(/\.pdf$/i, "");
}

export function errorMessage(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : JSON.stringify(e);
}

/**
 * Listen for files dropped onto the window from the OS. Only `.pdf` paths are
 * passed to `onDrop`. Returns an unlisten function.
 */
export function listenPdfDrop(onDrop: (paths: string[]) => void, onHover?: (over: boolean) => void) {
  const unlisten = getCurrentWebview().onDragDropEvent((e) => {
    const p = e.payload;
    if (p.type === "enter" || p.type === "over") onHover?.(true);
    else if (p.type === "leave") onHover?.(false);
    else if (p.type === "drop") {
      onHover?.(false);
      const pdfs = p.paths.filter((x) => /\.pdf$/i.test(x));
      if (pdfs.length) onDrop(pdfs);
    }
  });
  return () => void unlisten.then((f) => f());
}
