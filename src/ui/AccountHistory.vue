<script setup lang="ts">
import { useAuth } from "@clerk/vue";
import { computed, ref, watch } from "vue";
import {
  createCompletedPlayUpload,
  type CompletedPlayUpload,
} from "../core/online-history";
import type { PlayResult } from "../core/results";

const props = defineProps<{ plays: readonly PlayResult[] }>();
const { getToken, isLoaded, isSignedIn, signOut, userId } = useAuth();
const localCompleted = computed(() =>
  props.plays.filter((play) => play.status === "completed"),
);
const onlinePlays = ref<CompletedPlayUpload[]>([]);
const busy = ref(false);
const message = ref("");

watch(userId, () => {
  onlinePlays.value = [];
  message.value = "";
});

async function authenticatedFetch(
  accountId: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  if (userId.value !== accountId) throw new Error("Account changed.");
  const token = await getToken.value();
  if (userId.value !== accountId) throw new Error("Account changed.");
  if (!token) throw new Error("ログイン状態を確認できませんでした。");
  return fetch(path, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${token}` },
  });
}

async function refresh(): Promise<void> {
  const accountId = userId.value;
  if (!accountId) return;
  busy.value = true;
  message.value = "";
  try {
    const response = await authenticatedFetch(accountId, "/api/plays");
    if (!response.ok)
      throw new Error(`取得に失敗しました (${response.status})。`);
    const data: { plays: CompletedPlayUpload[] } = await response.json();
    if (userId.value !== accountId) return;
    onlinePlays.value = data.plays;
    message.value = `${data.plays.length} 件のオンライン履歴を取得しました。`;
  } catch {
    if (userId.value !== accountId) return;
    message.value =
      "オンライン履歴を取得できません。ローカルプレイは続けられます。";
  } finally {
    busy.value = false;
  }
}

async function importLocal(): Promise<void> {
  const accountId = userId.value;
  if (!accountId) return;
  busy.value = true;
  message.value = "";
  let imported = 0;
  let duplicates = 0;
  try {
    for (const play of localCompleted.value) {
      const upload = await createCompletedPlayUpload(play);
      const response = await authenticatedFetch(accountId, "/api/plays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(upload),
      });
      if (userId.value !== accountId) throw new Error("Account changed.");
      if (response.status === 409) {
        message.value = `${play.id} は既存の記録と競合しました。取り込みを中断しました。`;
        return;
      }
      if (!response.ok) throw new Error(`送信失敗: ${response.status}`);
      if (response.status === 201) imported += 1;
      else duplicates += 1;
    }
    message.value = `${imported} 件を取り込み、${duplicates} 件は登録済みでした。ローカル履歴は残しています。`;
  } catch {
    if (userId.value === accountId) {
      message.value = `${imported} 件を取り込みましたが、途中で失敗しました。再実行できます。ローカル履歴は残しています。`;
    }
  } finally {
    busy.value = false;
  }
}

async function deleteAccount(): Promise<void> {
  const accountId = userId.value;
  if (!accountId || busy.value) return;
  if (
    !window.confirm(
      "退会すると Clerk アカウントとオンライン履歴を削除します。端末のローカル履歴は残ります。元に戻せません。退会しますか？",
    )
  )
    return;
  busy.value = true;
  message.value = "";
  try {
    const response = await authenticatedFetch(accountId, "/api/account", {
      method: "DELETE",
    });
    if (!response.ok)
      throw new Error(`退会に失敗しました (${response.status})。`);
    onlinePlays.value = [];
    message.value = "退会しました。端末のローカル履歴は残っています。";
    await signOut.value();
  } catch {
    if (userId.value === accountId)
      message.value =
        "退会処理を確認できませんでした。オンライン履歴が削除済みの可能性があります。ログインできる場合は再試行してください。";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <details class="stats-panel">
    <summary>オンライン履歴</summary>
    <div class="stats-panel-body">
      <p v-if="!isLoaded">ログイン状態を確認しています。</p>
      <p v-else-if="!isSignedIn">ログインすると履歴を端末間で確認できます。</p>
      <template v-else>
        <p>
          ローカルのクリア履歴
          {{ localCompleted.length }} 件。自動送信はしません。
        </p>
        <button type="button" :disabled="busy" @click="importLocal">
          ローカル履歴を取り込む
        </button>
        <button type="button" :disabled="busy" @click="refresh">
          オンライン履歴を更新
        </button>
        <p v-if="message" aria-live="polite">{{ message }}</p>
        <ol v-if="onlinePlays.length" class="ranking-list">
          <li v-for="play in onlinePlays" :key="play.playId">
            <code>{{ play.seedCode }}</code> · {{ play.elapsedSeconds }} 秒 ·
            ヒント {{ play.hintsUsed }} · ミス {{ play.mistakes }}
          </li>
        </ol>
        <button type="button" :disabled="busy" @click="deleteAccount">
          退会してオンライン履歴を削除
        </button>
      </template>
    </div>
  </details>
</template>
