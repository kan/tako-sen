<script setup lang="ts">
import { useAuth, SignInButton } from "@clerk/vue";
import UiIcon from "./UiIcon.vue";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { Puzzle, PlayerState } from "../core/model";
import { createInitialPlayerState } from "../core/model";
import type { SavedPlayTimer } from "../core/play-timer";
import { isComplete } from "../core/rules";
import { maximumHintStage } from "../core/hint-progress";
import {
  encodeSuperSeed,
  generateSuperPuzzle,
  parseSuperSeed,
} from "../core/super-puzzle";
import {
  hasSuperRight,
  parseSuperProgress,
  remainingSuperPlays,
  type SuperProgress,
} from "../core/super-progress";
import {
  loadSuperGame,
  saveSuperGame,
  type SavedSuperGame,
  type SuperSession,
} from "../core/super-storage";
import { SuperOutbox, type SuperPending } from "../core/super-outbox";
import {
  chooseNextPuzzle,
  type RankedPuzzleCandidate,
} from "../core/next-puzzle";
import { puzzleId } from "../core/puzzle-identity";
import { restoreSharedPuzzleSnapshot } from "../core/shared-puzzle";
import { trapDialogFocus } from "./dialog";
import PublicLeaderboard from "./PublicLeaderboard.vue";
import { rankingScore } from "../core/ranking-score";

const props = defineProps<{
  puzzle: Puzzle;
  playId?: string;
  complete: boolean;
  gameName: string;
  playScreen: boolean;
  historyOpen: boolean;
  modalBlocked: boolean;
}>();
const emit = defineEmits<{
  start: [puzzle: Puzzle, saved: SavedSuperGame];
  pause: [];
  account: [];
  opened: [];
  closed: [];
  synced: [];
}>();
const { userId, isLoaded, isSignedIn, getToken } = useAuth();
const account = computed(() =>
  isLoaded.value && isSignedIn.value && props.gameName ? userId.value : null,
);
const isSuper = computed(() => props.puzzle.generatorVersion === "super-v1");
const progress = ref<SuperProgress>();
const progressOwner = ref<string>();
const active = ref<{ accountId: string; session: SuperSession }>();
const availableSave = ref(false);
const busy = ref(false);
const syncing = ref(false);
const offerOpen = ref(false);
const rankingOpen = ref(false);
const message = ref("");
const revision = ref(0);
const dialog = ref<HTMLElement>();
const entryButton = ref<HTMLElement>();
let focusBefore: HTMLElement | null = null;
let epoch = 0;
let preparation = 0;
const sharedCode = ref<string>();
let disposed = false;
let retryTimer: ReturnType<typeof setInterval> | undefined;
const excluded = new Set<string>();
const outbox = new SuperOutbox({
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
  keys: () =>
    Array.from({ length: localStorage.length }, (_, i) =>
      localStorage.key(i),
    ).filter((k): k is string => !!k),
});
const cacheKey = (id: string) =>
  `tako-sen.super-progress.v1:${encodeURIComponent(id)}`;
const trialKey = (id: string) => `tako-sen.super-trial.v1:${id}`;
const right = computed(() => !!progress.value && hasSuperRight(progress.value));
const label = computed(() =>
  right.value
    ? "超級に挑戦できます"
    : progress.value
      ? `あと${remainingSuperPlays(progress.value)}`
      : "",
);

