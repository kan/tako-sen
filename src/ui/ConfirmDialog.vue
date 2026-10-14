<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { answerConfirm, pendingConfirm } from "./confirm-dialog";
import { trapDialogFocus } from "./dialog";

const dialog = ref<HTMLElement>();
const cancelButton = ref<HTMLButtonElement>();
let focusBefore: HTMLElement | null = null;

watch(pendingConfirm, async (pending, previous) => {
  if (pending && !previous)
    focusBefore =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  if (pending) {
    // Cancel first: every question here guards something hard to undo.
    await nextTick();
    cancelButton.value?.focus();
  } else if (previous) {
    if (focusBefore?.isConnected) focusBefore.focus();
    focusBefore = null;
  }
});

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    answerConfirm(false);
  } else trapDialogFocus(event, dialog.value);
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="pendingConfirm"
      class="dialog-backdrop confirm-backdrop"
      role="presentation"
      @click.self="answerConfirm(false)"
    >
      <section
        ref="dialog"
        class="dialog-card confirm-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        tabindex="-1"
        @keydown="onKeydown"
      >
        <div class="dialog-header">
          <h2 id="confirm-title">{{ pendingConfirm.title }}</h2>
        </div>
        <p id="confirm-message">{{ pendingConfirm.message }}</p>
        <div class="dialog-actions confirm-actions">
          <button
            ref="cancelButton"
            type="button"
            @click="answerConfirm(false)"
          >
            キャンセル
          </button>
          <button
            type="button"
            class="confirm-accept"
            @click="answerConfirm(true)"
          >
            {{ pendingConfirm.confirmLabel }}
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>
