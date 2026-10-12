export interface Toast {
  id: number;
  kind: "success" | "error";
  message: string;
  action?: { label: string; run: () => void };
}

let nextId = 1;
export const toasts = $state<Toast[]>([]);

export function notify(kind: Toast["kind"], message: string, action?: Toast["action"]) {
  const id = nextId++;
  toasts.push({ id, kind, message, action });
  setTimeout(() => dismiss(id), kind === "error" ? 8000 : 6000);
}

export function dismiss(id: number) {
  const i = toasts.findIndex((t) => t.id === id);
  if (i >= 0) toasts.splice(i, 1);
}
