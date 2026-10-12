<script lang="ts">
  import { renderPage, type PDFDocumentProxy } from "$lib/pdfjs";

  interface Props {
    doc: PDFDocumentProxy;
    page: number;
    width: number;
    rotate?: number;
    /** displayed aspect ratio (height / width), reserves space before rendering */
    aspect?: number;
  }
  let { doc, page, width, rotate = 0, aspect = 1.414 }: Props = $props();

  let box: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let visible = $state(false);

  // Only render once the thumbnail scrolls into view: large PDFs have
  // hundreds of pages.
  $effect(() => {
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting), { rootMargin: "300px" });
    io.observe(box);
    return () => io.disconnect();
  });

  $effect(() => {
    if (visible) return renderPage(doc, page, canvas, width, rotate);
  });
</script>

<div
  bind:this={box}
  class="overflow-hidden bg-white shadow-sm ring-1 ring-black/10"
  style:width="{width}px"
  style:height="{width * aspect}px"
>
  <canvas bind:this={canvas} class="block"></canvas>
</div>
