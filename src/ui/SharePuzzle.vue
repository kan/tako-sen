<script setup lang="ts">
import UiIcon from "./UiIcon.vue";
import { apiFetch, useId } from "./auth";
import {
  PLAY_CONTINUES,
  PRESS_AGAIN_ONLINE,
  idUnavailable,
} from "./notice-text";
import { onUnmounted, ref, watch } from "vue";

const props = defineProps<{
  seedCode: string;
  /** The player name, or "" before one is set: sharing needs one. */
  gameName: string;
}>();
const emit = defineEmits<{
  /** Open the account dialog to set a player name. */
  account: [];
}>();
const { id } = useId();
const busy = ref(false);
const message = ref("");
const shareUrl = ref("");
/** Briefly true after the link reached the clipboard: the icon turns to ✓. */
const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;
onUnmounted(() => clearTimeout(copiedTimer));

watch(id, () => {
  shareUrl.value = "";
  message.value = "";
});
watch(
  () => props.seedCode,
  () => {
    shareUrl.value = "";
    message.value = "";
  },
);

async function share(seedCode: string): Promise<void> {
  if (!props.gameName) {
    emit("account");
    return;
  }
  const accountId = id.value;
  if (busy.value) return;
  if (!accountId) {
    message.value = `${idUnavailable("共有リンクを作成できません")}${PLAY_CONTINUES}`;
    return;
  }
  busy.value = true;
  message.value = "";
  shareUrl.value = "";
  try {
    const response = await apiFetch("/api/puzzles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seedCode }),
    });
    if (!response.ok)
      throw new Error(`共有に失敗しました (${response.status})。`);
    const data: { puzzle: { id: string } } = await response.json();
    if (id.value !== accountId) return;
    const url = new URL(window.location.href);
    url.searchParams.set("p", data.puzzle.id);
    shareUrl.value = url.toString();
    try {
      await navigator.clipboard.writeText(shareUrl.value);
      message.value = "共有リンクをコピーしました。";
      copied.value = true;
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => (copied.value = false), 2000);
    } catch {
      message.value =
        "リンクをコピーできませんでした。下の URL を選択してください。";
    }
  } catch {
    if (id.value === accountId)
      message.value = `共有リンクを作成できません。${PRESS_AGAIN_ONLINE}${PLAY_CONTINUES}`;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <button
      type="button"
      class="share-link-button"
      :aria-disabled="busy || undefined"
      @click="share(seedCode)"
    >
      <UiIcon :name="copied ? 'check' : 'share'" />{{
        busy ? "作成しています…" : "問題の共有リンクを作成"
      }}
    </button>
    <p v-if="!gameName">共有リンクの作成には、プレイヤー名の設定が必要です。</p>
    <p aria-live="polite" v-text="message"></p>
    <input
      v-if="shareUrl"
      :value="shareUrl"
      aria-label="問題の共有リンク"
      readonly
      @focus="($event.target as HTMLInputElement).select()"
    />
  </div>
</template>
