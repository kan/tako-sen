<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  toRaw,
  watch,
} from "vue";
import {
  Show,
  SignInButton,
  SignUpButton,
  onlineAuthEnabled,
  useAuth,
} from "./ui/auth";
import AccountHistory from "./ui/AccountHistory.vue";
import PublicLeaderboard from "./ui/PublicLeaderboard.vue";
import DailyChallenge from "./ui/DailyChallenge.vue";
import SuperChallenge from "./ui/SuperChallenge.vue";
import HistoryDialog from "./ui/HistoryDialog.vue";
import WeeklyLeaderboard from "./ui/WeeklyLeaderboard.vue";
import ConfirmDialog from "./ui/ConfirmDialog.vue";
import CellMark from "./ui/CellMark.vue";
import { scrollBehavior } from "./ui/scroll";
import { askConfirm, type ConfirmRequest } from "./ui/confirm-dialog";
import { isDailyVersion } from "./core/daily-puzzle";
import { isSuperVersion, parseSuperSeed } from "./core/super-puzzle";
import type { SavedSuperGame } from "./core/super-storage";
import SharePuzzle from "./ui/SharePuzzle.vue";
import GameName from "./ui/GameName.vue";
import UiIcon from "./ui/UiIcon.vue";
import { rankingPreview } from "./ui/ranking-preview";
import type { LeaderboardEntry, SyncedRanking } from "./core/leaderboard";
import { rememberTutorial, shouldShowTutorial } from "./core/tutorial";
import { trapDialogFocus } from "./ui/dialog";
import { cellLabel } from "./ui/cell-label";
import {
  createInitialPlayerState,
  getCellViewState,
  type PlayerState,
  type Puzzle,
  type PuzzleDifficulty,
} from "./core/model";
import {
  GENERATOR_VERSION,
  generatePuzzleWithAnalysis,
  type GeneratedPuzzle,
} from "./core/generator";
import {
  canGenerateInBackground,
  generateFreshInBackground,
  generateInBackground,
} from "./ui/puzzle-generation";
import {
  analyzePuzzleDifficulty,
  type DifficultyRating,
  type PuzzleDifficultyAnalysis,
} from "./core/difficulty";
import { encodePuzzleSeed, parsePuzzleSeedCode } from "./core/puzzle-code";
import { puzzleId } from "./core/puzzle-identity";
import {
  chooseNextPuzzle,
  resolveDifficultySelection,
  type DifficultySelection,
  type RankedPuzzleCandidate,
} from "./core/next-puzzle";
import { restoreSharedPuzzleSnapshot } from "./core/shared-puzzle";
import {
  createWaitingTimer,
  elapsedTimerMs,
  finishTimer,
  pauseTimer,
  restoreTimer,
  resumeTimer,
  type PlayTimer,
} from "./core/play-timer";
import {
  addExcludedMarks,
  removeExcludedMarks,
  countHintUsed,
  placePieceWithAutoExclusions,
  resetPlayerProgress,
  recordHintStage,
  toggleExcluded,
} from "./core/player";
import {
  HAPTICS_ENABLED_KEY as hapticsStorageKey,
  SOUND_ENABLED_KEY as soundStorageKey,
  loadAutoExclusionsEnabled,
  saveAutoExclusionsEnabled,
  loadDifficultySelection,
  saveDifficultySelection,
} from "./core/settings";
import { hintStageLabel, maximumHintStage } from "./core/hint-progress";
import { rankingScore } from "./core/ranking-score";
import { isComplete } from "./core/rules";
import { shortcutExclusionsForCell } from "./core/shortcuts";
import {
  findContradictionExclusions,
  findLogicalMoves,
  type LogicalMove,
} from "./core/logical";
import {
  loadGame,
  saveDailyGame,
  loadResultHistory,
  saveGame,
  saveResultHistory,
} from "./core/storage";
import {
  finishPlay,
  hasPlayerMarks,
  playerMarksChanged,
  startPlay,
  type ResultHistory,
} from "./core/results";
import {
  canShowHint,
  hintExcludeCells,
  hintFocusCells,
  hintStageCount,
  hintStageLines,
} from "./ui/hint";
import {
  LONG_PRESS_MS,
  DOUBLE_TAP_MS,
  pointerReleaseAction,
  cellIndexAtPoint,
} from "./ui/pointer";
import {
  createSoundEffects,
  soundEffectForFeedback,
  type SoundEffectKind,
} from "./ui/sound-effects";
import {
  cellFeedbacksForStateChange,
  strongestHapticFeedback,
  vibrateForFeedback,
  vibrationApiAvailable,
  requestVibration,
  type CellFeedback,
  type FeedbackSource,
} from "./ui/feedback";
import { assignRegionColorIndexes, cellBaseStyle } from "./ui/region-visuals";

const InteractiveTutorial = defineAsyncComponent(
  () => import("./ui/InteractiveTutorial.vue"),
);

const dragStartThresholdPx = 12;
const onlineAuth = onlineAuthEnabled ? useAuth() : undefined;
const nextPuzzleLoading = ref(false);
const nextPuzzleMessage = ref("");
// Shown only over the board it was written for, so replacing the board in any
// way hides it; the first mark on that board clears it.
const sharedLinkNotice = shallowRef<{ text: string; puzzle: Puzzle }>();
const sharedLinkMessage = computed(() =>
  sharedLinkNotice.value?.puzzle === toRaw(puzzle.value)
    ? sharedLinkNotice.value.text
    : "",
);
const offeredPuzzleIds = new Set<string>();
let nextPuzzleRequest = 0;
const onlineGameName = ref("");
const rankingRevision = ref(0);
const accountDialogOpen = ref(false);
const accountSetupRequired = ref(false);
const tutorialOpen = ref(false);
const tutorialFirstVisit = ref(false);
const menuOpen = ref(false);
const historyDialogOpen = ref(false);
const weeklyRankingOpen = ref(false);
const toolsDialog = ref<"settings" | "share">();
const toolsDialogRef = ref<HTMLElement>();
const historyAccountId = computed(() =>
  onlineAuth?.isSignedIn.value
    ? (onlineAuth.userId.value ?? undefined)
    : undefined,
);
let resumeAfterMenu = false;
const menuDialogRef = ref<HTMLElement>();
const menuButton = ref<HTMLButtonElement>();
const accountMenuButton = ref<HTMLButtonElement>();
const initialGenerated = generatePuzzleWithAnalysis({
  seed: "tako-sen-prototype",
});
const puzzle = ref<Puzzle>(initialGenerated.puzzle);
const difficultyAnalysis = ref<PuzzleDifficultyAnalysis>(
  initialGenerated.analysis,
);
const state = ref<PlayerState>(
  createInitialPlayerState(undefined, puzzle.value.givens),
);
const selectedDifficulty = ref<DifficultySelection>(
  puzzle.value.difficulty ?? "easy",
);
const currentTime = ref(Date.now());
const timer = ref<PlayTimer>(createWaitingTimer());
const waitingToStart = computed(() => timer.value.status === "ready");
const readyButton = ref<HTMLButtonElement>();
const boardWrap = ref<HTMLElement>();
const boardElement = ref<HTMLElement>();
const restoreSeedCode = ref("");
const seedMessage = ref("");
const showClearDialog = ref(false);
let clearBackdropPressed = false;
let clearDialogPointerStarted = false;
const clearElapsedSeconds = ref<number | undefined>();
const clearDialogMessage = ref("");
const playId = ref<string>();
const activeDailyDate = ref<string>();
const activeDailyAccountId = ref<string>();
const dailyClaimed = ref(false);
const dailyClaiming = ref(false);
const dailyReadyMessage = ref("");
const dailyChallengeRef = ref<InstanceType<typeof DailyChallenge>>();
const dailyRankingOpen = ref(false);
const dailyPanelOpen = ref(false);
const returnToClearAfterRanking = ref(false);
const publicRankingOpen = ref(false);
const returnToClearAfterPublicRanking = ref(false);
const isDaily = computed(() => isDailyVersion(puzzle.value.generatorVersion));
const isSuper = computed(() => isSuperVersion(puzzle.value.generatorVersion));
const isSpecial = computed(() => isDaily.value || isSuper.value);
const superChallengeRef = ref<InstanceType<typeof SuperChallenge>>();
const superDialogOpen = ref(false);
const resultHistory = ref<ResultHistory>();
const hapticsEnabled = ref(true);
const hapticsApiAvailable = ref(false);
const hapticsTestMessage = ref("");
const soundEnabled = ref(false);
const autoExclusionsEnabled = ref(false);
const autoExclusionsSaveFailed = ref(false);
const soundApiAvailable = ref(false);
const soundEffects = createSoundEffects(
  () =>
    typeof window.AudioContext === "function"
      ? new window.AudioContext()
      : undefined,
  () => document.visibilityState !== "hidden",
);
const soundPreviews: readonly { kind: SoundEffectKind; label: string }[] = [
  { kind: "excluded-add", label: "×の音を試す" },
  { kind: "piece-place", label: "タコの音を試す" },
  { kind: "clear", label: "CLEARの音を試す" },
];
type HintPanel =
  | { readonly kind: "move"; readonly move: LogicalMove }
  | {
      readonly kind: "unavailable";
      readonly title: string;
      readonly explanation: readonly string[];
    };

const hint = ref<HintPanel | undefined>();
const hintDialogOpen = ref(false);
const hintStage = ref(1);
const hintDialogRef = ref<HTMLElement>();
const clearDialogRef = ref<HTMLElement>();
let focusBeforeDialog: HTMLElement | null = null;
const pressedCell = ref<number | undefined>();
const holdingCell = ref<number | undefined>();
const cellFeedbacks = ref<Record<number, CellFeedback & { token: number }>>({});
let longPressTimer: number | undefined;
let feedbackToken = 0;
let lastPointerTap: { cell: number; at: number } | undefined;
let activePointer:
  | {
      readonly pointerId: number;
      readonly startCell: number;
      readonly startX: number;
      readonly startY: number;
      readonly startedAt: number;
      dragging: boolean;
      longPressReady: boolean;
      longPressCanceled: boolean;
      readonly pieceDisabled: boolean;
      readonly dragMarkAction: "add" | "remove";
    }
  | undefined;
let clockTimer: number | undefined;

const cells = computed(() =>
  Array.from(
    { length: puzzle.value.size * puzzle.value.size },
    (_, index) => index,
  ),
);
const complete = computed(() => isComplete(puzzle.value, state.value));
const activeDialog = computed<
  | "tutorial"
  | "hint"
  | "clear"
  | "account"
  | "menu"
  | "ranking"
  | "super"
  | "history"
  | "weekly"
  | "settings"
  | "share"
  | undefined
