<script setup lang="ts">
import { useAuth } from "@clerk/vue";
import { computed, ref, watch } from "vue";
import {
  createCompletedPlayUpload,
  type OnlinePlay,
} from "../core/online-history";
import { analyzeOnlineHistory } from "../core/online-stats";
import type { PuzzleDifficulty } from "../core/model";
import type { PlayResult } from "../core/results";

const props = defineProps<{ plays: readonly PlayResult[] }>();
const { getToken, isLoaded, isSignedIn, signOut, userId } = useAuth();
const localCompleted = computed(() =>
  props.plays.filter((play) => play.status === "completed"),
);
const onlinePlays = ref<OnlinePlay[]>([]);
const selectedDifficulty = ref<"all" | PuzzleDifficulty>("all");
const selectedPeriod = ref<"all" | "7" | "30">("all");
const searchQuery = ref("");
const asOf = ref(Date.now());
const historyView = computed(() =>
  analyzeOnlineHistory(onlinePlays.value, {
    difficulty:
      selectedDifficulty.value === "all" ? undefined : selectedDifficulty.value,
    since:
      selectedPeriod.value === "all"
        ? undefined
        : asOf.value - Number(selectedPeriod.value) * 24 * 60 * 60 * 1000,
    query: searchQuery.value,
  }),
);
const trendMaxSeconds = computed(() =>
  Math.max(
    1,
    ...historyView.value.recentTrend.map((play) => play.elapsedSeconds),
  ),
);
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
    const data: { plays: OnlinePlay[] } = await response.json();
    if (userId.value !== accountId) return;
    onlinePlays.value = data.plays;
    asOf.value = Date.now();
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
    try {
      const response = await authenticatedFetch(accountId, "/api/plays");
      if (response.ok) {
        const data: { plays: OnlinePlay[] } = await response.json();
        if (userId.value === accountId) {
          onlinePlays.value = data.plays;
          asOf.value = Date.now();
        }
      }
    } catch {
      // Uploads succeeded; failure to refresh must not turn them into a retry error.
    }
    if (userId.value !== accountId) return;
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
      "退会すると Clerk アカウント、オンライン履歴、公開ランキングの記録と匿名名を削除します。端末のローカル履歴は残ります。元に戻せません。退会しますか？",
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

function isPublished(playId: string): boolean {
  return onlinePlays.value.some(
    (play) => play.playId === playId && play.isPublic,
  );
}

async function withdrawAll(): Promise<void> {
  const accountId = userId.value;
  if (!accountId || busy.value) return;
  if (
    !window.confirm(
      "直近500件より古い記録を含め、すべての公開を取り消しますか？オンライン履歴とローカル履歴は残ります。",
    )
  )
    return;
  busy.value = true;
  message.value = "";
  try {
    const response = await authenticatedFetch(accountId, "/api/publications", {
      method: "DELETE",
    });
    if (!response.ok) throw new Error("Withdrawal failed.");
    if (userId.value !== accountId) return;
    onlinePlays.value = onlinePlays.value.map((play) => ({
      ...play,
      isPublic: false,
    }));
    message.value = "すべての公開を取り消しました。履歴は残っています。";
  } catch {
    if (userId.value === accountId)
      message.value =
        "公開取り消しを確認できませんでした。再試行してください。";
  } finally {
    busy.value = false;
  }
}

async function changePublication(playId: string): Promise<void> {
  const accountId = userId.value;
  const play = onlinePlays.value.find((entry) => entry.playId === playId);
  if (!accountId || !play || busy.value) return;
  const publish = !play.isPublic;
  if (
    publish &&
    !window.confirm(
      `この記録を公開しますか？\n時間 ${formatSeconds(play.elapsedSeconds)}・ヒント ${play.hintsUsed}・ミス ${play.mistakes}\n自動生成の匿名名と成績を誰でも閲覧できます。氏名・メールは公開しません。公開はいつでも取り消せます。`,
    )
  )
    return;
  busy.value = true;
  message.value = "";
  try {
    const response = await authenticatedFetch(
      accountId,
      `/api/plays/${playId}/publication`,
      { method: publish ? "PUT" : "DELETE" },
    );
    if (userId.value !== accountId) return;
    if (response.status === 429) {
      message.value =
        "公開操作が多すぎます。1分後に再試行してください。公開取り消しは可能です。";
      return;
    }
    if (!response.ok) throw new Error("Publication failed.");
    onlinePlays.value = onlinePlays.value.map((entry) =>
      entry.playId === playId ? { ...entry, isPublic: publish } : entry,
    );
    message.value = publish
      ? "この記録を公開しました。同じ問題では公開済みの自己ベスト1件が表示されます。"
      : "この記録の公開を取り消しました。他の公開済み記録と非公開履歴は残ります。";
  } catch {
    if (userId.value === accountId)
      message.value =
        "公開状態を変更できませんでした。「オンライン履歴を更新」で状態を確認してください。";
  } finally {
    busy.value = false;
  }
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(timestamp);
}

