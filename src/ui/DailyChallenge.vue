<script setup lang="ts">
import { useAuth, SignInButton } from "@clerk/vue";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { Puzzle, PlayerState } from "../core/model";
import { maximumHintStage, hintStageLabel } from "../core/hint-progress";
import { trapDialogFocus } from "./dialog";
import { restoreSharedPuzzleSnapshot } from "../core/shared-puzzle";
import { puzzleId } from "../core/puzzle-identity";
import { loadDailyGame } from "../core/storage";
import type {
  DailyStatus,
  DailyLeaderboardEntry,
  DailyCompletion,
} from "../worker/daily";
import GameName from "./GameName.vue";

const props = defineProps<{
  activeDate?: string;
  activeAccountId?: string;
  puzzle: Puzzle;
  state: PlayerState;
  playId?: string;
  elapsedSeconds: number;
  complete: boolean;
  gameName: string;
}>();
const emit = defineEmits<{
  start: [
    puzzle: Puzzle,
    date: string,
    accountId: string,
    playId: string,
    saved?: ReturnType<typeof loadDailyGame>,
  ];
  account: [];
  panelOpened: [];
  panelClosed: [];
  rankingOpened: [];
  rankingClosed: [];
}>();
const { getToken, isLoaded, isSignedIn, userId } = useAuth();
const panelOpen = ref(false);
const panelDialogRef = ref<HTMLElement>();
const entryButtonRef = ref<HTMLButtonElement>();
const busy = ref(false);
const message = ref("");
const status = ref<DailyStatus>();
const entries = ref<DailyLeaderboardEntry[]>([]);
const showingRanking = ref(false);
const rankingLoading = ref(false);
const rankingMessage = ref("");
const rankingDialogRef = ref<HTMLElement>();
let focusBeforeRanking: HTMLElement | null = null;
const signedIn = computed(() => isLoaded.value && isSignedIn.value);
let retryTimer: ReturnType<typeof setInterval> | undefined;

async function request(path: string, init?: RequestInit): Promise<Response> {
  const token = await getToken.value();
  if (!token) throw new Error("ログインが必要です。");
  return fetch(path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...init?.headers },
  });
}

async function openPanel(): Promise<void> {
  if (panelOpen.value) closePanel();
  if (!props.gameName) {
    emit("account");
    return;
  }
  await refresh();
  if (
    status.value?.attempt === "active" &&
    status.value.date === props.activeDate &&
    status.value.playId === props.playId
  ) {
    return;
  }
  if (status.value && status.value.attempt !== "completed") await begin();
  if (message.value) showPanel();
}

function showPanel(): void {
  panelOpen.value = true;
  emit("panelOpened");
  void nextTick(() => panelDialogRef.value?.focus());
}

function closePanel(): void {
  if (!panelOpen.value) return;
  panelOpen.value = false;
  emit("panelClosed");
  void nextTick(() => entryButtonRef.value?.focus());
}

function onPanelKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    closePanel();
  } else trapDialogFocus(event, panelDialogRef.value);
}

async function refresh(): Promise<void> {
  if (!userId.value || busy.value) return;
  busy.value = true;
  message.value = "";
  status.value = undefined;
  try {
    const response = await request("/api/daily");
    if (!response.ok) throw new Error("デイリーチャレンジを取得できません。");
    const data: DailyStatus = await response.json();
    status.value = data;
    if (data.attempt === "completed") await showRanking(data.date);
    else if (showingRanking.value) closeRanking();
  } catch {
    message.value = "通信できません。通常のプレイは続けられます。";
  } finally {
    busy.value = false;
  }
}