>(() => {
  if (accountSetupRequired.value) return "account";
  if (tutorialOpen.value) return "tutorial";
  if (superDialogOpen.value) return "super";
  if (complete.value && showClearDialog.value) return "clear";
  if (hint.value && hintDialogOpen.value && canShowHint(complete.value))
    return "hint";
  if (accountDialogOpen.value) return "account";
  if (publicRankingOpen.value) return "ranking";
  if (historyDialogOpen.value) return "history";
  if (weeklyRankingOpen.value) return "weekly";
  if (toolsDialog.value) return toolsDialog.value;
  if (menuOpen.value) return "menu";
  return undefined;
});
const puzzleSeedCode = computed(() => encodePuzzleSeed(puzzle.value));
// Daily and super boards are stored as "hard" (puzzle IDs and the shared
// snapshot check depend on it), but they are their own modes, not 上級.
// 「デイリー」 alone: with 「/ 10×10」 the status bar overflows at 320px.
const actualDifficultyLabel = computed(() =>
  isSuper.value
    ? "超級 / 10×10"
    : isDaily.value
      ? "デイリー"
      : difficultyLabel(difficultyAnalysis.value.rating),
);
const regionColorIndexes = computed(() =>
  assignRegionColorIndexes(puzzle.value),
);
const elapsedSeconds = computed(() =>
  Math.floor(elapsedTimerMs(timer.value, currentTime.value) / 1000),
);
const displayedElapsedSeconds = computed(
  () => clearElapsedSeconds.value ?? elapsedSeconds.value,
);
const clearRankingEntries = ref<(LeaderboardEntry & { isSelf: boolean })[]>([]);
const clearRankingMessage = ref("");
let clearRankingGeneration = 0;
// 通常問題のクリア直後は、記録の送信の応答で届くランキングを使う。送信前に取得
// しても自分の記録がまだ載っていないので、送信中はその完了を待つ。待つのは
// ダイアログを開いた時の1回だけで、上限を過ぎたら送信を待たずに取得する。
const CLEAR_RANKING_WAIT_MS = 3000;
let normalPlaySending = false;
let syncedRanking: SyncedRanking | undefined;
let clearRankingWaitTimer: number | undefined;
let clearRankingWaiting = false;
let clearRankingWaited = false;
const clearRankingRetry = ref(0);
function stopWaitingForUpload(): void {
  if (!clearRankingWaiting) return;
  clearRankingWaited = true;
  clearRankingRetry.value += 1;
}
function onNormalPlaySending(active: boolean): void {
  normalPlaySending = active;
  if (!active) stopWaitingForUpload();
}
watch(
  () => [
    activeDialog.value,
    puzzle.value,
    rankingRevision.value,
    clearRankingRetry.value,
    onlineGameName.value,
    onlineAuth?.userId.value,
    onlineAuth?.isSignedIn.value,
  ],
  async () => {
    const generation = ++clearRankingGeneration;
    // 届いたランキングと待ちの状態は、この1回の実行だけで使い切る。
    const synced = syncedRanking;
    const waited = clearRankingWaited;
    syncedRanking = undefined;
    clearRankingWaited = false;
    clearRankingWaiting = false;
    window.clearTimeout(clearRankingWaitTimer);
    clearRankingEntries.value = [];
    clearRankingMessage.value = "ランキングを取得しています…";
    if (activeDialog.value !== "clear") return;
    const special = isSpecial.value;
    try {
      const id = await puzzleId(puzzle.value);
      if (generation !== clearRankingGeneration) return;
      if (!special && synced?.puzzleId === id) {
        showClearRanking(synced.entries, false);
        return;
      }
      if (!special && normalPlaySending && !waited) {
        clearRankingWaiting = true;
        clearRankingWaitTimer = window.setTimeout(
          stopWaitingForUpload,
          CLEAR_RANKING_WAIT_MS,
        );
        return;
      }
      const token = special ? await onlineAuth?.getToken() : undefined;
      if (special && !token) {
        if (generation === clearRankingGeneration)
          clearRankingMessage.value =
            "ランキングの表示にはログインが必要です。";
        return;
      }
      const path = isDaily.value
        ? `/api/daily/ranking?date=${encodeURIComponent(activeDailyDate.value ?? "")}`
        : isSuper.value
          ? `/api/super/ranking?puzzleId=${encodeURIComponent(id)}`
          : `/api/leaderboards/${encodeURIComponent(id)}`;
      if (generation !== clearRankingGeneration) return;
      const response = await fetch(path, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error("Leaderboard unavailable.");
      const data = (await response.json()) as {
        entries?: (LeaderboardEntry & { isSelf?: boolean })[];
      };
      if (generation !== clearRankingGeneration || !Array.isArray(data.entries))
        return;
      showClearRanking(data.entries, special);
    } catch {
      if (generation === clearRankingGeneration)
        clearRankingMessage.value =
          "ランキングを取得できません。タップして開き直してください。";
    }
  },
);
function showClearRanking(
  entries: readonly (LeaderboardEntry & { isSelf?: boolean })[],
  special: boolean,
): void {
  clearRankingEntries.value = rankingPreview(
    entries.map((entry) => ({
      ...entry,
      isSelf: special
        ? !!entry.isSelf
        : !!onlineAuth?.isSignedIn.value &&
          !!onlineGameName.value &&
          entry.displayName === onlineGameName.value,
    })),
    (entry) => entry.isSelf,
  );
  // Right after a normal clear is when joining is most tempting, so say how;
  // daily and super boards have no "next puzzle" to join from.
  const canJoin =
    !special &&
    !!onlineAuth &&
    !(onlineAuth.isSignedIn.value && onlineGameName.value);
  clearRankingMessage.value = clearRankingEntries.value.length
    ? ""
    : canJoin
      ? "ログインしてプレイヤー名を設定すると、次の問題からランキングに載ります。"
      : "あなたの公開ランキング記録はありません。";
}
const contradictionCells = computed(() =>
  hint.value?.kind === "move" &&
  hint.value.move.technique === "contradiction" &&
  hintStage.value === 4
    ? findContradictionExclusions(puzzle.value, state.value)
    : [],
);

onMounted(() => {
  clockTimer = window.setInterval(() => {
    currentTime.value = Date.now();
    if (timer.value.status === "running") saveCurrentGame();
  }, 1000);
  window.addEventListener("pagehide", suspendGame);
  window.addEventListener("blur", suspendGame);
  window.addEventListener("resize", measureHintRoom);
  window.addEventListener("scroll", measureHintRoom, { passive: true });
  document.addEventListener("visibilitychange", onVisibilityChange);
  hapticsEnabled.value = loadHapticsEnabled();
  autoExclusionsEnabled.value = loadAutoExclusionsEnabled(localStorage);
  hapticsApiAvailable.value = vibrationApiAvailable(navigator);
  soundApiAvailable.value = typeof window.AudioContext === "function";
  try {
    soundEnabled.value = localStorage.getItem(soundStorageKey) === "1";
  } catch {
    /* 初期オフのままプレイを続ける。 */
  }
  soundEffects.setEnabled(soundEnabled.value);
  const saved = loadGame();
  selectedDifficulty.value = loadDifficultySelection(
    localStorage,
    saved?.puzzle.difficulty ?? puzzle.value.difficulty ?? "easy",
  );
  saveDifficultySelection(localStorage, selectedDifficulty.value);
  resultHistory.value = loadResultHistory();
  if (saved) {
    puzzle.value = saved.puzzle;
    state.value = saved.state;
    difficultyAnalysis.value = analyzePuzzleDifficulty(saved.puzzle);
    playId.value = saved.playId;
    timer.value = restoreTimer(
      saved.timer,
      saved.state.startedAt,
      Date.now(),
      isComplete(saved.puzzle, saved.state),
    );
  }
  if (!playId.value) {
    beginPlay();
  } else if (
    !resultHistory.value.plays.some((play) => play.id === playId.value) &&
    hasPlayerMarks(puzzle.value, state.value)
  ) {
    registerPlay(false);
  }
  const completedResult = resultHistory.value.plays.find(
    (play) => play.id === playId.value && play.status === "completed",
  );
  if (completedResult)
    clearElapsedSeconds.value = completedResult.elapsedSeconds;
  else if (complete.value) finalizePlay();
  tutorialFirstVisit.value = shouldShowTutorial(localStorage);
  tutorialOpen.value = tutorialFirstVisit.value;
  if (tutorialOpen.value) pauseGame();
  if (waitingToStart.value) focusReadyButton();
  saveCurrentGame();
  void openSharedPuzzleFromUrl(saved);
});

onUnmounted(() => {
  nextPuzzleRequest += 1;
  window.clearTimeout(prepareNextPuzzleTimer);
  window.clearTimeout(clearRankingWaitTimer);
  soundEffects.dispose();
  if (clockTimer !== undefined) window.clearInterval(clockTimer);
  window.removeEventListener("pagehide", suspendGame);
  window.removeEventListener("blur", suspendGame);
  window.removeEventListener("resize", measureHintRoom);
  window.removeEventListener("scroll", measureHintRoom);
  document.removeEventListener("visibilitychange", onVisibilityChange);
});

watch([puzzle, state, timer], saveCurrentGame, { deep: true });

// The hint sheet stays below the board so the cells it points at stay in view;
// on a screen too short for that it keeps a usable minimum and overlaps.
const HINT_MIN_HEIGHT_PX = 180;
const hintRoom = ref<number>();
async function measureHintRoom(): Promise<void> {
  if (activeDialog.value !== "hint") return;
  await nextTick();
  const board = boardElement.value;
  const backdrop = hintDialogRef.value?.parentElement;
  if (!board || !backdrop) return;
  const padding = parseFloat(getComputedStyle(backdrop).paddingBottom) || 0;
  const room =
    window.innerHeight - board.getBoundingClientRect().bottom - padding;
  hintRoom.value = Math.max(HINT_MIN_HEIGHT_PX, Math.floor(room));
}
watch(activeDialog, () => measureHintRoom());
// Watches the transition to a marked board, so a failure shown over a board
// that already had marks stays until the next board.
watch(
  () => hasPlayerMarks(puzzle.value, state.value),
  (marked) => {
    if (marked) sharedLinkNotice.value = undefined;
  },
);
watch(activeDialog, async (dialog, previous) => {
  if (dialog && !previous) {
    focusBeforeDialog =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  }
  await nextTick();
  if (dialog) {
    if (dialog === "menu") {
      // After logging out the account button is gone; the menu keeps focus.
      if (previous === "account" && accountMenuButton.value?.isConnected)
        accountMenuButton.value.focus();
      else menuDialogRef.value?.focus();
    } else if (dialog === "settings" || dialog === "share")
      toolsDialogRef.value?.focus();
    else if (
      dialog !== "account" &&
      dialog !== "tutorial" &&
      dialog !== "super" &&
      dialog !== "ranking" &&
      dialog !== "weekly" &&
      dialog !== "history"
    )
      (dialog === "hint" ? hintDialogRef.value : clearDialogRef.value)?.focus();
  } else if (previous) {
    if (waitingToStart.value) focusReadyButton();
    else if (focusBeforeDialog?.isConnected) focusBeforeDialog.focus();
    else menuButton.value?.focus();
    focusBeforeDialog = null;
  }
});
watch(hapticsEnabled, (enabled) => {
  localStorage.setItem(hapticsStorageKey, enabled ? "1" : "0");
  hapticsTestMessage.value = "";
});

watch(soundEnabled, (enabled) => {
  soundEffects.setEnabled(enabled);
  try {
    localStorage.setItem(soundStorageKey, enabled ? "1" : "0");
  } catch {
    /* 保存不可でも設定は現在のプレイに反映する。 */
  }
});

watch(autoExclusionsEnabled, (enabled) => {
  autoExclusionsSaveFailed.value = !saveAutoExclusionsEnabled(
    localStorage,
    enabled,
  );
});

watch(selectedDifficulty, (selection) => {
  saveDifficultySelection(localStorage, selection);
});

function onSoundPreferenceChange(): void {
  soundEffects.setEnabled(soundEnabled.value);
  if (soundEnabled.value) void soundEffects.unlock();
}

function testHaptics(): void {
  // click内で同期的に要求し、短い通常パターンとの感じ方の差も切り分ける。
  const result = requestVibration(navigator, 100, hapticsEnabled.value);
  hapticsTestMessage.value = {
    disabled: "振動設定がオフです。",
    unavailable: "このブラウザでは振動APIが利用できません。",
    accepted:
      "振動要求が受け付けられました。実際に振動したか確認してください。",
    rejected: "ブラウザが振動要求を受け付けませんでした。",
    failed: "振動要求でエラーが発生しました。プレイは続けられます。",
  }[result];
}

function saveCurrentGame(): void {
  if (!playId.value) return;
  const savedTimer = {
    waitingToStart: waitingToStart.value,
    elapsedMs: elapsedTimerMs(timer.value, Date.now()),
    hasStarted: timer.value.hasStarted,
  };
  if (isSuper.value) {
    superChallengeRef.value?.saveCurrent(
      puzzle.value,
      state.value,
      playId.value,
      savedTimer,
    );
    return;
  }
  if (isDaily.value && activeDailyDate.value && activeDailyAccountId.value)
    saveDailyGame(
      activeDailyAccountId.value,
      activeDailyDate.value,
      puzzle.value,
      state.value,
      playId.value,
      savedTimer,
    );
  else if (!isDaily.value)
    saveGame(puzzle.value, state.value, localStorage, playId.value, savedTimer);
}

watch(complete, (isCompleteNow, wasComplete) => {
  if (isCompleteNow && !wasComplete) {
    finalizePlay();
    clearDialogMessage.value = "";
    clearBackdropPressed = false;
    clearDialogPointerStarted = false;
    showClearDialog.value = true;
    vibrateForFeedback(navigator, "clear", hapticsEnabled.value);
  }
});

function beginPlay(): void {
  if (!resultHistory.value) return;
  cancelLongPress();
  resumeAfterMenu = false;
  playId.value = crypto.randomUUID();
  timer.value = createWaitingTimer();
  saveCurrentGame();
  focusReadyButton();
}

function focusReadyButton(): void {
  void nextTick(() => {
    if (!activeDialog.value) readyButton.value?.focus();
  });
}

async function navigateTo(
  next: "play" | "history" | "weekly" | "settings" | "share",
): Promise<void> {
  if (next === "settings" || next === "share") {
    cancelLongPress();
    pauseGame();
    resumeAfterMenu = false;
    menuOpen.value = false;
    toolsDialog.value = next;
    return;
  }
  if (next === "history" || next === "weekly") {
    const wasRunning = menuOpen.value
      ? resumeAfterMenu
      : timer.value.status === "running";
    cancelLongPress();
    pauseGame();
    resumeAfterMenu = next === "weekly" && wasRunning;
    menuOpen.value = false;
    if (next === "history") historyDialogOpen.value = true;
    else weeklyRankingOpen.value = true;
    return;
  }
  if (next === "play" && menuOpen.value) {
    closeMenu();
    return;
  }
  cancelLongPress();
  pauseGame();
  resumeAfterMenu = false;
  toolsDialog.value = undefined;
  menuOpen.value = false;
  await nextTick();
  if (waitingToStart.value) focusReadyButton();
  else menuButton.value?.focus();
  window.scrollTo({ top: 0 });
}

function openMenu(): void {
  cancelLongPress();
  resumeAfterMenu = timer.value.status === "running";
  menuOpen.value = true;
  pauseGame();
}

function onToolsKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    toolsDialog.value = undefined;
  } else trapDialogFocus(event, toolsDialogRef.value);
}

