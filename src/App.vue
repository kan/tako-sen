<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import {
  BOARD_SIZE,
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
  countHintUsed,
  placePiece,
  resetPlayerProgress,
  toggleExcluded,
} from "./core/player";
import { isComplete } from "./core/rules";
import { shortcutExclusionsForCell } from "./core/shortcuts";
import { findLogicalMoves, type LogicalMove } from "./core/logical";
import {
  loadGame,
  loadResultHistory,
  saveGame,
  saveResultHistory,
} from "./core/storage";
import {
  finishPlay,
  hasPlayerMarks,
  playerMarksChanged,
  sameSeedRanking,
  startPlay,
  summarizeUser,
  type ResultHistory,
} from "./core/results";
import { canShowHint } from "./ui/hint";
import { pointerReleaseAction } from "./ui/pointer";
import {
  cellFeedbacksForStateChange,
  strongestHapticFeedback,
  vibrateForFeedback,
  type CellFeedback,
  type FeedbackSource,
} from "./ui/feedback";
import {
  assignRegionColorIndexes,
  cellRegionBorders,
  regionColorForCell,
} from "./ui/region-visuals";

const longPressMs = 520;
const dragStartThresholdPx = 12;
const hapticsStorageKey = "tako-sen:haptics-enabled";
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
const restoreSeedCode = ref("");
const seedMessage = ref("");
const statsMessage = ref("");
const showClearDialog = ref(false);
const clearElapsedSeconds = ref<number | undefined>();
const clearDialogMessage = ref("");
const playId = ref<string>();
const resultHistory = ref<ResultHistory>();
const showStats = ref(false);
const hapticsEnabled = ref(true);
type HintPanel =
  | { readonly kind: "move"; readonly move: LogicalMove }
  | {
      readonly kind: "unavailable";
      readonly title: string;
      readonly explanation: readonly string[];
    };

const hint = ref<HintPanel | undefined>();
const hintDialogOpen = ref(false);
const hintDialogRef = ref<HTMLElement>();
const clearDialogRef = ref<HTMLElement>();
let focusBeforeDialog: HTMLElement | null = null;
const pressedCell = ref<number | undefined>();
const cellFeedbacks = ref<Record<number, CellFeedback & { token: number }>>({});
let longPressTimer: number | undefined;
let feedbackToken = 0;
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
    }
  | undefined;
let suppressNextClick = false;
let suppressClickUntil = 0;
let clockTimer: number | undefined;

const cells = computed(() =>
  Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, index) => index),
);
const complete = computed(() => isComplete(puzzle.value, state.value));
const activeDialog = computed<"hint" | "clear" | undefined>(() => {
  if (complete.value && showClearDialog.value) return "clear";
  if (hint.value && hintDialogOpen.value && canShowHint(complete.value))
    return "hint";
  return undefined;
});
const puzzleSeedCode = computed(() => encodePuzzleSeed(puzzle.value));
const actualDifficultyLabel = computed(() =>
  difficultyLabel(difficultyAnalysis.value.rating),
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
const currentRanking = computed(() =>
  resultHistory.value
    ? sameSeedRanking(resultHistory.value, puzzleSeedCode.value)
    : [],
);
const currentRank = computed(
  () =>
    currentRanking.value.findIndex((result) => result.id === playId.value) + 1,
);
const userSummary = computed(() =>
  resultHistory.value ? summarizeUser(resultHistory.value) : undefined,
);

onMounted(() => {
  clockTimer = window.setInterval(() => {
    currentTime.value = Date.now();
    if (timer.value.status === "running") saveCurrentGame();
  }, 1000);
  window.addEventListener("pagehide", saveCurrentGame);
  hapticsEnabled.value = loadHapticsEnabled();
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
    registerPlay();
  }
  const completedResult = resultHistory.value.plays.find(
    (play) => play.id === playId.value && play.status === "completed",
  );
  if (completedResult)
    clearElapsedSeconds.value = completedResult.elapsedSeconds;
  else if (complete.value) finalizePlay();
  if (waitingToStart.value) focusReadyButton();
  saveCurrentGame();
});

