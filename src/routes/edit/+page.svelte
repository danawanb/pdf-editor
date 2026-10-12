<script lang="ts">
  import { flushSync } from "svelte";
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
  import { SHAPES, normAngle, rotateAnnBy, uid, type ShapeAnn, type Tool } from "$lib/annotations";
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
  let selectedIds = $state<string[]>([]);
  let signing = $state(false);
  let viewW = $state(800);
  let canvas = $state<HTMLCanvasElement>();

  const page = $derived(editor.current);
  const size = $derived(page ? editor.size(page) : { w: 1, h: 1 });

  // Zoom: "fit" follows the window width; a number is relative to actual size
  // (100% = the page at its physical size on screen).
  const PX_PER_PT = 96 / 72;
  const ZOOM_MIN = 0.25;
  const ZOOM_MAX = 4;
  const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
  let zoom = $state<number | "fit">("fit");
  let scroller = $state<HTMLDivElement>();
  let pageEl = $state<HTMLDivElement>();
  const scale = $derived(zoom === "fit" ? Math.max((viewW - 64) / size.w, 0.1) : zoom * PX_PER_PT);
  const zoomFactor = $derived(scale / PX_PER_PT);
  const selectedAnns = $derived(page?.anns.filter((a) => selectedIds.includes(a.id)) ?? []);
  const selectedShapes = $derived(selectedAnns.filter((a): a is ShapeAnn => SHAPES.includes(a.kind)));
  // Controls show the values of the first selected object of the matching kind.
  const selected = $derived(selectedAnns[0] ?? null);
  const selectedShape = $derived(selectedShapes[0] ?? null);
  const selectedText = $derived(selectedAnns.find((a) => a.kind === "text") ?? null);
  const selectedStroked = $derived(selectedAnns.find((a) => a.kind === "draw" || SHAPES.includes(a.kind)) ?? null);
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
      selectedIds = [];
      tool = "select";
    } catch (e) {
      notify("error", `Could not open ${fileName(p)}: ${errorMessage(e)}`);
    }
  }

  // Render the current page whenever it, its rotation or the zoom changes.
  // Zoom-only changes are debounced: meanwhile the old bitmap is stretched.
  let renderedKey = "";
  $effect(() => {
    if (!editor.doc || !page || !canvas) return;
    const [doc, el, src, rotate, width] = [editor.doc, canvas, page.src, page.rotate, size.w * scale];
    const key = `${page.id}:${rotate}`;
    const delay = key === renderedKey ? 120 : 0;
    renderedKey = key;
    let cancel: (() => void) | undefined;
    const timer = setTimeout(() => (cancel = renderPage(doc, src, el, width, rotate)), delay);
    return () => {
      clearTimeout(timer);
      cancel?.();
    };
  });

  /**
   * Set the zoom factor, keeping the page point under `anchor` (client
   * coordinates; defaults to the middle of the view) in place.
   */
  function setZoom(factor: number, anchor?: { x: number; y: number }) {
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, factor));
    if (!scroller || !pageEl) return void (zoom = next);
    const view = scroller.getBoundingClientRect();
    const a = anchor ?? { x: view.left + view.width / 2, y: view.top + view.height / 2 };
    const before = pageEl.getBoundingClientRect();
    const pt = { x: (a.x - before.left) / scale, y: (a.y - before.top) / scale };
    // Apply synchronously so rapid wheel events each measure an up-to-date layout.
    flushSync(() => (zoom = next));
    const after = pageEl.getBoundingClientRect();
    scroller.scrollLeft += after.left + pt.x * scale - a.x;
    scroller.scrollTop += after.top + pt.y * scale - a.y;
  }
  const zoomIn = () => setZoom(ZOOM_STEPS.find((z) => z > zoomFactor + 0.001) ?? ZOOM_MAX);
  const zoomOut = () => setZoom(ZOOM_STEPS.findLast((z) => z < zoomFactor - 0.001) ?? ZOOM_MIN);
  const zoomFit = () => (zoom = "fit");

  // ⌘/Ctrl + scroll wheel (and trackpad pinch in Chromium-based WebView2)
  // zooms around the cursor. Needs a non-passive listener to stop the scroll.
  $effect(() => {
    const el = scroller;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom(zoomFactor * Math.exp(-e.deltaY * 0.01), { x: e.clientX, y: e.clientY });
    };
    // Trackpad pinch in WebKit (macOS) arrives as gesture events instead.
    let start = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      start = zoomFactor;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as Event & { scale: number; clientX: number; clientY: number };
      setZoom(start * g.scale, { x: g.clientX, y: g.clientY });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGestureStart);
    el.addEventListener("gesturechange", onGestureChange);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
    };
  });

  function selectTool(t: Tool) {
    if (t === "image") return void addImage();
    if (t === "signature") return void (signing = true);
    tool = t;
    selectedIds = [];
  }

  /** Put an image of natural size `nw`×`nh` in the middle of the page. */
  function place(src: string, nw: number, nh: number, width: number) {
    if (!page) return;
    const w = Math.min(width, size.w * 0.6);
    const h = (w * nh) / nw;
    const id = uid();
    page.anns.push({ id, kind: "image", x: (size.w - w) / 2, y: (size.h - h) / 2, w, h, src });
    selectedIds = [id];
    tool = "select";
    editor.commit();
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

  // Style setters update the defaults and the selected annotation. Pass
  // `live` while a picker/slider is being dragged; its change event commits.
  function setColor(c: string, live = false) {
    color = c;
    for (const a of selectedAnns) {
      if (a.kind === "text" || a.kind === "draw" || SHAPES.includes(a.kind)) (a as { color: string }).color = c;
    }
    if (!live) editor.commit();
  }
  function setFontSize(s: number) {
    fontSize = s;
    for (const a of selectedAnns) if (a.kind === "text") a.size = s;
    editor.commit();
  }
  function setStroke(s: number) {
    stroke = s;
    for (const a of selectedShapes) a.stroke = s;
    for (const a of selectedAnns) if (a.kind === "draw") a.stroke = Math.max(1, s);
    editor.commit();
  }
  function setFill(c: string | null, live = false) {
    fill = c;
    for (const a of selectedShapes) a.fill = c;
    if (!live) editor.commit();
  }
  function setFillOpacity(o: number, live = false) {
    fillOpacity = o;
    for (const a of selectedShapes) a.fillOpacity = o;
    if (!live) editor.commit();
  }

  function rotateSelected(deg: number) {
    for (const a of selectedAnns) rotateAnnBy(a, deg);
    editor.commit();
  }
  function setAngle(deg: number) {
    if (selected && selected.kind !== "draw" && Number.isFinite(deg)) {
      selected.angle = normAngle(deg);
      editor.commit();
    }
  }

  function copySelected() {
    if (selectedAnns.length) editor.copy(selectedAnns);
  }
  function cutSelected() {
    if (!selectedAnns.length) return;
    editor.copy(selectedAnns);
    deleteSelected();
  }
  function paste() {
    if (!page) return;
    const ids = editor.paste(page);
    if (ids.length) {
      selectedIds = ids;
      tool = "select";
    }
  }
  function selectAll() {
    if (!page) return;
    tool = "select";
    selectedIds = page.anns.map((a) => a.id);
  }

  function undo() {
    editor.undo();
    selectedIds = [];
  }
  function redo() {
    editor.redo();
    selectedIds = [];
  }

  function deleteSelected() {
    if (!page || !selectedIds.length) return;
    page.anns = page.anns.filter((a) => !selectedIds.includes(a.id));
    selectedIds = [];
    editor.commit();
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
    const typing =
      t.isContentEditable ||
      t.tagName === "TEXTAREA" ||
      (t instanceof HTMLInputElement && !["range", "color", "radio", "checkbox"].includes(t.type));
    if (typing) return; // let text fields handle their own undo
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (mod && key === "s") {
      e.preventDefault();
      save();
    } else if (mod && (key === "y" || (key === "z" && e.shiftKey))) {
      e.preventDefault();
      redo();
    } else if (mod && key === "z") {
      e.preventDefault();
      undo();
    } else if (mod && (key === "=" || key === "+")) {
      e.preventDefault();
      zoomIn();
    } else if (mod && key === "-") {
      e.preventDefault();
      zoomOut();
    } else if (mod && key === "0") {
      e.preventDefault();
      zoomFit();
    } else if (mod && key === "a") {
      e.preventDefault();
      selectAll();
    } else if (mod && key === "c" && selected) {
      e.preventDefault();
      copySelected();
    } else if (mod && key === "x" && selected) {
      e.preventDefault();
      cutSelected();
    } else if (mod && key === "v" && editor.clipboard.length) {
      e.preventDefault();
      paste();
    } else if (mod && key === "d" && selected) {
      // duplicate in place: copy + paste in one go
      e.preventDefault();
      copySelected();
      paste();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      if (selectedIds.length) {
        e.preventDefault();
        deleteSelected();
      }
    } else if (e.key === "Escape") {
      shapeMenuOpen = false;
      selectedIds = [];
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
        onfinalize={(e) => {
          editor.pages = e.detail.items;
          editor.commit();
        }}
      >
        {#each editor.pages as p, i (p.id)}
          {@const s = editor.size(p)}
          {@const active = page?.id === p.id}
          <div animate:flip={{ duration: 150 }} class="group flex w-full flex-col items-center">
            <button
              class="relative rounded-md p-1 {active ? 'bg-brand-500' : 'hover:bg-gray-200'}"
              onclick={() => {
                editor.currentId = p.id;
                selectedIds = [];
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
        <button
          class="icon-btn h-9 w-9 text-lg"
          title="Undo (⌘/Ctrl+Z)"
          aria-label="Undo"
          disabled={!editor.canUndo}
          onclick={undo}>↶</button
        >
        <button
          class="icon-btn h-9 w-9 text-lg"
          title="Redo (⌘/Ctrl+Shift+Z)"
          aria-label="Redo"
          disabled={!editor.canRedo}
          onclick={redo}>↷</button
        >
        <div class="mx-1 h-6 w-px bg-gray-200"></div>

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
          oninput={(e) => setColor(e.currentTarget.value, true)}
          onchange={() => editor.commit()}
          title="Custom color"
        />

        <div class="mx-2 h-6 w-px bg-gray-200"></div>

        <label class="flex items-center gap-1 text-xs text-gray-500">
          Font size
          <select
            class="rounded border border-gray-300 px-1 py-1 text-sm text-gray-800"
            value={selectedText?.kind === "text" ? selectedText.size : fontSize}
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
            value={selectedStroked && "stroke" in selectedStroked ? selectedStroked.stroke : stroke}
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
            oninput={(e) => setFill(e.currentTarget.value, true)}
            onchange={() => editor.commit()}
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
                oninput={(e) => setFillOpacity(Number(e.currentTarget.value) / 100, true)}
                onchange={() => editor.commit()}
              />
              <span class="w-8 tabular-nums">{Math.round(shownFillOpacity * 100)}%</span>
            </label>
          {/if}
        {/if}

        <div class="ml-auto flex items-center gap-2">
          {#if selected}
            <div class="flex items-center gap-0.5">
              <button class="icon-btn" title="Rotate 90° left" aria-label="Rotate left" onclick={() => rotateSelected(-90)}>⟲</button>
              {#if selectedAnns.length === 1 && selected.kind !== "draw"}
                <label class="flex items-center text-xs text-gray-500" title="Rotation angle">
                  <input
                    type="number"
                    step="1"
                    class="w-14 rounded border border-gray-300 px-1 py-1 text-right text-sm text-gray-800"
                    value={Math.round(selected.angle ?? 0)}
                    onchange={(e) => setAngle(Number(e.currentTarget.value))}
                  />°
                </label>
              {/if}
              <button class="icon-btn" title="Rotate 90° right" aria-label="Rotate right" onclick={() => rotateSelected(90)}>⟳</button>
            </div>
          {/if}
          {#if selected}
            <button class="btn-ghost py-1.5" title="Copy (⌘/Ctrl+C)" onclick={copySelected}>Copy</button>
          {/if}
          {#if selectedIds.length > 1}
            <span class="self-center text-xs text-gray-500">{selectedIds.length} selected</span>
          {/if}
          {#if editor.clipboard.length}
            <button class="btn-ghost py-1.5" title="Paste (⌘/Ctrl+V)" onclick={paste}>Paste</button>
          {/if}
          {#if selected}
            <button class="btn-ghost py-1.5 text-red-600" title="Delete" onclick={deleteSelected}>Delete</button>
          {/if}
        </div>
      </div>

      <div class="flex-1 overflow-auto bg-gray-100" bind:this={scroller} bind:clientWidth={viewW}>
        {#if page}
          <!-- w-max + min-w-full: centred when smaller than the view, scrollable when larger -->
          <div class="flex min-h-full w-max min-w-full items-start justify-center p-8">
            <div
              bind:this={pageEl}
              class="relative shrink-0 shadow-lg ring-1 ring-black/10"
              style:width="{size.w * scale}px"
              style:height="{size.h * scale}px"
            >
              <canvas
                bind:this={canvas}
                class="block bg-white"
                style:width="{size.w * scale}px"
                style:height="{size.h * scale}px"
              ></canvas>
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
                  bind:selectedIds
                  oncommit={() => editor.commit()}
                />
              {/key}
            </div>
          </div>
        {/if}
      </div>
      <div class="flex items-center gap-4 border-t border-gray-200 bg-white px-4 py-1">
      <p class="min-w-0 flex-1 truncate text-xs text-gray-400">
        ⌘/Ctrl +/− or pinch to zoom · Shift/⌘-click or drag a box to select several · ⌘/Ctrl+A select all · Drag the round handle to rotate (Shift snaps 15°) · Double-click text to edit · Delete removes selected · ⌘/Ctrl+C/X/V copy, cut, paste · ⌘/Ctrl+D duplicate · ⌘/Ctrl+Z undo · ⌘/Ctrl+Shift+Z redo · ⌘/Ctrl+S save
      </p>
      <div class="flex shrink-0 items-center gap-1">
        <button class="icon-btn h-7 w-7" title="Zoom out (⌘/Ctrl −)" aria-label="Zoom out" disabled={zoomFactor <= ZOOM_MIN + 0.001} onclick={zoomOut}>−</button>
        <select
          class="rounded border border-gray-300 px-1 py-0.5 text-xs tabular-nums"
          title="Zoom"
          value={zoom === "fit" ? "fit" : "custom"}
          onchange={(e) => {
            const v = e.currentTarget.value;
            if (v === "fit") zoomFit();
            else if (v !== "custom") setZoom(Number(v));
            e.currentTarget.value = zoom === "fit" ? "fit" : "custom";
          }}
        >
          <option value="custom" hidden>{Math.round(zoomFactor * 100)}%</option>
          <option value="fit">Fit width{zoom === "fit" ? ` (${Math.round(zoomFactor * 100)}%)` : ""}</option>
          {#each [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as z}
            <option value={z}>{z * 100}%</option>
          {/each}
        </select>
        <button class="icon-btn h-7 w-7" title="Zoom in (⌘/Ctrl +)" aria-label="Zoom in" disabled={zoomFactor >= ZOOM_MAX - 0.001} onclick={zoomIn}>+</button>
      </div>
      </div>
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
