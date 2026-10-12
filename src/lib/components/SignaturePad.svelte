<script lang="ts">
  interface Props {
    color: string;
    onsave: (dataUrl: string, width: number, height: number) => void;
    oncancel: () => void;
  }
  let { color, onsave, oncancel }: Props = $props();

  const W = 560;
  const H = 220;
  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D;
  let drawing = false;
  let empty = $state(true);
  let last: [number, number] = [0, 0];

  $effect(() => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2.5;
  });

  const pos = (e: PointerEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  function down(e: PointerEvent) {
    drawing = true;
    canvas.setPointerCapture(e.pointerId);
    last = pos(e);
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(last[0], last[1], 1.2, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    empty = false;
  }

  function move(e: PointerEvent) {
    if (!drawing) return;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(...last);
    ctx.lineTo(...p);
    ctx.stroke();
    last = p;
  }

  function clear() {
    ctx.clearRect(0, 0, W, H);
    empty = true;
  }

  /** Crop to the drawn strokes so the placed image has no empty margins. */
  function save() {
    const { width, height } = canvas;
    const data = canvas.getContext("2d")!.getImageData(0, 0, width, height).data;
    let x0 = width, y0 = height, x1 = 0, y1 = 0;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        if (data[(y * width + x) * 4 + 3] > 0) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
    if (x1 < x0) return;
    const pad = 4;
    x0 = Math.max(0, x0 - pad);
    y0 = Math.max(0, y0 - pad);
    x1 = Math.min(width - 1, x1 + pad);
    y1 = Math.min(height - 1, y1 + pad);
    const out = document.createElement("canvas");
    out.width = x1 - x0 + 1;
    out.height = y1 - y0 + 1;
    out.getContext("2d")!.drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    onsave(out.toDataURL("image/png"), out.width, out.height);
  }
</script>

<div class="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
  <div class="rounded-2xl bg-white p-6 shadow-2xl">
    <h3 class="mb-1 text-lg font-semibold">Create signature</h3>
    <p class="mb-4 text-sm text-gray-500">Draw your signature with a mouse or trackpad.</p>
    <canvas
      bind:this={canvas}
      class="cursor-crosshair touch-none rounded-lg border border-gray-300 bg-[repeating-linear-gradient(transparent,transparent_179px,#e5e7eb_179px,#e5e7eb_181px,transparent_181px)]"
      style:width="{W}px"
      style:height="{H}px"
      onpointerdown={down}
      onpointermove={move}
      onpointerup={() => (drawing = false)}
    ></canvas>
    <div class="mt-4 flex justify-between">
      <button class="btn-ghost" onclick={clear}>Clear</button>
      <div class="flex gap-2">
        <button class="btn-ghost" onclick={oncancel}>Cancel</button>
        <button class="btn-primary" disabled={empty} onclick={save}>Use signature</button>
      </div>
    </div>
  </div>
</div>