onUnmounted(() => {
  if (clockTimer !== undefined) window.clearInterval(clockTimer);
  window.removeEventListener("pagehide", saveCurrentGame);
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
    (dialog === "hint" ? hintDialogRef.value : clearDialogRef.value)?.focus();
  } else if (previous) {
    if (focusBeforeDialog?.isConnected) focusBeforeDialog.focus();
    focusBeforeDialog = null;
  }
});
watch(hapticsEnabled, (enabled) => {
  localStorage.setItem(hapticsStorageKey, enabled ? "1" : "0");
});

function saveCurrentGame(): void {
  if (!playId.value) return;
  saveGame(puzzle.value, state.value, localStorage, playId.value, {
    waitingToStart: waitingToStart.value,
    elapsedMs: elapsedTimerMs(timer.value, Date.now()),
    hasStarted: timer.value.hasStarted,
  });
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
  playId.value = crypto.randomUUID();
  timer.value = createWaitingTimer();
  saveCurrentGame();
  focusReadyButton();
}

function focusReadyButton(): void {
  void nextTick(() => readyButton.value?.focus());
}

function confirmReady(): void {
  if (!waitingToStart.value) return;
  const startedAt = Date.now();
  if (!timer.value.hasStarted) state.value = { ...state.value, startedAt };
  timer.value = resumeTimer(timer.value, startedAt);
  currentTime.value = startedAt;
  saveCurrentGame();
}

function pauseGame(): void {
  if (complete.value || timer.value.status !== "running") return;
  const now = Date.now();
  timer.value = pauseTimer(timer.value, now);
  currentTime.value = now;
  saveCurrentGame();
  focusReadyButton();
}

function registerPlay(): void {
  if (!resultHistory.value || !playId.value) return;
  if (resultHistory.value.plays.some((play) => play.id === playId.value))
    return;
  resultHistory.value = startPlay(resultHistory.value, {
    id: playId.value,
    seedCode: puzzleSeedCode.value,
    generatorVersion: puzzle.value.generatorVersion ?? GENERATOR_VERSION,
    difficulty: puzzle.value.difficulty ?? "easy",
    startedAt: state.value.startedAt,
  });
  saveResultHistory(resultHistory.value);
}

function commitPlayerState(next: PlayerState): void {
  if (playerMarksChanged(state.value, next)) registerPlay();
  state.value = next;
}

function commitPlayerStateWithFeedback(
  next: PlayerState,
  source: FeedbackSource,
): void {
  const feedbacks = cellFeedbacksForStateChange(state.value, next, source);
  commitPlayerState(next);
  triggerCellFeedbacks(feedbacks);
  const haptic = strongestHapticFeedback(feedbacks);
  if (haptic) vibrateForFeedback(navigator, haptic, hapticsEnabled.value);
}

function finalizePlay(): void {
  if (!resultHistory.value || !playId.value) return;
  const completedAt = Date.now();
  const clearSeconds = Math.floor(
    elapsedTimerMs(timer.value, completedAt) / 1000,
  );
  timer.value = finishTimer(timer.value, completedAt);
  currentTime.value = completedAt;
  const updated = finishPlay(
    resultHistory.value,
    playId.value,
    completedAt,
    state.value.mistakes,
    state.value.hintsUsed,
    clearSeconds,
  );
  if (updated === resultHistory.value) return;
  resultHistory.value = updated;
  saveResultHistory(updated);
  clearElapsedSeconds.value = updated.plays.find(
    (play) => play.id === playId.value,
  )?.elapsedSeconds;
  saveCurrentGame();
}

