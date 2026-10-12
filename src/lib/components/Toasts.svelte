<script lang="ts">
  import { dismiss, toasts } from "$lib/toast.svelte";
</script>

<div class="pointer-events-none fixed right-4 bottom-4 z-50 flex w-96 flex-col gap-2">
  {#each toasts as t (t.id)}
    <div
      class="pointer-events-auto flex items-start gap-3 rounded-xl border bg-white p-4 text-sm shadow-lg
        {t.kind === 'error' ? 'border-red-200' : 'border-green-200'}"
    >
      <span class="mt-0.5 text-base">{t.kind === "error" ? "⚠️" : "✅"}</span>
      <div class="flex-1">
        <p class="break-words whitespace-pre-line text-gray-800">{t.message}</p>
        {#if t.action}
          <button class="mt-2 font-medium text-brand-600 hover:underline" onclick={t.action.run}>
            {t.action.label}
          </button>
        {/if}
      </div>
      <button class="text-gray-400 hover:text-gray-700" aria-label="Close" onclick={() => dismiss(t.id)}>✕</button>
    </div>
  {/each}
</div>
