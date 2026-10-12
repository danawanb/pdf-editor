<script lang="ts">
  interface Props {
    title: string;
    hint: string;
    hover: boolean;
    onpick: () => void;
  }
  let { title, hint, hover, onpick }: Props = $props();
</script>

<div
  class="flex flex-1 flex-col items-center justify-center rounded-2xl border-2 border-dashed p-12 text-center transition
    {hover ? 'border-brand-500 bg-brand-50' : 'border-gray-300 bg-white'}"
>
  <div class="mb-4 text-5xl">📄</div>
  <h2 class="mb-2 text-2xl font-semibold">{title}</h2>
  <p class="mb-6 text-gray-500">{hint}</p>
  <button class="btn-primary px-8 py-3 text-base" onclick={onpick}>Select PDF file</button>
  <p class="mt-3 text-xs text-gray-400">or drag &amp; drop files here</p>
</div>