function formatSeconds(seconds: number): string {
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

function difficultyLabel(difficulty: PuzzleDifficulty): string {
  return difficulty === "easy"
    ? "初級"
    : difficulty === "normal"
      ? "中級"
      : "上級";
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
        <button type="button" :disabled="busy" @click="withdrawAll">
          すべてのランキング公開を取り消す
        </button>
        <p v-if="message" aria-live="polite">{{ message }}</p>
        <template v-if="onlinePlays.length">
          <p>
            取得した直近
            {{ onlinePlays.length }} 件（最大500件）から集計します。
          </p>
          <div class="online-history-filters">
            <label>
              期間
              <select v-model="selectedPeriod">
                <option value="all">すべて</option>
                <option value="7">過去7日</option>
                <option value="30">過去30日</option>
              </select>
            </label>
            <label>
              難易度
              <select v-model="selectedDifficulty">
                <option value="all">すべて</option>
                <option value="easy">初級</option>
                <option value="normal">中級</option>
                <option value="hard">上級</option>
              </select>
            </label>
            <label>
              シード・問題 ID
              <input v-model="searchQuery" type="search" autocomplete="off" />
            </label>
          </div>
          <p aria-live="polite">
            条件に合うクリア {{ historyView.count }} 件
            <template v-if="historyView.averageSeconds !== undefined">
              · 平均 {{ formatSeconds(historyView.averageSeconds) }}
            </template>
          </p>
          <ul v-if="historyView.count" class="stats-list">
            <li
              v-for="group in historyView.byDifficulty"
              :key="group.difficulty"
            >
              {{ difficultyLabel(group.difficulty) }}: {{ group.clears }} 件
              <template v-if="group.averageSeconds !== undefined">
                · 平均 {{ formatSeconds(group.averageSeconds) }} · 最速
                {{ formatSeconds(group.bestSeconds ?? 0) }}
              </template>
            </li>
          </ul>
          <details v-if="historyView.puzzleBests.length">
            <summary>
              問題別自己ベスト（{{ historyView.puzzleBests.length }} 問）
            </summary>
            <ol class="ranking-list">
              <li
                v-for="entry in historyView.puzzleBests"
                :key="entry.puzzleId"
              >
                <code>{{ entry.seedCode }}</code> ·
                {{ formatSeconds(entry.best.elapsedSeconds) }} · ヒント
                {{ entry.best.hintsUsed }} · ミス {{ entry.best.mistakes }} ·
                {{ entry.attempts }} 回挑戦
              </li>
            </ol>
          </details>
          <details v-if="historyView.recentTrend.length">
            <summary>最近のクリア時間の推移</summary>
            <ol class="online-history-trend">
              <li v-for="play in historyView.recentTrend" :key="play.playId">
                <span>{{ formatDate(play.completedAt) }}</span>
                <span class="online-history-trend-track" aria-hidden="true">
                  <span
                    :style="{
                      width: `${Math.max(4, (play.elapsedSeconds / trendMaxSeconds) * 100)}%`,
                    }"
                  ></span>
                </span>
                <span>{{ formatSeconds(play.elapsedSeconds) }}</span>
              </li>
            </ol>
            <p>棒が短いほどクリア時間が短いことを示します。</p>
          </details>
          <details v-if="historyView.plays.length">
            <summary>該当する履歴（{{ historyView.count }} 件）</summary>
            <p>
              公開は記録ごとの任意参加です。時間は自己申告の参考記録です。自動生成の匿名名は問題間で共通になります。
            </p>
            <ol class="ranking-list">
              <li v-for="play in historyView.plays" :key="play.playId">
                {{ formatDate(play.completedAt) }} ·
                <code>{{ play.seedCode }}</code> ·
                {{ formatSeconds(play.elapsedSeconds) }} · ヒント
                {{ play.hintsUsed }} · ミス {{ play.mistakes }}
                <span>{{
                  isPublished(play.playId) ? "公開中" : "非公開"
                }}</span>
                <button
                  type="button"
                  :disabled="busy"
                  @click="changePublication(play.playId)"
                >
                  {{
                    isPublished(play.playId)
                      ? "公開を取り消す"
                      : "ランキングに公開"
                  }}
                </button>
              </li>
            </ol>
          </details>
        </template>
        <button type="button" :disabled="busy" @click="deleteAccount">
          退会してオンライン履歴を削除
        </button>
      </template>
    </div>
  </details>
</template>