function newGame(): void {
  const seed = `game-${Date.now()}`;
  const generated = generatePuzzleWithAnalysis({
    seed,
    difficulty: selectedDifficulty.value,
  });
  puzzle.value = generated.puzzle;
  difficultyAnalysis.value = generated.analysis;
  state.value = createInitialPlayerState(undefined, puzzle.value.givens);
  hint.value = undefined;
  hintDialogOpen.value = false;
  showClearDialog.value = false;
  clearElapsedSeconds.value = undefined;
  clearDialogMessage.value = "";
  restoreSeedCode.value = "";
  seedMessage.value = "新しい問題を生成しました。";
  statsMessage.value = "";
  beginPlay();
}

async function copySeed(): Promise<void> {
  try {
    await navigator.clipboard.writeText(puzzleSeedCode.value);
    seedMessage.value = "シードをコピーしました。";
  } catch {
    seedMessage.value =
      "コピーできませんでした。シードを手動で選択してください。";
  }
}

function restoreFromSeed(): void {
  statsMessage.value = "";
  restoreSeed(restoreSeedCode.value);
}

function restoreRecentSeed(code: string, event: MouseEvent): void {
  if (!restoreSeed(code)) {
    event.preventDefault();
    statsMessage.value = seedMessage.value;
    return;
  }
  statsMessage.value = "シードから問題を復元しました。";
}

function restoreSeed(code: string): boolean {
  const parsed = parsePuzzleSeedCode(code);
  if (!parsed) {
    seedMessage.value =
      "シードを復元できません。表示された形式のシードを入力してください。";
    return false;
  }

  selectedDifficulty.value = parsed.difficulty;
  const generated = generatePuzzleWithAnalysis({
    seed: parsed.seed,
    difficulty: parsed.difficulty,
  });
  puzzle.value = generated.puzzle;
  difficultyAnalysis.value = generated.analysis;
  state.value = createInitialPlayerState(undefined, puzzle.value.givens);
  hint.value = undefined;
  hintDialogOpen.value = false;
  showClearDialog.value = false;
  clearElapsedSeconds.value = undefined;
  clearDialogMessage.value = "";
  seedMessage.value = "シードから問題を復元しました。";
  beginPlay();
  return true;
}

function resetProgress(): void {
  state.value = resetPlayerProgress(
    state.value,
    undefined,
    puzzle.value.givens,
  );
  hint.value = undefined;
  hintDialogOpen.value = false;
  showClearDialog.value = false;
  clearElapsedSeconds.value = undefined;
  clearDialogMessage.value = "";
  statsMessage.value = "";
  beginPlay();
}

function cellLabel(index: number): string {
  const { row, col } = cellCoord(index);
  const viewState = getCellViewState(state.value, index);
  return `${row + 1}行${col + 1}列、Region ${puzzle.value.regions[index] + 1}、${viewState}`;
}

function onTap(index: number): void {
  if (suppressNextClick || Date.now() < suppressClickUntil) {
    suppressNextClick = false;
    return;
  }
  commitPlayerStateWithFeedback(toggleExcluded(state.value, index), "tap");
  hint.value = undefined;
}

function startPointerPress(index: number, event: PointerEvent): void {
  if (!event.isPrimary) return;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  activePointer = {
    pointerId: event.pointerId,
    startCell: index,
    startX: event.clientX,
    startY: event.clientY,
    startedAt: Date.now(),
    dragging: false,
    longPressReady: false,
    longPressCanceled: false,
  };
  startLongPress(index);
}

function startLongPress(index: number): void {
  cancelLongPressTimer();
  longPressTimer = window.setTimeout(() => {
    if (activePointer && activePointer.startCell === index) {
      activePointer.longPressReady = true;
      pressedCell.value = index;
    }
    longPressTimer = undefined;
  }, longPressMs);
}

