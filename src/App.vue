<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  watch,
} from "vue";
import { Show, SignInButton, SignUpButton, useAuth } from "@clerk/vue";
import AccountHistory from "./ui/AccountHistory.vue";
import PublicLeaderboard from "./ui/PublicLeaderboard.vue";
import DailyChallenge from "./ui/DailyChallenge.vue";
import SuperChallenge from "./ui/SuperChallenge.vue";
import HistoryDialog from "./ui/HistoryDialog.vue";
import { parseSuperSeed } from "./core/super-puzzle";
import type { SavedSuperGame } from "./core/super-storage";
import SharePuzzle from "./ui/SharePuzzle.vue";
import GameName from "./ui/GameName.vue";
import UiIcon from "./ui/UiIcon.vue";
import { rememberTutorial, shouldShowTutorial } from "./core/tutorial";
import { trapDialogFocus } from "./ui/dialog";
import {
  cellCoord,
  createInitialPlayerState,
  getCellViewState,
  type PuzzleDifficulty,
  type PlayerState,
  type Puzzle,
} from "./core/model";
import {
  GENERATOR_VERSION,
  generatePuzzleWithAnalysis,
} from "./core/generator";
import {
  analyzePuzzleDifficulty,
  type DifficultyRating,
  type PuzzleDifficultyAnalysis,
} from "./core/difficulty";
import { encodePuzzleSeed, parsePuzzleSeedCode } from "./core/puzzle-code";
import { puzzleId } from "./core/puzzle-identity";
import {
  chooseNextPuzzle,
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
  loadAutoExclusionsEnabled,
  saveAutoExclusionsEnabled,
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
import {
  assignRegionColorIndexes,
  cellRegionBorders,
  regionColorForCell,
} from "./ui/region-visuals";

const InteractiveTutorial = defineAsyncComponent(
  () => import("./ui/InteractiveTutorial.vue"),
);

const dragStartThresholdPx = 12;
const hapticsStorageKey = "tako-sen:haptics-enabled";
const soundStorageKey = "tako-sen:sound-enabled";
const onlineAuthEnabled = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const onlineAuth = onlineAuthEnabled ? useAuth() : undefined;
const nextPuzzleLoading = ref(false);
const offeredPuzzleIds = new Set<string>();
let nextPuzzleRequest = 0;
const onlineGameName = ref("");
const rankingRevision = ref(0);
const accountDialogOpen = ref(false);
const accountSetupRequired = ref(false);
const tutorialOpen = ref(false);
const tutorialFirstVisit = ref(false);
type Screen = "play";
const screen = ref<Screen>("play");
const menuOpen = ref(false);
const historyDialogOpen = ref(false);
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
const selectedDifficulty = ref<PuzzleDifficulty>(
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
const isDaily = computed(() => puzzle.value.generatorVersion === "daily-v1");
const isSuper = computed(() => puzzle.value.generatorVersion === "super-v1");
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
  if (toolsDialog.value) return toolsDialog.value;
  if (menuOpen.value) return "menu";
  return undefined;
});
const puzzleSeedCode = computed(() => encodePuzzleSeed(puzzle.value));
const actualDifficultyLabel = computed(() =>
  isSuper.value
    ? "超級 / 10×10"
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
const clearRanking = ref("— / —");
let clearRankingGeneration = 0;
watch(
  () => [
    activeDialog.value,
    puzzle.value,
    rankingRevision.value,
    onlineGameName.value,
    onlineAuth?.userId.value,
    onlineAuth?.isSignedIn.value,
  ],
  async () => {
    const generation = ++clearRankingGeneration;
    clearRanking.value = "— / —";
    if (activeDialog.value !== "clear") return;
    try {
      const id = await puzzleId(puzzle.value);
      const special = isSpecial.value;
      const token = special ? await onlineAuth?.getToken.value() : undefined;
      if (special && !token) return;
      const path = isDaily.value
        ? `/api/daily/ranking?date=${encodeURIComponent(activeDailyDate.value ?? "")}`
        : isSuper.value
          ? `/api/super/ranking?puzzleId=${encodeURIComponent(id)}`
          : `/api/leaderboards/${encodeURIComponent(id)}`;
      if (generation !== clearRankingGeneration) return;
      const response = await fetch(path, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) return;
      const data = (await response.json()) as {
        entries?: { rank: number; displayName: string; isSelf?: boolean }[];
      };
      if (generation !== clearRankingGeneration || !Array.isArray(data.entries))
        return;
      const self = data.entries.find((entry) =>
        special
          ? entry.isSelf
          : !!onlineGameName.value &&
            entry.displayName === onlineGameName.value,
      );
      clearRanking.value = `${self?.rank ?? "—"} / ${data.entries.length}`;
    } catch {
      /* Rankings are optional; never substitute a local rank. */
    }
  },
);
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
  resultHistory.value = loadResultHistory();
  if (saved) {
    puzzle.value = saved.puzzle;
    state.value = saved.state;
    difficultyAnalysis.value = analyzePuzzleDifficulty(saved.puzzle);
    selectedDifficulty.value = saved.puzzle.difficulty ?? "easy";
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
  soundEffects.dispose();
  if (clockTimer !== undefined) window.clearInterval(clockTimer);
  window.removeEventListener("pagehide", suspendGame);
  window.removeEventListener("blur", suspendGame);
  document.removeEventListener("visibilitychange", onVisibilityChange);
});

