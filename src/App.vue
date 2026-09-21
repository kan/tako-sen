<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  BOARD_SIZE,
  cellCoord,
  createInitialPlayerState,
  getCellViewState,
  type PuzzleDifficulty,
  type PlayerState,
  type Puzzle,
} from "./core/model";
import { generatePuzzleWithAnalysis } from "./core/generator";
import {
  analyzePuzzleDifficulty,
  type DifficultyRating,
  type PuzzleDifficultyAnalysis,
} from "./core/difficulty";
import { encodePuzzleSeed, parsePuzzleSeedCode } from "./core/puzzle-code";
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
import { loadGame, saveGame } from "./core/storage";
import { hasContradiction } from "./core/solver";
import { canShowHint } from "./ui/hint";
import { pointerReleaseAction } from "./ui/pointer";
import {
  assignRegionColorIndexes,
  cellRegionBorders,
  regionColorForCell,
} from "./ui/region-visuals";

const longPressMs = 520;
const dragStartThresholdPx = 12;
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
const restoreSeedCode = ref("");
const seedMessage = ref("");
type HintPanel =
  | { readonly kind: "move"; readonly move: LogicalMove }
  | {
      readonly kind: "unavailable";
      readonly title: string;
      readonly explanation: readonly string[];
    };

const hint = ref<HintPanel | undefined>();
const pressedCell = ref<number | undefined>();
let longPressTimer: number | undefined;
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

const cells = computed(() =>
  Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, index) => index),
);
const complete = computed(() => isComplete(puzzle.value, state.value));
const contradiction = computed(() =>
  hasContradiction(puzzle.value, state.value),
);
const puzzleSeedCode = computed(() => encodePuzzleSeed(puzzle.value));
const actualDifficultyLabel = computed(() =>
  difficultyLabel(difficultyAnalysis.value.rating),
);
const regionColorIndexes = computed(() =>
  assignRegionColorIndexes(puzzle.value),
);

onMounted(() => {
  const saved = loadGame();
  if (saved) {
    puzzle.value = saved.puzzle;
    state.value = saved.state;
    difficultyAnalysis.value = analyzePuzzleDifficulty(saved.puzzle);
    selectedDifficulty.value = saved.puzzle.difficulty ?? "easy";
  }
});

watch(
  [puzzle, state],
  () => {
    saveGame(puzzle.value, state.value);
  },
  { deep: true },
);

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
  restoreSeedCode.value = "";
  seedMessage.value = "新しい問題を生成しました。";
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
  const parsed = parsePuzzleSeedCode(restoreSeedCode.value);
  if (!parsed) {
    seedMessage.value =
      "シードを復元できません。表示された形式のシードを入力してください。";
    return;
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
  seedMessage.value = "シードから問題を復元しました。";
}

function resetProgress(): void {
  state.value = resetPlayerProgress(
    state.value,
    undefined,
    puzzle.value.givens,
  );
  hint.value = undefined;
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
  state.value = toggleExcluded(state.value, index);
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
    state.value = placePiece(
      puzzle.value,
      state.value,
      activePointer.startCell,
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
  state.value = addExcludedMarks(state.value, [index]);
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
  state.value = addExcludedMarks(
    state.value,
    shortcutExclusionsForCell(puzzle.value, state.value, index),
  );
}

function showHint(): void {
  if (!canShowHint(complete.value)) {
    hint.value = undefined;
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
  };
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
</script>

<template>
  <main class="app-shell">
    <header class="hero">
      <h1>TAKO-SEN</h1>
      <p class="eyebrow">PROTOTYPE</p>
    </header>

    <section class="status-bar" aria-live="polite">
      <span>ミス {{ state.mistakes }}</span>
      <span>ヒント {{ state.hintsUsed }}</span>
      <span v-if="complete" class="clear">CLEAR</span>
      <span v-else-if="contradiction" class="warning">矛盾あり</span>
      <span v-else>進行中</span>
      <span>評価 {{ actualDifficultyLabel }}</span>
    </section>

    <section class="board-wrap">
      <div
        class="board"
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

    <section class="actions">
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
    </section>

    <details class="seed-panel">
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

    <section v-if="hint && canShowHint(complete)" class="hint-card">
      <h2>{{ hint.kind === "move" ? hint.move.title : hint.title }}</h2>
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
  </main>
</template>
