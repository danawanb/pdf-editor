<script lang="ts">
  import {
    TEXT_LINE_HEIGHT,
    bounds,
    moveAnn,
    uid,
    type Ann,
    type BoxAnn,
    type DrawAnn,
    type ImageAnn,
    type ShapeAnn,
    type TextAnn,
    type Tool,
  } from "$lib/annotations";

  interface Props {
    anns: Ann[];
    /** page size in points, as displayed */
    width: number;
    height: number;
    /** CSS pixels per point */
    scale: number;
    tool: Tool;
    color: string;
    fontSize: number;
    stroke: number;
    fill: string | null;
    fillOpacity: number;
    selectedId: string | null;
  }
  let {
    anns,
    width,
    height,
    scale,
    tool = $bindable(),
    color,
    fontSize,
    stroke,
    fill,
    fillOpacity,
    selectedId = $bindable(),
  }: Props = $props();

  let layer: HTMLDivElement;
  let editingId = $state<string | null>(null);

  type Drag =
    | { mode: "move"; ann: Ann; last: [number, number]; moved: boolean }
    | { mode: "resize"; ann: Resizable; start: [number, number]; w: number; h: number }
    | { mode: "create"; ann: BoxAnn | ShapeAnn; origin: [number, number] }
    | { mode: "draw"; ann: DrawAnn };
  let drag: Drag | null = null;

  type Resizable = ImageAnn | BoxAnn | ShapeAnn;
  const isResizable = (a: Ann): a is Resizable => a.kind !== "text" && a.kind !== "draw";
  /** tools that start a new mark when pressing on top of an existing annotation */
  const DRAWING_TOOLS: Tool[] = ["draw", "rect", "ellipse", "triangle", "highlight"];

  const HIGHLIGHT = "#ffe14d";

  function point(e: PointerEvent): [number, number] {
    const r = layer.getBoundingClientRect();
    const x = Math.min(Math.max((e.clientX - r.left) / scale, 0), width);
    const y = Math.min(Math.max((e.clientY - r.top) / scale, 0), height);
    return [x, y];
  }

  function find(id: string) {
    return anns.find((a) => a.id === id);
  }

  function remove(id: string) {
    const i = anns.findIndex((a) => a.id === id);
    if (i >= 0) anns.splice(i, 1);
    if (selectedId === id) selectedId = null;
  }

  /** Leave text editing, dropping the annotation if it ended up empty. */
  function stopEditing() {
    if (!editingId) return;
    const a = find(editingId);
    editingId = null;
    if (a?.kind === "text" && !a.text.trim()) remove(a.id);
  }

  function onLayerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const p = point(e);
    stopEditing();
    switch (tool) {
      case "text": {
        const ann: TextAnn = { id: uid(), kind: "text", x: p[0], y: p[1] - (fontSize * TEXT_LINE_HEIGHT) / 2, text: "", size: fontSize, color };
        anns.push(ann);
        selectedId = editingId = ann.id;
        tool = "select";
        e.preventDefault(); // keep focus on the new editor
        return;
      }
      case "highlight":
        anns.push({ id: uid(), kind: "highlight", x: p[0], y: p[1], w: 0, h: 0, color: HIGHLIGHT });
        drag = { mode: "create", ann: anns[anns.length - 1] as BoxAnn, origin: p };
        break;
      case "rect":
      case "ellipse":
      case "triangle":
        anns.push({ id: uid(), kind: tool, x: p[0], y: p[1], w: 0, h: 0, color, stroke, fill, fillOpacity });
        drag = { mode: "create", ann: anns[anns.length - 1] as ShapeAnn, origin: p };
        break;
      case "draw": {
        anns.push({ id: uid(), kind: "draw", points: [p], color, stroke: Math.max(1, stroke) });
        drag = { mode: "draw", ann: anns[anns.length - 1] as DrawAnn };
        break;
      }
      default:
        selectedId = null;
        return;
    }
    layer.setPointerCapture(e.pointerId);
  }

  function onAnnDown(e: PointerEvent, ann: Ann) {
    if (e.button !== 0 || editingId === ann.id) return;
    if (DRAWING_TOOLS.includes(tool)) return; // let the layer start a new shape
    e.stopPropagation();
    e.preventDefault();
    stopEditing();
    tool = "select";
    selectedId = ann.id;
    drag = { mode: "move", ann, last: point(e), moved: false };
    layer.setPointerCapture(e.pointerId);
  }

  function onResizeDown(e: PointerEvent, ann: Ann) {
    if (!isResizable(ann)) return;
    e.stopPropagation();
    e.preventDefault();
    drag = { mode: "resize", ann, start: point(e), w: ann.w, h: ann.h };
    layer.setPointerCapture(e.pointerId);
  }

  function onMove(e: PointerEvent) {
    if (!drag) return;
    const p = point(e);
    switch (drag.mode) {
      case "move": {
        moveAnn(drag.ann, p[0] - drag.last[0], p[1] - drag.last[1]);
        drag.last = p;
        drag.moved = true;
        break;
      }
      case "resize": {
        const a = drag.ann;
        const w = Math.max(8, drag.w + p[0] - drag.start[0]);
        if (a.kind === "image") {
          a.w = w;
          a.h = (w * drag.h) / drag.w;
        } else {
          a.w = w;
          a.h = Math.max(4, drag.h + p[1] - drag.start[1]);
        }
        break;
      }
      case "create": {
        const [ox, oy] = drag.origin;
        Object.assign(drag.ann, {
          x: Math.min(ox, p[0]),
          y: Math.min(oy, p[1]),
          w: Math.abs(p[0] - ox),
          h: Math.abs(p[1] - oy),
        });
        break;
      }
      case "draw":
        drag.ann.points.push(p);
        break;
    }
  }

  function onUp() {
    if (drag?.mode === "create" && drag.ann.w < 3 && drag.ann.h < 3) remove(drag.ann.id);
    drag = null;
  }

  function onDblClick(ann: Ann) {
    if (ann.kind === "text") editingId = ann.id;
  }

  /** Make a text annotation editable in place; commits on input. */
  function editable(node: HTMLElement, ann: TextAnn) {
    node.innerText = ann.text;
    node.focus();
    const range = document.createRange();
    range.selectNodeContents(node);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    const onInput = () => (ann.text = node.innerText.replace(/\n$/, ""));
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation(); // don't trigger editor shortcuts while typing
      if (e.key === "Escape") node.blur();
    };
    node.addEventListener("input", onInput);
    node.addEventListener("keydown", onKey);
    return {
      destroy() {
        node.removeEventListener("input", onInput);
        node.removeEventListener("keydown", onKey);
      },
    };
  }

  function onEditBlur(ann: TextAnn) {
    if (editingId === ann.id) stopEditing();
  }

  function shapeStyle(a: ShapeAnn) {
    return {
      fill: a.fill ?? "none",
      "fill-opacity": a.fillOpacity,
      stroke: a.stroke > 0 ? a.color : "none",
      "stroke-width": a.stroke * scale,
    };
  }

  const cursor = $derived(
    tool === "text" ? "text" : tool === "select" || tool === "image" || tool === "signature" ? "default" : "crosshair",
  );