watch([puzzle, state, timer], saveCurrentGame, { deep: true });
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
      if (previous === "account") accountMenuButton.value?.focus();
      else menuDialogRef.value?.focus();
    } else if (dialog === "settings" || dialog === "share")
      toolsDialogRef.value?.focus();
    else if (
      dialog !== "account" &&
      dialog !== "tutorial" &&
      dialog !== "super" &&
      dialog !== "ranking" &&
      dialog !== "history"
    )
      (dialog === "hint" ? hintDialogRef.value : clearDialogRef.value)?.focus();
  } else if (previous) {
    if (waitingToStart.value && screen.value === "play") focusReadyButton();
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
    if (!activeDialog.value && screen.value === "play")
      readyButton.value?.focus();
  });
}

async function navigateTo(
  next: Screen | "history" | "settings" | "share",
): Promise<void> {
  if (next === "settings" || next === "share") {
    cancelLongPress();
    pauseGame();
    resumeAfterMenu = false;
    menuOpen.value = false;
    toolsDialog.value = next;
    return;
  }
  if (next === "history") {
    cancelLongPress();
    pauseGame();
    resumeAfterMenu = false;
    menuOpen.value = false;
    historyDialogOpen.value = true;
    return;
  }
  if (next === "play" && screen.value === "play" && menuOpen.value) {
    closeMenu();
    return;
  }
  cancelLongPress();
  pauseGame();
  resumeAfterMenu = false;
  screen.value = next;
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

async function loadHistoryOnline(mode: "normal" | "super"): Promise<unknown> {
  const account = historyAccountId.value;
  if (!account || navigator.onLine === false)
    throw new Error("Offline history.");
  const token = await onlineAuth?.getToken.value();
  if (!token || account !== historyAccountId.value)
    throw new Error("History account changed.");
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(
      mode === "super" ? "/api/super/history" : "/api/plays",
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      },
    );
    if (!response.ok || account !== historyAccountId.value)
      throw new Error("History unavailable.");
    return await response.json();
  } finally {
    window.clearTimeout(timeout);
  }
}
function restoreHistorySeed(seedCode: string): void {
  historyDialogOpen.value = false;
  restoreSeed(seedCode);
}