function current(id: string, generation: number): boolean {
  return (
    !disposed &&
    id === account.value &&
    generation === epoch &&
    navigator.onLine !== false
  );
}
async function request(path: string, body?: unknown): Promise<Response> {
  const id = account.value;
  const generation = epoch;
  if (!id || !current(id, generation))
    throw new Error("ログインとオンライン接続が必要です。");
  const token = await getToken.value();
  if (!token || !current(id, generation))
    throw new Error("ログイン状態を確認してください。");
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!current(id, generation))
      throw new Error("アカウントか接続状態が変わりました。");
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) emit("pause");
      if (response.status === 403) emit("account");
      throw new Error(
        response.status === 429
          ? "送信が混み合っています。少し待って再試行してください。"
          : "通信・ログイン状態を確認して再試行してください。",
      );
    }
    return response;
  } finally {
    window.clearTimeout(timeout);
  }
}
async function readBody(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("応答を確認できません。");
  return value as Record<string, unknown>;
}
function applyProgress(value: unknown, id: string): void {
  const parsed = parseSuperProgress(value);
  if (id !== account.value) return;
  if (!parsed) throw new Error("超級の進行を確認できません。");
  progress.value = outbox.isDeferred(id, parsed.cycle)
    ? { ...parsed, offerPending: false }
    : parsed;
  progressOwner.value = id;
  try {
    localStorage.setItem(cacheKey(id), JSON.stringify(progress.value));
  } catch {
    /* cached state is optional */
  }
  rememberTrial();
}
function rememberTrial(): void {
  const id = account.value;
  if (
    !id ||
    !props.playId ||
    props.puzzle.size !== 8 ||
    progressOwner.value !== id ||
    !progress.value
  )
    return;
  try {
    if (localStorage.getItem(trialKey(props.playId)) === null)
      localStorage.setItem(
        trialKey(props.playId),
        JSON.stringify({ accountId: id, cycle: progress.value.cycle }),
      );
  } catch {
    /* capture will report unavailable persistence */
  }
}
function captureNormalTrial(playId: string, seedCode: string): void {
  rememberTrial();
  const id = account.value;
  if (!id) return;
  try {
    const trial = JSON.parse(localStorage.getItem(trialKey(playId)) ?? "null");
    if (!trial || trial.accountId !== id || !Number.isSafeInteger(trial.cycle))
      throw new Error();
    if (
      !outbox.capture(id, {
        kind: "event",
        body: { playId, seedCode, cycle: trial.cycle },
      })
    )
      throw new Error();
    void retry();
  } catch {
    message.value =
      "超級のプレイ回数を保存できませんでした。通常プレイは続けられます。";
  }
}
async function refresh(): Promise<void> {
  const id = account.value;
  const generation = epoch;
  if (!id || navigator.onLine === false) return;
  try {
    const data = await readBody(await request("/api/super/progress"));
    if (current(id, generation)) applyProgress(data.progress, id);
  } catch {
    if (current(id, generation))
      message.value = "超級の進行を取得できません。通常プレイは続けられます。";
  }
}
async function retry(): Promise<void> {
  const id = account.value;
  const generation = epoch;
  if (!id || syncing.value || navigator.onLine === false) return;
  syncing.value = true;
  try {
    const sent = await outbox.flush(
      id,
      () => current(id, generation),
      async (item: SuperPending) => {
        const data = await readBody(
          await request(`/api/super/${item.kind}`, item.body),
        );
        if (current(id, generation) && data.progress)
          applyProgress(data.progress, id);
      },
    );
    if (sent && current(id, generation)) {
      revision.value += 1;
      emit("synced");
      message.value = "";
    }
    if (current(id, generation)) await refresh();
  } catch {
    if (current(id, generation))
      message.value =
        "超級の未送信記録を保持しています。同じアカウントで再接続すると再送します。";
  } finally {
    syncing.value = false;
  }
}
function showOffer(): void {
  if (offerOpen.value) return;
  focusBefore =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  offerOpen.value = true;
  emit("opened");
  void nextTick(() => dialog.value?.focus());
  if (account.value && progress.value?.offerPending) {
    const cycle = progress.value.cycle;
    if (outbox.capture(account.value, { kind: "defer", body: { cycle } })) {
      progress.value = { ...progress.value, offerPending: false };
      void retry();
    } else
      message.value =
        "案内済み状態を保存できません。次回も案内する場合があります。";
  }
}
function closeOffer(): void {
  if (!offerOpen.value) return;
  offerOpen.value = false;
  sharedCode.value = undefined;
  preparation += 1;
  emit("closed");
  void nextTick(() =>
    focusBefore?.isConnected ? focusBefore.focus() : entryButton.value?.focus(),
  );
  focusBefore = null;
}
function offerIfPending(): boolean {
  if (
    !isSuper.value &&
    account.value &&
    progress.value?.offerPending &&
    right.value
  ) {
    showOffer();
    return true;
  }
  return false;
}
function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    closeOffer();
  } else trapDialogFocus(event, dialog.value);
}
async function prepare(seedCode?: string): Promise<void> {
  if (busy.value) return;
  if (!account.value) {
    emit("account");
    return;
  }
  const id = account.value;
  const generation = epoch;
  const ticket = ++preparation;
  const preparing = () => current(id, generation) && preparation === ticket;
  busy.value = true;
  message.value = "";
  try {
    await refresh();
    if (!preparing()) return;
    if (!progress.value)
      throw new Error("接続とログイン状態を確認してください。");
    const entry = seedCode ? "shared" : "earned";
    if (entry === "earned" && !hasSuperRight(progress.value))
      throw new Error("通常プレイ10回で超級に挑戦できます。");
    const cycle = progress.value.cycle;
    let candidate: RankedPuzzleCandidate | undefined;
    if (!seedCode) {
      try {
        const data = await readBody(await request("/api/super/candidates"));
        if (!preparing()) return;
        candidate = chooseNextPuzzle(
          Array.isArray(data.candidates) ? data.candidates : [],
          new Set([...excluded, ...outbox.completedIds(id)]),
          Math.random,
        );
      } catch {
        if (!preparing()) return;
      }
      seedCode = candidate?.seedCode ?? encodeSuperSeed(crypto.randomUUID());
    }
    if (candidate && parseSuperSeed(seedCode) === undefined) {
      candidate = undefined;
      seedCode = encodeSuperSeed(crypto.randomUUID());
    }
    let seed = parseSuperSeed(seedCode);
    if (seed === undefined) throw new Error("超級のシードを復元できません。");
    let generated;
    try {
      generated = generateSuperPuzzle(seed);
    } catch (error) {
      if (!candidate) throw error;
      candidate = undefined;
      seedCode = encodeSuperSeed(crypto.randomUUID());
      seed = parseSuperSeed(seedCode)!;
      generated = generateSuperPuzzle(seed);
    }
    let identity = await puzzleId(generated);
    if (candidate && identity !== candidate.puzzleId) {
      if (!preparing()) return;
      seedCode = encodeSuperSeed(crypto.randomUUID());
      seed = parseSuperSeed(seedCode)!;
      generated = generateSuperPuzzle(seed);
      identity = await puzzleId(generated);
    }
    const data = await readBody(
      await request("/api/super/prepare", { seedCode }),
    );
    const verified = await restoreSharedPuzzleSnapshot(data.puzzle);
    if (!preparing()) return;
    if (
      (await puzzleId(verified)) !== identity ||
      verified.seed !== seed ||
      verified.generatorVersion !== "super-v1"
    )
      throw new Error("超級の盤面を確認できません。");
    if (!preparing()) return;
    const session: SuperSession = {
      puzzleId: identity,
      seedCode,
      entry,
      cycle,
      claimed: false,
    };
    const playId = crypto.randomUUID();
    const state = createInitialPlayerState(undefined, generated.givens);
    const timer = { waitingToStart: true, elapsedMs: 0, hasStarted: false };
    if (
      !saveSuperGame(id, session, generated, state, playId, timer, localStorage)
    )
      throw new Error("保存できないため超級を開始できません。");
    const saved = loadSuperGame(id, localStorage);
    if (!saved) throw new Error("保存した超級を確認できません。");
    active.value = { accountId: id, session };
    availableSave.value = true;
    excluded.add(identity);
    persistExcluded(id);
    closeOffer();
    sharedCode.value = undefined;
    emit("start", generated, saved);
  } catch (error) {
    if (preparing())
      message.value =
        error instanceof Error ? error.message : "超級を開始できません。";
  } finally {
    busy.value = false;
  }
}
function openShared(code: string): void {
  if (parseSuperSeed(code) === undefined) {
    message.value = "超級のシードを復元できません。";
    return;
  }
  sharedCode.value = code;
  if (!account.value) {
    emit("account");
    return;
  }
  showOffer();
}
function canPlay(): boolean {
  return (
    !!active.value?.session.claimed &&
    active.value.accountId === account.value &&
    navigator.onLine !== false
  );
}
async function resumeSaved(): Promise<void> {
  const id = account.value;
  const generation = epoch;
  if (!id || busy.value) return;
  busy.value = true;
  try {
    await request("/api/super/progress");
    const saved = loadSuperGame(id, localStorage);
    if (
      !saved ||
      (await puzzleId(saved.game.puzzle)) !== saved.session.puzzleId
    )
      throw new Error("この端末の超級を復元できません。");
    if (!current(id, generation)) return;
    active.value = { accountId: id, session: saved.session };
    emit("start", saved.game.puzzle, saved);
  } catch (error) {
    if (current(id, generation)) message.value = String(error);
  } finally {
    busy.value = false;
  }
}
function saveCurrent(
  puzzle: Puzzle,
  state: PlayerState,
  playId: string,
  timer: SavedPlayTimer,
): boolean {
  if (
    !active.value ||
    puzzle.generatorVersion !== "super-v1" ||
    parseSuperSeed(active.value.session.seedCode) !== puzzle.seed
  )
    return false;
  const ok = saveSuperGame(
    active.value.accountId,
    active.value.session,
    puzzle,
    state,
    playId,
    timer,
    localStorage,
  );
  if (!ok)
    message.value =
      "超級の進行を保存できません。再読み込みすると進行が戻る可能性があります。";
  return ok;
}
async function claimReady(
  puzzle: Puzzle,
  state: PlayerState,
  playId: string,
  timer: SavedPlayTimer,
): Promise<boolean> {
  const meta = active.value;
  if (!meta || meta.accountId !== account.value || busy.value) return false;
  if (!saveCurrent(puzzle, state, playId, timer)) return false;
  busy.value = true;
  try {
    // Same start body is retried even if the first response was lost. Restoring
    // the claimed flag alone is not proof; the server verifies every resume.
    await request("/api/super/start", {
      playId,
      puzzleId: meta.session.puzzleId,
      cycle: meta.session.cycle,
      entry: meta.session.entry,
    });
    if (active.value !== meta || meta.accountId !== account.value) return false;
    active.value = { ...meta, session: { ...meta.session, claimed: true } };
    saveCurrent(puzzle, state, playId, timer);
    void refresh();
    return true;
  } catch (error) {
    message.value = String(error);
    return false;
  } finally {
    busy.value = false;
  }
}
function completeCurrent(
  state: PlayerState,
  playId: string,
  seconds: number,
): void {
  const meta = active.value;
  if (!meta?.session.claimed) return;
  availableSave.value = false;
  if (
    !outbox.capture(
      meta.accountId,
      {
        kind: "complete",
        body: {
          playId,
          puzzleId: meta.session.puzzleId,
          pieces: [...state.pieces],
          elapsedSeconds: seconds,
          mistakes: state.mistakes,
          hintsUsed: state.hintsUsed,
          maxHintStage: maximumHintStage(state),
        },
      },
      meta.session.seedCode,
    )
  )
    message.value =
      "超級の結果を保存できません。画面を閉じず、保存できる状態で再試行してください。";
  else {
    excluded.add(meta.session.puzzleId);
    persistExcluded(meta.accountId);
    void retry();
  }
}
function persistExcluded(id: string): void {
  try {
    localStorage.setItem(
      `tako-sen.super-offered.v1:${encodeURIComponent(id)}`,
      JSON.stringify([...excluded].slice(-100)),
    );
  } catch {
    /* optional recent cache */
  }
}
async function openRanking(): Promise<void> {
  if (!account.value || !isSuper.value) {
    emit("account");
    return;
  }
  rankingOpen.value = true;
  emit("opened");
}
function closeRanking(): void {
  rankingOpen.value = false;
  emit("closed");
}
async function fetchRanking(id: string): Promise<Response> {
  return request(`/api/super/ranking?puzzleId=${encodeURIComponent(id)}`);
}
const history = ref<
  {
    playId: string;
    seedCode: string;
    elapsedSeconds: number;
    mistakes: number;
    hintsUsed: number;
  }[]
