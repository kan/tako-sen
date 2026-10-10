<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { PlayResult } from "../core/results";
import {
  historyView,
  localHistory,
  onlineHistory,
  type HistoryDifficulty,
  type HistoryPlay,
} from "../core/history-view";
import { loadSuperGame } from "../core/super-storage";
import { SuperOutbox } from "../core/super-outbox";
import { isComplete } from "../core/rules";
import { rankingScore } from "../core/ranking-score";
import { trapDialogFocus } from "./dialog";

const props = defineProps<{
  open: boolean;
  plays: readonly PlayResult[];
  accountId?: string;
  revision?: number;
  loadOnline: (mode: "normal" | "super") => Promise<unknown>;
}>();
const emit = defineEmits<{ close: []; restore: [seedCode: string] }>();
const dialog = ref<HTMLElement>();
const tabButtons = ref<HTMLButtonElement[]>([]);
const selected = ref<HistoryDifficulty>("easy");
const tabs = [
  { id: "easy", label: "初級" },
  { id: "normal", label: "中級" },
  { id: "hard", label: "上級" },
  { id: "super", label: "超級" },
] as const;
const connected = ref(navigator.onLine !== false);
const online = computed(() => !!props.accountId && connected.value);
const remote = ref<HistoryPlay[]>([]);
const localSupers = ref<HistoryPlay[]>([]);
const busy = ref(false);
const message = ref("");
let generation = 0;
const records = computed(() =>
  online.value
    ? remote.value
    : [...localHistory(props.plays), ...localSupers.value],
);
const view = computed(() => historyView(records.value, selected.value));
const label = computed(
  () => tabs.find((tab) => tab.id === selected.value)!.label,
);
const chartPoints = computed(() =>
  view.value.trend.map((point) => `${point.x},${point.y}`).join(" "),
);
const seconds = (value: number) =>
  `${Math.floor(Math.round(value) / 60)}:${String(Math.round(value) % 60).padStart(2, "0")}`;
