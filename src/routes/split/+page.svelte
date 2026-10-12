<script lang="ts">
  import { revealItemInDir } from "@tauri-apps/plugin-opener";
  import { errorMessage, fileName, listenPdfDrop, pickFolder, pickPdfs, readFile, splitPdf, type PageRange } from "$lib/api";
  import { displaySize, loadPdf, type PDFDocumentProxy } from "$lib/pdfjs";
  import { everyN, formatRange, parseRanges } from "$lib/ranges";
  import { notify } from "$lib/toast.svelte";
  import DropZone from "$lib/components/DropZone.svelte";
  import PageThumb from "$lib/components/PageThumb.svelte";

  type Mode = "each" | "ranges" | "every";

  let path = $state<string | null>(null);
  let doc = $state.raw<PDFDocumentProxy | null>(null);
  let aspects = $state.raw<number[]>([]);
  let hover = $state(false);
  let busy = $state(false);

  let mode = $state<Mode>("ranges");
  let rangeText = $state("");
  let n = $state(2);

  const count = $derived(doc?.numPages ?? 0);
  const result = $derived.by((): PageRange[] | string => {
    if (!count) return [];
    if (mode === "each") return everyN(1, count);
    if (mode === "every") return n >= 1 ? everyN(Math.floor(n), count) : "Pages per file must be at least 1";
    return parseRanges(rangeText, count);
  });
  const ranges = $derived(typeof result === "string" ? [] : result);

  const palette = ["#e5322d", "#2563eb", "#16a34a", "#d97706", "#9333ea", "#0891b2", "#db2777"];
  /** group index of each page (first matching range), for colour-coding thumbnails */
  const groupOf = $derived.by(() => {
    const g = new Map<number, number>();
    ranges.forEach((r, i) => {
      for (let p = r.start; p <= r.end; p++) if (!g.has(p)) g.set(p, i);
    });
    return g;
  });

  async function open(paths: string[]) {
    const p = paths[0];
    if (!p) return;
    try {
      const d = await loadPdf(await readFile(p));
      const sizes = await Promise.all(Array.from({ length: d.numPages }, (_, i) => displaySize(d, i + 1)));
      void doc?.loadingTask.destroy();
      path = p;
      doc = d;
      aspects = sizes.map((s) => s.height / s.width);
      rangeText = d.numPages > 1 ? `1-${Math.ceil(d.numPages / 2)}, ${Math.ceil(d.numPages / 2) + 1}-${d.numPages}` : "1";
    } catch (e) {
      notify("error", `Could not open ${fileName(p)}: ${errorMessage(e)}`);
    }
  }

  async function split() {
    if (!path || !ranges.length) return;
    const dir = await pickFolder();
    if (!dir) return;
    busy = true;
    try {
      const files = await splitPdf(path, ranges, dir);
      notify("success", `Created ${files.length} PDF files.`, {
        label: "Show in folder",
        run: () => revealItemInDir(files[0]),
      });
    } catch (e) {
      notify("error", errorMessage(e));
    } finally {
      busy = false;
    }
  }

  $effect(() => listenPdfDrop(open, (h) => (hover = h)));
</script>

<header class="flex items-center justify-between border-b border-gray-200 bg-white px-8 py-4">
  <div>
    <h1 class="text-xl font-semibold">Split PDF</h1>
    <p class="text-sm text-gray-500">
      {path ? `${fileName(path)} · ${count} pages` : "Split a PDF into multiple files."}
    </p>
  </div>
  {#if path}
    <button class="btn-ghost" onclick={async () => open(await pickPdfs(false))}>Change file</button>
  {/if}
</header>

{#if !doc}
  <div class="flex flex-1 flex-col p-8">
    <DropZone
      title="Split PDF file"
      hint="Select the PDF file you want to split."
      {hover}
      onpick={async () => open(await pickPdfs(false))}
    />
  </div>
{:else}
  <div class="flex min-h-0 flex-1">
    <div class="flex-1 overflow-y-auto p-8">
      <div class="flex flex-wrap gap-4">
        {#each aspects as aspect, i}
          {@const g = groupOf.get(i + 1)}
          <div class="flex flex-col items-center gap-1.5">
            <div
              class="rounded p-1"
              style:background={g === undefined ? "transparent" : palette[g % palette.length] + "33"}
              style:opacity={g === undefined ? 0.4 : 1}
            >
              <PageThumb {doc} page={i + 1} width={110} {aspect} />
            </div>
            <span
              class="rounded-full px-2 text-xs font-medium"
              style:color={g === undefined ? "#9ca3af" : palette[g % palette.length]}>{i + 1}</span
            >
          </div>
        {/each}
      </div>
    </div>

    <aside class="flex w-80 shrink-0 flex-col border-l border-gray-200 bg-white p-6">
      <h2 class="mb-4 font-semibold">Split mode</h2>
      <div class="mb-6 flex flex-col gap-2">
        {#each [["ranges", "Custom ranges"], ["each", "One file per page"], ["every", "Every N pages"]] as [value, label]}
          <label
            class="flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm
              {mode === value ? 'border-brand-500 bg-brand-50' : 'border-gray-200 hover:bg-gray-50'}"
          >
            <input type="radio" bind:group={mode} {value} class="accent-brand-500" />
            {label}
          </label>
        {/each}
      </div>

      {#if mode === "ranges"}
        <label class="mb-1 text-sm font-medium" for="ranges">Page ranges</label>
        <input
          id="ranges"
          class="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
          placeholder="e.g. 1-3, 5, 8-10"
          bind:value={rangeText}
        />
        <p class="mt-1 text-xs text-gray-400">Separate with commas. Each range becomes one file.</p>
      {:else if mode === "every"}
        <label class="mb-1 text-sm font-medium" for="n">Pages per file</label>
        <input
          id="n"
          type="number"
          min="1"
          max={count}
          class="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
          bind:value={n}
        />
      {/if}

      <div class="mt-6 min-h-0 flex-1 overflow-y-auto">
        {#if typeof result === "string"}
          <p class="rounded-lg bg-red-50 p-3 text-sm text-red-700">{result}</p>
        {:else}
          <p class="mb-2 text-sm text-gray-500">Will create <b>{ranges.length}</b> {ranges.length === 1 ? "file" : "files"}:</p>
          <div class="flex flex-wrap gap-1.5">
            {#each ranges as r, i}
              <span
                class="rounded-md px-2 py-1 text-xs font-medium text-white"
                style:background={palette[i % palette.length]}>{r.start === r.end ? "Page" : "Pages"} {formatRange(r)}</span
              >
            {/each}
          </div>
        {/if}
      </div>

      <button class="btn-primary mt-6 w-full py-3" disabled={!ranges.length || busy} onclick={split}>
        {busy ? "Splitting…" : "Split PDF"}
      </button>
    </aside>
  </div>
{/if}