function onBoardPointerMove(event: PointerEvent): void {
  if (!activePointer || activePointer.pointerId !== event.pointerId) return;
  if (activePointer.longPressReady) {
    if (cellIndexFromPointer(event) !== activePointer.startCell) {
      activePointer.longPressCanceled = true;
      pressedCell.value = undefined;
    }
    return;
  }

  const dx = event.clientX - activePointer.startX;
  const dy = event.clientY - activePointer.startY;
  const movedEnough = Math.hypot(dx, dy) >= dragStartThresholdPx;
  if (!activePointer.dragging && movedEnough) {
    activePointer.dragging = true;
    cancelLongPressTimer();
    addDraggedExcludedMark(activePointer.startCell);
  }

  if (activePointer.dragging) {
    const cell = cellIndexFromPointer(event);
    if (cell !== undefined) addDraggedExcludedMark(cell);
  }
}

function endPointerPress(event: PointerEvent): void {
  if (!activePointer || activePointer.pointerId !== event.pointerId) return;

  const action = pointerReleaseAction({
    elapsedMs: Date.now() - activePointer.startedAt,
    longPressMs,
    dragging: activePointer.dragging,
    longPressReady: activePointer.longPressReady,
    longPressCanceled: activePointer.longPressCanceled,
  });

  if (action === "place-piece") {
    commitPlayerStateWithFeedback(
      placePiece(puzzle.value, state.value, activePointer.startCell),
      "piece",
    );
    hint.value = undefined;
    suppressUpcomingClick();
  } else if (action === "suppress-click") {
    suppressUpcomingClick();
  }
  cancelLongPress();
}

function cancelLongPress(): void {
  cancelLongPressTimer();
  activePointer = undefined;
  pressedCell.value = undefined;
}

function cancelLongPressTimer(): void {
  if (longPressTimer !== undefined) window.clearTimeout(longPressTimer);
  longPressTimer = undefined;
}

function suppressUpcomingClick(): void {
  suppressNextClick = true;
  suppressClickUntil = Date.now() + 700;
  window.setTimeout(() => {
    suppressNextClick = false;
  }, 700);
}

function addDraggedExcludedMark(index: number): void {
  const previousExcludedCount = state.value.excluded.size;
  commitPlayerStateWithFeedback(addExcludedMarks(state.value, [index]), "drag");
  if (state.value.excluded.size !== previousExcludedCount)
    hint.value = undefined;
}

function cellIndexFromPointer(event: PointerEvent): number | undefined {
  const element = document.elementFromPoint(event.clientX, event.clientY);
  const cellElement = element?.closest<HTMLElement>("[data-cell-index]");
  const indexText = cellElement?.dataset.cellIndex;
  if (indexText === undefined) return undefined;
  const index = Number(indexText);
  return Number.isInteger(index) ? index : undefined;
}

function onBoardPointerLeave(event: PointerEvent): void {
  if (!activePointer || activePointer.pointerId !== event.pointerId) return;
  if (activePointer.longPressReady) {
    activePointer.longPressCanceled = true;
    pressedCell.value = undefined;
    return;
  }
  if (!activePointer.dragging) {
    cancelLongPress();
  }
}

