<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { trapDialogFocus } from "./dialog";
import { acceptMigration, closeMigration, migrationOffer } from "./migration";

const dialog = ref<HTMLElement>();
const firstButton = ref<HTMLButtonElement>();
let focusBefore: HTMLElement | null = null;

watch(
  () => migrationOffer.value?.state,
  async (state, previous) => {
    if (state && !previous)
      focusBefore =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    if (!state) {
      // Back to where the player was, as ConfirmDialog does.
      if (focusBefore?.isConnected) focusBefore.focus();
      focusBefore = null;
      return;
    }
    if (state === "working") return;
    await nextTick();
    // Cancel first while asking: the switch is hard to undo.
    (firstButton.value ?? dialog.value)?.focus();
  },
);

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeMigration();
  } else trapDialogFocus(event, dialog.value);
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="migrationOffer"
      class="dialog-backdrop confirm-backdrop"
      role="presentation"
    >
      <section
        ref="dialog"
        class="dialog-card confirm-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="migration-title"
        aria-describedby="migration-message"
        tabindex="-1"
        @keydown="onKeydown"
      >
        <div class="dialog-header">
          <h2 id="migration-title">
            {{
              migrationOffer.state === "done"
                ? "引き継ぎました"
                : migrationOffer.state === "refused"
                  ? "引き継げませんでした"
                  : migrationOffer.kind === "transfer"
                    ? "この端末を引き継ぎますか？"
                    : "以前の記録を引き継ぎますか？"
            }}
          </h2>
        </div>
        <template
          v-if="
            migrationOffer.state === 'done' ||
            migrationOffer.state === 'refused'
          "
        >
          <p id="migration-message">
            {{
              migrationOffer.state === "refused"
                ? migrationOffer.message
                : migrationOffer.kind === "transfer"
                  ? "QR コードを表示した端末と同じ ID に切り替えました。メニューの「プレイヤー」から確認できます。"
                  : "以前の TAKO-SEN の記録とプレイヤー名を、この端末に引き継ぎました。メニューの「プレイヤー」から確認できます。"
            }}
          </p>
          <div class="dialog-actions confirm-actions">
            <button ref="firstButton" type="button" @click="closeMigration">
              OK
            </button>
          </div>
        </template>
        <template v-else>
          <p v-if="migrationOffer.kind === 'transfer'" id="migration-message">
            この端末を、QR コードを表示した端末と同じ ID
            に切り替えます。この端末でいま使っている ID の記録は、切り替え後の
            ID には移りません。自分の端末で表示した QR
            コードでなければ、キャンセルしてください。
          </p>
          <p v-else id="migration-message">
            以前の
            TAKO-SEN（tako-sen.kan-fushihara.workers.dev）でログインしていたアカウントの記録とプレイヤー名を、この端末に引き継ぎます。この端末でいま使っている
            ID の記録は、引き継ぎ後の ID
            には移りません。心当たりのないリンクから開いた場合は、キャンセルしてください。
          </p>
          <p v-if="migrationOffer.state === 'working'" role="status">
            引き継いでいます…
          </p>
          <p v-if="migrationOffer.state === 'failed'" role="alert">
            {{ migrationOffer.message }}
          </p>
          <div class="dialog-actions confirm-actions">
            <button
              ref="firstButton"
              type="button"
              :aria-disabled="migrationOffer.state === 'working' || undefined"
              @click="closeMigration"
            >
              キャンセル
            </button>
            <button
              type="button"
              class="confirm-accept"
              :aria-disabled="migrationOffer.state === 'working' || undefined"
              @click="acceptMigration"
            >
              引き継ぐ
            </button>
          </div>
        </template>
      </section>
    </div>
  </Teleport>
</template>
