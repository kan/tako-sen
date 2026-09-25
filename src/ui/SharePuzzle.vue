<script setup lang="ts">
import { useAuth } from "@clerk/vue";
import { ref, watch } from "vue";

const props = defineProps<{ seedCode: string }>();
const { getToken, isSignedIn, userId } = useAuth();
const busy = ref(false);
const message = ref("");
const shareUrl = ref("");

watch(userId, () => {
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
  const accountId = userId.value;
  if (!accountId || busy.value) return;
  busy.value = true;
  message.value = "";
  shareUrl.value = "";
  try {
    const token = await getToken.value();
    if (!token || userId.value !== accountId)
      throw new Error("ログイン状態を確認できませんでした。");
    const response = await fetch("/api/puzzles", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ seedCode }),
    });
    if (!response.ok)
      throw new Error(`共有に失敗しました (${response.status})。`);
    const data: { puzzle: { id: string } } = await response.json();
    if (userId.value !== accountId) return;
    const url = new URL(window.location.href);
    url.searchParams.set("p", data.puzzle.id);
    shareUrl.value = url.toString();
    try {
      await navigator.clipboard.writeText(shareUrl.value);
      message.value = "共有リンクをコピーしました。";
    } catch {
      message.value =
        "リンクをコピーできませんでした。下の URL を選択してください。";
    }
  } catch {
    if (userId.value === accountId)
      message.value =
        "共有リンクを作成できません。ローカルプレイは続けられます。";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <button
      type="button"
      :disabled="busy || !isSignedIn"
      @click="share(seedCode)"
    >
      問題の共有リンクを作成
    </button>
    <p v-if="!isSignedIn">共有リンクの作成にはログインが必要です。</p>
    <p v-if="message" aria-live="polite">{{ message }}</p>
    <input
      v-if="shareUrl"
      :value="shareUrl"
      aria-label="問題の共有リンク"
      readonly
      @focus="($event.target as HTMLInputElement).select()"
    />
  </div>
</template>
