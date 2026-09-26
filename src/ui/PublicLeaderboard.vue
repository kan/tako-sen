<script setup lang="ts">
import { ref, watch } from "vue";
import type { Puzzle } from "../core/model";
import type { LeaderboardEntry } from "../core/leaderboard";
import { puzzleId } from "../core/puzzle-identity";

const props = defineProps<{ puzzle: Puzzle }>();
const entries = ref<LeaderboardEntry[]>([]);
const busy = ref(false);
const message = ref("");
let generation = 0;
watch(
  () => props.puzzle,
  () => {
    generation += 1;
    entries.value = [];
    message.value = "";
    busy.value = false;
  },
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
      ? `${data.entries.length} 人の公開済みベストを取得しました。`
      : "この問題には公開された記録がありません。";
  } catch {
    if (current === generation)
      message.value =
        "ランキングを取得できません。ローカルプレイは続けられます。";
  } finally {
    if (current === generation) busy.value = false;
  }
}
</script>

<template>
  <details class="stats-panel">
    <summary>この問題の公開ランキング</summary>
    <div class="stats-panel-body">
      <p>
        任意で公開された自己申告の参考記録です。未ログインでも閲覧できます。
      </p>
      <p>
        時間・ヒント数・ミス数の順で比較し、同成績は同順位。各参加者の公開済みベストを最大100人表示します。
      </p>
      <button type="button" :disabled="busy" @click="refresh">
        ランキングを更新
      </button>
      <p v-if="message" aria-live="polite">{{ message }}</p>
      <ul v-if="entries.length" class="ranking-list">
        <li v-for="entry in entries" :key="entry.displayName">
          {{ entry.rank }} 位 · {{ entry.displayName }} ·
          {{ entry.elapsedSeconds }} 秒 · ヒント {{ entry.hintsUsed }} · ミス
          {{ entry.mistakes }}
        </li>
      </ul>
      <p>
        参加・取り消しは「オンライン履歴」の「該当する履歴」から行えます。公開取り消し後、閲覧側の表示は更新時に反映されます。
      </p>
    </div>
  </details>
</template>
