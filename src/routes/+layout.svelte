<script lang="ts">
  import "../app.css";
  import { page } from "$app/state";
  import Toasts from "$lib/components/Toasts.svelte";

  let { children } = $props();

  const nav = [
    { href: "/", label: "Home", icon: "🏠" },
    { href: "/merge", label: "Merge PDF", icon: "🧩" },
    { href: "/split", label: "Split PDF", icon: "✂️" },
    { href: "/edit", label: "Edit PDF", icon: "✏️" },
  ];
</script>

<div class="flex h-screen overflow-hidden">
  <aside class="flex w-56 shrink-0 flex-col border-r border-gray-200 bg-white">
    <div class="flex items-center gap-2 px-5 py-5">
      <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500 font-bold text-white">P</div>
      <span class="text-lg font-semibold">PDF Editor</span>
    </div>
    <nav class="flex flex-col gap-1 px-3">
      {#each nav as item}
        {@const active = page.url.pathname === item.href}
        <a
          href={item.href}
          class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition
            {active ? 'bg-brand-50 text-brand-600' : 'text-gray-600 hover:bg-gray-100'}"
        >
          <span>{item.icon}</span>{item.label}
        </a>
      {/each}
    </nav>
    <p class="mt-auto px-5 py-4 text-xs text-gray-400">Offline · files never leave your computer</p>
  </aside>
  <main class="flex min-w-0 flex-1 flex-col overflow-hidden">
    {@render children()}
  </main>
</div>
<Toasts />