const historyPaths = {
  normal: "/api/plays",
  super: "/api/super/history",
  daily: "/api/daily/history",
} as const;
async function loadHistoryOnline(
  mode: keyof typeof historyPaths,
): Promise<unknown> {
  const account = historyAccountId.value;
  if (!account || navigator.onLine === false)
    throw new Error("Offline history.");
  const token = await onlineAuth?.getToken();
  if (!token || account !== historyAccountId.value)
    throw new Error("History account changed.");
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(historyPaths[mode], {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!response.ok || account !== historyAccountId.value)
      throw new Error("History unavailable.");
    return await response.json();
  } finally {
    window.clearTimeout(timeout);
  }
}
// The history stays open if the player cancels the confirm, so they can pick
// another record.
async function restoreHistorySeed(seedCode: string): Promise<void> {
  if (await restoreSeed(seedCode)) historyDialogOpen.value = false;
}

function closeMenu(): void {
  menuOpen.value = false;
  if (resumeAfterMenu) confirmReady();
  resumeAfterMenu = false;
}

function onNormalPlaysSynced(ranking?: SyncedRanking): void {
  syncedRanking = ranking;
  rankingRevision.value += 1;
  // A normal completion, not its first board action, now credits the right.
  void superChallengeRef.value?.refreshProgress();
}

function suspendGame(): void {
  soundEffects.stop();
  // メニュー中のフォーカス喪失でも自動再開を取り消す。
  resumeAfterMenu = false;
  cancelLongPress();
  pauseGame();
  saveCurrentGame();
}

function onVisibilityChange(): void {
  if (document.visibilityState === "hidden") suspendGame();
}

function onMenuKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    closeMenu();
    return;
  }
  trapDialogFocus(event, menuDialogRef.value);
}

function openTutorial(): void {
  resumeAfterMenu = false;
  tutorialOpen.value = true;
  pauseGame();
}

function closeTutorial(): void {
  rememberTutorial(localStorage);
  tutorialFirstVisit.value = false;
  tutorialOpen.value = false;
}

async function confirmReady(): Promise<void> {
  if (!waitingToStart.value) return;
  if (isSuper.value) {
    const expected = playId.value;
    if (!expected || dailyClaiming.value) return;
    dailyClaiming.value = true;
    const claimed = await superChallengeRef.value?.claimReady(
      puzzle.value,
      state.value,
      expected,
      {
        waitingToStart: true,
        elapsedMs: elapsedTimerMs(timer.value, Date.now()),
        hasStarted: timer.value.hasStarted,
      },
    );
    dailyClaiming.value = false;
    if (!isSuper.value || expected !== playId.value) return;
    if (claimed !== true) {
      dailyReadyMessage.value =
        claimed ??
        "超級を開始できません。通常プレイに戻り、超級の案内を開き直してください。";
      return;
    }
    dailyReadyMessage.value = "";
  }
  if (isDaily.value && !dailyClaimed.value) {
    if (dailyClaiming.value || !activeDailyDate.value || !playId.value) return;
    const expectedDate = activeDailyDate.value;
    const expectedPlayId = playId.value;
    dailyClaiming.value = true;
    const claimed = await dailyChallengeRef.value?.claimStart(
      expectedDate,
      expectedPlayId,
    );
    dailyClaiming.value = false;
    if (
      !isDaily.value ||
      activeDailyDate.value !== expectedDate ||
      playId.value !== expectedPlayId
    )
      return;
    if (claimed !== true) {
      dailyReadyMessage.value =
        claimed ??
        "開始できません。通常プレイに戻り、デイリーを開き直してください。";
      return;
    }
    dailyClaimed.value = true;
    dailyReadyMessage.value = "";
  }
  void soundEffects.unlock();
  const startedAt = Date.now();
  if (!timer.value.hasStarted) state.value = { ...state.value, startedAt };
  timer.value = resumeTimer(timer.value, startedAt);
  currentTime.value = startedAt;
  saveCurrentGame();
}

function pauseGame(): void {
  soundEffects.stop();
  if (complete.value || timer.value.status !== "running") return;
  const now = Date.now();
  timer.value = pauseTimer(timer.value, now);
  currentTime.value = now;
  saveCurrentGame();
  focusReadyButton();
}

function registerPlay(countForSuper = true): void {
  if (!resultHistory.value || !playId.value || isSpecial.value) return;
  if (resultHistory.value.plays.some((play) => play.id === playId.value))
    return;
  resultHistory.value = startPlay(resultHistory.value, {
    id: playId.value,
    seedCode: puzzleSeedCode.value,
    generatorVersion: puzzle.value.generatorVersion ?? "g1",
    difficulty: puzzle.value.difficulty ?? "easy",
    startedAt: state.value.startedAt,
  });
  saveResultHistory(resultHistory.value);
  if (countForSuper)
    superChallengeRef.value?.captureNormalTrial(
      playId.value,
      puzzleSeedCode.value,
    );
}

function commitPlayerState(next: PlayerState): void {
  if (complete.value) return;
  if (isSuper.value && !superChallengeRef.value?.canPlay()) {
    pauseGame();
    return;
  }
  if (playerMarksChanged(state.value, next)) {
    registerPlay();
    touchedPlayId.value = playId.value;
  }
  state.value = next;
}

function commitPlayerStateWithFeedback(
  next: PlayerState,
  source: FeedbackSource,
): void {
  if (complete.value) return;
  if (isSuper.value && !superChallengeRef.value?.canPlay()) {
    pauseGame();
    return;
  }
  const feedbacks = cellFeedbacksForStateChange(state.value, next, source);
  const wasComplete = complete.value;
  commitPlayerState(next);
  triggerCellFeedbacks(feedbacks);
  const haptic = strongestHapticFeedback(feedbacks);
  if (haptic) vibrateForFeedback(navigator, haptic, hapticsEnabled.value);
  const sound = soundEffectForFeedback(
    feedbacks,
    !wasComplete && complete.value,
  );
  if (sound) soundEffects.play(sound);
}

function finalizePlay(): void {
  if (!playId.value) return;
  const completedAt = Date.now();
  const clearSeconds = Math.floor(
    elapsedTimerMs(timer.value, completedAt) / 1000,
  );
  timer.value = finishTimer(timer.value, completedAt);
  currentTime.value = completedAt;
  if (isSpecial.value) {
    clearElapsedSeconds.value = clearSeconds;
    saveCurrentGame();
    if (isSuper.value)
      superChallengeRef.value?.completeCurrent(
        state.value,
        playId.value,
        clearSeconds,
      );
    return;
  }
  if (!resultHistory.value) return;
  const updated = finishPlay(
    resultHistory.value,
    playId.value,
    completedAt,
    state.value.mistakes,
    state.value.hintsUsed,
    clearSeconds,
    maximumHintStage(state.value),
  );
  if (updated === resultHistory.value) return;
  resultHistory.value = updated;
  saveResultHistory(updated);
  clearElapsedSeconds.value = updated.plays.find(
    (play) => play.id === playId.value,
  )?.elapsedSeconds;
  saveCurrentGame();
}

async function newGame(): Promise<void> {
  if (nextPuzzleLoading.value) return;
  if (!isSpecial.value && superChallengeRef.value?.offerIfPending()) {
    showClearDialog.value = false;
    return;
  }
  if (
    !isSpecial.value &&
    !(await confirmDiscardProgress({
      title: "次の問題へ進みますか？",
      message: "この盤面の途中のタコと×は消えます。",
      confirmLabel: "次の問題へ",
    }))
  )
    return;
  const request = ++nextPuzzleRequest;
  nextPuzzleLoading.value = true;
  nextPuzzleMessage.value = "";
  const difficulty = resolveDifficultySelection(
    selectedDifficulty.value,
    Math.random,
  );
  let next: NextPuzzle | undefined;
  try {
    next =
      (await preparedNextPuzzle?.next) ?? (await loadNextPuzzle(difficulty));
  } catch {
    // 別のシードでも作れなかった。下で知らせる。
  }
  if (request !== nextPuzzleRequest) return;
  if (!next) {
    // 今の盤面を残し、もう一度押せるようにする。ボタンはプレイ画面とクリア
    // ダイアログの両方にあるので、どちらにも表示する。
    nextPuzzleLoading.value = false;
    nextPuzzleMessage.value =
      "次の問題を作れませんでした。もう一度お試しください。";
    if (showClearDialog.value)
      clearDialogMessage.value = nextPuzzleMessage.value;
    return;
  }
  const { generated, recommendedId } = next;
  if (recommendedId) offeredPuzzleIds.add(recommendedId);
  nextPuzzleLoading.value = false;
  putAwayBoard();
  clearSharedPuzzleUrl();
  puzzle.value = generated.puzzle;
  difficultyAnalysis.value = generated.analysis;
  state.value = createInitialPlayerState(undefined, puzzle.value.givens);
  hint.value = undefined;
  hintStage.value = 1;
  hintDialogOpen.value = false;
  showClearDialog.value = false;
  clearElapsedSeconds.value = undefined;
  clearDialogMessage.value = "";
  restoreSeedCode.value = "";
  seedMessage.value = recommendedId
    ? "他のプレイヤーの記録がある問題を選びました。"
    : "次の問題を生成しました。";
  beginPlay();
  void navigateTo("play");
  centerBoardAfterPuzzleChange();
}

