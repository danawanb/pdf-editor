<script lang="ts">
  import { flip } from "svelte/animate";
  import { dndzone } from "svelte-dnd-action";
  import { revealItemInDir } from "@tauri-apps/plugin-opener";
  import {
    applyPageOps,
    errorMessage,
    fileName,
    listenPdfDrop,
    pickImage,
    pickPdfs,
    pickSavePath,
    readFile,
    stem,
    writeFile,
  } from "$lib/api";
  import { applyAnnotations } from "$lib/annotate";
  import { SHAPES, uid, type ShapeAnn, type Tool } from "$lib/annotations";
  import { editor } from "$lib/editor.svelte";
  import { displaySize, loadPdf, renderPage } from "$lib/pdfjs";
  import { notify } from "$lib/toast.svelte";
  import AnnotationLayer from "$lib/components/AnnotationLayer.svelte";
  import DropZone from "$lib/components/DropZone.svelte";
  import PageThumb from "$lib/components/PageThumb.svelte";
  import SignaturePad from "$lib/components/SignaturePad.svelte";

  let hover = $state(false);
  let busy = $state(false);
  let tool = $state<Tool>("select");
  let color = $state("#1f2937");
  let fontSize = $state(16);
  let stroke = $state(2);
  /** fill for new shapes; null = transparent */
  let fill = $state<string | null>(null);
  let fillOpacity = $state(1);
  let selectedId = $state<string | null>(null);
  let signing = $state(false);
  let viewW = $state(800);
  let canvas = $state<HTMLCanvasElement>();

  const page = $derived(editor.current);
  const size = $derived(page ? editor.size(page) : { w: 1, h: 1 });
  const scale = $derived(Math.min(Math.max((viewW - 64) / size.w, 0.3), 2));
  const selected = $derived(page?.anns.find((a) => a.id === selectedId) ?? null);
  const selectedShape = $derived(selected && SHAPES.includes(selected.kind) ? (selected as ShapeAnn) : null);
  /** fill controls reflect the selected shape, else the defaults for new shapes */
  const shownFill = $derived(selectedShape ? selectedShape.fill : fill);
  const shownFillOpacity = $derived(selectedShape ? selectedShape.fillOpacity : fillOpacity);
  const showFill = $derived(selectedShape !== null || SHAPES.includes(tool));

  type ToolDef = { id: Tool; label: string; icon: string };
  const shapeTools: ToolDef[] = [
    { id: "rect", label: "Rectangle", icon: "▭" },
    { id: "ellipse", label: "Circle", icon: "◯" },
    { id: "triangle", label: "Triangle", icon: "△" },
  ];
  /** "shapes" marks where the shape dropdown sits in the toolbar */
  const tools: (ToolDef | "shapes")[] = [
    { id: "select", label: "Select / move", icon: "🖱️" },
    { id: "text", label: "Text", icon: "T" },
    { id: "image", label: "Image", icon: "🖼️" },
    { id: "signature", label: "Signature", icon: "✍️" },
    { id: "highlight", label: "Highlight", icon: "🖍️" },
    "shapes",
    { id: "draw", label: "Freehand", icon: "✏️" },
  ];
  let shapeMenuOpen = $state(false);
  let shapeMenu = $state<HTMLDivElement>();
  let lastShape = $state(shapeTools[0]);
  const activeShape = $derived(shapeTools.find((t) => t.id === tool));
  const swatches = ["#1f2937", "#e5322d", "#2563eb", "#16a34a", "#d97706", "#ffffff"];

  async function open(paths: string[]) {
    const p = paths[0];
    if (!p) return;
    try {
      const doc = await loadPdf(await readFile(p));
      const sizes = await Promise.all(Array.from({ length: doc.numPages }, (_, i) => displaySize(doc, i + 1)));
      editor.open(
        p,
        doc,
        sizes.map((s) => ({ w: s.width, h: s.height })),
      );
      selectedId = null;
      tool = "select";
    } catch (e) {
      notify("error", `Could not open ${fileName(p)}: ${errorMessage(e)}`);
    }
  }

  // Render the current page whenever it, its rotation or the zoom changes.
  $effect(() => {
    if (editor.doc && page && canvas) return renderPage(editor.doc, page.src, canvas, size.w * scale, page.rotate);
  });

  function selectTool(t: Tool) {
    if (t === "image") return void addImage();
    if (t === "signature") return void (signing = true);
    tool = t;
    selectedId = null;
  }

  /** Put an image of natural size `nw`×`nh` in the middle of the page. */
  function place(src: string, nw: number, nh: number, width: number) {
    if (!page) return;
    const w = Math.min(width, size.w * 0.6);
    const h = (w * nh) / nw;
    const id = uid();
    page.anns.push({ id, kind: "image", x: (size.w - w) / 2, y: (size.h - h) / 2, w, h, src });
    selectedId = id;
    tool = "select";
  }

  async function addImage() {
    const path = await pickImage();
    if (!path) return;
    try {
      const mime = /\.png$/i.test(path) ? "image/png" : "image/jpeg";
      const blob = new Blob([(await readFile(path)) as BlobPart], { type: mime });
      const src = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.onerror = () => rej(r.error);
        r.readAsDataURL(blob);
      });
      const img = new Image();
      img.src = src;
      await img.decode();
      place(src, img.naturalWidth, img.naturalHeight, 220);
    } catch (e) {
      notify("error", `Could not load image: ${errorMessage(e)}`);
    }
  }

  function setColor(c: string) {
    color = c;
    if (selected && (selected.kind === "text" || selected.kind === "draw" || selectedShape)) {
      (selected as { color: string }).color = c;
    }
  }
  function setFontSize(s: number) {
    fontSize = s;
    if (selected?.kind === "text") selected.size = s;
  }
  function setStroke(s: number) {
    stroke = s;
    if (selectedShape) selectedShape.stroke = s;
    else if (selected?.kind === "draw") selected.stroke = Math.max(1, s);
  }
  function setFill(c: string | null) {
    fill = c;
    if (selectedShape) selectedShape.fill = c;
  }
  function setFillOpacity(o: number) {
    fillOpacity = o;
    if (selectedShape) selectedShape.fillOpacity = o;
  }

  function deleteSelected() {
    if (!page || !selectedId) return;
    const i = page.anns.findIndex((a) => a.id === selectedId);
    if (i >= 0) page.anns.splice(i, 1);
    selectedId = null;
  }

  function removePage(p: (typeof editor.pages)[number]) {
    if (!editor.remove(p)) notify("error", "A PDF must have at least one page.");
  }

  async function save() {
    if (!editor.path || busy) return;
    const output = await pickSavePath(`${stem(editor.path)}_edit.pdf`);
    if (!output) return;
    busy = true;
    try {
      const pages = $state.snapshot(editor.pages);
      let bytes = await applyPageOps(
        editor.path,
        pages.map((p) => ({ doc: 0, page: p.src, rotate: p.rotate })),
      );
      if (pages.some((p) => p.anns.length)) {
        bytes = await applyAnnotations(
          bytes,
          pages.map((p) => p.anns),
        );
      }
      await writeFile(output, bytes);
      notify("success", `Saved: ${fileName(output)}`, {
        label: "Show in folder",
        run: () => revealItemInDir(output),
      });
    } catch (e) {
      notify("error", errorMessage(e));
    } finally {
      busy = false;
    }
  }

  function onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      save();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      if (selectedId) {
        e.preventDefault();
        deleteSelected();
      }
    } else if (e.key === "Escape") {
      shapeMenuOpen = false;
      selectedId = null;
      tool = "select";
    }
  }

  $effect(() => listenPdfDrop(open, (h) => (hover = h)));
