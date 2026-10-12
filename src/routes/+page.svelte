<script lang="ts">
  const tools = [
    {
      href: "/merge",
      icon: "🧩",
      title: "Merge PDF",
      desc: "Combine multiple PDFs into one file, in any order you like.",
    },
    {
      href: "/split",
      icon: "✂️",
      title: "Split PDF",
      desc: "Split by single pages, custom page ranges, or every N pages.",
    },
    {
      href: "/edit",
      icon: "✏️",
      title: "Edit PDF",
      desc: "Rotate, delete, duplicate and reorder pages. Add text, images, signatures, shapes and highlights.",
    },
  ];
</script>

<div class="overflow-y-auto p-10">
  <h1 class="mb-2 text-3xl font-bold">Every PDF tool you need</h1>
  <p class="mb-10 text-gray-500">Free, fast, and fully offline on your computer.</p>
  <div class="grid max-w-5xl grid-cols-1 gap-6 md:grid-cols-3">
    {#each tools as t}
      <a
        href={t.href}
        class="group rounded-2xl border border-gray-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-500 hover:shadow-md"
      >
        <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-2xl">{t.icon}</div>
        <h2 class="mb-2 text-lg font-semibold group-hover:text-brand-600">{t.title}</h2>
        <p class="text-sm leading-relaxed text-gray-500">{t.desc}</p>
      </a>
    {/each}
  </div>
</div>
