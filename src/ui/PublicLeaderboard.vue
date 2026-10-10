<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { Puzzle } from "../core/model";
import type { LeaderboardEntry } from "../core/leaderboard";
import { puzzleId } from "../core/puzzle-identity";
import GameName from "./GameName.vue";
import { hintStageLabel } from "../core/hint-progress";
import { rankingScore } from "../core/ranking-score";
import { trapDialogFocus } from "./dialog";

const props = defineProps<{
  puzzle: Puzzle;
  revision?: number;
  complete?: boolean;
  open: boolean;
  gameName?: string;
  title?: string;
  fetchEntries?: (id: string) => Promise<Response>;
}>();
const emit = defineEmits<{ close: [] }>();
const entries = ref<LeaderboardEntry[]>([]);
const busy = ref(false);
const message = ref("");
let generation = 0;
const dialog = ref<HTMLElement>();
watch(
  () => props.open,
  (open) => {
    if (open) {
      void refresh();
      void nextTick(() => dialog.value?.focus());
    }
  },
);
watch(
  () => [props.puzzle, props.revision, props.complete],
  () => {
    generation += 1;
    entries.value = [];
    message.value = "";
    busy.value = false;
    if (props.open) void refresh();
  },
  { immediate: true },
);

async function refresh(): Promise<void> {
  const current = ++generation;
  busy.value = true;
  message.value = "";
  entries.value = [];
  try {
    const id = await puzzleId(props.puzzle);
    if (current !== generation) return;
    const response = props.fetchEntries
      ? await props.fetchEntries(id)
      : await fetch(`/api/leaderboards/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error("Leaderboard unavailable.");
    const data: { entries: LeaderboardEntry[] } = await response.json();
    if (current !== generation) return;
    entries.value = data.entries;
    message.value = data.entries.length
      ? `${data.entries.length} 人の初回成績を取得しました。`
      : "この問題には公開された記録がありません。";
  } catch {
    if (current === generation)
      message.value =
        "ランキングを取得できません。ローカルプレイは続けられます。";
  } finally {
    if (current === generation) {
      busy.value = false;
    }
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
  } else trapDialogFocus(event, dialog.value);
}

function onPageVisible(): void {
  if (props.open && document.visibilityState === "visible") void refresh();
}
onMounted(() => document.addEventListener("visibilitychange", onPageVisible));
onUnmounted(() => {
  generation += 1;
  document.removeEventListener("visibilitychange", onPageVisible);
});
</script>

<template>
  <div
    v-if="props.open"
    class="dialog-backdrop ranking-backdrop"
    role="presentation"
    @click.self="emit('close')"
  >
    <section
      ref="dialog"
      id="public-leaderboard"
      class="dialog-card ranking-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="public-leaderboard-title"
      tabindex="-1"
      @keydown="onKeydown"
    >
      <div class="ranking-header">
        <h2 id="public-leaderboard-title" class="tako-title">
          <img src="/tako.svg" alt="" aria-hidden="true" draggable="false" />
          <span>{{ props.title ?? "この問題のランキング" }}</span>
        </h2>
        <button
          type="button"
          class="dialog-close"
          aria-label="ランキングを閉じる"
          @click="emit('close')"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <p class="ranking-note">
        公開に同意した参加者の初回成績です。自己申告の参考記録で、未ログインでも閲覧できます。
      </p>
      <p v-if="busy" role="status">ランキングを取得しています。</p>
      <p v-else-if="message" aria-live="polite">{{ message }}</p>
      <ol v-if="entries.length" class="public-ranking-entries">
        <li
          v-for="entry in entries"
          :key="entry.displayName"
          :class="{
            'ranking-self':
              !!props.gameName && entry.displayName === props.gameName,
          }"
        >
          <div class="ranking-score-main">
            <strong class="ranking-place">{{ entry.rank }}位</strong>
            <div class="ranking-name">
              <GameName :name="entry.displayName" />
              <strong
                v-if="props.gameName && entry.displayName === props.gameName"
                class="ranking-you"
                >あなた</strong
              >
            </div>
            <strong>{{ rankingScore(entry) }}点</strong>
            <strong class="ranking-time">{{ entry.elapsedSeconds }}秒</strong>
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
      <details class="ranking-guide">
        <summary>順位の付け方</summary>
        <p>
          スコアは10,000点からクリア秒数、ミス1回につき180点、ヒント1回につき30点を引きます。高得点順で、同点は時間・ミス数・ヒント数の順に比較し、すべて同じなら同順位です。最大100人を表示します。
        </p>
      </details>
      <p class="ranking-note">
        ログインしてゲーム名を設定すると自動参加します。再挑戦では記録を更新しません。退会で公開記録を削除できます。
      </p>
    </section>
  </div>
</template>