function readLocalSupers(): void {
  localSupers.value = [];
  if (!props.accountId) return;
  try {
    const storage = {
      getItem: (key: string) => localStorage.getItem(key),
      setItem: (key: string, value: string) => localStorage.setItem(key, value),
      keys: () =>
        Array.from({ length: localStorage.length }, (_, i) =>
          localStorage.key(i),
        ).filter((key): key is string => !!key),
    };
    localSupers.value = new SuperOutbox(storage)
      .completedRecords(props.accountId)
      .map(({ completion, capturedAt, seedCode }) => ({
        id: completion.playId,
        seedCode,
        difficulty: "super",
        playedAt: capturedAt,
        completed: true,
        elapsedSeconds: completion.elapsedSeconds,
        mistakes: completion.mistakes,
        hintsUsed: completion.hintsUsed,
      }));
    // Older queue records did not carry seeds. The current save can recover
    // its completed trial without guessing a seed for another puzzle.
    const saved = loadSuperGame(props.accountId, storage);
    if (
      saved?.session.claimed &&
      !localSupers.value.some((play) => play.id === saved.game.playId)
    ) {
      localSupers.value.push({
        id: saved.game.playId!,
        seedCode: saved.session.seedCode,
        difficulty: "super",
        playedAt: saved.game.state.startedAt,
        completed: isComplete(saved.game.puzzle, saved.game.state),
        elapsedSeconds: Math.floor((saved.game.timer.elapsedMs ?? 0) / 1000),
        mistakes: saved.game.state.mistakes,
        hintsUsed: saved.game.state.hintsUsed,
      });
    }
  } catch {
    message.value = "端末の超級記録を読み込めません。";
  }
}
async function refresh(): Promise<void> {
  const current = ++generation;
  remote.value = [];
  message.value = "";
  busy.value = false;
  if (!props.open) return;
  readLocalSupers();
  if (!online.value) return;
  busy.value = true;
  const account = props.accountId;
  const results = await Promise.allSettled(
    ["normal", "super"].map((mode) =>
      Promise.resolve().then(() =>
        props.loadOnline(mode as "normal" | "super"),
      ),
    ),
  );
  if (current !== generation || account !== props.accountId || !online.value)
    return;
  const loaded: HistoryPlay[] = [];
  let failures = 0;
  results.forEach((result, i) => {
    try {
      if (result.status !== "fulfilled") throw new Error();
      const data = result.value as { plays?: unknown };
      loaded.push(...onlineHistory(data?.plays, i === 0 ? "normal" : "super"));
    } catch {
      failures += 1;
    }
  });
  remote.value = loaded;
  busy.value = false;
  if (failures)
    message.value =
      "一部のオンライン成績を取得できません。再読み込みしてください。";
}
watch(
  () => [props.open, props.accountId, props.revision, connected.value],
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
function onTabKeydown(event: KeyboardEvent, index: number): void {
  const next =
    event.key === "ArrowRight"
      ? (index + 1) % tabs.length
      : event.key === "ArrowLeft"
        ? (index + tabs.length - 1) % tabs.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? tabs.length - 1
            : undefined;
  if (next === undefined) return;
  event.preventDefault();
  selected.value = tabs[next].id;
  tabButtons.value[next]?.focus();
}
function onConnection(): void {
  connected.value = navigator.onLine !== false;
}
onMounted(() => {
  window.addEventListener("online", onConnection);
  window.addEventListener("offline", onConnection);
});
onUnmounted(() => {
  generation += 1;
  window.removeEventListener("online", onConnection);
  window.removeEventListener("offline", onConnection);
});
</script>

<template>
  <div
    v-if="open"
    class="dialog-backdrop history-backdrop"
    role="presentation"
    @click.self="emit('close')"
  >
    <section
      ref="dialog"
      class="dialog-card history-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="history-title"
      tabindex="-1"
      @keydown="onKeydown"
    >
      <div class="dialog-header">
        <h2 id="history-title">履歴・成績</h2>
        <button
          type="button"
          class="dialog-close"
          aria-label="履歴・成績を閉じる"
          @click="emit('close')"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <div class="history-dialog-body">
        <p class="history-source">
          {{
            online
              ? "オンラインの完了記録（通常・超級それぞれ直近500件まで）"
              : "端末に保存された記録"
          }}
        </p>
        <div class="history-tabs" role="tablist" aria-label="成績の難易度">
          <button
            v-for="(tab, index) in tabs"
            :id="`history-tab-${tab.id}`"
            :key="tab.id"
            :ref="
              (el) => {
                if (el) tabButtons[index] = el as HTMLButtonElement;
              }
            "
            type="button"
            role="tab"
            :aria-selected="selected === tab.id"
            :aria-controls="`history-panel-${tab.id}`"
            :tabindex="selected === tab.id ? 0 : -1"
            @click="selected = tab.id"
            @keydown="onTabKeydown($event, index)"
          >
            {{ tab.label }}
          </button>
        </div>
        <p v-if="busy" role="status">成績を読み込んでいます。</p>
        <p v-if="message" role="status">
          {{ message }}
          <button type="button" :disabled="busy" @click="refresh">
            再読み込み
          </button>
        </p>
        <section
          :id="`history-panel-${selected}`"
          role="tabpanel"
          :aria-labelledby="`history-tab-${selected}`"
          tabindex="0"
        >
          <p class="history-summary">
            <template v-if="!online && selected !== 'super'"
              >{{ view.plays }}回プレイ · </template
            >{{ view.clears }}回クリア
          </p>
          <dl v-if="view.clears" class="history-summary-grid">
            <div>
              <dt>平均タイム</dt>
              <dd>{{ seconds(Math.round(view.averageSeconds!)) }}</dd>
            </div>
            <div>
              <dt>最高スコア</dt>
              <dd>{{ view.bestScore }}</dd>
            </div>
            <div>
              <dt>平均ミス</dt>
              <dd>{{ view.averageMistakes?.toFixed(1) }}</dd>
            </div>
            <div>
              <dt>平均ヒント</dt>
              <dd>{{ view.averageHints?.toFixed(1) }}</dd>
            </div>
          </dl>
          <p v-else-if="!busy">{{ label }}のクリア記録はありません。</p>
          <figure v-if="view.trend.length" class="history-chart">
            <figcaption>最近のクリア時間（最大20回・左が古い記録）</figcaption>
            <svg
              viewBox="0 0 300 120"
              role="img"
              :aria-label="`${label}のクリア時間の推移`"
            >
              <path d="M20 20v80h260" class="history-chart-axis" />
              <polyline :points="chartPoints" class="history-chart-line" />
              <circle
                v-for="point in view.trend"
                :key="point.play.id"
                :cx="point.x"
                :cy="point.y"
                r="3"
              >
                <title>{{ seconds(point.play.elapsedSeconds!) }}</title>
              </circle>
              <text x="20" y="14">{{ seconds(view.maxSeconds) }}</text>
              <text x="3" y="105">0</text>
            </svg>
          </figure>
          <details :key="selected" class="history-recent">
            <summary>最近のプレイ（{{ view.recent.length }}件）</summary>
            <ul>
              <li v-for="play in view.recent" :key="play.id">
                <button
                  type="button"
                  class="history-seed"
                  :title="play.seedCode"
                  @click="emit('restore', play.seedCode)"
                >
                  <code>{{ play.seedCode }}</code></button
                ><span v-if="play.completed"
                  >{{ seconds(play.elapsedSeconds!) }} ·
                  {{
                    rankingScore({
                      elapsedSeconds: play.elapsedSeconds!,
                      mistakes: play.mistakes ?? 0,
                      hintsUsed: play.hintsUsed ?? 0,
                    })
                  }}点 · ミス{{ play.mistakes }} · ヒント{{
                    play.hintsUsed
                  }}</span
                ><span v-else>プレイ中</span>
              </li>
            </ul>
          </details>
        </section>
      </div>
    </section>
  </div>
</template>
