<script setup lang="ts">
import { useAuth } from "@clerk/vue";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import GameName from "./GameName.vue";
import { hintStageLabel } from "../core/hint-progress";
import { rankingScore } from "../core/ranking-score";
import { trapDialogFocus } from "./dialog";
import {
  createCompletedPlayUpload,
  type OnlinePlay,
} from "../core/online-history";
import { analyzeOnlineHistory } from "../core/online-stats";
import {
  RANKING_CONSENT_VERSION,
  validateGameName,
  loadCachedProfile,
  saveCachedProfile,
  type AccountProfile,
} from "../core/account-profile";
import { SyncOutbox } from "../core/sync-outbox";
import type { PuzzleDifficulty } from "../core/model";
import type { PlayResult } from "../core/results";

const props = defineProps<{
  plays: readonly PlayResult[];
  open: boolean;
  setupOnly?: boolean;
  historyOpen?: boolean;
  historyInert?: boolean;
}>();
const emit = defineEmits<{
  synced: [];
  profile: [name: string];
  setupRequired: [required: boolean];
  close: [];
}>();
const dialogRef = ref<HTMLElement>();
const nameInputRef = ref<HTMLInputElement>();
const { getToken, isLoaded, isSignedIn, signOut, userId } = useAuth();
const cacheStorage = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
} satisfies import("../core/storage").KeyValueStorage;
const outbox = new SyncOutbox(props.plays, cacheStorage);
const profile = ref<AccountProfile | null>(null);
const profileLoading = ref(false);
const gameName = ref("");
const consent = ref(false);
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
        : asOf.value - Number(selectedPeriod.value) * 86400000,
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
const syncing = ref(false);
const message = ref("");
const syncMessage = ref("");
let epoch = 0;
let disposed = false;
let retryTimer: ReturnType<typeof setInterval> | undefined;

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    await nextTick();
    if (props.setupOnly) nameInputRef.value?.focus();
    else dialogRef.value?.focus();
    void refresh();
  },
);
watch(
  () => props.historyOpen,
  (open) => {
    if (open) void refresh();
  },
);

function onAccountKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    if (!props.setupOnly) emit("close");
    return;
  }
  trapDialogFocus(event, dialogRef.value);
}

watch(isSignedIn, (signedIn) => {
  if (!signedIn) emit("close");
});

watch(
  userId,
  () => {
    epoch += 1;
    emit("setupRequired", false);
    profileLoading.value = false;
    profile.value = userId.value
      ? loadCachedProfile(userId.value, cacheStorage)
      : null;
    onlinePlays.value = [];
    gameName.value = "";
    consent.value = false;
    message.value = "";
    syncMessage.value = "";
    emit("profile", profile.value?.displayName ?? "");
    void loadProfile();
  },
  { immediate: true },
);

watch(
  () => props.plays,
  (plays) => {
    outbox.capture(
      plays,
      profile.value && isSignedIn.value ? (userId.value ?? null) : null,
    );
    void synchronize();
  },
  { flush: "sync" },
);

