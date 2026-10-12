<script lang="ts">
  import { flip } from "svelte/animate";
  import { dndzone } from "svelte-dnd-action";
  import { revealItemInDir } from "@tauri-apps/plugin-opener";
  import { errorMessage, fileName, listenPdfDrop, mergePdfs, pickPdfs, pickSavePath, readFile } from "$lib/api";
  import { displaySize, loadPdf, type PDFDocumentProxy } from "$lib/pdfjs";
  import { notify } from "$lib/toast.svelte";
  import DropZone from "$lib/components/DropZone.svelte";
  import PageThumb from "$lib/components/PageThumb.svelte";

  interface Item {
    id: string;
    path: string;
    name: string;
    pages: number;
    doc: PDFDocumentProxy;
    aspect: number;
  }

  let items = $state<Item[]>([]);
  let hover = $state(false);
  let busy = $state(false);
  const totalPages = $derived(items.reduce((n, f) => n + f.pages, 0));

  async function add(paths: string[]) {
    for (const path of paths) {
      try {
        const doc = await loadPdf(await readFile(path));
        const size = await displaySize(doc, 1);
        items.push({
          id: crypto.randomUUID(),
          path,
          name: fileName(path),
          pages: doc.numPages,
          doc,
          aspect: size.height / size.width,
        });
      } catch (e) {
        notify("error", `Could not open ${fileName(path)}: ${errorMessage(e)}`);
      }
    }
  }

  function remove(id: string) {
    const i = items.findIndex((f) => f.id === id);
    if (i >= 0) items.splice(i, 1);
  }

  async function merge() {
    const output = await pickSavePath("merged.pdf");
    if (!output) return;
    busy = true;
    try {
      await mergePdfs(
        items.map((f) => f.path),
        output,
      );
      notify("success", `Merged ${items.length} files (${totalPages} pages).`, {
        label: "Show in folder",
        run: () => revealItemInDir(output),
      });
    } catch (e) {
      notify("error", errorMessage(e));
    } finally {
      busy = false;
    }
  }

  $effect(() => listenPdfDrop(add, (h) => (hover = h)));
</script>

<header class="flex items-center justify-between border-b border-gray-200 bg-white px-8 py-4">
  <div>
    <h1 class="text-xl font-semibold">Merge PDF</h1>
    <p class="text-sm text-gray-500">Drag the cards to change the order.</p>
  </div>
  {#if items.length}
    <div class="flex items-center gap-3">
      <span class="text-sm text-gray-500">{items.length} files · {totalPages} pages</span>
      <button class="btn-ghost" onclick={async () => add(await pickPdfs(true))}>+ Add PDFs</button>
      <button class="btn-primary" disabled={items.length < 2 || busy} onclick={merge}>
        {busy ? "Merging…" : "Merge PDF"}
      </button>
    </div>
  {/if}
</header>

<div class="flex flex-1 flex-col overflow-y-auto p-8 {hover && items.length ? 'bg-brand-50' : ''}">
  {#if !items.length}
    <DropZone
      title="Merge PDF files"
      hint="Select two or more PDF files to combine into one."
      {hover}
      onpick={async () => add(await pickPdfs(true))}
    />
  {:else}
    <section
      class="flex flex-wrap content-start gap-5"
      use:dndzone={{ items, flipDurationMs: 150, dropTargetStyle: {} }}
      onconsider={(e) => (items = e.detail.items)}
      onfinalize={(e) => (items = e.detail.items)}
    >
      {#each items as item, i (item.id)}
        <div
          animate:flip={{ duration: 150 }}
          class="group relative flex w-44 cursor-grab flex-col items-center rounded-xl border border-gray-200 bg-white p-3 shadow-sm active:cursor-grabbing"
        >
          <span class="absolute top-2 left-2 z-10 rounded-full bg-gray-800 px-2 py-0.5 text-xs font-medium text-white">
            {i + 1}
          </span>
          <button
            class="absolute top-2 right-2 z-10 hidden h-6 w-6 items-center justify-center rounded-full bg-white text-xs text-gray-500 shadow ring-1 ring-gray-200 group-hover:flex hover:text-red-600"
            aria-label="Remove"
            onclick={() => remove(item.id)}>✕</button
          >
          <PageThumb doc={item.doc} page={1} width={140} aspect={item.aspect} />
          <p class="mt-2 w-full truncate text-center text-xs font-medium" title={item.name}>{item.name}</p>
          <p class="text-xs text-gray-400">{item.pages} {item.pages === 1 ? "page" : "pages"}</p>
        </div>
      {/each}
    </section>
    {#if items.length < 2}
      <p class="mt-6 text-sm text-gray-500">Add at least one more file to merge.</p>
    {/if}
  {/if}
</div>
