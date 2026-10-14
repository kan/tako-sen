import { shallowRef } from "vue";

export interface ConfirmRequest {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
}

interface PendingConfirm extends ConfirmRequest {
  readonly resolve: (accepted: boolean) => void;
}

/** The question on screen, rendered by ConfirmDialog.vue. */
export const pendingConfirm = shallowRef<PendingConfirm>();

/**
 * Ask in the game's own dialog instead of `window.confirm`, whose look varies
 * by browser. A new question cancels one still open.
 */
export function askConfirm(request: ConfirmRequest): Promise<boolean> {
  pendingConfirm.value?.resolve(false);
  return new Promise((resolve) => {
    pendingConfirm.value = { ...request, resolve };
  });
}

export function answerConfirm(accepted: boolean): void {
  const pending = pendingConfirm.value;
  if (!pending) return;
  pendingConfirm.value = undefined;
  pending.resolve(accepted);
}