</script>

<svelte:window
  onkeydown={onKey}
  onpointerdown={(e) => {
    if (shapeMenuOpen && !shapeMenu?.contains(e.target as Node)) shapeMenuOpen = false;
  }}
/>

<header class="flex items-center justify-between border-b border-gray-200 bg-white px-8 py-4">
  <div class="min-w-0">
    <h1 class="text-xl font-semibold">Edit PDF</h1>
    <p class="truncate text-sm text-gray-500">
      {editor.path ? `${fileName(editor.path)} · ${editor.pages.length} pages` : "Organize pages and add annotations."}
    </p>
  </div>
  {#if editor.doc}
    <div class="flex gap-3">
      <button class="btn-ghost" onclick={async () => open(await pickPdfs(false))}>Open another file</button>
      <button class="btn-primary" disabled={busy} onclick={save}>{busy ? "Saving…" : "Save PDF"}</button>
    </div>
  {/if}
</header>

{#if !editor.doc}
  <div class="flex flex-1 flex-col p-8">
    <DropZone
      title="Edit PDF file"
      hint="Rotate, delete, duplicate and reorder pages, and add text, images, signatures and shapes."
      {hover}
      onpick={async () => open(await pickPdfs(false))}
    />
  </div>
{:else}
  {@const doc = editor.doc}
  <div class="flex min-h-0 flex-1">
    <!-- Page list -->
    <aside class="w-52 shrink-0 overflow-y-auto border-r border-gray-200 bg-white px-4 py-4">
      <section
        class="flex flex-col items-center gap-4"
        use:dndzone={{ items: editor.pages, flipDurationMs: 150, dropTargetStyle: {} }}
        onconsider={(e) => (editor.pages = e.detail.items)}
        onfinalize={(e) => (editor.pages = e.detail.items)}
      >
        {#each editor.pages as p, i (p.id)}
          {@const s = editor.size(p)}
          {@const active = page?.id === p.id}
          <div animate:flip={{ duration: 150 }} class="group flex w-full flex-col items-center">
            <button
              class="relative rounded-md p-1 {active ? 'bg-brand-500' : 'hover:bg-gray-200'}"
              onclick={() => {
                editor.currentId = p.id;
                selectedId = null;
              }}
            >
              <PageThumb {doc} page={p.src} width={128} rotate={p.rotate} aspect={s.h / s.w} />
              {#if p.anns.length}
                <span class="absolute right-2 bottom-2 rounded bg-blue-600 px-1.5 text-[10px] font-medium text-white"
                  >✎ {p.anns.length}</span
                >
              {/if}
            </button>
            <div class="mt-1 flex h-7 items-center gap-0.5">
              <span class="w-6 text-center text-xs font-medium text-gray-500">{i + 1}</span>
              <div class="hidden gap-0.5 group-hover:flex">
                <button class="icon-btn h-6 w-6 text-xs" title="Rotate left" onclick={() => editor.rotate(p, -90)}>⟲</button>
                <button class="icon-btn h-6 w-6 text-xs" title="Rotate right" onclick={() => editor.rotate(p, 90)}>⟳</button>
                <button class="icon-btn h-6 w-6 text-xs" title="Duplicate" onclick={() => editor.duplicate(p)}>⧉</button>
                <button class="icon-btn h-6 w-6 text-xs hover:text-red-600" title="Delete page" onclick={() => removePage(p)}
                  >🗑</button
                >
              </div>
            </div>
          </div>
        {/each}
      </section>
    </aside>

    <!-- Canvas -->
    <div class="flex min-w-0 flex-1 flex-col">
      <div class="flex flex-wrap items-center gap-1 border-b border-gray-200 bg-white px-4 py-2">
        {#each tools as t}
          {#if t === "shapes"}
            {@const shown = activeShape ?? lastShape}
            <div class="relative" bind:this={shapeMenu}>
              <button
                class="flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition
                  {activeShape ? 'bg-brand-500 text-white' : 'text-gray-700 hover:bg-gray-100'}"
                title="Shapes"
                aria-haspopup="menu"
                aria-expanded={shapeMenuOpen}
                onclick={() => (shapeMenuOpen = !shapeMenuOpen)}
              >
                <span class="font-serif">{shown.icon}</span><span class="hidden xl:inline">{shown.label}</span>
                <span class="text-[10px] opacity-70">▼</span>
              </button>
              {#if shapeMenuOpen}
                <div
                  class="absolute top-full left-0 z-30 mt-1 w-40 rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
                  role="menu"
                >
                  {#each shapeTools as st}
                    <button
                      class="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm
                        {tool === st.id ? 'bg-brand-50 text-brand-600' : 'text-gray-700 hover:bg-gray-100'}"
                      role="menuitem"
                      onclick={() => {
                        lastShape = st;
                        shapeMenuOpen = false;
                        selectTool(st.id);
                      }}
                    >
                      <span class="w-4 text-center font-serif">{st.icon}</span>{st.label}
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          {:else}
            <button
              class="flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition
                {tool === t.id ? 'bg-brand-500 text-white' : 'text-gray-700 hover:bg-gray-100'}"
              title={t.label}
              onclick={() => selectTool(t.id)}
            >
              <span class="font-serif">{t.icon}</span><span class="hidden xl:inline">{t.label}</span>
            </button>
          {/if}
        {/each}

        <div class="mx-2 h-6 w-px bg-gray-200"></div>

        {#each swatches as c}
          <button
            class="h-6 w-6 rounded-full ring-1 ring-black/20 {color === c ? 'outline-2 outline-offset-2 outline-brand-500' : ''}"
            style:background={c}
            title={c}
            aria-label="Color {c}"
            onclick={() => setColor(c)}
          ></button>
        {/each}
        <input
          type="color"
          class="h-7 w-8 cursor-pointer rounded border-0 bg-transparent"
          value={color}
          oninput={(e) => setColor(e.currentTarget.value)}
          title="Custom color"
        />

        <div class="mx-2 h-6 w-px bg-gray-200"></div>

        <label class="flex items-center gap-1 text-xs text-gray-500">
          Font size
          <select
            class="rounded border border-gray-300 px-1 py-1 text-sm text-gray-800"
            value={selected?.kind === "text" ? selected.size : fontSize}
            onchange={(e) => setFontSize(Number(e.currentTarget.value))}
          >
            {#each [8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64] as s}
              <option value={s}>{s}</option>
            {/each}
          </select>
        </label>
        <label class="ml-2 flex items-center gap-1 text-xs text-gray-500">
          Line width
          <select
            class="rounded border border-gray-300 px-1 py-1 text-sm text-gray-800"
            value={selectedShape ? selectedShape.stroke : selected?.kind === "draw" ? selected.stroke : stroke}
            onchange={(e) => setStroke(Number(e.currentTarget.value))}
          >
            {#each [0, 1, 2, 3, 4, 6, 8] as s}
              <option value={s}>{s === 0 ? "0 (no outline)" : s}</option>
            {/each}
          </select>
        </label>

        {#if showFill}
          <div class="mx-2 h-6 w-px bg-gray-200"></div>
          <span class="text-xs text-gray-500">Fill</span>
          <button
            class="relative h-6 w-6 overflow-hidden rounded-full bg-white ring-1 ring-black/20
              {shownFill === null ? 'outline-2 outline-offset-2 outline-brand-500' : ''}"
            title="Transparent (no fill)"
            aria-label="Transparent fill"
            onclick={() => setFill(null)}
          >
            <span class="absolute top-1/2 left-1/2 h-0.5 w-8 -translate-x-1/2 -translate-y-1/2 -rotate-45 bg-red-500"></span>
          </button>
          {#each swatches as c}
            <button
              class="h-6 w-6 rounded-md ring-1 ring-black/20 {shownFill === c ? 'outline-2 outline-offset-2 outline-brand-500' : ''}"
              style:background={c}
              title="Fill {c}"
              aria-label="Fill {c}"
              onclick={() => setFill(c)}
            ></button>
          {/each}
          <input
            type="color"
            class="h-7 w-8 cursor-pointer rounded border-0 bg-transparent"
            value={shownFill ?? "#ffffff"}
            oninput={(e) => setFill(e.currentTarget.value)}
            title="Custom fill color"
          />
          {#if shownFill !== null}
            <label class="ml-1 flex items-center gap-1.5 text-xs text-gray-500" title="Fill opacity">
              <input
                type="range"
                min="0"
                max="100"
                class="w-20 accent-brand-500"
                value={Math.round(shownFillOpacity * 100)}
                oninput={(e) => setFillOpacity(Number(e.currentTarget.value) / 100)}
              />
              <span class="w-8 tabular-nums">{Math.round(shownFillOpacity * 100)}%</span>
            </label>
          {/if}
        {/if}

        {#if selected}
          <button class="btn-ghost ml-auto py-1.5 text-red-600" onclick={deleteSelected}>Delete annotation</button>
        {/if}
      </div>

      <div class="flex-1 overflow-auto bg-gray-100" bind:clientWidth={viewW}>
        {#if page}
          <div class="flex min-h-full items-start justify-center p-8">
            <div class="relative shadow-lg ring-1 ring-black/10" style:width="{size.w * scale}px" style:height="{size.h * scale}px">
              <canvas bind:this={canvas} class="block bg-white"></canvas>
              {#key page.id}
                <AnnotationLayer
                  anns={page.anns}
                  width={size.w}
                  height={size.h}
                  {scale}
                  bind:tool
                  {color}
                  {fontSize}
                  {stroke}
                  {fill}
                  {fillOpacity}
                  bind:selectedId
                />
              {/key}
            </div>
          </div>
        {/if}
      </div>
      <p class="border-t border-gray-200 bg-white px-4 py-1.5 text-xs text-gray-400">
        Double-click text to edit · Delete removes the selected annotation · ⌘/Ctrl+S to save
      </p>
    </div>
  </div>
{/if}

{#if signing}
  <SignaturePad
    {color}
    oncancel={() => (signing = false)}
    onsave={(src, w, h) => {
      signing = false;
      place(src, w, h, 160);
    }}
  />
{/if}
