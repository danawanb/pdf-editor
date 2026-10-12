<script lang="ts">
  import {
    TEXT_FONT,
    TEXT_LINE_HEIGHT,
    bounds,
    centerOf,
    moveAnn,
    normAngle,
    rotatePoint,
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
    selectedIds: string[];
    /** called when an action that changed annotations has finished */
    oncommit: () => void;
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
    selectedIds = $bindable(),
    oncommit,
  }: Props = $props();

  let layer: HTMLDivElement;
  let editingId = $state<string | null>(null);
  /** rubber-band selection rectangle while dragging on empty space */
  let marquee = $state<{ x: number; y: number; w: number; h: number } | null>(null);

  type Drag =
    | { mode: "move"; anns: Ann[]; last: [number, number] }
    | { mode: "marquee"; origin: [number, number]; base: string[] }
    | { mode: "resize"; ann: Resizable; start: [number, number]; x: number; y: number; w: number; h: number }
    | {
        mode: "rotate";
        ann: Ann;
        center: [number, number];
        /** pointer angle (radians) and object angle (degrees) when the drag began */
        from: number;
        angle: number;
        /** original points of a freehand stroke, which is rotated by rewriting them */
        points?: [number, number][];
      }
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
    selectedIds = selectedIds.filter((s) => s !== id);
  }

  /** Shift, ⌘ or Ctrl adds to / toggles the selection instead of replacing it. */
  const additive = (e: PointerEvent) => e.shiftKey || e.metaKey || e.ctrlKey;

  /** Leave text editing, dropping the annotation if it ended up empty. */
  function stopEditing() {
    if (!editingId) return;
    const a = find(editingId);
    editingId = null;
    if (a?.kind === "text" && !a.text.trim()) remove(a.id);
    oncommit();
  }

  function onLayerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const p = point(e);
    stopEditing();
    switch (tool) {
      case "text": {
        const ann: TextAnn = { id: uid(), kind: "text", x: p[0], y: p[1] - (fontSize * TEXT_LINE_HEIGHT) / 2, text: "", size: fontSize, color };
        anns.push(ann);
        selectedIds = [ann.id];
        editingId = ann.id;
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
      default: {
        const base = additive(e) ? [...selectedIds] : [];
        selectedIds = base;
        drag = { mode: "marquee", origin: p, base };
        break;
      }
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
    if (additive(e)) {
      selectedIds = selectedIds.includes(ann.id)
        ? selectedIds.filter((s) => s !== ann.id)
        : [...selectedIds, ann.id];
      return;
    }
    // Dragging an object that's part of the selection moves the whole group.
    if (!selectedIds.includes(ann.id)) selectedIds = [ann.id];
    drag = { mode: "move", anns: anns.filter((a) => selectedIds.includes(a.id)), last: point(e) };
    layer.setPointerCapture(e.pointerId);
  }

  function onResizeDown(e: PointerEvent, ann: Ann) {
    if (!isResizable(ann)) return;
    e.stopPropagation();
    e.preventDefault();
    drag = { mode: "resize", ann, start: point(e), x: ann.x, y: ann.y, w: ann.w, h: ann.h };
    layer.setPointerCapture(e.pointerId);
  }

  function onRotateDown(e: PointerEvent, ann: Ann) {
    e.stopPropagation();
    e.preventDefault();
    const center = centerOf(ann);
    const p = point(e);
    drag = {
      mode: "rotate",
      ann,
      center,
      from: Math.atan2(p[1] - center[1], p[0] - center[0]),
      angle: ann.kind === "draw" ? 0 : (ann.angle ?? 0),
      points: ann.kind === "draw" ? ann.points.map(([x, y]) => [x, y]) : undefined,
    };
    layer.setPointerCapture(e.pointerId);
  }

  function onMove(e: PointerEvent) {
    if (!drag) return;
    const p = point(e);
    switch (drag.mode) {
      case "move": {
        for (const a of drag.anns) moveAnn(a, p[0] - drag.last[0], p[1] - drag.last[1]);
        drag.last = p;
        break;
      }
      case "marquee": {
        const [ox, oy] = drag.origin;
        const m = { x: Math.min(ox, p[0]), y: Math.min(oy, p[1]), w: Math.abs(p[0] - ox), h: Math.abs(p[1] - oy) };
        marquee = m;
        const hit = anns
          .filter((a) => {
            const b = bounds(a);
            return b.x <= m.x + m.w && b.x + b.w >= m.x && b.y <= m.y + m.h && b.y + b.h >= m.y;
          })
          .map((a) => a.id);
        selectedIds = [...new Set([...drag.base, ...hit])];
        break;
      }
      case "resize": {
        const a = drag.ann;
        const angle = a.angle ?? 0;
        // Pointer movement in the object's own (unrotated) frame.
        const [dx, dy] = rotatePoint([p[0] - drag.start[0], p[1] - drag.start[1]], [0, 0], -angle);
        const w = Math.max(8, drag.w + dx);
        const h = a.kind === "image" ? (w * drag.h) / drag.w : Math.max(4, drag.h + dy);
        // Keep the (rotated) top-left corner where it is while the size changes.
        const corner = rotatePoint([drag.x, drag.y], [drag.x + drag.w / 2, drag.y + drag.h / 2], angle);
        const [cx, cy] = rotatePoint([corner[0] + w / 2, corner[1] + h / 2], corner, angle);
        Object.assign(a, { w, h, x: cx - w / 2, y: cy - h / 2 });
        break;
      }
      case "rotate": {
        const center = drag.center;
        const [cx, cy] = center;
        let angle = drag.angle + ((Math.atan2(p[1] - cy, p[0] - cx) - drag.from) * 180) / Math.PI;
        if (e.shiftKey) angle = Math.round(angle / 15) * 15; // snap to 15°
        const a = drag.ann;
        if (a.kind === "draw") a.points = drag.points!.map((pt) => rotatePoint(pt, center, angle));
        else a.angle = normAngle(angle);
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
    if (!drag) return;
    if (drag.mode === "create" && drag.ann.w < 3 && drag.ann.h < 3) remove(drag.ann.id);
    drag = null;
    marquee = null;
    oncommit();
  }

  function onDblClick(ann: Ann) {
    if (ann.kind !== "text") return;
    selectedIds = [ann.id];
    editingId = ann.id;
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
    {@const selected = selectedIds.includes(ann.id)}
    <div
      class="absolute {selected ? 'outline-2 outline-offset-2 outline-blue-500' : 'hover:outline-1 hover:outline-blue-300'}"
      style:left="{b.x * scale}px"
      style:top="{b.y * scale}px"
      style:width={ann.kind === "text" ? undefined : `${b.w * scale}px`}
      style:height={ann.kind === "text" ? undefined : `${b.h * scale}px`}
      style:cursor={tool === "select" ? (editingId === ann.id ? "text" : "move") : undefined}
      style:transform={ann.kind !== "draw" && ann.angle ? `rotate(${ann.angle}deg)` : undefined}
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
            style:font-family={TEXT_FONT}
            onblur={() => onEditBlur(ann)}
          ></div>
        {:else}
          <div
            class="whitespace-pre"
            style:font-size="{ann.size * scale}px"
            style:line-height={TEXT_LINE_HEIGHT}
            style:color={ann.color}
            style:font-family={TEXT_FONT}
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

      {#if selected && selectedIds.length === 1 && isResizable(ann)}
        <div
          class="absolute -right-2 -bottom-2 h-3.5 w-3.5 cursor-nwse-resize rounded-sm border-2 border-white bg-blue-500 shadow"
          role="presentation"
          onpointerdown={(e) => onResizeDown(e, ann)}
        ></div>
      {/if}

      {#if selected && selectedIds.length === 1 && editingId !== ann.id}
        <!-- rotate handle: a knob on a short stem above the top edge -->
        <div class="pointer-events-none absolute -top-7 left-1/2 h-5 w-px -translate-x-1/2 bg-blue-500"></div>
        <div
          class="absolute -top-9 left-1/2 h-3.5 w-3.5 -translate-x-1/2 cursor-grab rounded-full border-2 border-blue-500 bg-white shadow active:cursor-grabbing"
          title="Drag to rotate (Shift snaps to 15°)"
          role="presentation"
          onpointerdown={(e) => onRotateDown(e, ann)}
        ></div>
      {/if}
    </div>
  {/each}

  {#if marquee}
    <div
      class="pointer-events-none absolute border border-dashed border-blue-500 bg-blue-500/10"
      style:left="{marquee.x * scale}px"
      style:top="{marquee.y * scale}px"
      style:width="{marquee.w * scale}px"
      style:height="{marquee.h * scale}px"
    ></div>
  {/if}
</div>
