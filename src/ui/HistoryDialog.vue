<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { PlayResult } from "../core/results";
import {
  dailyHistory,
  historyView,
  localHistory,
  onlineHistory,
  type HistoryDifficulty,
  type HistoryPlay,
} from "../core/history-view";
import { loadSuperGame } from "../core/super-storage";
import { SuperOutbox } from "../core/super-outbox";
import { isComplete } from "../core/rules";
import { dailyDate } from "../core/daily-puzzle";
import { rankingScore } from "../core/ranking-score";
import { trapDialogFocus } from "./dialog";
import UiIcon from "./UiIcon.vue";

const props = defineProps<{
  open: boolean;
  plays: readonly PlayResult[];
  accountId?: string;
  revision?: number;
  loadOnline: (mode: OnlineHistoryMode) => Promise<unknown>;
}>();
type OnlineHistoryMode = "normal" | "super" | "daily";
const onlineModes = ["normal", "super", "daily"] as const;
const emit = defineEmits<{ close: []; restore: [seedCode: string] }>();
const dialog = ref<HTMLElement>();
const tabButtons = ref<HTMLButtonElement[]>([]);
const selected = ref<HistoryDifficulty>("easy");
const tabs = [
  { id: "easy", label: "初級" },
  { id: "normal", label: "中級" },
  { id: "hard", label: "上級" },
  { id: "super", label: "超級" },
  { id: "daily", label: "デイリー" },
] as const;
const connected = ref(navigator.onLine !== false);
const online = computed(() => !!props.accountId && connected.value);
const remote = ref<HistoryPlay[]>([]);
const localSupers = ref<HistoryPlay[]>([]);
const busy = ref(false);
const message = ref("");
const copyMessage = ref("");
const dateFormat = new Intl.DateTimeFormat("ja-JP", {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
async function copySeed(seedCode: string): Promise<void> {
  const current = generation;
  try {
    await navigator.clipboard.writeText(seedCode);
    if (current === generation) copyMessage.value = "シードをコピーしました。";
  } catch {
    if (current === generation)
      copyMessage.value =
        "コピーできませんでした。ブラウザのクリップボード権限を確認して再試行してください。";
  }
}
watch(
  () => [props.open, props.accountId, selected.value, online.value],
  () => {
    copyMessage.value = "";
  },
);
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
// Read when the dialog opens, so a day change while it stays open is not tracked.
const today = computed(() => (props.open ? dailyDate(Date.now()) : ""));
/** M/D, with the year only when it differs from today's. */
const dailyLabel = (date: string) => {
  const [year, month, day] = date.split("-").map(Number);
  return year === Number(today.value.slice(0, 4))
    ? `${month}/${day}`
    : `${year}/${month}/${day}`;
};
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
    onlineModes.map((mode) =>
      Promise.resolve().then(() => props.loadOnline(mode)),
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
      const mode = onlineModes[i];
      loaded.push(
        ...(mode === "daily"
          ? dailyHistory(data?.plays)
          : onlineHistory(data?.plays, mode)),
      );
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
        <p v-if="online || selected !== 'daily'" class="history-source">
          {{
            online
              ? "オンラインの記録（通常・超級・デイリーそれぞれ直近500件まで）"
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
        <p v-if="message" class="retry-status" role="status">
          <span>{{ message }}</span>
          <button
            type="button"
            class="icon-button"
            aria-label="再読み込み"
            title="再読み込み"
            :disabled="busy"
            @click="refresh"
          >
            <UiIcon name="reset" />
          </button>
        </p>
        <section
          :id="`history-panel-${selected}`"
          role="tabpanel"
          :aria-labelledby="`history-tab-${selected}`"
          tabindex="0"
        >
          <p v-if="selected === 'daily' && !online">
            デイリーの成績はログイン中のオンラインで表示します。
          </p>
          <template v-else>
            <p class="history-summary">
              <template v-if="selected === 'daily'"
                >{{ view.plays }}日挑戦 · </template
              ><template v-else-if="!online && selected !== 'super'"
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
              <figcaption>
                最近のクリア時間（最大20回・左が古い記録）
              </figcaption>
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
                <li
                  v-for="play in view.recent"
                  :key="play.id"
                  :data-seed-code="play.seedCode"
                >
                  <div v-if="play.completed" class="history-record-result">
                    <strong
                      :aria-label="`タイム ${seconds(play.elapsedSeconds!)}`"
                      ><UiIcon name="clock" />{{
                        seconds(play.elapsedSeconds!)
                      }}</strong
                    >
                    <strong
                      ><UiIcon name="score" /><span class="sr-only"
                        >スコア
                      </span>
                      {{
                        rankingScore({
                          elapsedSeconds: play.elapsedSeconds!,
                          mistakes: play.mistakes ?? 0,
                          hintsUsed: play.hintsUsed ?? 0,
                        })
                      }}点</strong
                    >
                  </div>
                  <strong v-else-if="play.date && play.date !== today"
                    >未完了</strong
                  >
                  <strong v-else>プレイ中</strong>
                  <p class="history-record-meta">
                    <time v-if="play.date" :datetime="play.date">{{
                      dailyLabel(play.date)
                    }}</time>
                    <time
                      v-else
                      :datetime="new Date(play.playedAt).toISOString()"
                      >{{ dateFormat.format(play.playedAt) }}</time
                    >
                    <template v-if="play.completed">
                      · ミス{{ play.mistakes }} · ヒント{{
                        play.hintsUsed
                      }}</template
                    >
                  </p>
                  <div
                    v-if="play.seedCode"
                    class="dialog-actions history-record-actions"
                  >
                    <button
                      type="button"
                      class="icon-button"
                      aria-label="再挑戦"
                      title="再挑戦"
                      @click="emit('restore', play.seedCode)"
                    >
                      <UiIcon name="reset" />
                    </button>
                    <button
                      type="button"
                      class="icon-button"
                      aria-label="シードを共有（コピー）"
                      title="シードを共有（コピー）"
                      @click="copySeed(play.seedCode)"
                    >
                      <UiIcon name="share" />
                    </button>
                  </div>
                </li>
              </ul>
            </details>
          </template>
          <p v-if="copyMessage" role="status">{{ copyMessage }}</p>
        </section>
      </div>
    </section>
  </div>
</template>