interface NextPuzzle {
  readonly generated: GeneratedPuzzle;
  readonly recommendedId?: string;
}

/** Picks a ranked board the account has not played, or generates a new one. */
async function loadNextPuzzle(
  difficulty: PuzzleDifficulty,
  preparing?: AbortSignal,
): Promise<NextPuzzle> {
  // その場の取得では、API が使えなくても通常のクライアント生成で遊べる。先読みでは
  // 候補の取得に失敗した結果を残さず、「次の問題へ」を押した時に取り直す。
  const ranked = await pickRankedPuzzle(difficulty, preparing).catch(
    (error: unknown) => {
      if (preparing) throw error;
      return undefined;
    },
  );
  throwIfAborted(preparing);
  return (
    ranked ?? {
      generated: await generateFreshInBackground(difficulty, preparing),
    }
  );
}

// AbortSignal.throwIfAborted のないブラウザでも動かす。
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason;
}

/** 候補がなければ undefined。候補を取得できなかった時は例外を投げる。 */
async function pickRankedPuzzle(
  difficulty: PuzzleDifficulty,
  signal?: AbortSignal,
): Promise<NextPuzzle | undefined> {
  const accountId = onlineAuth?.userId.value;
  if (!accountId) return undefined;
  const token = await onlineAuth?.getToken();
  if (!token || accountId !== onlineAuth?.userId.value)
    throw new Error("Session unavailable.");
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timeout = window.setTimeout(abort, 3000);
  signal?.addEventListener("abort", abort);
  let response: Response;
  try {
    throwIfAborted(signal);
    response = await fetch(
      `/api/next-puzzle?difficulty=${encodeURIComponent(difficulty)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      },
    );
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
  if (!response.ok) throw new Error("Candidates unavailable.");
  const data: { candidates?: unknown } = await response.json();
  if (!Array.isArray(data.candidates))
    throw new Error("Candidates unavailable.");
  const candidates = data.candidates.filter(
    (value): value is RankedPuzzleCandidate =>
      value !== null &&
      typeof value === "object" &&
      typeof value.puzzleId === "string" &&
      /^p1:[0-9a-f]{64}$/.test(value.puzzleId) &&
      typeof value.seedCode === "string" &&
      value.seedCode.length <= 512 &&
      Number.isSafeInteger(value.players),
  );
  const excluded = new Set(offeredPuzzleIds);
  excluded.add(await puzzleId(puzzle.value));
  for (const candidate of candidates) {
    if (
      resultHistory.value?.plays.some(
        (play) =>
          play.status === "completed" && play.seedCode === candidate.seedCode,
      )
    )
      excluded.add(candidate.puzzleId);
  }
  const chosen = chooseNextPuzzle(candidates, excluded, Math.random);
  const code = chosen && parsePuzzleSeedCode(chosen.seedCode);
  if (!chosen || !code || code.difficulty !== difficulty) return undefined;
  const generated = await generateInBackground(
    { version: code.version, seed: code.seed, difficulty: code.difficulty },
    signal,
  );
  return (await puzzleId(generated.puzzle)) === chosen.puzzleId
    ? { generated, recommendedId: chosen.puzzleId }
    : undefined;
}

// プレイ中に次の問題を用意しておき、「次の問題へ」で待たせない。用意した結果は
// この鍵が変わるまで有効とする。この起動中に盤面へ手を入れた通常プレイだけを
// 対象にし、保存済みの盤面を開いただけでは用意しない。
const touchedPlayId = ref<string>();
const nextPuzzleKey = computed(() => {
  const id = playId.value;
  if (!id || isSpecial.value || touchedPlayId.value !== id) return undefined;
  return JSON.stringify([
    id,
    selectedDifficulty.value,
    onlineAuth?.userId.value ?? null,
  ]);
});
const nextPuzzlePreparationDelay = 2000;
let preparedNextPuzzle:
  | {
      readonly next: Promise<NextPuzzle | undefined>;
      readonly controller: AbortController;
    }
  | undefined;
let prepareNextPuzzleTimer: number | undefined;

function scheduleNextPuzzlePreparation(): void {
  window.clearTimeout(prepareNextPuzzleTimer);
  preparedNextPuzzle?.controller.abort();
  preparedNextPuzzle = undefined;
  // メインスレッドで生成するとプレイ中の入力が止まるため、Worker がある時だけ用意する。
  if (!nextPuzzleKey.value || !canGenerateInBackground()) return;
  const selection = selectedDifficulty.value;
  prepareNextPuzzleTimer = window.setTimeout(() => {
    const controller = new AbortController();
    preparedNextPuzzle = {
      controller,
      next: loadNextPuzzle(
        resolveDifficultySelection(selection, Math.random),
        controller.signal,
      ).catch(() => undefined),
    };
  }, nextPuzzlePreparationDelay);
}

// 鍵が変わった時点で古い結果を捨てる。次の描画まで待つと、その間に押された
// 「次の問題へ」が古い結果を受け取る。
watch(nextPuzzleKey, scheduleNextPuzzlePreparation, { flush: "sync" });

function cancelPendingNextPuzzle(): void {
  nextPuzzleRequest += 1;
  nextPuzzleLoading.value = false;
}

function startDaily(
  dailyPuzzle: Puzzle,
  date: string,
  accountId: string,
  dailyPlayId: string,
  saved?: ReturnType<typeof loadGame>,
): void {
  cancelPendingNextPuzzle();
  if (!isDaily.value) pauseGame();
  else saveCurrentGame();
  clearSharedPuzzleUrl();
  activeDailyDate.value = date;
  activeDailyAccountId.value = accountId;
  dailyClaimed.value = Boolean(saved);
  dailyReadyMessage.value = "";
  puzzle.value = dailyPuzzle;
  difficultyAnalysis.value = analyzePuzzleDifficulty(dailyPuzzle);
  state.value =
    saved?.state ?? createInitialPlayerState(undefined, dailyPuzzle.givens);
  playId.value = dailyPlayId;
  timer.value = saved
    ? restoreTimer(
        saved.timer,
        saved.state.startedAt,
        Date.now(),
        isComplete(dailyPuzzle, saved.state),
      )
    : createWaitingTimer();
  hint.value = undefined;
  hintDialogOpen.value = false;
  showClearDialog.value = false;
  clearElapsedSeconds.value =
    saved && isComplete(dailyPuzzle, saved.state)
      ? Math.floor(elapsedTimerMs(timer.value, Date.now()) / 1000)
      : undefined;
  void navigateTo("play");
  saveCurrentGame();
  focusReadyButton();
  centerBoardAfterPuzzleChange();
}

function startSuper(superPuzzle: Puzzle, saved: SavedSuperGame): void {
  cancelPendingNextPuzzle();
  putAwayBoard();
  clearSharedPuzzleUrl();
  puzzle.value = superPuzzle;
  difficultyAnalysis.value = analyzePuzzleDifficulty(superPuzzle);
  state.value = saved.game.state;
  playId.value = saved.game.playId;
  timer.value = restoreTimer(
    saved.game.timer,
    saved.game.state.startedAt,
    Date.now(),
    isComplete(superPuzzle, saved.game.state),
  );
  hint.value = undefined;
  hintDialogOpen.value = false;
  showClearDialog.value = false;
  clearElapsedSeconds.value = complete.value
    ? Math.floor(elapsedTimerMs(timer.value, Date.now()) / 1000)
    : undefined;
  void navigateTo("play");
  saveCurrentGame();
  centerBoardAfterPuzzleChange();
  focusReadyButton();
}

function onSuperOpened(): void {
  resumeAfterMenu = timer.value.status === "running";
  superDialogOpen.value = true;
  pauseGame();
}
function onSuperClosed(): void {
  superDialogOpen.value = false;
  if (resumeAfterMenu) void confirmReady();
  resumeAfterMenu = false;
}

/**
 * Pauses and saves the current board, then drops the daily state, before
 * another board replaces it. Every path that leaves a board for a normal or
 * super board goes through here (startDaily sets the daily state itself): a
 * daily or super board keeps its progress in its own slot, and saving it
 * unpaused would lose the time since the last save.
 */
function putAwayBoard(): void {
  pauseGame();
  saveCurrentGame();
  activeDailyDate.value = undefined;
  activeDailyAccountId.value = undefined;
  dailyClaimed.value = false;
  dailyReadyMessage.value = "";
}

function leaveDaily(): void {
  cancelPendingNextPuzzle();
  putAwayBoard();
  const saved = loadGame();
  if (!saved) {
    newGame();
    return;
  }
  puzzle.value = saved.puzzle;
  state.value = saved.state;
  difficultyAnalysis.value = analyzePuzzleDifficulty(saved.puzzle);
  playId.value = saved.playId;
  timer.value = restoreTimer(
    saved.timer,
    saved.state.startedAt,
    Date.now(),
    isComplete(saved.puzzle, saved.state),
  );
  clearElapsedSeconds.value = undefined;
  hint.value = undefined;
  showClearDialog.value = false;
  saveCurrentGame();
  focusReadyButton();
}

function centerBoardAfterPuzzleChange(): void {
  const behavior = scrollBehavior();
  void nextTick(() =>
    boardWrap.value?.scrollIntoView({ block: "center", behavior }),
  );
}

async function copySeed(): Promise<void> {
  try {
    await navigator.clipboard.writeText(puzzleSeedCode.value);
    seedMessage.value = "シードをコピーしました。";
  } catch {
    seedMessage.value =
      "コピーできませんでした。シード・共有のシード表示から手動でコピーしてください。";
  }
}

function restoreFromSeed(): void {
  void restoreSeed(restoreSeedCode.value);
}

async function copySuperLink(): Promise<void> {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete("p");
    url.searchParams.set("s", puzzleSeedCode.value);
    await navigator.clipboard.writeText(url.href);
    seedMessage.value =
      "超級の共有リンクをコピーしました。受け取った人もログインとオンライン接続が必要です。";
  } catch {
    seedMessage.value =
      "共有リンクをコピーできませんでした。シードをコピーして共有できます。";
  }
}

async function restoreSeed(code: string): Promise<boolean> {
  if (parseSuperSeed(code) !== undefined) {
    if (!onlineAuthEnabled) {
      seedMessage.value = "超級はログインとオンライン接続が必要です。";
      return false;
    }
    superChallengeRef.value?.openShared(code.trim());
    return true;
  }
  const parsed = parsePuzzleSeedCode(code);
  if (!parsed) {
    seedMessage.value =
      "シードを復元できません。表示された形式のシードを入力してください。";
    return false;
  }

  let generated: GeneratedPuzzle;
  try {
    generated = generatePuzzleWithAnalysis({
      version: parsed.version,
      seed: parsed.seed,
      difficulty: parsed.difficulty,
    });
  } catch {
    // 生成器は決まった試行回数で打ち切るので、盤面にならないシードがあり得る。
    seedMessage.value =
      "このシードからは問題を作れません。別のシードを入力するか、次の問題へ進んでください。";
    return false;
  }
  // A daily or super board keeps its progress in its own slot, so do not ask,
  // as newGame does not. The saved normal board is still overwritten.
  if (
    !isSpecial.value &&
    !(await confirmDiscardProgress({
      title: "この問題を開きますか？",
      message: "この盤面の途中のタコと×は消えます。",
      confirmLabel: "開く",
    }))
  ) {
    // Clear an earlier result so it does not read as this attempt's.
    seedMessage.value = "";
    return false;
  }
  cancelPendingNextPuzzle();
  putAwayBoard();
  clearSharedPuzzleUrl();
  puzzle.value = generated.puzzle;
  difficultyAnalysis.value = generated.analysis;
  state.value = createInitialPlayerState(undefined, puzzle.value.givens);
  hint.value = undefined;
  hintStage.value = 1;
  hintDialogOpen.value = false;
  showClearDialog.value = false;
  clearElapsedSeconds.value = undefined;
  clearDialogMessage.value = "";
  seedMessage.value = "シードから問題を復元しました。";
  beginPlay();
  void navigateTo("play");
  centerBoardAfterPuzzleChange();
  return true;
}

async function openSharedPuzzleFromUrl(
  saved: ReturnType<typeof loadGame>,
): Promise<void> {
  const superCode = new URL(window.location.href).searchParams.get("s");
  if (superCode) {
    if (!(await restoreSeed(superCode)))
      showSharedLinkMessage(seedMessage.value);
    return;
  }
  const id = new URL(window.location.href).searchParams.get("p");
  if (!id) return;
  if (!/^p1:[0-9a-f]{64}$/.test(id)) {
    showSharedLinkMessage(
      "共有リンクが正しくありません。リンクを送ってくれた人に、もう一度送ってもらってください。",
    );
    return;
  }
  try {
    if (saved) {
      try {
        if ((await puzzleId(saved.puzzle)) === id) return;
      } catch {
        // A legacy local puzzle must not prevent a valid shared link opening.
      }
    }
    const response = await fetch(`/api/puzzles/${encodeURIComponent(id)}`);
    if (!response.ok)
      throw new Error(`取得に失敗しました (${response.status})。`);
    const data: { puzzle: unknown } = await response.json();
    const shared = await restoreSharedPuzzleSnapshot(data.puzzle);
    // Judge by the live board: the player may have marked it while the
    // shared puzzle was loading. A daily or super board is not asked about,
    // as in restoreSeed.
    if (
      !isSpecial.value &&
      !(await confirmDiscardProgress({
        title: "共有された問題を開きますか？",
        message: "この端末で進行中の盤面を置き換えます。",
        confirmLabel: "開く",
      }))
    )
      return;
    cancelPendingNextPuzzle();
    putAwayBoard();
    puzzle.value = shared;
    difficultyAnalysis.value = analyzePuzzleDifficulty(shared);
    state.value = createInitialPlayerState(undefined, shared.givens);
    hint.value = undefined;
    hintStage.value = 1;
    hintDialogOpen.value = false;
    showClearDialog.value = false;
    clearElapsedSeconds.value = undefined;
    clearDialogMessage.value = "";
    showSharedLinkMessage("共有された問題を開きました。");
    beginPlay();
    centerBoardAfterPuzzleChange();
  } catch {
    showSharedLinkMessage(
      "共有された問題を開けませんでした。通信状態を確認して、リンクをもう一度開いてください。",
    );
  }
}

/** A shared link opens before any dialog, so its outcome also goes under the
 * board, where the seed dialog's own message would never be seen. */
function showSharedLinkMessage(message: string): void {
  seedMessage.value = message;
  sharedLinkNotice.value = { text: message, puzzle: toRaw(puzzle.value) };
}

function clearSharedPuzzleUrl(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("p") && !url.searchParams.has("s")) return;
  url.searchParams.delete("p");
  url.searchParams.delete("s");
  window.history.replaceState(null, "", url);
}

/** Ask before discarding marks on an unfinished board; true when nothing to lose. */
async function confirmDiscardProgress(
  request: ConfirmRequest,
): Promise<boolean> {
  return (
    complete.value ||
    !hasPlayerMarks(puzzle.value, state.value) ||
    askConfirm(request)
  );
}

async function resetProgress(): Promise<void> {
  if (isSpecial.value) return;
  if (
    !(await confirmDiscardProgress({
      title: "盤面をリセットしますか？",
      message: "置いたタコと×をすべて消します。元に戻せません。",
      confirmLabel: "リセットする",
    }))
  )
    return;
  cancelPendingNextPuzzle();
  state.value = resetPlayerProgress(
    state.value,
    undefined,
    puzzle.value.givens,
  );
  hint.value = undefined;
  hintStage.value = 1;
  hintDialogOpen.value = false;
  showClearDialog.value = false;
  clearElapsedSeconds.value = undefined;
  clearDialogMessage.value = "";
  beginPlay();
}

const hintFocusIndexes = computed(
  () =>
    new Set(
      hint.value?.kind === "move"
        ? hintFocusCells(
            puzzle.value,
            hint.value.move,
            hintStage.value,
            contradictionCells.value,
          )
        : [],
    ),
);
const hintExcludeIndexes = computed(
  () =>
    new Set(
      hint.value?.kind === "move"
        ? hintExcludeCells(hint.value.move, hintStage.value)
        : [],
    ),
);

function boardCellLabel(index: number): string {
  return cellLabel(puzzle.value, state.value, index, [
    ...(hintFocusIndexes.value.has(index) ? ["ヒント注目"] : []),
    ...(hintExcludeIndexes.value.has(index) ? ["×候補"] : []),
  ]);
}

function onTap(index: number): void {
  commitPlayerStateWithFeedback(
    toggleExcluded(state.value, index, puzzle.value.size),
    "tap",
  );
  hint.value = undefined;
}

function onCellClick(index: number, event?: MouseEvent): void {
  // Pointer input is committed on release. Keep keyboard/assistive activation.
  if (!event || event.detail === 0) onTap(index);
}

function startPointerPress(event: PointerEvent): void {
  if (complete.value || !event.isPrimary || event.button !== 0 || activePointer)
    return;
  const index = cellIndexFromPointer(event);
  if (index === undefined) return;
  void soundEffects.unlock();
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  const pieceDisabled = state.value.excluded.has(index);
  activePointer = {
    pointerId: event.pointerId,
    startCell: index,
    startX: event.clientX,
    startY: event.clientY,
    startedAt: Date.now(),
    dragging: false,
    longPressReady: false,
    longPressCanceled: false,
    pieceDisabled,
    dragMarkAction: pieceDisabled ? "remove" : "add",
  };
  if (!pieceDisabled) startLongPress(index);
}

function startLongPress(index: number): void {
  cancelLongPressTimer();
  holdingCell.value = index;
  longPressTimer = window.setTimeout(() => {
    if (
      activePointer &&
      activePointer.startCell === index &&
      !activePointer.dragging
    ) {
      activePointer.longPressReady = true;
      holdingCell.value = undefined;
      pressedCell.value = index;
    }
    longPressTimer = undefined;
  }, LONG_PRESS_MS);
}

function onBoardPointerMove(event: PointerEvent): void {
  if (!activePointer || activePointer.pointerId !== event.pointerId) return;
  const cell = cellIndexFromPointer(event);
  // Before dragging, leaving the board cancels without adding any marks.
  if (cell === undefined && !activePointer.dragging) {
    cancelLongPress();
    return;
  }

  const dx = event.clientX - activePointer.startX;
  const dy = event.clientY - activePointer.startY;
  const movedEnough = Math.hypot(dx, dy) >= dragStartThresholdPx;
  if (!activePointer.dragging && movedEnough) {
    activePointer.dragging = true;
    activePointer.longPressReady = false;
    holdingCell.value = undefined;
    pressedCell.value = undefined;
    cancelLongPressTimer();
    applyDraggedExcludedMark(activePointer.startCell);
  }

  if (activePointer.dragging) {
    if (cell !== undefined) applyDraggedExcludedMark(cell);
  }
}

function endPointerPress(event: PointerEvent): void {
  if (!activePointer || activePointer.pointerId !== event.pointerId) return;

  if (
    !activePointer.dragging &&
    cellIndexFromPointer(event) !== activePointer.startCell
  )
    activePointer.longPressCanceled = true;

  const action = pointerReleaseAction({
    elapsedMs: Date.now() - activePointer.startedAt,
    longPressMs: LONG_PRESS_MS,
    dragging: activePointer.dragging,
    longPressReady: activePointer.longPressReady,
    longPressCanceled: activePointer.longPressCanceled,
    pieceDisabled: activePointer.pieceDisabled,
  });

  if (action === "place-piece") {
    commitPlayerStateWithFeedback(
      placePieceWithAutoExclusions(
        puzzle.value,
        state.value,
        activePointer.startCell,
        autoExclusionsEnabled.value,
      ),
      autoExclusionsEnabled.value ? "shortcut" : "piece",
    );
    hint.value = undefined;
  } else if (action === "tap") {
    onTap(activePointer.startCell);
    const now = Date.now();
    if (
      lastPointerTap?.cell === activePointer.startCell &&
      now - lastPointerTap.at < DOUBLE_TAP_MS
    ) {
      onShortcut(activePointer.startCell);
      lastPointerTap = undefined;
    } else {
      lastPointerTap = { cell: activePointer.startCell, at: now };
    }
  }
  if (action !== "tap") lastPointerTap = undefined;
  cancelLongPress(false);
}

function cancelLongPress(clearTap = true): void {
  cancelLongPressTimer();
  activePointer = undefined;
  holdingCell.value = undefined;
  pressedCell.value = undefined;
  if (clearTap) lastPointerTap = undefined;
}

function onPointerCanceled(event: PointerEvent): void {
  if (activePointer?.pointerId === event.pointerId) cancelLongPress();
}

function cancelLongPressTimer(): void {
  if (longPressTimer !== undefined) window.clearTimeout(longPressTimer);
  longPressTimer = undefined;
}

function applyDraggedExcludedMark(index: number): void {
  if (!activePointer) return;
  const previousExcludedCount = state.value.excluded.size;
  // Keep the action chosen at pointerdown, even when revisiting cleared cells.
  const updateMarks =
    activePointer.dragMarkAction === "remove"
      ? removeExcludedMarks
      : addExcludedMarks;
  commitPlayerStateWithFeedback(
    updateMarks(state.value, [index], puzzle.value.size),
    "drag",
  );
  if (state.value.excluded.size !== previousExcludedCount)
    hint.value = undefined;
}

function cellIndexFromPointer(event: PointerEvent): number | undefined {
  const board = boardElement.value;
  if (!board) return undefined;
  const bounds = board.getBoundingClientRect();
  return cellIndexAtPoint(
    event.clientX,
    event.clientY,
    {
      left: bounds.left + board.clientLeft,
      top: bounds.top + board.clientTop,
      // clientWidth/clientHeight round to integers; retain fractional cell sizes.
      width: bounds.width - 2 * board.clientLeft,
      height: bounds.height - 2 * board.clientTop,
    },
    puzzle.value.size,
  );
}

function onBoardPointerLeave(event: PointerEvent): void {
  if (!activePointer || activePointer.pointerId !== event.pointerId) return;
  if (!activePointer.dragging) {
    cancelLongPress();
  }
}

function onShortcut(index: number): void {
  commitPlayerStateWithFeedback(
    addExcludedMarks(
      state.value,
      shortcutExclusionsForCell(puzzle.value, state.value, index),
      puzzle.value.size,
    ),
    "shortcut",
  );
}

function triggerCellFeedbacks(feedbacks: readonly CellFeedback[]): void {
  if (feedbacks.length === 0) return;
  const nextFeedbacks = { ...cellFeedbacks.value };
  for (const feedback of feedbacks) {
    const token = ++feedbackToken;
    nextFeedbacks[feedback.cell] = { ...feedback, token };
    window.setTimeout(() => {
      const current = cellFeedbacks.value[feedback.cell];
      if (!current || current.token !== token) return;
      const updated = { ...cellFeedbacks.value };
      delete updated[feedback.cell];
      cellFeedbacks.value = updated;
    }, 700);
  }
  cellFeedbacks.value = nextFeedbacks;
}

function showHint(): void {
  if (!canShowHint(complete.value)) {
    hint.value = undefined;
    hintDialogOpen.value = false;
    return;
  }

  const nextHint = findLogicalMoves(puzzle.value, state.value)[0];
  if (nextHint) {
    if (
      hint.value?.kind !== "move" ||
      logicalMoveKey(hint.value.move) !== logicalMoveKey(nextHint)
    ) {
      state.value = countHintUsed(state.value);
      hintStage.value = 1;
    }
    hint.value = { kind: "move", move: nextHint };
    state.value = recordHintStage(state.value, hintStage.value);
    hintDialogOpen.value = true;
    return;
  }

  hint.value = {
    kind: "unavailable",
    title: "今出せるヒントがありません",
    explanation: [
      "今の盤面からは、説明できる次の一手を見つけられませんでした。",
      "ヒント回数は増やしていません。",
      "×の付け忘れがないか、置いたタコをダブルタップして×を付けたかを見直してください。",
    ],
  };
  hintDialogOpen.value = true;
}

function closeHintDialog(): void {
  hintDialogOpen.value = false;
}

function revealNextHintStage(): void {
  if (hint.value?.kind !== "move") return;
  hintStage.value = Math.min(
    hintStage.value + 1,
    hintStageCount(hint.value.move),
  );
  state.value = recordHintStage(state.value, hintStage.value);
  if (hintStage.value === hintStageCount(hint.value.move))
    void nextTick(() => hintDialogRef.value?.focus());
}

function applyHintExclusions(): void {
  if (
    hint.value?.kind !== "move" ||
    hintStage.value < 3 ||
    hint.value.move.technique === "contradiction"
  )
    return;
  const exclusions = hintExcludeCells(hint.value.move, hintStage.value);
  if (exclusions.length === 0) return;
  commitPlayerStateWithFeedback(
    addExcludedMarks(state.value, exclusions, puzzle.value.size),
    "shortcut",
  );
  hint.value = undefined;
  closeHintDialog();
}

function closeClearDialog(): void {
  clearBackdropPressed = false;
  clearDialogPointerStarted = false;
  showClearDialog.value = false;
}

function onClearBackdropPointerDown(event: PointerEvent): void {
  clearDialogPointerStarted = event.isPrimary && event.button === 0;
  clearBackdropPressed =
    clearDialogPointerStarted && event.target === event.currentTarget;
}

function onClearDialogClickCapture(event: MouseEvent): void {
  // タッチのclickはpointerup後の描画で、新しい×ボタンへ届く場合がある。
  // ダイアログ内で始まっていないポインター操作だけを遮断し、キー操作は残す。
  if (event.detail > 0 && !clearDialogPointerStarted) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  clearDialogPointerStarted = false;
}

function cancelClearDialogPointer(): void {
  clearBackdropPressed = false;
  clearDialogPointerStarted = false;
}

function onClearBackdropClick(event: MouseEvent): void {
  // クリアしたpointerupに続くclickで、表示直後の結果を閉じない。
  const pressed = clearBackdropPressed;
  clearBackdropPressed = false;
  if (pressed && event.target === event.currentTarget) closeClearDialog();
}

function showDailyRankingFromClear(): void {
  if (!activeDailyDate.value) return;
  returnToClearAfterRanking.value = true;
  closeClearDialog();
  void dailyChallengeRef.value?.openRanking(activeDailyDate.value);
}

function onDailyRankingClosed(): void {
  dailyRankingOpen.value = false;
  if (returnToClearAfterRanking.value && isDaily.value && complete.value)
    showClearDialog.value = true;
  returnToClearAfterRanking.value = false;
  if (resumeAfterMenu) void confirmReady();
  resumeAfterMenu = false;
}

function onAccountSetupRequired(required: boolean): void {
  accountSetupRequired.value = required;
  if (required) accountDialogOpen.value = true;
}

function onAccountProfile(name: string): void {
  onlineGameName.value = name;
  if (name && accountSetupRequired.value) {
    accountSetupRequired.value = false;
    accountDialogOpen.value = false;
  }
}

function showLeaderboard(): void {
  returnToClearAfterPublicRanking.value = showClearDialog.value;
  closeClearDialog();
  if (!menuOpen.value) {
    resumeAfterMenu = timer.value.status === "running";
    pauseGame();
  }
  menuOpen.value = false;
  publicRankingOpen.value = true;
}

function showCurrentRanking(): void {
  if (isSuper.value) {
    closeClearDialog();
    menuOpen.value = false;
    void superChallengeRef.value?.openRanking();
    return;
  }
  if (!isDaily.value) {
    showLeaderboard();
    return;
  }
  if (!activeDailyDate.value) return;
  if (!menuOpen.value) {
    resumeAfterMenu = timer.value.status === "running";
    pauseGame();
  }
  menuOpen.value = false;
  void dailyChallengeRef.value?.openRanking(activeDailyDate.value);
}

function closeLeaderboard(): void {
  publicRankingOpen.value = false;
  if (returnToClearAfterPublicRanking.value && complete.value)
    showClearDialog.value = true;
  returnToClearAfterPublicRanking.value = false;
  if (resumeAfterMenu) void confirmReady();
  resumeAfterMenu = false;
}

function closeWeeklyRanking(): void {
  weeklyRankingOpen.value = false;
  if (resumeAfterMenu) void confirmReady();
  resumeAfterMenu = false;
}

function onDialogKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    if (activeDialog.value === "hint") closeHintDialog();
    else if (activeDialog.value === "clear") closeClearDialog();
    return;
  }
  if (event.key !== "Tab") return;
  const dialog =
    activeDialog.value === "hint" ? hintDialogRef.value : clearDialogRef.value;
  if (!dialog) return;
  trapDialogFocus(event, dialog);
}

async function copyResultSeed(): Promise<void> {
  try {
    await navigator.clipboard.writeText(puzzleSeedCode.value);
    clearDialogMessage.value = "シードをコピーしました。";
  } catch {
    clearDialogMessage.value =
      "コピーできませんでした。メニューの「シード・共有」からコピーしてください。";
  }
}

function logicalMoveKey(move: LogicalMove): string {
  return JSON.stringify({
    technique: move.technique,
    regionId: move.regionId,
    regionIds: move.regionIds,
    affectedRegionId: move.affectedRegionId,
    row: move.row,
    col: move.col,
    rows: move.rows,
    cols: move.cols,
    focusCells: [...move.focusCells].sort((a, b) => a - b),
    excludeCells: [...move.excludeCells].sort((a, b) => a - b),
    placeCell: move.placeCell,
  });
}

function cellClasses(index: number): Record<string, boolean> {
  const viewState = getCellViewState(state.value, index);
  return {
    "is-excluded": viewState === "excluded",
    "is-piece": viewState === "piece",
    "is-fixed-error": viewState === "fixed-error",
    "is-pressed": pressedCell.value === index,
    "is-holding": holdingCell.value === index,
    "is-hint-focus": hintFocusIndexes.value.has(index),
    "is-hint-exclude": hintExcludeIndexes.value.has(index),
    "is-feedback-excluded-add":
      cellFeedbacks.value[index]?.kind === "excluded-add",
    "is-feedback-excluded-remove":
      cellFeedbacks.value[index]?.kind === "excluded-remove",
    "is-feedback-shortcut-exclude":
      cellFeedbacks.value[index]?.kind === "shortcut-exclude",
    "is-feedback-piece-place":
      cellFeedbacks.value[index]?.kind === "piece-place",
    "is-feedback-fixed-error":
      cellFeedbacks.value[index]?.kind === "fixed-error",
  };
}

// Depends only on the board, so it is built once per board rather than on
// every render (the clock re-renders each second).
const cellBaseStyles = computed(() =>
  cells.value.map((index) =>
    cellBaseStyle(puzzle.value, regionColorIndexes.value, index),
  ),
);

// The board's fixed look and the feedback that changes are passed as two
// objects, so the fixed one keeps its identity between renders.
function cellStyles(index: number): Record<string, string>[] {
  return [cellBaseStyles.value[index], cellFeedbackStyle(index)];
}

function cellFeedbackStyle(index: number): Record<string, string> {
  return {
    "--feedback-order": String(cellFeedbacks.value[index]?.order ?? 0),
    "--feedback-delay": `${Math.min(cellFeedbacks.value[index]?.order ?? 0, 12) * 22}ms`,
  };
}

function loadHapticsEnabled(): boolean {
  return localStorage.getItem(hapticsStorageKey) !== "0";
}

function difficultyLabel(rating: DifficultyRating): string {
  switch (rating) {
    case "easy":
      return "初級";
    case "normal":
      return "中級";
    case "hard":
      return "上級";
    case "unsupported":
      return "未分類";
  }
}

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}
</script>

<template>
  <main class="app-shell" :inert="dailyRankingOpen || dailyPanelOpen">
    <header class="hero" :inert="waitingToStart || !!activeDialog">
      <section class="status-bar" aria-label="プレイ状況">
        <span role="img" :aria-label="`ミス ${state.mistakes} 回`" title="ミス"
          ><UiIcon name="mistake" />{{ state.mistakes }}</span
        >
        <span
          role="img"
          :aria-label="`ヒント ${state.hintsUsed} 回`"
          :title="`ヒント · ${hintStageLabel(state)}`"
          ><UiIcon name="hint" />{{ state.hintsUsed }}</span
        >
        <span
          class="time-status"
          role="group"
          :aria-label="`時間 ${formatElapsed(displayedElapsedSeconds)}`"
          title="プレイ時間"
        >
          <UiIcon name="clock" />{{ formatElapsed(displayedElapsedSeconds) }}
          <button
            v-if="!complete && timer.status === 'running'"
            type="button"
            class="pause-button"
            aria-label="一時停止"
            title="一時停止"
            @click="pauseGame"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <rect x="3" y="2" width="3" height="12" rx="1" />
              <rect x="10" y="2" width="3" height="12" rx="1" />
            </svg>
          </button>
        </span>
        <span
          role="img"
          :aria-label="`評価 ${actualDifficultyLabel}`"
          title="問題の評価"
          ><UiIcon name="difficulty" />{{ actualDifficultyLabel }}</span
        >
        <span v-if="complete" class="clear" role="status">CLEAR</span>
      </section>
      <button
        ref="menuButton"
        type="button"
        class="icon-button menu-trigger"
        aria-label="メニューを開く"
        title="メニュー"
        aria-haspopup="dialog"
        :aria-expanded="menuOpen"
        @click="openMenu"
      >
        <UiIcon name="settings" />
      </button>
    </header>

    <div
      v-if="activeDialog === 'menu'"
      class="dialog-backdrop menu-backdrop"
      role="presentation"
      @click.self="closeMenu"
    >
      <section
        ref="menuDialogRef"
        class="dialog-card menu-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="menu-title"
        tabindex="-1"
        @keydown="onMenuKeydown"
      >
        <div class="dialog-header menu-header">
          <h2 id="menu-title" class="tako-title">
            <img src="/tako.svg" alt="" aria-hidden="true" draggable="false" />
            <span>TAKO-SEN メニュー</span>
          </h2>
          <button
            type="button"
            class="dialog-close"
            aria-label="メニューを閉じる"
            @click="closeMenu"
          >
            <span aria-hidden="true">×</span>
          </button>
          <nav
            v-if="onlineAuthEnabled"
            class="account-controls"
            aria-label="アカウント"
          >
            <Show when="signed-out">
              <SignInButton
                ><button type="button">ログイン</button></SignInButton
              >
              <SignUpButton
                ><button type="button">アカウント作成</button></SignUpButton
              >
            </Show>
            <Show when="signed-in"
              ><button
                ref="accountMenuButton"
                type="button"
                aria-haspopup="dialog"
                :aria-expanded="accountDialogOpen"
                @click="accountDialogOpen = true"
              >
                <template v-if="onlineGameName"
                  >プレイヤー：<GameName :name="onlineGameName" /></template
                ><template v-else>プレイヤー名を設定</template>
              </button></Show
            >
          </nav>
        </div>
        <nav class="screen-menu" aria-label="メニュー">
          <button type="button" @click="navigateTo('history')">
            履歴・成績
          </button>
          <button type="button" @click="navigateTo('weekly')">
            週間ランキング
          </button>
          <button type="button" @click="navigateTo('settings')">設定</button>
          <button type="button" @click="navigateTo('share')">
            シード・共有
          </button>
          <button type="button" @click="openTutorial">遊び方</button>
        </nav>
      </section>
    </div>

    <section
      class="play-area"
      :inert="waitingToStart || complete || !!activeDialog"
    >
      <section ref="boardWrap" class="board-wrap">
        <div
          ref="boardElement"
          class="board"
          id="board"
          role="grid"
          :aria-label="`TAKO-SEN ${puzzle.size}×${puzzle.size} の盤面`"
          :style="{
            gridTemplateColumns: `repeat(${puzzle.size}, 1fr)`,
            gridTemplateRows: `repeat(${puzzle.size}, 1fr)`,
            '--long-press-duration': `${LONG_PRESS_MS}ms`,
          }"
          @pointermove.prevent="onBoardPointerMove"
          @pointerdown.prevent="startPointerPress"
          @pointerup="endPointerPress"
          @pointercancel="onPointerCanceled"
          @lostpointercapture="onPointerCanceled"
          @pointerleave="onBoardPointerLeave"
        >
          <button
            v-for="index in cells"
            :key="index"
            class="cell"
            :class="cellClasses(index)"
            :style="cellStyles(index)"
            :data-cell-index="index"
            :data-region="puzzle.regions[index]"
            :aria-label="boardCellLabel(index)"
            role="gridcell"
            @click="onCellClick(index, $event)"
            @dblclick.prevent
          >
            <img
              v-if="state.pieces.has(index)"
              src="/tako.svg"
              alt=""
              aria-hidden="true"
              draggable="false"
              class="tako"
            />
            <span
              v-else-if="state.fixedErrors.has(index)"
              aria-hidden="true"
              class="fixed-error"
              ><CellMark error
            /></span>
            <span
              v-else-if="state.excluded.has(index)"
              aria-hidden="true"
              class="mark"
              ><CellMark
            /></span>
          </button>
        </div>
      </section>
    </section>

    <div class="play-footer">
      <section class="actions" :inert="waitingToStart || !!activeDialog">
        <button
          v-if="canShowHint(complete)"
          type="button"
          class="icon-button"
          aria-label="ヒント"
          title="ヒント"
          @click="showHint"
        >
          <UiIcon name="hint" />
        </button>
        <button
          v-if="!isSpecial"
          type="button"
          class="icon-button"
          aria-label="リセット"
          title="リセット"
          @click="resetProgress"
        >
          <UiIcon name="reset" />
        </button>
        <button
          type="button"
          class="icon-button next-puzzle-button"
          :disabled="nextPuzzleLoading"
          :aria-label="isSpecial ? '通常プレイに戻る' : '次の問題へ'"
          :title="isSpecial ? '通常プレイに戻る' : '次の問題へ'"
          @click="isSpecial ? leaveDaily() : newGame()"
        >
          <UiIcon name="next" />
        </button>
        <button
          v-if="!isDaily || activeDailyDate"
          type="button"
          class="icon-button"
          :aria-label="isDaily ? '今日のランキング' : 'この問題のランキング'"
          :title="isDaily ? '今日のランキング' : 'この問題のランキング'"
          @click="showCurrentRanking"
        >
          <UiIcon name="ranking" />
        </button>
      </section>

      <div class="play-options">
        <label
          v-if="!isSpecial"
          class="difficulty-select"
          :inert="waitingToStart || !!activeDialog"
        >
          <UiIcon name="difficulty" />
          <select
            v-model="selectedDifficulty"
            aria-label="難易度"
            :disabled="nextPuzzleLoading"
          >
            <option value="easy">初級</option>
            <option value="normal">中級</option>
            <option value="hard">上級</option>
            <option value="random">ランダム</option>
          </select>
        </label>
        <SuperChallenge
          v-if="onlineAuthEnabled"
          ref="superChallengeRef"
          :puzzle="puzzle"
          :play-id="playId"
          :complete="complete"
          :game-name="onlineGameName"
          :modal-blocked="!!activeDialog"
          :entry-blocked="waitingToStart"
          @start="startSuper"
          @pause="pauseGame"
          @account="accountDialogOpen = true"
          @opened="onSuperOpened"
          @closed="onSuperClosed"
          @synced="rankingRevision += 1"
        />

        <DailyChallenge
          v-if="onlineAuthEnabled"
          ref="dailyChallengeRef"
          :inert="waitingToStart || !!activeDialog"
          :active-date="activeDailyDate"
          :active-account-id="activeDailyAccountId"
          :puzzle="puzzle"
          :state="state"
          :play-id="playId"
          :elapsed-seconds="displayedElapsedSeconds"
          :complete="complete"
          :game-name="onlineGameName"
          @start="startDaily"
          @account="accountDialogOpen = true"
          @panel-opened="dailyPanelOpen = true"
          @panel-closed="dailyPanelOpen = false"
          @ranking-opened="dailyRankingOpen = true"
          @ranking-closed="onDailyRankingClosed"
          @synced="rankingRevision += 1"
        />
      </div>
      <!-- One region that stays mounted, so each change is announced. -->
      <p
        class="play-footer-message"
        role="status"
        v-text="
          nextPuzzleLoading
            ? '次の問題を選んでいます…'
            : nextPuzzleMessage || sharedLinkMessage || ''
        "
      ></p>
    </div>

    <div
      v-if="activeDialog === 'settings' || activeDialog === 'share'"
      class="dialog-backdrop tools-backdrop"
      role="presentation"
      @click.self="toolsDialog = undefined"
    >
      <section
        ref="toolsDialogRef"
        class="dialog-card tools-dialog"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="
          toolsDialog === 'settings' ? 'settings-title' : 'seed-share-title'
        "
        tabindex="-1"
        @keydown="onToolsKeydown"
      >
        <div class="dialog-header">
          <h2
            :id="
              toolsDialog === 'settings' ? 'settings-title' : 'seed-share-title'
            "
          >
            {{ toolsDialog === "settings" ? "設定" : "シード・共有" }}
          </h2>
          <button
            type="button"
            class="dialog-close"
            :aria-label="
              toolsDialog === 'settings'
                ? '設定を閉じる'
                : 'シード・共有を閉じる'
            "
            @click="toolsDialog = undefined"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div class="tools-dialog-body">
          <template v-if="toolsDialog === 'settings'">
            <div class="auto-exclusions-settings">
              <label class="settings-toggle">
                <input
                  v-model="autoExclusionsEnabled"
                  type="checkbox"
                  aria-describedby="auto-exclusions-help"
                />
                正解のタコを置いたら自動で×を付ける
              </label>
              <p id="auto-exclusions-help">
                初期設定はオフです。オンにすると、新しく正解のタコを置いた直後に、同じ行・列・エリアと周囲8マスへ×を付けます。配置済みのタコをダブルタップする操作と同じ範囲です。設定の変更だけでは盤面は変わりません。
              </p>
              <p v-if="autoExclusionsSaveFailed" role="status">
                この設定を保存できませんでした。現在のプレイには反映されますが、再読み込みで元に戻る場合があります。
              </p>
            </div>
            <div class="haptics-settings">
              <label class="settings-toggle">
                <input
                  v-model="hapticsEnabled"
                  type="checkbox"
                  :disabled="!hapticsApiAvailable"
                  aria-describedby="haptics-help"
                />
                操作時に振動する（対応ブラウザ・端末のみ）
              </label>
              <p id="haptics-help">
                <template v-if="!hapticsApiAvailable">
                  このブラウザでは振動APIが利用できません。操作結果は盤面の表示で確認できます。
                </template>
                <template v-else>
                  振動APIを利用できますが、実際に振動するとは限りません。振動しない場合は端末の振動設定やマナーモードを確認してください。Firefox
                  Androidではブラウザ側で振動が無効化されています。
                </template>
              </p>
              <button
                type="button"
                :disabled="!hapticsApiAvailable || !hapticsEnabled"
                @click="testHaptics"
              >
                振動を試す（100ms）
              </button>
              <p v-if="hapticsTestMessage" role="status">
                {{ hapticsTestMessage }}
              </p>
            </div>
            <div class="sound-settings">
              <label class="settings-toggle">
                <input
                  v-model="soundEnabled"
                  type="checkbox"
                  :disabled="!soundApiAvailable"
                  aria-describedby="sound-help"
                  @change="onSoundPreferenceChange"
                />
                効果音（SE）を鳴らす
              </label>
              <p id="sound-help">
                {{
                  soundApiAvailable
                    ? "初期設定はオフです。×・タコの配置とCLEAR時に鳴ります。音量は端末で調整してください。"
                    : "このブラウザでは音声APIが利用できません。音なしでもプレイできます。"
                }}
              </p>
              <div class="sound-previews">
                <button
                  v-for="preview in soundPreviews"
                  :key="preview.kind"
                  type="button"
                  :disabled="!soundApiAvailable || !soundEnabled"
                  @click="soundEffects.play(preview.kind)"
                >
                  {{ preview.label }}
                </button>
              </div>
            </div>
          </template>
          <template v-else>
            <h3>{{ isDaily ? "今日の問題" : "シード表示・復元" }}</h3>
            <p v-if="isDaily">
              {{ activeDailyDate }}
              のデイリーチャレンジです。通常のシード復元・共有には対応しません。
            </p>
            <div v-else class="seed-panel-body" aria-label="シード">
              <span class="seed-label">現在のシード</span>
              <div class="seed-inline-row">
                <code :title="puzzleSeedCode">{{ puzzleSeedCode }}</code>
                <button
                  type="button"
                  class="icon-button"
                  aria-label="シードをコピー"
                  title="シードをコピー"
                  @click="copySeed"
                >
                  <UiIcon name="copy" />
                </button>
              </div>
              <label for="restore-seed-input">シード復元</label>
              <div class="seed-inline-row">
                <input
                  id="restore-seed-input"
                  v-model="restoreSeedCode"
                  type="text"
                  inputmode="text"
                  autocomplete="off"
                  :placeholder="`TAKO:${GENERATOR_VERSION}:easy:...`"
                />
                <button
                  type="button"
                  class="icon-button"
                  aria-label="復元"
                  title="シードを復元"
                  @click="restoreFromSeed"
                >
                  <UiIcon name="reset" />
                </button>
              </div>
              <SharePuzzle
                v-if="onlineAuthEnabled && !isSpecial"
                :seed-code="puzzleSeedCode"
              />
              <button v-if="isSuper" type="button" @click="copySuperLink">
                <UiIcon name="share" />
                超級の共有リンクをコピー
              </button>
              <p
                class="seed-message"
                aria-live="polite"
                v-text="seedMessage"
              ></p>
            </div>
          </template>
        </div>
      </section>
    </div>

    <WeeklyLeaderboard
      :open="activeDialog === 'weekly'"
      :game-name="onlineGameName"
      :revision="rankingRevision"
      @close="closeWeeklyRanking"
    />

    <ConfirmDialog />

    <HistoryDialog
      :open="activeDialog === 'history'"
      :plays="resultHistory?.plays ?? []"
      :account-id="historyAccountId"
      :revision="rankingRevision"
      :load-online="loadHistoryOnline"
      @close="historyDialogOpen = false"
      @restore="restoreHistorySeed"
    />

    <PublicLeaderboard
      v-if="!isSpecial"
      :open="publicRankingOpen"
      :puzzle="puzzle"
      :revision="rankingRevision"
      :game-name="onlineGameName"
      :complete="complete"
      @close="closeLeaderboard"
    />

    <AccountHistory
      v-if="onlineAuthEnabled && resultHistory"
      :plays="resultHistory.plays"
      :open="activeDialog === 'account'"
      :setup-only="accountSetupRequired"
      @close="accountDialogOpen = false"
      @profile="onAccountProfile"
      @setup-required="onAccountSetupRequired"
      @synced="onNormalPlaysSynced"
      @sending="onNormalPlaySending"
    />

    <div
      v-if="hint && activeDialog === 'hint'"
      class="dialog-backdrop hint-backdrop"
      role="presentation"
      @click.self="closeHintDialog"
    >
      <section
        ref="hintDialogRef"
        class="dialog-card hint-card"
        :style="hintRoom ? { '--hint-room': `${hintRoom}px` } : undefined"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hint-title"
        tabindex="-1"
        @keydown="onDialogKeydown"
      >
        <div class="dialog-header">
          <h2 id="hint-title">
            {{ hint.kind === "move" ? "ヒント" : hint.title }}
          </h2>
          <button
            type="button"
            class="dialog-close"
            aria-label="ヒントを閉じる"
            @click="closeHintDialog"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <p v-if="hint.kind === 'move'">
          {{
            hintStage >= 3 || hint.move.technique === "contradiction"
              ? hint.move.title
              : hintStage === 2
                ? "パターンを確認"
                : "注目箇所"
          }}
          · ステップ {{ hintStage }} / {{ hintStageCount(hint.move) }}
        </p>
        <ol>
          <li
            v-for="line in hint.kind === 'move'
              ? hintStageLines(hint.move, hintStage, contradictionCells)
              : hint.explanation"
            :key="line"
          >
            {{ line }}
          </li>
        </ol>
        <div v-if="hint.kind === 'move'" class="dialog-actions">
          <button
            v-if="hintStage < hintStageCount(hint.move)"
            type="button"
            @click="revealNextHintStage"
          >
            次のステップ
          </button>
          <button
            v-if="hintStage >= 3 && hint.move.excludeCells.length > 0"
            type="button"
            @click="applyHintExclusions"
          >
            ×を適用
          </button>
          <p v-if="hintStage >= 3 && hint.move.placeCell !== undefined">
            強調されたマスを長押しするとタコを確定できます。
          </p>
        </div>
      </section>
    </div>

    <div
      v-if="activeDialog === 'clear'"
      class="dialog-backdrop clear-backdrop"
      role="presentation"
      @pointerdown="onClearBackdropPointerDown"
      @pointercancel="cancelClearDialogPointer"
      @click.capture="onClearDialogClickCapture"
      @click="onClearBackdropClick"
    >
      <div class="clear-confetti" aria-hidden="true">
        <span
          v-for="index in 20"
          :key="index"
          :style="{
            '--offset-x': `${(index - 10.5) * 30}px`,
            '--delay': `${index * 20}ms`,
            '--rotation': `${index * 57}deg`,
          }"
        />
      </div>
      <section
        ref="clearDialogRef"
        class="dialog-card clear-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="clear-title"
        tabindex="-1"
        @keydown="onDialogKeydown"
      >
        <div class="clear-dialog-header">
          <h2 id="clear-title" class="clear-badge">CLEAR</h2>
          <button
            type="button"
            class="dialog-close"
            aria-label="クリア結果を閉じる"
            @click="closeClearDialog"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <dl class="result-list">
          <div>
            <dt>
              <UiIcon name="difficulty" /><span class="sr-only">難易度</span>
            </dt>
            <dd :title="actualDifficultyLabel">
              {{
                isSuper ? "超級" : isDaily ? "デイリー" : actualDifficultyLabel
              }}
            </dd>
          </div>
          <div class="result-primary">
            <dt><UiIcon name="clock" /><span class="sr-only">時間</span></dt>
            <dd>{{ formatElapsed(displayedElapsedSeconds) }}</dd>
          </div>
          <div class="result-primary">
            <dt><UiIcon name="score" /><span class="sr-only">スコア</span></dt>
            <dd>
              {{
                rankingScore({
                  elapsedSeconds: displayedElapsedSeconds,
                  mistakes: state.mistakes,
                  hintsUsed: state.hintsUsed,
                })
              }}
            </dd>
          </div>
          <div>
            <dt><UiIcon name="mistake" /><span class="sr-only">ミス</span></dt>
            <dd>{{ state.mistakes }}</dd>
          </div>
          <div>
            <dt><UiIcon name="hint" /><span class="sr-only">ヒント</span></dt>
            <dd :title="hintStageLabel(state)">{{ state.hintsUsed }}</dd>
          </div>
        </dl>
        <!-- The preview below is a button, so its own text is not announced
          when it changes; this region announces it instead. -->
        <p class="sr-only" role="status">{{ clearRankingMessage }}</p>
        <div
          class="clear-ranking-preview"
          role="button"
          tabindex="0"
          :aria-label="
            isDaily ? '今日のランキングを表示' : 'この問題のランキングを表示'
          "
          aria-describedby="clear-ranking-content"
          @click="isDaily ? showDailyRankingFromClear() : showCurrentRanking()"
          @keydown.enter.prevent="
            isDaily ? showDailyRankingFromClear() : showCurrentRanking()
          "
          @keydown.space.prevent="
            isDaily ? showDailyRankingFromClear() : showCurrentRanking()
          "
        >
          <!-- The button's name replaces its content for screen readers, so the
            ranking itself is read as the description. -->
          <p v-if="clearRankingMessage" id="clear-ranking-content">
            {{ clearRankingMessage }}
          </p>
          <ol v-else id="clear-ranking-content" class="public-ranking-entries">
            <li
              v-for="entry in clearRankingEntries"
              :key="entry.displayName"
              :class="{ 'ranking-self': entry.isSelf }"
            >
              <div class="ranking-score-main">
                <strong class="ranking-place">{{ entry.rank }}位</strong>
                <div class="ranking-name">
                  <GameName :name="entry.displayName" />
                  <strong v-if="entry.isSelf" class="ranking-you"
                    >あなた</strong
                  >
                </div>
                <strong>{{ rankingScore(entry) }}点</strong>
                <strong class="ranking-time"
                  >{{ entry.elapsedSeconds }}秒</strong
                >
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
        </div>
        <p
          class="dialog-message"
          aria-live="polite"
          v-text="clearDialogMessage"
        ></p>
        <div class="dialog-actions clear-actions">
          <label v-if="!isSpecial" class="difficulty-select">
            <UiIcon name="difficulty" />
            <select
              v-model="selectedDifficulty"
              aria-label="次の問題の難易度"
              :disabled="nextPuzzleLoading"
            >
              <option value="easy">初級</option>
              <option value="normal">中級</option>
              <option value="hard">上級</option>
              <option value="random">ランダム</option>
            </select>
          </label>
          <button
            type="button"
            class="icon-button next-puzzle-button"
            :aria-label="isSpecial ? '通常プレイに戻る' : '次の問題へ'"
            :title="isSpecial ? '通常プレイに戻る' : '次の問題へ'"
            :disabled="nextPuzzleLoading"
            @click="isSpecial ? leaveDaily() : newGame()"
          >
            <UiIcon name="next" />
          </button>
          <button
            v-if="!isSpecial"
            type="button"
            class="icon-button"
            aria-label="もう一度"
            title="もう一度"
            @click="resetProgress"
          >
            <UiIcon name="reset" />
          </button>
          <button
            v-if="!isDaily"
            type="button"
            class="icon-button"
            aria-label="シードをコピー"
            title="シードをコピー"
            @click="copyResultSeed"
          >
            <UiIcon name="share" />
          </button>
        </div>
      </section>
    </div>
    <InteractiveTutorial
      v-if="activeDialog === 'tutorial'"
      :open="activeDialog === 'tutorial'"
      :first-visit="tutorialFirstVisit"
      :online-enabled="onlineAuthEnabled"
      :auto-exclusions-enabled="autoExclusionsEnabled"
      @close="closeTutorial"
      @auto-exclusions-change="autoExclusionsEnabled = $event"
    />
    <div
      v-if="waitingToStart && !activeDialog"
      class="ready-overlay"
      role="presentation"
    >
      <section
        class="ready-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ready-title"
      >
        <h2 id="ready-title">READY?</h2>
        <p v-if="isDaily && !dailyClaimed">
          OK を押すと今日の挑戦権を使用します。
        </p>
        <p v-if="isSuper">
          超級 / 10×10 ·
          ログインとオンライン接続が必要です。初回のOKでのみ挑戦権を使用します（共有経由は消費しません）。
        </p>
        <p v-if="dailyReadyMessage" role="alert">{{ dailyReadyMessage }}</p>
        <div class="ready-actions">
          <button
            ref="readyButton"
            type="button"
            class="ready-primary"
            :disabled="dailyClaiming"
            @click="confirmReady"
          >
            OK
          </button>
          <button
            v-if="isSuper || (isDaily && !dailyClaimed)"
            type="button"
            :disabled="dailyClaiming"
            @click="leaveDaily"
          >
            通常プレイに戻る
          </button>
          <button type="button" @click="openTutorial">遊び方</button>
          <button
            v-if="!isSpecial && superChallengeRef?.right"
            type="button"
            @click="superChallengeRef?.openEarned()"
          >
            超級に挑戦
          </button>
          <button
            type="button"
            class="icon-button"
            aria-label="メニューを開く"
            title="メニュー"
            @click="openMenu"
          >
            <UiIcon name="settings" />
          </button>
        </div>
      </section>
    </div>
  </main>
</template>
