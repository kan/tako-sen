<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import type { Puzzle } from "../core/model";
import type { LeaderboardEntry } from "../core/leaderboard";
import { puzzleId } from "../core/puzzle-identity";
import GameName from "./GameName.vue";
import { hintStageLabel } from "../core/hint-progress";

const props = defineProps<{
  puzzle: Puzzle;
  revision?: number;
  complete?: boolean;
  visible?: boolean;
}>();
const entries = ref<LeaderboardEntry[]>([]);
const busy = ref(false);
const message = ref("");
let generation = 0;
let pendingRefresh = false;
const panel = ref<HTMLDetailsElement>();
watch(
  () => props.visible,
  (visible) => {
    if (visible) void refresh();
  },
);
watch(
  () => [props.puzzle, props.revision, props.complete],
  () => {
    generation += 1;
    pendingRefresh = false;
    entries.value = [];
    message.value = "";
    busy.value = false;
    void refresh();
  },
  { immediate: true },
);

async function refresh(): Promise<void> {
  if (busy.value) {
    pendingRefresh = true;
    return;
  }
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
      if (pendingRefresh) {
        pendingRefresh = false;
        void refresh();
      }
    }
  }
}

function onPanelToggle(): void {
  if (panel.value?.open) void refresh();
}

function onPageVisible(): void {
  if (document.visibilityState === "visible") void refresh();
}
onMounted(() => document.addEventListener("visibilitychange", onPageVisible));
onUnmounted(() => {
  generation += 1;
  document.removeEventListener("visibilitychange", onPageVisible);
});
</script>

<template>
  <details
    ref="panel"
    id="public-leaderboard"
    class="stats-panel"
    :open="props.visible || props.complete"
    @toggle="onPanelToggle"
  >
    <summary>この問題の公開ランキング</summary>
    <div class="stats-panel-body">
      <p>
        ゲーム名の設定時に公開へ同意した参加者の初回成績です。自己申告の参考記録で、未ログインでも閲覧できます。
      </p>
      <p>
        ヒントの深さが浅い順、時間・ヒント数・ミス数の順で比較し、同成績は同順位。深さは見たヒントの最も詳しいレベルを共通尺度の1/4〜4/4で表します。通常ヒントは3/4まで、矛盾調査は4/4までです。未使用が最優先、旧記録の深さ不明は深さの分かる記録より後ろに並びます。各参加者の初回成績を最大100人表示します。
      </p>
      <p v-if="busy" role="status">ランキングを取得しています。</p>
      <p v-if="message" aria-live="polite">{{ message }}</p>
      <ul v-if="entries.length" class="ranking-list">
        <li v-for="entry in entries" :key="entry.displayName">
          {{ entry.rank }} 位 · <GameName :name="entry.displayName" /> ·
          {{ entry.elapsedSeconds }} 秒 · ヒント {{ entry.hintsUsed }}回（{{
            hintStageLabel(entry)
          }}） · ミス
          {{ entry.mistakes }}
        </li>
      </ul>
      <p>
        ログインしてゲーム名を設定すると自動参加します。再挑戦でランキングの成績は更新されません。退会で公開記録を削除できます。
      </p>
    </div>
  </details>
</template>
