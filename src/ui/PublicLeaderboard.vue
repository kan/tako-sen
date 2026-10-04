<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { Puzzle } from "../core/model";
import type { LeaderboardEntry } from "../core/leaderboard";
import { puzzleId } from "../core/puzzle-identity";
import GameName from "./GameName.vue";
import { hintStageLabel } from "../core/hint-progress";
import { trapDialogFocus } from "./dialog";

const props = defineProps<{
  puzzle: Puzzle;
  revision?: number;
  complete?: boolean;
  open: boolean;
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
    const response = await fetch(`/api/leaderboards/${encodeURIComponent(id)}`);
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
        <h2 id="public-leaderboard-title">この問題のランキング</h2>
        <button type="button" class="dialog-close" @click="emit('close')">
          閉じる
        </button>
      </div>
      <p class="ranking-note">
        公開に同意した参加者の初回成績です。自己申告の参考記録で、未ログインでも閲覧できます。
      </p>
      <p v-if="busy" role="status">ランキングを取得しています。</p>
      <p v-else-if="message" aria-live="polite">{{ message }}</p>
      <ol v-if="entries.length" class="public-ranking-entries">
        <li v-for="entry in entries" :key="entry.displayName">
          <div class="ranking-score-main">
            <strong class="ranking-place">{{ entry.rank }}位</strong>
            <GameName :name="entry.displayName" />
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
          ヒントの深さが浅い順、時間・ヒント数・ミス数の順で比較し、同成績は同順位です。深さは見たヒントの最も詳しいレベルを1/4〜4/4で表します。通常ヒントは3/4まで、矛盾調査は4/4までです。未使用が最優先で、深さ不明の旧記録は最後に並びます。最大100人を表示します。
        </p>
      </details>
      <p class="ranking-note">
        ログインしてゲーム名を設定すると自動参加します。再挑戦では記録を更新しません。退会で公開記録を削除できます。
      </p>
    </section>
  </div>
</template>
