<script setup lang="ts">
import { useId } from "./auth";
import UiIcon from "./UiIcon.vue";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { Puzzle, PlayerState } from "../core/model";
import { createInitialPlayerState } from "../core/model";
import type { SavedPlayTimer } from "../core/play-timer";
import { isComplete } from "../core/rules";
import { maximumHintStage } from "../core/hint-progress";
import {
  encodeSuperSeed,
  SUPER_GENERATOR_VERSION,
  SuperSeedError,
  isSuperPuzzleOf,
  isSuperVersion,
  parseSuperSeed,
  parseSuperSeedCode,
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
import { generateSuperInBackground } from "./puzzle-generation";
import {
  ALLOW_SITE_DATA,
  NAME_AND_ONLINE_REQUIRED,
  PLAY_CONTINUES,
  accountChanged,
} from "./notice-text";
import {
  fetchSuperResponse,
  SuperConnectionError,
  SuperNotice,
  superNoticeText,
  superRetryDelay,
  superStartFailureText,
} from "./super-connection";

const SHARED_SEED_INVALID =
  "超級のシードを復元できません。共有された文字列を省略せずに貼り付けてください。";
// The recovery steps the player-facing failures end with.
const RETRY_LATER = "少し待ってからもう一度お試しください。";
const PRESS_CHALLENGE = "もう一度「挑戦する」を押してください。";
const CANNOT_SAVE_START = `この端末に保存できないため超級を開始できません。${ALLOW_SITE_DATA}`;
const ACCOUNT_CHANGED = accountChanged("超級の案内");
const SUPER_RANKING_NOTE = {
  lead: "この超級の盤面に挑戦した参加者の初回成績です。自己申告の参考記録で、見るにはプレイヤー名の設定が必要です。",
  join: "挑戦権か共有された超級で挑戦すると自動参加します。同じ盤面への再挑戦では記録を更新しません。退会で公開記録を削除できます。",
};

const props = defineProps<{
  puzzle: Puzzle;
  playId?: string;
  complete: boolean;
  gameName: string;
  modalBlocked: boolean;
  /** Also disables the entry while READY covers it, without delaying offers. */
  entryBlocked?: boolean;
}>();
const emit = defineEmits<{
  start: [puzzle: Puzzle, saved: SavedSuperGame];
  pause: [];
  account: [];
  opened: [];
  closed: [];
  synced: [];
}>();
const { id: userId } = useId();
const account = computed(() => (props.gameName ? userId.value : null));
const isSuper = computed(() => isSuperVersion(props.puzzle.generatorVersion));
const progress = ref<SuperProgress>();
const progressOwner = ref<string>();
const active = ref<{ accountId: string; session: SuperSession }>();
const availableSave = ref(false);
const busy = ref(false);
const syncing = ref(false);
const connected = ref(navigator.onLine !== false);
const offerOpen = ref(false);
const rankingOpen = ref(false);
const message = ref("");
const syncMessage = ref("");
let failures = 0;
let nextRetryAt = 0;
// 進捗を最後に取得できた時刻。0 はこのアカウントで未取得。
let refreshedAt = 0;
let refreshing: Promise<boolean> | undefined;
const revision = ref(0);
const dialog = ref<HTMLElement>();
const entryButton = ref<HTMLElement>();
let focusBefore: HTMLElement | null = null;
let epoch = 0;
let preparation = 0;
let preparationAbort: AbortController | undefined;
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
/** "Later" only means something when there is a challenge to put off. */
const canPostpone = computed(
  () => !!account.value && (!!sharedCode.value || right.value),
);
/** The entry button resumes a super board saved here rather than offering one. */
const resumable = computed(() => availableSave.value && !isSuper.value);
/** The entry button's name, which also says whether a right is waiting. */
const entryLabel = computed(() =>
  resumable.value
    ? "この端末の超級を再開"
    : right.value
      ? "超級に挑戦（挑戦権があります）"
      : progress.value
        ? `超級に挑戦（${label.value}回クリアすると挑戦できます）`
        : "超級に挑戦",
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
    throw new SuperNotice(NAME_AND_ONLINE_REQUIRED);
  try {
    const response = await fetchSuperResponse(path, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!current(id, generation))
      throw new SuperNotice("アカウントか接続状態が変わりました。");
    return response;
  } catch (error) {
    if (current(id, generation) && error instanceof SuperConnectionError) {
      if (error.kind === "auth" || error.kind === "profile") emit("pause");
      if (error.kind === "profile") emit("account");
    }
    throw error;
  }
}
async function readBody(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new SuperNotice(`サーバーの応答を確認できません。${RETRY_LATER}`);
  return value as Record<string, unknown>;
}
function applyProgress(value: unknown, id: string): void {
  const parsed = parseSuperProgress(value);
  if (id !== account.value) return;
  if (!parsed)
    throw new SuperNotice(`超級の進行を確認できません。${RETRY_LATER}`);
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
    message.value = `この端末に保存できないため、このクリアは超級のクリア数に入りません。${ALLOW_SITE_DATA}${PLAY_CONTINUES}`;
  }
}
function syncFailed(error: unknown): void {
  failures += 1;
  nextRetryAt = Date.now() + superRetryDelay(failures);
  const failure =
    error instanceof SuperConnectionError
      ? error
      : new SuperConnectionError("invalid");
  // Sending again cannot fix these; only the player can, and the retry button
  // stays for when they have.
  const lasting =
    failure.kind === "auth" ||
    failure.kind === "profile" ||
    failure.kind === "conflict";
  if (lasting) nextRetryAt = Infinity;
  // A brief connection hiccup should recover silently. Report it only when
  // the next attempt also fails; keep the queued records in either case.
  else if (failures === 1) return;
  syncMessage.value = `${failure.message} 送れていない記録はこの端末に残っています。${PLAY_CONTINUES}`;
}
async function refresh(): Promise<boolean> {
  if (refreshing) return refreshing;
  const pending = fetchProgress();
  refreshing = pending;
  try {
    return await pending;
  } finally {
    if (refreshing === pending) refreshing = undefined;
  }
}
async function fetchProgress(): Promise<boolean> {
  const id = account.value;
  const generation = epoch;
  if (!id || navigator.onLine === false) return false;
  try {
    const data = await readBody(await request("/api/super/progress"));
    if (current(id, generation)) {
      applyProgress(data.progress, id);
      failures = 0;
      nextRetryAt = 0;
      refreshedAt = Date.now();
      syncMessage.value = "";
      return true;
    }
  } catch (error) {
    if (current(id, generation)) syncFailed(error);
  }
  return false;
}
// 未送信の記録は毎回送る（無ければ通信しない）。進捗の再取得は、今回送信した、
// 前回失敗した、未取得、最後の取得から staleAfter 以上たった、のどれかの時だけ行う。
async function retry(force = false, staleAfter = 0): Promise<void> {
  const id = account.value;
  const generation = epoch;
  if (
    !id ||
    syncing.value ||
    navigator.onLine === false ||
    (!force && Date.now() < nextRetryAt)
  )
    return;
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
    const due =
      sent > 0 ||
      failures > 0 ||
      refreshedAt === 0 ||
      Date.now() - refreshedAt >= staleAfter;
    if (due && current(id, generation)) await refresh();
  } catch (error) {
    if (current(id, generation)) syncFailed(error);
  } finally {
    syncing.value = false;
    if (!disposed && generation !== epoch && account.value) void retry();
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
        "この案内を見たことをこの端末に保存できません。次回も同じ案内が出る場合があります。";
  }
}
function closeOffer(): void {
  if (!offerOpen.value) return;
  offerOpen.value = false;
  sharedCode.value = undefined;
  cancelPreparation();
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
/**
 * Ends the preparation under way: its result is no longer wanted, and the
 * board it may be building stops taking the generation worker's time.
 */
function cancelPreparation(): void {
  preparation += 1;
  preparationAbort?.abort();
  preparationAbort = undefined;
}
/** super-v2 has seeds that reach no hard board, so a few are tried. */
async function generateFreshSuper(signal: AbortSignal): Promise<{
  seedCode: string;
  puzzle: Puzzle;
}> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const seed = crypto.randomUUID();
    try {
      return {
        seedCode: encodeSuperSeed(seed),
        puzzle: await generateSuperInBackground(
          seed,
          SUPER_GENERATOR_VERSION,
          signal,
        ),
      };
    } catch (error) {
      if (!(error instanceof SuperSeedError)) throw error;
    }
  }
  throw new SuperNotice(`超級の盤面を作れませんでした。${PRESS_CHALLENGE}`);
}
/** The board a code names, or undefined when it names none. */
async function rebuildSuper(
  seedCode: string,
  signal: AbortSignal,
): Promise<{ seedCode: string; puzzle: Puzzle; identity: string } | undefined> {
  const code = parseSuperSeedCode(seedCode);
  if (!code) return undefined;
  try {
    const puzzle = await generateSuperInBackground(
      code.seed,
      code.version,
      signal,
    );
    return { seedCode, puzzle, identity: await puzzleId(puzzle) };
  } catch {
    return undefined;
  }
}
async function prepare(seedCode?: string): Promise<void> {
  if (busy.value) return;
  if (!account.value) {
    emit("account");
    return;
  }
  const id = account.value;
  const generation = epoch;
  cancelPreparation();
  const ticket = preparation;
  const abort = new AbortController();
  preparationAbort = abort;
  const preparing = () => current(id, generation) && preparation === ticket;
  busy.value = true;
  message.value = "";
  try {
    await refresh();
    if (!preparing()) return;
    if (!progress.value) throw new SuperNotice("接続を確認してください。");
    const entry = seedCode ? "shared" : "earned";
    if (entry === "earned" && !hasSuperRight(progress.value))
      throw new SuperNotice("通常問題を10回クリアすると超級に挑戦できます。");
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
      seedCode = candidate?.seedCode;
    }
    let board = seedCode
      ? await rebuildSuper(seedCode, abort.signal)
      : undefined;
    if (!preparing()) return;
    if (seedCode && !board && !candidate)
      throw new SuperNotice(SHARED_SEED_INVALID);
    // A candidate that cannot be rebuilt as recorded gives way to a new board.
    if (!board || (candidate && board.identity !== candidate.puzzleId)) {
      const fresh = await generateFreshSuper(abort.signal);
      board = { ...fresh, identity: await puzzleId(fresh.puzzle) };
      if (!preparing()) return;
    }
    const { puzzle: generated, identity } = board;
    seedCode = board.seedCode;
    const data = await readBody(
      await request("/api/super/prepare", { seedCode }),
    );
    const verified = await restoreSharedPuzzleSnapshot(data.puzzle);
    if (!preparing()) return;
    if (
      (await puzzleId(verified)) !== identity ||
      !isSuperPuzzleOf(verified, seedCode)
    )
      throw new SuperNotice(`超級の盤面を確認できません。${PRESS_CHALLENGE}`);
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
      throw new SuperNotice(CANNOT_SAVE_START);
    const saved = loadSuperGame(id, localStorage);
    if (!saved)
      throw new SuperNotice(`保存した超級を確認できません。${PRESS_CHALLENGE}`);
    active.value = { accountId: id, session };
    availableSave.value = true;
    excluded.add(identity);
    persistExcluded(id);
    closeOffer();
    sharedCode.value = undefined;
    emit("start", generated, saved);
  } catch (error) {
    if (preparing())
      message.value = superNoticeText(
        error,
        `超級の盤面を準備できません。${PRESS_CHALLENGE}`,
      );
  } finally {
    busy.value = false;
    if (preparationAbort === abort) preparationAbort = undefined;
  }
}
function openShared(code: string): void {
  if (parseSuperSeed(code) === undefined) {
    message.value = SHARED_SEED_INVALID;
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
      throw new SuperNotice(
        "この端末の超級を復元できません。超級を始めた端末で再開してください。",
      );
    if (!current(id, generation)) return;
    active.value = { accountId: id, session: saved.session };
    emit("start", saved.game.puzzle, saved);
  } catch (error) {
    if (current(id, generation))
      message.value = superNoticeText(
        error,
        `超級を再開できません。${RETRY_LATER}`,
      );
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
  if (!active.value || !isSuperPuzzleOf(puzzle, active.value.session.seedCode))
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
    message.value = `超級の進行をこの端末に保存できません。ページを読み込み直すと、進行が戻る場合があります。${ALLOW_SITE_DATA}`;
  return ok;
}
/** Claims the start on READY's OK: true, or what the player should do. */
async function claimReady(
  puzzle: Puzzle,
  state: PlayerState,
  playId: string,
  timer: SavedPlayTimer,
): Promise<true | string> {
  const meta = active.value;
  if (!meta || meta.accountId !== account.value) return ACCOUNT_CHANGED;
  if (busy.value)
    return "超級の状態を確認しています。少し待ってから、もう一度 OK を押してください。";
  if (!saveCurrent(puzzle, state, playId, timer)) return CANNOT_SAVE_START;
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
    if (active.value !== meta || meta.accountId !== account.value)
      return ACCOUNT_CHANGED;
    active.value = { ...meta, session: { ...meta.session, claimed: true } };
    saveCurrent(puzzle, state, playId, timer);
    void refresh();
    return true;
  } catch (error) {
    // A failure from the account that started the request is not news for
    // whoever is signed in now.
    return meta.accountId === account.value
      ? superStartFailureText(error)
      : ACCOUNT_CHANGED;
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
    message.value = `超級の結果をこの端末に保存できません。画面を閉じずに、${ALLOW_SITE_DATA}`;
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
watch(
  () => [props.playId, props.puzzle],
  () => {
    cancelPreparation();
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
  account,
  () => {
    epoch += 1;
    failures = 0;
    nextRetryAt = 0;
    refreshedAt = 0;
    syncMessage.value = "";
    refreshing = undefined;
    cancelPreparation();
    progress.value = undefined;
    progressOwner.value = undefined;
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
  },
  { immediate: true },
);
function onOffline(): void {
  connected.value = false;
  if (account.value)
    syncMessage.value = `通信が切れています。送れていない記録はこの端末に残り、接続が戻ると自動で送り直します。${PLAY_CONTINUES}`;
  if (isSuper.value) {
    emit("pause");
    message.value = "超級はオンライン復帰後に再開できます。";
  }
}
function sync(staleAfter: number): void {
  const reconnected = !connected.value && navigator.onLine !== false;
  connected.value = navigator.onLine !== false;
  void retry(reconnected, reconnected ? 0 : staleAfter);
}
function onOnline(): void {
  sync(0);
}
const refreshInterval = 30000;
// 定期実行は未送信分の再送だけを行い、送るものが無ければ通信しない。
function onTimer(): void {
  sync(Infinity);
}
// 画面へ戻った時は他の端末での変化を取り込む。短い間隔の往復では取得しない。
function onReturn(): void {
  sync(refreshInterval);
}
function onVisible(): void {
  if (document.visibilityState === "visible") onReturn();
}
onMounted(() => {
  window.addEventListener("offline", onOffline);
  window.addEventListener("online", onOnline);
  window.addEventListener("focus", onReturn);
  document.addEventListener("visibilitychange", onVisible);
  retryTimer = setInterval(onTimer, refreshInterval);
});
onUnmounted(() => {
  disposed = true;
  epoch += 1;
  if (retryTimer) clearInterval(retryTimer);
  window.removeEventListener("offline", onOffline);
  window.removeEventListener("online", onOnline);
  window.removeEventListener("focus", onReturn);
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
  refreshProgress: retry,
});
</script>

<template>
  <section class="super-entry" :inert="modalBlocked || entryBlocked">
    <button
      v-if="!gameName"
      type="button"
      class="icon-button super-challenge-button"
      aria-label="超級 · プレイヤー名を設定して参加"
      title="超級 · プレイヤー名を設定して参加"
      @click="showOffer"
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
        :class="{ 'has-right': right && !resumable }"
        :aria-label="entryLabel"
        :title="entryLabel"
        :aria-busy="busy || undefined"
        type="button"
        :disabled="busy"
        @click="
          if (resumable) {
            resumeSaved();
          } else {
            sharedCode = undefined;
            showOffer();
          }
        "
      >
        <UiIcon name="super" />
      </button>
    </template>
    <p
      role="status"
      v-text="
        message ||
        (busy && !offerOpen
          ? '超級を準備しています…'
          : syncing && account
            ? '超級の記録を送信しています…'
            : '')
      "
    ></p>
    <!-- Mounted while empty (v-if leaves only a comment), so the change is
         announced. -->
    <p role="status">
      <template v-if="syncMessage"
        >{{ syncMessage
        }}<button
          type="button"
          class="icon-button retry-button"
          aria-label="今すぐ送り直す"
          title="今すぐ送り直す"
          :disabled="syncing || !connected"
          @click="retry(true)"
        >
          <UiIcon name="reset" /></button
      ></template>
    </p>
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
      <div class="dialog-header">
        <h2 id="super-offer-title">
          {{
            sharedCode
              ? "共有された超級に挑戦しますか？"
              : right
                ? "超級に挑戦しますか？"
                : "超級について"
          }}
        </h2>
        <button
          type="button"
          class="dialog-close"
          aria-label="超級の説明を閉じる"
          @click="closeOffer"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <p v-if="sharedCode">
        共有された10×10の超級です。挑戦権や通常問題のクリア数は変わりません。
      </p>
      <p v-else-if="right">
        10×10・タコ10匹の超級です。「挑戦する」を押しても、READY
        画面で「OK」を押すまでは挑戦権を使いません。今は挑戦せず、あとで挑戦することもできます。
      </p>
      <template v-if="!sharedCode && !right">
        <p>初級・中級・上級より難しい、10×10・タコ10匹のパズルです。</p>
        <p>
          プレイヤー名を設定して公開ルールに同意してから、通常問題を合計10回クリアすると、挑戦権を1回分もらえます。
        </p>
        <p>
          デイリー・超級・練習は加算しません。挑戦権は1回分だけ保留でき、保留中のクリアは次の分へ繰り越しません。
        </p>
        <p v-if="!gameName">
          プレイヤー名の設定と公開ルールへの同意が必要です。
        </p>
        <p v-else-if="progress">
          現在 {{ progress.count }} / 10回クリア。あと{{
            remainingSuperPlays(progress)
          }}回です。
        </p>
        <p v-else-if="connected">クリア数を確認しています…</p>
        <p v-else>クリア数は、接続が戻ると確認できます。</p>
      </template>
      <p v-if="!connected">超級の開始・再開にはオンライン接続が必要です。</p>
      <p v-if="!complete && (sharedCode || right)">
        現在の盤面から超級へ切り替えます。通常の進行は端末に保存します。
      </p>
      <p role="status" v-text="message"></p>
      <p role="status">
        <template v-if="syncMessage"
          >{{ syncMessage
          }}<button
            type="button"
            class="icon-button retry-button"
            aria-label="今すぐ送り直す"
            title="今すぐ送り直す"
            :disabled="syncing || !connected"
            @click="retry(true)"
          >
            <UiIcon name="reset" /></button
        ></template>
      </p>
      <div class="dialog-actions">
        <button
          v-if="!gameName"
          type="button"
          @click="
            closeOffer();
            emit('account');
          "
        >
          プレイヤー名を設定する
        </button>
        <button
          v-else-if="sharedCode || right"
          type="button"
          :disabled="!connected"
          :aria-disabled="busy || undefined"
          :aria-busy="busy || undefined"
          @click="prepare(sharedCode)"
        >
          {{ busy ? "準備しています…" : "挑戦する" }}</button
        ><button type="button" class="secondary-button" @click="closeOffer">
          {{ canPostpone ? "あとで" : "閉じる" }}
        </button>
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
    :note="SUPER_RANKING_NOTE"
    :fetch-entries="fetchRanking"
    @close="closeRanking"
  />
</template>