async function authenticatedFetch(
  accountId: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const current = epoch;
  if (disposed || current !== epoch || userId.value !== accountId)
    throw new Error("Account changed.");
  const token = await getToken.value();
  if (disposed || current !== epoch || userId.value !== accountId)
    throw new Error("Account changed.");
  if (!token) throw new Error("Session unavailable.");
  return fetch(path, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${token}` },
  });
}

async function loadProfile(): Promise<void> {
  const accountId = userId.value;
  if (!accountId || profileLoading.value) return;
  const current = epoch;
  profileLoading.value = true;
  try {
    const response = await authenticatedFetch(accountId, "/api/profile");
    if (!response.ok) throw new Error("Profile unavailable.");
    const data: { profile: AccountProfile | null } = await response.json();
    if (current !== epoch || disposed) return;
    profile.value = data.profile;
    profileLoading.value = false;
    saveCachedProfile(accountId, data.profile, cacheStorage);
    emit("profile", data.profile?.displayName ?? "");
    emit("setupRequired", data.profile === null);
    await refresh();
    if (current === epoch) await synchronize();
  } catch {
    if (current === epoch && !disposed)
      message.value =
        "オンライン設定を確認できません。再試行できます。オフラインでのプレイは続けられます。";
    if (current === epoch) await synchronize();
  } finally {
    if (current === epoch) profileLoading.value = false;
  }
}

async function registerProfile(): Promise<void> {
  const accountId = userId.value;
  const name = validateGameName(gameName.value);
  if (!accountId || !consent.value || !name || busy.value) return;
  const current = epoch;
  busy.value = true;
  try {
    const response = await authenticatedFetch(accountId, "/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName: name,
        consentVersion: RANKING_CONSENT_VERSION,
      }),
    });
    if (current !== epoch) return;
    if (response.status === 409) {
      message.value = "この名前は使われています。別の名前を選んでください。";
      return;
    }
    if (!response.ok) throw new Error("Registration failed.");
    const data: { profile: AccountProfile } = await response.json();
    if (current !== epoch) return;
    profile.value = data.profile;
    saveCachedProfile(accountId, data.profile, cacheStorage);
    emit("profile", data.profile.displayName);
    emit("setupRequired", false);
    message.value =
      "設定しました。これからのクリアを自動同期します。過去のローカル履歴は送信しません。";
    await synchronize();
  } catch {
    if (current === epoch)
      message.value = "設定を保存できません。再試行してください。";
  } finally {
    busy.value = false;
  }
}

async function refresh(): Promise<void> {
  const accountId = userId.value;
  if (!accountId) return;
  const current = epoch;
  try {
    const response = await authenticatedFetch(accountId, "/api/plays");
    if (!response.ok) throw new Error("History unavailable.");
    const data: { plays: OnlinePlay[] } = await response.json();
    if (current !== epoch || disposed) return;
    onlinePlays.value = data.plays;
    asOf.value = Date.now();
  } catch {
    if (current === epoch && !disposed)
      message.value = "履歴を取得できません。プレイは続けられます。";
  }
}

async function synchronize(): Promise<void> {
  const accountId = userId.value;
  if (!accountId || !profile.value || syncing.value || disposed) return;
  const current = epoch;
  const pending = outbox.count(accountId);
  if (!pending) {
    syncMessage.value = "同期済み";
    return;
  }
  if (!navigator.onLine) {
    syncMessage.value = `未送信 ${pending} 件 · 接続後に自動再送します`;
    return;
  }
  syncing.value = true;
  syncMessage.value = "同期中…";
  try {
    const sent = await outbox.drain(
      accountId,
      () => !disposed && current === epoch,
      async (play) => {
        const upload = await createCompletedPlayUpload(play);
        if (current !== epoch) throw new Error("Account changed.");
        const response = await authenticatedFetch(accountId, "/api/plays", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(upload),
        });
        if (!response.ok)
          throw new Error(
            response.status === 409 ? "conflict" : "upload_failed",
          );
      },
    );
    if (current !== epoch || disposed) return;
    syncMessage.value = outbox.count(accountId)
      ? `未送信 ${outbox.count(accountId)} 件`
      : "同期済み";
    if (sent) {
      emit("synced");
      await refresh();
    }
  } catch (error) {
    if (current === epoch && !disposed)
      syncMessage.value = String(error).includes("conflict")
        ? "記録が競合しています。ローカル記録は保持しています。"
        : `未送信 ${outbox.count(accountId)} 件 · 再接続後に自動再送します`;
  } finally {
    syncing.value = false;
    if (current === epoch && outbox.persistenceFailed)
      syncMessage.value +=
        " · 未送信データを端末に保存できません。この画面を閉じると再送できない場合があります。";
  }
}

async function deleteAccount(): Promise<void> {
  const accountId = userId.value;
  if (!accountId || busy.value) return;
  if (
    !window.confirm(
      "退会するとアカウント、ゲーム名、オンライン履歴、すべてのランキング記録を削除します。端末のローカル履歴は残ります。元に戻せません。退会しますか？",
    )
  )
    return;
  busy.value = true;
  try {
    const response = await authenticatedFetch(accountId, "/api/account", {
      method: "DELETE",
    });
    if (!response.ok) throw new Error("Deletion failed.");
    outbox.forget(accountId);
    saveCachedProfile(accountId, null, cacheStorage);
    if (userId.value !== accountId) return;
    onlinePlays.value = [];
    profile.value = null;
    emit("profile", "");
    emit("synced");
    await signOut.value();
  } catch {
    if (userId.value === accountId)
      message.value =
        "退会処理を確認できません。ログインできる場合は再試行してください。";
  } finally {
    busy.value = false;
  }
}

function reconnect(): void {
  void loadProfile();
}
onMounted(() => {
  window.addEventListener("online", reconnect);
  retryTimer = setInterval(() => {
    void synchronize();
  }, 30000);
});
onUnmounted(() => {
  disposed = true;
  window.removeEventListener("online", reconnect);
  clearInterval(retryTimer);
});

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(timestamp);
}
function isRanked(playId: string): boolean {
  return onlinePlays.value.some(
    (play) => play.playId === playId && play.isPublic,
  );
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
  <div
    v-if="open"
    class="dialog-backdrop"
    role="presentation"
    @click.self="!setupOnly && emit('close')"
  >
    <section
      ref="dialogRef"
      class="dialog-card account-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="account-title"
      tabindex="-1"
      @keydown="onAccountKeydown"
    >
      <div class="dialog-header">
        <h2 id="account-title">
          {{ setupOnly ? "ゲーム名を設定" : "アカウント" }}
        </h2>
        <button
          v-if="!setupOnly"
          type="button"
          class="dialog-close"
          aria-label="アカウントを閉じる"
          @click="emit('close')"
        >
          閉じる
        </button>
      </div>
      <p v-if="!isLoaded || profileLoading">オンライン設定を確認しています。</p>
      <template v-else-if="isSignedIn">
        <form v-if="!profile" @submit.prevent="registerProfile">
          <h2 v-if="!setupOnly">ゲームで使う名前を決める</h2>
          <label
            >ゲーム名
            <input
              ref="nameInputRef"
              v-model="gameName"
              required
              autocomplete="off"
          /></label>
          <p>
            2〜20文字の文字・数字・絵文字・空白・ハイフン・下線を使えます。本名やメールアドレスは使わないでください。名前はランキングに表示されます。
          </p>
          <p>
            設定後はログイン中のクリアを自動同期し、各問題で最初にサーバーへ登録された成績を公開ランキングに載せます。再挑戦は個人履歴だけに残ります。過去のローカル履歴は送信しません。
          </p>
          <p>
            個別の非公開設定はありません。公開記録とゲーム名は退会すると削除されます。第三者が保存したコピーは回収できません。
          </p>
          <label
            ><input v-model="consent" type="checkbox" required />
            この公開ルールに同意する</label
          >
          <button
            type="submit"
            :disabled="busy || !consent || !validateGameName(gameName)"
          >
            名前を設定して参加する
          </button>
        </form>
        <template v-else-if="!setupOnly">
          <p>
            <GameName :name="profile.displayName" /> ·
            <span aria-live="polite">{{ syncMessage }}</span>
          </p>
          <p>
            ランキングは各問題の初回クリアのみ。再挑戦も個人履歴に自動保存します。
          </p>
          <button type="button" :disabled="syncing" @click="synchronize">
            同期を再試行
          </button>
        </template>
        <button
          v-if="!setupOnly"
          type="button"
          :disabled="busy"
          @click="signOut()"
        >
          ログアウト
        </button>
        <button
          v-if="!setupOnly"
          type="button"
          :disabled="profileLoading"
          @click="loadProfile"
        >
          オンライン設定を再確認
        </button>
      </template>
      <p v-else>
        ログインしてゲーム名を設定すると、クリアの自動同期とランキング参加ができます。ログインなしでも遊べます。
      </p>
      <p v-if="message" aria-live="polite">{{ message }}</p>
      <button
        v-if="isSignedIn && !setupOnly"
        type="button"
        :disabled="busy"
        @click="deleteAccount"
      >
        退会してオンライン履歴を削除
      </button>
    </section>
  </div>
  <section v-if="historyOpen" class="stats-panel" :inert="historyInert">
    <h3>オンライン履歴</h3>
    <div class="stats-panel-body">
      <p v-if="!isLoaded">ログイン状態を確認しています。</p>
      <p v-else-if="!isSignedIn">ログインすると履歴を端末間で確認できます。</p>
      <template v-else>
        <button type="button" :disabled="busy" @click="refresh">
          履歴を再取得
        </button>
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
                {{ rankingScore(entry.best) }}点 ·
                {{ formatSeconds(entry.best.elapsedSeconds) }} · ヒント
                {{ entry.best.hintsUsed }}回（{{ hintStageLabel(entry.best) }}）
                · ミス {{ entry.best.mistakes }} · {{ entry.attempts }} 回挑戦
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
              時間は自己申告の参考記録です。ランキングには初回だけが反映されます。
            </p>
            <ol class="ranking-list">
              <li v-for="play in historyView.plays" :key="play.playId">
                {{ formatDate(play.completedAt) }} ·
                <code>{{ play.seedCode }}</code> ·
                {{ formatSeconds(play.elapsedSeconds) }} · ヒント
                {{ play.hintsUsed }}回（{{ hintStageLabel(play) }}） · ミス
                {{ play.mistakes }}
                <span>{{
                  isRanked(play.playId) ? "ランキング反映済み" : "個人履歴"
                }}</span>
              </li>
            </ol>
          </details>
        </template>
      </template>
    </div>
  </section>
</template>