function closeMenu(): void {
  menuOpen.value = false;
  if (resumeAfterMenu && screen.value === "play") confirmReady();
  resumeAfterMenu = false;
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
    if (!claimed) {
      dailyReadyMessage.value =
        "超級を開始・再開できません。保存・ログイン・通信状態を確認してください。";
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
    if (!claimed) {
      dailyReadyMessage.value =
        "開始できません。通信状態を確認して再試行してください。";
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
  if (playerMarksChanged(state.value, next)) registerPlay();
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
  const request = ++nextPuzzleRequest;
  const difficulty = selectedDifficulty.value;
  nextPuzzleLoading.value = true;
  let generated;
  let recommendedId: string | undefined;
  try {
    const accountId = onlineAuth?.userId.value;
    const token = accountId ? await onlineAuth?.getToken.value() : null;
    if (token && accountId === onlineAuth?.userId.value) {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 3000);
      let response: Response;
      try {
        response = await fetch(
          `/api/next-puzzle?difficulty=${encodeURIComponent(difficulty)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
          },
        );
      } finally {
        window.clearTimeout(timeout);
      }
      if (response.ok) {
        const data: { candidates?: unknown } = await response.json();
        if (Array.isArray(data.candidates)) {
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
                  play.status === "completed" &&
                  play.seedCode === candidate.seedCode,
              )
            )
              excluded.add(candidate.puzzleId);
          }
          const chosen = chooseNextPuzzle(candidates, excluded, Math.random);
          if (chosen) {
            const code = parsePuzzleSeedCode(chosen.seedCode);
            if (code?.difficulty === difficulty) {
              const candidate = generatePuzzleWithAnalysis({
                version: code.version,
                seed: code.seed,
                difficulty: code.difficulty,
              });
              if ((await puzzleId(candidate.puzzle)) === chosen.puzzleId) {
                generated = candidate;
                recommendedId = chosen.puzzleId;
              }
            }
          }
        }
      }
    }
  } catch {
    // API が使えなくても、通常のクライアント生成で遊べる。
  }
  if (request !== nextPuzzleRequest) return;
  if (!generated)
    generated = generatePuzzleWithAnalysis({
      seed: `game-${crypto.randomUUID()}`,
      difficulty,
    });
  if (recommendedId) offeredPuzzleIds.add(recommendedId);
  nextPuzzleLoading.value = false;
  activeDailyDate.value = undefined;
  activeDailyAccountId.value = undefined;
  dailyClaimed.value = false;
  dailyReadyMessage.value = "";
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
    : "新しい問題を生成しました。";
  beginPlay();
  void navigateTo("play");
  centerBoardAfterPuzzleChange();
}

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
  selectedDifficulty.value = "hard";
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
  pauseGame();
  clearSharedPuzzleUrl();
  activeDailyDate.value = undefined;
  activeDailyAccountId.value = undefined;
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
  dailyReadyMessage.value = "";
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
  if (resumeAfterMenu && screen.value === "play") void confirmReady();
  resumeAfterMenu = false;
}

function leaveDaily(): void {
  cancelPendingNextPuzzle();
  pauseGame();
  saveCurrentGame();
  activeDailyDate.value = undefined;
  activeDailyAccountId.value = undefined;
  dailyClaimed.value = false;
  dailyReadyMessage.value = "";
  const saved = loadGame();
  if (!saved) {
    newGame();
    return;
  }
  puzzle.value = saved.puzzle;
  state.value = saved.state;
  difficultyAnalysis.value = analyzePuzzleDifficulty(saved.puzzle);
  selectedDifficulty.value = saved.puzzle.difficulty ?? "easy";
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
  const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
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
  restoreSeed(restoreSeedCode.value);
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

function restoreSeed(code: string): boolean {
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

  cancelPendingNextPuzzle();
  clearSharedPuzzleUrl();

  selectedDifficulty.value = parsed.difficulty;
  const generated = generatePuzzleWithAnalysis({
    version: parsed.version,
    seed: parsed.seed,
    difficulty: parsed.difficulty,
  });
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
    restoreSeed(superCode);
    return;
  }
  const id = new URL(window.location.href).searchParams.get("p");
  if (!id) return;
  if (!/^p1:[0-9a-f]{64}$/.test(id)) {
    seedMessage.value = "共有リンクの問題 ID が不正です。";
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
    if (
      saved &&
      hasPlayerMarks(saved.puzzle, saved.state) &&
      !window.confirm(
        "共有された問題を開くと、この端末で進行中の盤面を置き換えます。開きますか？",
      )
    )
      return;
    cancelPendingNextPuzzle();
    puzzle.value = shared;
    difficultyAnalysis.value = analyzePuzzleDifficulty(shared);
    selectedDifficulty.value = shared.difficulty ?? "easy";
    state.value = createInitialPlayerState(undefined, shared.givens);
    hint.value = undefined;
    hintStage.value = 1;
    hintDialogOpen.value = false;
    showClearDialog.value = false;
    clearElapsedSeconds.value = undefined;
    clearDialogMessage.value = "";
    seedMessage.value = "共有された問題を開きました。";
    beginPlay();
    centerBoardAfterPuzzleChange();
  } catch {
    seedMessage.value =
      "共有された問題を開けませんでした。ローカルプレイは続けられます。";
  }
}

function clearSharedPuzzleUrl(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("p") && !url.searchParams.has("s")) return;
  url.searchParams.delete("p");
  url.searchParams.delete("s");
  window.history.replaceState(null, "", url);
}

function resetProgress(): void {
  if (isSpecial.value) return;
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

function cellLabel(index: number): string {
  const { row, col } = cellCoord(index, puzzle.value.size);
  const viewState = getCellViewState(state.value, index);
  return `${row + 1}行${col + 1}列、Region ${puzzle.value.regions[index] + 1}、${viewState}`;
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
      "現在のプロトタイプが対応している定石では、説明できる次の一手を見つけられませんでした。",
      "ヒント回数は増やしていません。",
      "×の付け忘れや、タコからの一括消去・Region-Line消去を見直してください。",
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
  showClearDialog.value = false;
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
  if (resumeAfterMenu && screen.value === "play") void confirmReady();
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
  if (resumeAfterMenu && screen.value === "play") void confirmReady();
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
      "コピーできませんでした。シードを手動で選択してください。";
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
    "is-hint-focus":
      hint.value?.kind === "move" &&
      hintFocusCells(
        puzzle.value,
        hint.value.move,
        hintStage.value,
        contradictionCells.value,
      ).includes(index),
    "is-hint-exclude":
      hint.value?.kind === "move" &&
      hintExcludeCells(hint.value.move, hintStage.value).includes(index),
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

function cellStyles(index: number): Record<string, string> {
  const color = regionColorForCell(
    puzzle.value,
    regionColorIndexes.value,
    index,
  );
  const borders = cellRegionBorders(puzzle.value, index);
  return {
    backgroundColor: color.background,
    color: color.foreground ?? "#2a1b14",
    "--error-color": color.foreground ? "#ff9b9b" : "#d11f1f",
    borderTopWidth: borders.top ? "2px" : "1px",
    borderRightWidth: borders.right ? "2px" : "1px",
    borderBottomWidth: borders.bottom ? "2px" : "1px",
    borderLeftWidth: borders.left ? "2px" : "1px",
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
    <header
      class="hero"
      :inert="(screen === 'play' && waitingToStart) || !!activeDialog"
    >
      <section
        v-show="screen === 'play'"
        class="status-bar"
        aria-label="プレイ状況"
      >
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
                <GameName :name="onlineGameName || 'ゲーム名を設定'" /></button
            ></Show>
          </nav>
          <button
            type="button"
            class="dialog-close"
            aria-label="メニューを閉じる"
            @click="closeMenu"
          >
            閉じる
          </button>
        </div>
        <nav class="screen-menu" aria-label="メニュー">
          <button type="button" @click="navigateTo('history')">
            履歴・成績
          </button>
          <button type="button" @click="showCurrentRanking">
            {{ isDaily ? "今日のランキング" : "この問題のランキング" }}
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
      v-show="screen === 'play'"
      class="play-area"
      :inert="waitingToStart || complete || !!activeDialog"
    >
      <section ref="boardWrap" class="board-wrap">
        <div
          ref="boardElement"
          class="board"
          id="board"
          role="grid"
          :aria-label="`TAKO-SEN ${puzzle.size}×${puzzle.size} board`"
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
            :aria-label="cellLabel(index)"
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
              >×</span
            >
            <span
              v-else-if="state.excluded.has(index)"
              aria-hidden="true"
              class="mark"
              >×</span
            >
          </button>
        </div>
      </section>
    </section>

    <div :class="{ 'play-footer': screen === 'play' }">
      <section
        v-show="screen === 'play'"
        class="actions"
        :inert="waitingToStart || !!activeDialog"
      >
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
          class="icon-button"
          :disabled="nextPuzzleLoading"
          :aria-label="isSpecial ? '通常のプレイに戻る' : '新しい問題'"
          :title="isSpecial ? '通常のプレイに戻る' : '新しい問題'"
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

      <div v-show="screen === 'play'" class="play-options">
        <label
          v-if="!isSpecial"
          class="difficulty-select"
          :inert="waitingToStart || !!activeDialog"
        >
          難易度
          <select v-model="selectedDifficulty" :disabled="nextPuzzleLoading">
            <option value="easy">初級</option>
            <option value="normal">中級</option>
            <option value="hard">上級</option>
          </select>
        </label>
        <SuperChallenge
          v-if="onlineAuthEnabled"
          ref="superChallengeRef"
          :puzzle="puzzle"
          :play-id="playId"
          :complete="complete"
          :game-name="onlineGameName"
          :play-screen="screen === 'play'"
          :history-open="false"
          :modal-blocked="!!activeDialog"
          @start="startSuper"
          @pause="pauseGame"
          @account="accountDialogOpen = true"
          @opened="onSuperOpened"
          @closed="onSuperClosed"
          @synced="rankingRevision += 1"
        />

        <DailyChallenge
          v-if="onlineAuthEnabled && screen === 'play'"
          ref="dailyChallengeRef"
          :inert="!!activeDialog"
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
      <p
        v-if="screen === 'play' && nextPuzzleLoading"
        class="play-footer-message"
        role="status"
      >
        次の問題を選んでいます。
      </p>
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
            閉じる
          </button>
        </div>
        <div class="tools-dialog-body">
          <template v-if="toolsDialog === 'settings'">
            <div class="auto-exclusions-settings">
              <label>
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
              <label class="haptics-toggle">
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
              <label>
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
              <p v-if="seedMessage" class="seed-message" aria-live="polite">
                {{ seedMessage }}
              </p>
            </div>
          </template>
        </div>
      </section>
    </div>

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
      :history-open="false"
      :history-inert="!!activeDialog"
      @close="accountDialogOpen = false"
      @profile="onAccountProfile"
      @setup-required="onAccountSetupRequired"
      @synced="rankingRevision += 1"
    />

    <div
      v-if="hint && activeDialog === 'hint'"
      class="dialog-backdrop"
      role="presentation"
      @click.self="closeHintDialog"
    >
      <section
        ref="hintDialogRef"
        class="dialog-card hint-card"
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
          <button type="button" class="dialog-close" @click="closeHintDialog">
            閉じる
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
            次のヒント
          </button>
          <button
            v-if="hintStage >= 3 && hint.move.excludeCells.length > 0"
            type="button"
            @click="applyHintExclusions"
          >
            ×を適用
          </button>
          <p v-if="hintStage >= 3 && hint.move.placeCell !== undefined">
            強調されたセルを長押しするとタコを確定できます。
          </p>
        </div>
      </section>
    </div>

    <div
      v-if="activeDialog === 'clear'"
      class="dialog-backdrop clear-backdrop"
      role="presentation"
      @click.self="closeClearDialog"
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
        <h2 id="clear-title" class="clear-badge">CLEAR</h2>
        <dl class="result-list">
          <div>
            <dt>
              <UiIcon name="difficulty" /><span class="sr-only">難易度</span>
            </dt>
            <dd :title="actualDifficultyLabel">
              {{ isSuper ? "超級" : isDaily ? "上級" : actualDifficultyLabel }}
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
        <p v-if="clearDialogMessage" class="dialog-message" aria-live="polite">
          {{ clearDialogMessage }}
        </p>
        <div class="dialog-actions clear-actions">
          <select
            v-if="!isSpecial"
            v-model="selectedDifficulty"
            aria-label="次の問題の難易度"
            class="clear-next-difficulty"
            :disabled="nextPuzzleLoading"
          >
            <option value="easy">初級</option>
            <option value="normal">中級</option>
            <option value="hard">上級</option>
          </select>
          <button
            type="button"
            class="icon-button"
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
            type="button"
            class="icon-button"
            aria-label="盤面を見る"
            title="盤面を見る"
            @click="closeClearDialog"
          >
            <UiIcon name="board" />
          </button>
          <button
            v-if="isDaily"
            type="button"
            class="icon-button clear-ranking-button"
            :aria-label="`今日のランキング ${clearRanking}`"
            title="今日のランキング（取得した公開成績内の順位 / 人数）"
            @click="showDailyRankingFromClear"
          >
            <UiIcon name="ranking" />
          </button>
          <button
            v-if="!isDaily"
            type="button"
            class="icon-button clear-ranking-button"
            :aria-label="`この問題のランキング ${clearRanking}`"
            title="この問題のランキング（取得した公開成績内の順位 / 人数）"
            @click="isSuper ? showCurrentRanking() : showLeaderboard()"
          >
            <UiIcon name="ranking" />
          </button>
          <span class="clear-ranking-position" aria-live="polite">{{
            clearRanking
          }}</span>
          <button
            v-if="!isDaily"
            type="button"
            class="icon-button"
            aria-label="シードをシェア"
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
      v-if="screen === 'play' && waitingToStart && !activeDialog"
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
        <button
          ref="readyButton"
          type="button"
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
          通常の問題に戻る
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
      </section>
    </div>
  </main>
</template>
