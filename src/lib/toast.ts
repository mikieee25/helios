import { create } from "zustand";

export type Toast = {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
  onExpire?: () => void | Promise<void>;
};

const DURATION_MS = 7000;
let nextId = 1;
let timer: ReturnType<typeof setTimeout> | undefined;

interface ToastState {
  toast?: Toast;
  show(toast: Omit<Toast, "id">, durationMs?: number): void;
  dismiss(): void;
  pause(): void;
  resume(): void;
  /** Runs the visible toast's action (Undo), then dismisses it. */
  runAction(): Promise<void>;
}

export const useToast = create<ToastState>((set, get) => ({
  toast: undefined,
  show: (toast, durationMs = DURATION_MS) => {
    clearTimeout(timer);
    void get().toast?.onExpire?.();
    set({ toast: { ...toast, id: nextId++ } });
    timer = setTimeout(() => get().dismiss(), durationMs);
  },
  dismiss: () => {
    const current = get().toast;
    clearTimeout(timer);
    set({ toast: undefined });
    void current?.onExpire?.();
  },
  pause: () => clearTimeout(timer),
  resume: () => {
    clearTimeout(timer);
    if (get().toast) timer = setTimeout(() => get().dismiss(), 3000);
  },
  runAction: async () => {
    const current = get().toast;
    if (!current?.onAction) return;
    clearTimeout(timer);
    set({ toast: undefined });
    try {
      await current.onAction();
    } catch (error) {
      get().show({
        message: error instanceof Error ? error.message : String(error),
      });
    }
  },
}));
