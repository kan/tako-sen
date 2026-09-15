<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  BOARD_SIZE,
  cellCoord,
  createInitialPlayerState,
  getCellViewState,
  type PlayerState,
  type Puzzle,
} from "./core/model";
import { generatePuzzle } from "./core/generator";
import {
  addExcludedMarks,
  countHintUsed,
  placePiece,
  toggleExcluded,
} from "./core/player";
import { isComplete } from "./core/rules";
import { exclusionsFromPiece, regionLineExclusions } from "./core/shortcuts";
import { findLogicalMoves, type LogicalMove } from "./core/logical";
import { loadGame, saveGame } from "./core/storage";
import { hasContradiction } from "./core/solver";

const longPressMs = 520;
const puzzle = ref<Puzzle>(generatePuzzle({ seed: "tako-sen-prototype" }));
const state = ref<PlayerState>(createInitialPlayerState());
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

const cells = computed(() =>
  Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, index) => index),
);
const complete = computed(() => isComplete(puzzle.value, state.value));
const contradiction = computed(() =>
  hasContradiction(puzzle.value, state.value),
);

onMounted(() => {
  const saved = loadGame();
  if (saved) {
    puzzle.value = saved.puzzle;
    state.value = saved.state;
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
  puzzle.value = generatePuzzle({ seed });
  state.value = createInitialPlayerState();
  hint.value = undefined;
}

function cellLabel(index: number): string {
  const { row, col } = cellCoord(index);
  const viewState = getCellViewState(state.value, index);
  return `${row + 1}行${col + 1}列、Region ${puzzle.value.regions[index] + 1}、${viewState}`;
}

function onTap(index: number): void {
  state.value = toggleExcluded(state.value, index);
  hint.value = undefined;
}

function startLongPress(index: number): void {
  pressedCell.value = index;
  longPressTimer = window.setTimeout(() => {
    state.value = placePiece(puzzle.value, state.value, index);
    pressedCell.value = undefined;
    hint.value = undefined;
  }, longPressMs);
}

function cancelLongPress(): void {
  if (longPressTimer !== undefined) window.clearTimeout(longPressTimer);
  pressedCell.value = undefined;
}

function onShortcut(index: number): void {
  if (state.value.pieces.has(index)) {
    state.value = addExcludedMarks(state.value, exclusionsFromPiece(index));
    return;
  }
  const regionId = puzzle.value.regions[index];
  const exclusions = regionLineExclusions(puzzle.value, state.value, regionId);
  state.value = addExcludedMarks(state.value, exclusions);
}

function showHint(): void {
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
    row: move.row,
    col: move.col,
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
      hint.value?.kind === "move" &&
      hint.value.move.focusCells.includes(index),
    "is-hint-exclude":
      hint.value?.kind === "move" &&
      hint.value.move.excludeCells.includes(index),
  };
}
</script>

<template>
  <main class="app-shell">
    <header class="hero">
      <p class="eyebrow">TAKO-SEN prototype</p>
      <h1>観察 → 消去 → 確定</h1>
      <p>
        タップで×、長押しでタコを確定。ダブルタップで発見済みの単純作業だけをまとめて実行します。
      </p>
    </header>

    <section class="status-bar" aria-live="polite">
      <span>ミス {{ state.mistakes }}</span>
      <span>ヒント {{ state.hintsUsed }}</span>
      <span v-if="complete" class="clear">CLEAR</span>
      <span v-else-if="contradiction" class="warning">矛盾あり</span>
      <span v-else>進行中</span>
    </section>

    <section class="board-wrap">
      <div class="board" role="grid" aria-label="TAKO-SEN 8×8 board">
        <button
          v-for="index in cells"
          :key="index"
          class="cell"
          :class="cellClasses(index)"
          :data-region="puzzle.regions[index]"
          :aria-label="cellLabel(index)"
          role="gridcell"
          @click="onTap(index)"
          @dblclick.prevent="onShortcut(index)"
          @pointerdown.prevent="startLongPress(index)"
          @pointerup="cancelLongPress"
          @pointercancel="cancelLongPress"
          @pointerleave="cancelLongPress"
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
      <button type="button" @click="showHint">ヒント</button>
      <button type="button" @click="newGame">新しい問題</button>
    </section>

    <section v-if="hint" class="hint-card">
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