>([]);
async function refreshHistory(): Promise<void> {
  const id = account.value;
  const generation = epoch;
  if (!id) return;
  try {
    const data = await readBody(await request("/api/super/history"));
    if (current(id, generation))
      history.value = Array.isArray(data.plays) ? data.plays : [];
  } catch {
    if (current(id, generation)) message.value = "超級の履歴を取得できません。";
  }
}
watch(
  () => [props.playId, props.puzzle],
  () => {
    preparation += 1;
    rememberTrial();
  },
);
watch(
  () => props.modalBlocked,
  (blocked) => {
    if (!blocked && sharedCode.value && account.value && !offerOpen.value)
      showOffer();
  },
);
watch(
  () => props.historyOpen,
  (open) => {
    if (open) void refreshHistory();
  },
);
watch(revision, () => {
  if (props.historyOpen) void refreshHistory();
});
watch(
  account,
  () => {
    epoch += 1;
    preparation += 1;
    progress.value = undefined;
    progressOwner.value = undefined;
    history.value = [];
    availableSave.value = false;
    excluded.clear();
    closeOffer();
    if (rankingOpen.value) closeRanking();
    if (isSuper.value) emit("pause");
    const id = account.value;
    if (!id) return;
    try {
      const cached = parseSuperProgress(
        JSON.parse(localStorage.getItem(cacheKey(id)) ?? "null"),
      );
      if (cached) applyProgress(cached, id);
      const recent = JSON.parse(
        localStorage.getItem(
          `tako-sen.super-offered.v1:${encodeURIComponent(id)}`,
        ) ?? "[]",
      );
      if (Array.isArray(recent))
        for (const value of recent)
          if (typeof value === "string") excluded.add(value);
      const saved = loadSuperGame(id, localStorage);
      availableSave.value =
        !!saved && !isComplete(saved.game.puzzle, saved.game.state);
      if (
        saved?.session.claimed &&
        isComplete(saved.game.puzzle, saved.game.state)
      ) {
        const previous = active.value;
        active.value = { accountId: id, session: saved.session };
        completeCurrent(
          saved.game.state,
          saved.game.playId!,
          Math.floor((saved.game.timer.elapsedMs ?? 0) / 1000),
        );
        active.value = previous;
      }
    } catch {
      /* unavailable cache must not block normal play */
    }
    void retry().then(() => {
      if (sharedCode.value && account.value === id && !props.modalBlocked)
        showOffer();
    });
    if (props.historyOpen) void refreshHistory();
  },
  { immediate: true },
);
function onOffline(): void {
  if (isSuper.value) {
    emit("pause");
    message.value = "超級はオンライン復帰後に再開できます。";
  }
}
function onOnline(): void {
  void retry();
}
function onVisible(): void {
  if (document.visibilityState === "visible") void retry();
}
onMounted(() => {
  window.addEventListener("offline", onOffline);
  window.addEventListener("online", onOnline);
  window.addEventListener("focus", onOnline);
  document.addEventListener("visibilitychange", onVisible);
  retryTimer = setInterval(onOnline, 30000);
});
onUnmounted(() => {
  disposed = true;
  epoch += 1;
  if (retryTimer) clearInterval(retryTimer);
  window.removeEventListener("offline", onOffline);
  window.removeEventListener("online", onOnline);
  window.removeEventListener("focus", onOnline);
  document.removeEventListener("visibilitychange", onVisible);
});
defineExpose({
  right,
  openEarned: () => {
    sharedCode.value = undefined;
    showOffer();
  },
  captureNormalTrial,
  offerIfPending,
  openShared,
  resumeSaved,
  claimReady,
  saveCurrent,
  completeCurrent,
  openRanking,
  canPlay,
});
</script>