function onShortcut(index: number): void {
  commitPlayerStateWithFeedback(
    addExcludedMarks(
      state.value,
      shortcutExclusionsForCell(puzzle.value, state.value, index),
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
    }
    hint.value = { kind: "move", move: nextHint };
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

function closeClearDialog(): void {
  showClearDialog.value = false;
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
  const buttons = [
    ...dialog.querySelectorAll<HTMLButtonElement>("button:not([disabled])"),
  ];
  if (buttons.length === 0) {
    event.preventDefault();
    return;
  }
  const first = buttons[0];
  const last = buttons[buttons.length - 1];
  if (
    event.shiftKey &&
    (document.activeElement === first || document.activeElement === dialog)
  ) {
    event.preventDefault();
    last.focus();
  } else if (
    !event.shiftKey &&
    (document.activeElement === last || document.activeElement === dialog)
  ) {
    event.preventDefault();
    first.focus();
  }
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
    "is-hint-focus":
      hint.value?.kind === "move" && hint.value.move.focusCells.includes(index),
    "is-hint-exclude":
      hint.value?.kind === "move" &&
      hint.value.move.excludeCells.includes(index),
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
  <main class="app-shell">
    <header class="hero" :inert="waitingToStart || !!activeDialog">
      <h1>TAKO-SEN</h1>
      <p class="eyebrow">PROTOTYPE</p>
    </header>

    <section class="play-area" :inert="waitingToStart || !!activeDialog">
      <section class="status-bar" aria-live="polite">
        <span>ミス {{ state.mistakes }}</span>
        <span>ヒント {{ state.hintsUsed }}</span>
        <span class="time-status">
          時間 {{ formatElapsed(displayedElapsedSeconds) }}
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
        <span v-if="complete" class="clear">CLEAR</span>
        <span v-else>進行中</span>
        <span>評価 {{ actualDifficultyLabel }}</span>
      </section>

      <section class="board-wrap">
        <div
          class="board"
          id="board"
          role="grid"
          aria-label="TAKO-SEN 8×8 board"
          @pointermove.prevent="onBoardPointerMove"
          @pointerup="endPointerPress"
          @pointercancel="cancelLongPress"
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
            @click="onTap(index)"
            @dblclick.prevent="onShortcut(index)"
            @pointerdown.prevent="startPointerPress(index, $event)"
          >
            <span v-if="state.pieces.has(index)" aria-hidden="true" class="tako"
              >🐙</span
            >
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

    <section class="actions" :inert="waitingToStart || !!activeDialog">
      <label class="difficulty-select">
        難易度
        <select v-model="selectedDifficulty">
          <option value="easy">初級</option>
          <option value="normal">中級</option>
          <option value="hard">上級</option>
        </select>
      </label>
      <button v-if="canShowHint(complete)" type="button" @click="showHint">
        ヒント
      </button>
      <button type="button" @click="resetProgress">リセット</button>
      <button type="button" @click="newGame">新しい問題</button>
      <label class="haptics-toggle">
        <input v-model="hapticsEnabled" type="checkbox" />
        振動
      </label>
    </section>

    <details class="seed-panel" :inert="waitingToStart || !!activeDialog">
      <summary>シード表示・復元</summary>
      <div class="seed-panel-body" aria-label="シード">
        <div>
          <span class="seed-label">現在のシード</span>
          <code>{{ puzzleSeedCode }}</code>
        </div>
        <button type="button" @click="copySeed">コピー</button>
        <label>
          シード復元
          <input
            v-model="restoreSeedCode"
            type="text"
            inputmode="text"
            autocomplete="off"
            placeholder="TAKO:g1:easy:..."
          />
        </label>
        <button type="button" @click="restoreFromSeed">復元</button>
        <p v-if="seedMessage" class="seed-message" aria-live="polite">
          {{ seedMessage }}
        </p>
      </div>
    </details>

    <details
      class="stats-panel"
      :inert="waitingToStart || !!activeDialog"
      @toggle="showStats = ($event.target as HTMLDetailsElement).open"
    >
      <summary>ローカル成績</summary>
      <div v-if="showStats && userSummary" class="stats-panel-body">
        <p>
          総プレイ {{ userSummary.plays }} 回 · クリア
          {{ userSummary.clears }} 回 · 自己ベスト更新
          {{ userSummary.personalBests }} 回
        </p>
        <h2>このシードの記録</h2>
        <ol v-if="currentRanking.length" class="ranking-list">
          <li v-for="result in currentRanking.slice(0, 10)" :key="result.id">
            {{ formatElapsed(result.elapsedSeconds ?? 0) }} · ヒント
            {{ result.hintsUsed }} · ミス {{ result.mistakes }}
            <span v-if="result.id === playId">（今回）</span>
          </li>
        </ol>
        <p v-else>このシードのクリア記録はまだありません。</p>
        <h2>難易度別集計</h2>
        <ul class="stats-list">
          <li
            v-for="summary in userSummary.byDifficulty"
            :key="summary.difficulty"
          >
            <strong>{{ difficultyLabel(summary.difficulty) }}</strong
            >：{{ summary.plays }} 回中 {{ summary.clears }} 回クリア
            <span v-if="summary.averageSeconds !== undefined">
              · 平均 {{ formatElapsed(Math.round(summary.averageSeconds)) }} ·
              ミス {{ summary.averageMistakes?.toFixed(1) }} · ヒント
              {{ summary.averageHints?.toFixed(1) }}</span
            >
          </li>
        </ul>
        <h2>最近のシード</h2>
        <ul class="stats-list">
          <li v-for="seed in userSummary.recentSeeds" :key="seed">
            <a
              class="recent-seed-link"
              href="#board"
              @click="restoreRecentSeed(seed, $event)"
              ><code>{{ seed }}</code></a
            >
          </li>
        </ul>
        <p v-if="statsMessage" class="seed-message" aria-live="polite">
          {{ statsMessage }}
        </p>
      </div>
    </details>

    <div
      v-if="hint && hintDialogOpen && canShowHint(complete)"
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
            {{ hint.kind === "move" ? hint.move.title : hint.title }}
          </h2>
          <button type="button" class="dialog-close" @click="closeHintDialog">
            閉じる
          </button>
        </div>
        <ol>
          <li
            v-for="line in hint.kind === 'move'
              ? hint.move.explanation
              : hint.explanation"
            :key="line"
          >
            {{ line }}
          </li>
        </ol>
      </section>
    </div>

    <div
      v-if="complete && showClearDialog"
      class="dialog-backdrop clear-backdrop"
      role="presentation"
      @click.self="closeClearDialog"
    >
      <section
        ref="clearDialogRef"
        class="dialog-card clear-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="clear-title"
        tabindex="-1"
        @keydown="onDialogKeydown"
      >
        <p class="clear-badge">CLEAR</p>
        <h2 id="clear-title">クリアしました！</h2>
        <dl class="result-list">
          <div>
            <dt>難易度</dt>
            <dd>{{ actualDifficultyLabel }}</dd>
          </div>
          <div>
            <dt>時間</dt>
            <dd>{{ formatElapsed(displayedElapsedSeconds) }}</dd>
          </div>
          <div>
            <dt>ミス</dt>
            <dd>{{ state.mistakes }}</dd>
          </div>
          <div>
            <dt>ヒント</dt>
            <dd>{{ state.hintsUsed }}</dd>
          </div>
          <div>
            <dt>シード</dt>
            <dd class="result-seed-row">
              <span class="result-seed">{{ puzzleSeedCode }}</span>
              <button type="button" class="inline-copy" @click="copyResultSeed">
                コピー
              </button>
            </dd>
          </div>
        </dl>
        <p v-if="clearDialogMessage" class="dialog-message" aria-live="polite">
          {{ clearDialogMessage }}
        </p>
        <p v-if="currentRank > 0">
          このシードのローカル順位：{{ currentRank }} 位 /
          {{ currentRanking.length }} 回
        </p>
        <div class="dialog-actions">
          <button type="button" @click="newGame">次の問題へ</button>
          <button type="button" @click="resetProgress">もう一度</button>
          <button type="button" @click="closeClearDialog">盤面を見る</button>
        </div>
      </section>
    </div>
    <div v-if="waitingToStart" class="ready-overlay" role="presentation">
      <section
        class="ready-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ready-title"
      >
        <h2 id="ready-title">READY?</h2>
        <button ref="readyButton" type="button" @click="confirmReady">
          OK
        </button>
      </section>
    </div>
  </main>
</template>