async function begin(): Promise<void> {
  if (!status.value || !userId.value || busy.value) return;
  const day = status.value;
  if (day.attempt === "active") {
    const saved = loadDailyGame(userId.value, day.date);
    if (!saved || saved.playId !== day.playId) {
      message.value =
        "この端末に挑戦の続きがありません。別の端末で開始した場合は、開始した端末から再開してください。";
      return;
    }
    try {
      const puzzle = await restoreSharedPuzzleSnapshot(day.puzzle);
      if ((await puzzleId(saved.puzzle)) !== day.puzzle.id)
        throw new Error("Saved puzzle mismatch.");
      emit("start", puzzle, day.date, userId.value, day.playId!, saved);
      closePanel();
    } catch {
      message.value = "保存された盤面を復元できません。";
    }
    return;
  }
  if (day.attempt !== "not_started") return;
  busy.value = true;
  try {
    const puzzle = await restoreSharedPuzzleSnapshot(day.puzzle);
    const playId = crypto.randomUUID();
    emit("start", puzzle, day.date, userId.value, playId);
    closePanel();
  } catch (error) {
    message.value = String(error);
  } finally {
    busy.value = false;
  }
}

async function claimStart(date: string, playId: string): Promise<boolean> {
  if (!userId.value || !status.value || status.value.date !== date)
    return false;
  try {
    const response = await request("/api/daily/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, playId }),
    });
    if (response.status === 403) emit("account");
    if (!response.ok)
      throw new Error("今日の挑戦は既に始まっているか、日付が変わりました。");
    status.value = { ...status.value, attempt: "active", playId };
    return true;
  } catch {
    message.value =
      "開始できません。接続とログイン状態を確認して、もう一度 OK を押してください。";
    return false;
  }
}

defineExpose({ claimStart, openRanking: showRanking });

async function showRanking(date: string): Promise<void> {
  closePanel();
  if (!showingRanking.value) {
    focusBeforeRanking =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    emit("rankingOpened");
  }
  showingRanking.value = true;
  rankingLoading.value = true;
  rankingMessage.value = "";
  entries.value = [];
  await nextTick();
  rankingDialogRef.value?.focus();
  try {
    const response = await request(
      `/api/daily/ranking?date=${encodeURIComponent(date)}`,
    );
    if (!response.ok) throw new Error();
    const data: { entries: DailyLeaderboardEntry[] } = await response.json();
    entries.value = data.entries;
  } catch {
    rankingMessage.value = "ランキングを取得できません。";
  } finally {
    rankingLoading.value = false;
  }
}

function closeRanking(): void {
  showingRanking.value = false;
  emit("rankingClosed");
  void nextTick(() => {
    if (focusBeforeRanking?.isConnected) focusBeforeRanking.focus();
    focusBeforeRanking = null;
  });
}

function onRankingKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    closeRanking();
  } else trapDialogFocus(event, rankingDialogRef.value);
}

function pendingKey(accountId: string, date: string): string {
  return `tako-sen.daily-pending.v1:${accountId}:${date}`;
}

async function sendCompletion(
  completion: DailyCompletion,
  accountId: string,
): Promise<void> {
  const key = pendingKey(accountId, completion.date);
  try {
    localStorage.setItem(key, JSON.stringify(completion));
  } catch {
    message.value =
      "記録を保存できません。通信可能な状態でこの画面を開いたまま再試行してください。";
  }
  try {
    const response = await request("/api/daily/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(completion),
    });
    if (!response.ok) throw new Error();
    try {
      localStorage.removeItem(key);
    } catch {
      /* 保存不可 */
    }
    if (panelOpen.value) await refresh();
  } catch {
    message.value = "結果の送信待ちです。接続が戻ると再送します。";
  }
}

async function retryPending(): Promise<void> {
  if (!userId.value) return;
  const prefix = `tako-sen.daily-pending.v1:${userId.value}:`;
  const pending: string[] = [];
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(prefix)) pending.push(key);
    }
  } catch {
    return;
  }
  for (const key of pending) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const completion = JSON.parse(raw) as DailyCompletion;
      if (key === pendingKey(userId.value, completion.date))
        await sendCompletion(completion, userId.value);
    } catch {
      /* 破損データを勝手に送信しない */
    }
  }
}