<template>
  <section v-if="playScreen" class="super-entry" :inert="modalBlocked">
    <SignInButton v-if="!isSignedIn"
      ><button
        type="button"
        class="icon-button super-challenge-button"
        aria-label="超級 · ログインして挑戦"
        title="超級 · ログインして挑戦"
      >
        <UiIcon name="super" /></button
    ></SignInButton>
    <button
      v-else-if="!gameName"
      type="button"
      class="icon-button super-challenge-button"
      aria-label="超級 · 名前と公開ルールを設定"
      title="超級 · 名前と公開ルールを設定"
      @click="emit('account')"
    >
      <UiIcon name="super" />
    </button>
    <template v-else>
      <span v-if="!right && label" class="super-progress" aria-live="polite">{{
        label
      }}</span>
      <button
        ref="entryButton"
        class="icon-button super-challenge-button"
        :aria-label="
          availableSave && !isSuper ? 'この端末の超級を再開' : '超級に挑戦'
        "
        :title="
          availableSave && !isSuper
            ? 'この端末の超級を再開'
            : right
              ? '超級に挑戦'
              : `${label}回で超級に挑戦`
        "
        type="button"
        :disabled="busy || (!right && !(availableSave && !isSuper))"
        @click="
          if (availableSave && !isSuper) {
            resumeSaved();
          } else {
            sharedCode = undefined;
            showOffer();
          }
        "
      >
        <UiIcon name="super" />
      </button>
      <p v-if="syncing" role="status">超級の記録を同期しています。</p>
    </template>
    <p v-if="message" role="status">{{ message }}</p>
  </section>
  <section
    v-if="historyOpen && account"
    class="stats-panel"
    :inert="modalBlocked"
  >
    <h3>超級の履歴</h3>
    <p v-if="!history.length">超級の完了記録はありません。</p>
    <p v-else>
      取得した {{ history.length }} 件 · 平均
      {{
        Math.round(
          history.reduce((sum, p) => sum + p.elapsedSeconds, 0) /
            history.length,
        )
      }}秒
    </p>
    <ul class="stats-list">
      <li v-for="play in history" :key="play.playId">
        <code>{{ play.seedCode }}</code> · {{ rankingScore(play) }}点 ·
        {{ play.elapsedSeconds }}秒
        <button
          type="button"
          :disabled="busy"
          @click="openShared(play.seedCode)"
        >
          この超級を開く
        </button>
      </li>
    </ul>
  </section>
  <div
    v-if="offerOpen"
    class="dialog-backdrop"
    role="presentation"
    @click.self="closeOffer"
  >
    <section
      ref="dialog"
      class="dialog-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="super-offer-title"
      tabindex="-1"
      @keydown="onKeydown"
    >
      <h2 id="super-offer-title">
        {{
          sharedCode ? "共有された超級に挑戦しますか？" : "超級に挑戦しますか？"
        }}
      </h2>
      <p v-if="sharedCode">
        共有された10×10の超級です。挑戦権や通常プレイの回数は変わりません。
      </p>
      <p v-else>
        10×10・タコ10匹の超級です。OKで開始するまで挑戦権は使いません。あとで挑戦することもできます。
      </p>
      <p v-if="!complete">
        現在の盤面から超級へ切り替えます。通常の進行は端末に保存します。
      </p>
      <p v-if="message" role="status">{{ message }}</p>
      <div class="dialog-actions">
        <button type="button" :disabled="busy" @click="prepare(sharedCode)">
          挑戦する</button
        ><button type="button" @click="closeOffer">あとで</button>
      </div>
    </section>
  </div>
  <PublicLeaderboard
    v-if="isSuper"
    :puzzle="puzzle"
    :open="rankingOpen"
    :revision="revision"
    :complete="complete"
    :game-name="gameName"
    title="超級のランキング"
    :fetch-entries="fetchRanking"
    @close="closeRanking"
  />
</template>
