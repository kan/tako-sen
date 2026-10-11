<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { PuzzleDifficulty } from "../core/model";
import type { WeeklyMetric, WeeklyRanking } from "../core/weekly-ranking";
import GameName from "./GameName.vue";
import UiIcon from "./UiIcon.vue";
import { trapDialogFocus } from "./dialog";

const props = defineProps<{
  open: boolean;
  gameName?: string;
  revision?: number;
}>();
const emit = defineEmits<{ close: [] }>();
const difficulty = ref<PuzzleDifficulty>("easy");
const metric = ref<WeeklyMetric>("clears");
const data = ref<WeeklyRanking>();
const busy = ref(false);
const message = ref("");
const dialog = ref<HTMLElement>();
let generation = 0;
let controller: AbortController | undefined;
const dateFormat = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "numeric",
  day: "numeric",
});
async function refresh(): Promise<void> {
  const current = ++generation;
  controller?.abort();
  data.value = undefined;
  message.value = "";
  busy.value = false;
  if (!props.open) return;
  const requestController = new AbortController();
  controller = requestController;
  const timeout = setTimeout(() => requestController.abort(), 30000);
  busy.value = true;
  try {
    const response = await fetch(
      `/api/weekly-ranking?difficulty=${difficulty.value}&metric=${metric.value}`,
      { signal: requestController.signal },
    );
    if (!response.ok) throw new Error("Weekly ranking unavailable");
    const result: WeeklyRanking = await response.json();
    if (
      !Number.isSafeInteger(result.start) ||
      !Number.isSafeInteger(result.end) ||
      !Array.isArray(result.entries)
    )
      throw new Error("Invalid ranking");
    if (current === generation) data.value = result;
  } catch {
    if (current === generation)
      message.value =
        "週間ランキングを取得できません。通信状態を確認して再試行してください。";
  } finally {
    clearTimeout(timeout);
    if (current === generation) busy.value = false;
  }
}
watch(
  () => [props.open, difficulty.value, metric.value, props.revision],
  () => {
    void refresh();
  },
  { immediate: true },
);
watch(
  () => props.open,
  (open) => {
    if (open) void nextTick(() => dialog.value?.focus());
  },
  { immediate: true },
);
function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
  } else trapDialogFocus(event, dialog.value);
}
function onVisible(): void {
  if (props.open && document.visibilityState === "visible") void refresh();
}
function onOnline(): void {
  if (props.open) void refresh();
}
onMounted(() => {
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", onOnline);
});
onUnmounted(() => {
  generation += 1;
  controller?.abort();
  document.removeEventListener("visibilitychange", onVisible);
  window.removeEventListener("online", onOnline);
});
</script>

<template>
  <div
    v-if="open"
    class="dialog-backdrop ranking-backdrop"
    role="presentation"
    @click.self="emit('close')"
  >
    <section
      ref="dialog"
      class="dialog-card ranking-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="weekly-ranking-title"
      tabindex="-1"
      @keydown="onKeydown"
    >
      <div class="dialog-header ranking-header">
        <h2 id="weekly-ranking-title">週間プレイヤーランキング</h2>
        <button
          type="button"
          class="dialog-close"
          aria-label="週間ランキングを閉じる"
          @click="emit('close')"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <div class="weekly-ranking-filters">
        <label class="weekly-difficulty-label"
          ><UiIcon name="difficulty" />難易度
          <select v-model="difficulty" aria-label="週間ランキングの難易度">
            <option value="easy">初級</option>
            <option value="normal">中級</option>
            <option value="hard">上級</option>
          </select></label
        >
        <fieldset class="weekly-metric-switch">
          <legend class="sr-only">週間ランキングの集計</legend>
          <label
            ><input
              v-model="metric"
              class="sr-only"
              type="radio"
              name="weekly-metric"
              value="clears"
            /><span>クリア数</span></label
          >
          <label
            ><input
              v-model="metric"
              class="sr-only"
              type="radio"
              name="weekly-metric"
              value="time"
            /><span>平均タイム</span></label
          >
        </fieldset>
      </div>
      <p class="ranking-note">
        日本時間の月曜0時〜翌月曜0時。通常問題のみ、同じ問題は週に1クリアとして集計します。平均タイムは週5クリア以上が対象です。
      </p>
      <p v-if="data" class="ranking-note">
        {{ dateFormat.format(data.start) }} 0:00 〜
        {{ dateFormat.format(data.end) }} 0:00（日本時間）
      </p>
      <p v-if="busy" role="status">週間ランキングを取得しています。</p>
      <p v-else-if="message" role="status">
        {{ message }} <button type="button" @click="refresh">再試行</button>
      </p>
      <p v-else-if="data && !data.entries.length" role="status">
        今週の対象となる公開記録はありません。
      </p>
      <ol v-if="data?.entries.length" class="public-ranking-entries">
        <li
          v-for="entry in data.entries"
          :key="entry.displayName"
          :class="{
            'ranking-self': !!gameName && entry.displayName === gameName,
          }"
        >
          <div class="ranking-score-main">
            <strong class="ranking-place">{{ entry.rank }}位</strong>
            <div class="ranking-name">
              <GameName :name="entry.displayName" /><strong
                v-if="gameName && entry.displayName === gameName"
                class="ranking-you"
                >あなた</strong
              >
            </div>
            <strong class="ranking-time">{{
              metric === "clears"
                ? `${entry.clears}クリア`
                : `${entry.averageSeconds.toFixed(1)}秒`
            }}</strong>
          </div>
          <div class="ranking-score-meta">
            <span>{{
              metric === "clears"
                ? `平均 ${entry.averageSeconds.toFixed(1)}秒`
                : `${entry.clears}クリア`
            }}</span>
          </div>
        </li>
      </ol>
      <details class="ranking-guide">
        <summary>順位の付け方</summary>
        <p>
          クリア数は多い順、平均タイムは短い順です。同じ値は同順位。各問題は週内で最初にクリアした試行を採用し、再挑戦の速いタイムへの差し替えはしません。最大100人を表示します。
        </p>
      </details>
      <p class="ranking-note">
        公開に同意した参加者の自己申告による参考記録です。未ログインでも閲覧でき、デイリー・超級・練習は含めません。
      </p>
    </section>
  </div>
</template>