</script>

<div
  bind:this={layer}
  class="absolute inset-0 touch-none"
  style:cursor
  role="application"
  onpointerdown={onLayerDown}
  onpointermove={onMove}
  onpointerup={onUp}
  onpointercancel={onUp}
>
  {#each anns as ann (ann.id)}
    {@const b = bounds(ann)}
    {@const selected = selectedId === ann.id}
    <div
      class="absolute {selected ? 'outline-2 outline-offset-2 outline-blue-500' : 'hover:outline-1 hover:outline-blue-300'}"
      style:left="{b.x * scale}px"
      style:top="{b.y * scale}px"
      style:width={ann.kind === "text" ? undefined : `${b.w * scale}px`}
      style:height={ann.kind === "text" ? undefined : `${b.h * scale}px`}
      style:cursor={tool === "select" ? (editingId === ann.id ? "text" : "move") : undefined}
      role="presentation"
      onpointerdown={(e) => onAnnDown(e, ann)}
      ondblclick={() => onDblClick(ann)}
    >
      {#if ann.kind === "text"}
        {#if editingId === ann.id}
          <div
            use:editable={ann}
            contenteditable="true"
            class="min-w-4 whitespace-pre outline-none"
            style:font-size="{ann.size * scale}px"
            style:line-height={TEXT_LINE_HEIGHT}
            style:color={ann.color}
            style:font-family="Helvetica, Arial, sans-serif"
            onblur={() => onEditBlur(ann)}
          ></div>
        {:else}
          <div
            class="whitespace-pre"
            style:font-size="{ann.size * scale}px"
            style:line-height={TEXT_LINE_HEIGHT}
            style:color={ann.color}
            style:font-family="Helvetica, Arial, sans-serif"
          >{ann.text}</div>
        {/if}
      {:else if ann.kind === "image"}
        <img src={ann.src} alt="" class="pointer-events-none h-full w-full" draggable="false" />
      {:else if ann.kind === "rect" || ann.kind === "ellipse" || ann.kind === "triangle"}
        {@const w = b.w * scale}
        {@const h = b.h * scale}
        <svg class="pointer-events-none absolute inset-0 overflow-visible" width={w} height={h}>
          {#if ann.kind === "rect"}
            <rect width={w} height={h} {...shapeStyle(ann)} />
          {:else if ann.kind === "ellipse"}
            <ellipse cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} {...shapeStyle(ann)} />
          {:else}
            <polygon points="{w / 2},0 {w},{h} 0,{h}" stroke-linejoin="miter" {...shapeStyle(ann)} />
          {/if}
        </svg>
      {:else if ann.kind === "highlight"}
        <div class="h-full w-full mix-blend-multiply" style:background={ann.color} style:opacity="0.4"></div>
      {:else if ann.kind === "draw"}
        {@const pad = ann.stroke}
        <svg
          class="pointer-events-none absolute overflow-visible"
          style:left="{-pad * scale}px"
          style:top="{-pad * scale}px"
          width={(b.w + 2 * pad) * scale}
          height={(b.h + 2 * pad) * scale}
        >
          <polyline
            points={ann.points.map(([x, y]) => `${(x - b.x + pad) * scale},${(y - b.y + pad) * scale}`).join(" ")}
            fill="none"
            stroke={ann.color}
            stroke-width={ann.stroke * scale}
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      {/if}

      {#if selected && isResizable(ann)}
        <div
          class="absolute -right-2 -bottom-2 h-3.5 w-3.5 cursor-nwse-resize rounded-sm border-2 border-white bg-blue-500 shadow"
          role="presentation"
          onpointerdown={(e) => onResizeDown(e, ann)}
        ></div>
      {/if}
    </div>
  {/each}
</div>