watch(
  () => [props.complete, props.activeDate, props.playId, userId.value],
  async () => {
    if (
      !props.complete ||
      !props.activeDate ||
      !props.playId ||
      !userId.value ||
      userId.value !== props.activeAccountId ||
      props.puzzle.generatorVersion !== "daily-v1"
    )
      return;
    const completion: DailyCompletion = {
      date: props.activeDate,
      playId: props.playId,
      puzzleId: await puzzleId(props.puzzle),
      pieces: [...props.state.pieces],
      elapsedSeconds: props.elapsedSeconds,
      mistakes: props.state.mistakes,
      hintsUsed: props.state.hintsUsed,
      maxHintStage: maximumHintStage(props.state),
    };
    await sendCompletion(completion, userId.value);
  },
  { immediate: true },
);
watch(userId, () => {
  if (showingRanking.value) closeRanking();
  status.value = undefined;
  entries.value = [];
  closePanel();
  void retryPending();
});
onMounted(() => {
  retryTimer = setInterval(() => {
    void retryPending();
  }, 30_000);
  void retryPending();
});
onUnmounted(() => {
  if (retryTimer) clearInterval(retryTimer);
});
</script>

<template>
  <section class="daily-entry">
    <SignInButton v-if="!signedIn"
      ><button type="button">
        デイリーチャレンジ · ログインして挑戦
      </button></SignInButton
    >
    <button
      v-else
      ref="entryButtonRef"
      type="button"
      :disabled="busy"
      @click="openPanel"
    >
      {{ busy ? "読み込み中…" : "デイリーチャレンジ" }}
    </button>
    <Teleport v-if="panelOpen" to="body">
      <div
        class="dialog-backdrop daily-panel-backdrop"
        role="presentation"
        @click.self="closePanel"
      >
        <section
          ref="panelDialogRef"
          class="dialog-card daily-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="daily-panel-title"
          tabindex="-1"
          @keydown="onPanelKeydown"
        >
          <div class="daily-panel-header">
            <h2 id="daily-panel-title">デイリーチャレンジ</h2>
            <button type="button" class="dialog-close" @click="closePanel">
              閉じる
            </button>
          </div>
          <p v-if="message" role="alert">{{ message }}</p>
          <p v-if="status">{{ status.date }} · 10×10 · タコ10匹 · 上級</p>
          <button v-if="!status" type="button" @click="openPanel">
            再試行
          </button>
          <button
            v-else-if="status.attempt !== 'completed'"
            type="button"
            :disabled="busy"
            @click="begin"
          >
            {{ status.attempt === "active" ? "挑戦を続ける" : "挑戦を始める" }}
          </button>
        </section>
      </div>
    </Teleport>
    <Teleport v-if="showingRanking" to="body">
      <div
        class="dialog-backdrop daily-ranking-backdrop"
        role="presentation"
        @click.self="closeRanking"
      >
        <section
          ref="rankingDialogRef"
          class="dialog-card ranking-dialog daily-ranking-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="daily-ranking-title"
          tabindex="-1"
          @keydown="onRankingKeydown"
        >
          <div class="ranking-header">
            <h2 id="daily-ranking-title">今日のランキング</h2>
            <button type="button" class="dialog-close" @click="closeRanking">
              閉じる
            </button>
          </div>
          <p class="ranking-note">
            時間・ヒント・ミスは参考記録です。同成績は同順位です。
          </p>
          <p v-if="rankingLoading" role="status">読み込み中…</p>
          <p v-else-if="rankingMessage" role="alert">{{ rankingMessage }}</p>
          <p v-else-if="!entries.length">まだ記録がありません。</p>
          <ol v-else class="ranking-entries">
            <li
              v-for="entry in entries"
              :key="entry.displayName"
              :class="{ 'daily-self': entry.isSelf }"
            >
              <div class="ranking-score-main">
                <strong class="ranking-place">{{ entry.rank }}位</strong>
                <GameName :name="entry.displayName" />
                <strong v-if="entry.isSelf" class="ranking-you">あなた</strong>
                <span class="ranking-time">{{ entry.elapsedSeconds }}秒</span>
              </div>
              <div class="ranking-score-meta">
                <span
                  >ヒント {{ entry.hintsUsed }}回（{{
                    hintStageLabel(entry)
                  }}）</span
                >
                <span>ミス {{ entry.mistakes }}</span>
              </div>
            </li>
          </ol>
        </section>
      </div>
    </Teleport>
  </section>
</template>
