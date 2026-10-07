<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import { Show, SignInButton } from "@clerk/vue";
import { tutorialLesson } from "./tutorial-lesson";
import {
  cellCoord,
  createInitialPlayerState,
  getCellViewState,
} from "../core/model";
import {
  addExcludedMarks,
  countHintUsed,
  placePieceWithAutoExclusions,
  recordHintStage,
  removeExcludedMarks,
  toggleExcluded,
} from "../core/player";
import { findLogicalMoves, type LogicalMove } from "../core/logical";
import { isComplete } from "../core/rules";
import { shortcutExclusionsForCell } from "../core/shortcuts";
import {
  assignRegionColorIndexes,
  cellRegionBorders,
  regionColorForCell,
} from "./region-visuals";
import {
  cellIndexAtPoint,
  DOUBLE_TAP_MS,
  LONG_PRESS_MS,
  pointerReleaseAction,
} from "./pointer";
import { trapDialogFocus } from "./dialog";
import {
  hintExcludeCells,
  hintFocusCells,
  hintStageCount,
  hintStageLines,
} from "./hint";

type Phase =
  | "intro"
  | "place"
  | "shortcut"
  | "auto"
  | "drag"
  | "reason"
  | "hint"
  | "free"
  | "complete";

const props = defineProps<{
  open: boolean;
  firstVisit: boolean;
  onlineEnabled: boolean;
  autoExclusionsEnabled: boolean;
}>();
const emit = defineEmits<{
  close: [];
  autoExclusionsChange: [enabled: boolean];
}>();
const lesson = tutorialLesson;
const puzzle = lesson.puzzle;
const colorIndexes = assignRegionColorIndexes(puzzle);
const cells = Array.from({ length: puzzle.size * puzzle.size }, (_, i) => i);
const state = ref(createInitialPlayerState(0, puzzle.givens));
const phase = ref<Phase>("intro");
const message = ref("");
const shownHint = ref<LogicalMove>();
const shownHintKey = ref("");
const shownHintStage = ref(0);
const dialog = ref<HTMLElement>();
const board = ref<HTMLElement>();
const holdingCell = ref<number>();
const readyCell = ref<number>();
const selectedAutoExclusions = ref(false);
let holdTimer: number | undefined;
let lastTap: { index: number; at: number } | undefined;
let pointer:
  | {
      id: number;
      start: number;
      x: number;
      y: number;
      at: number;
      dragging: boolean;
      ready: boolean;
      canceled: boolean;
      dragAction: "add" | "remove";
    }
  | undefined;

const stageNumbers: Partial<Record<Phase, number>> = {
  place: 1,
  shortcut: 2,
  auto: 3,
  drag: 4,
  reason: 5,
  hint: 6,
  free: 7,
};
const stageNumber = computed(() => stageNumbers[phase.value]);
const titles: Record<Phase, string> = {
  intro: "チュートリアルを見ますか？",
  place: "長押しでタコを置こう",
  shortcut: "ダブルタップで×を追加",
  auto: "自動の×を選ぼう",
  drag: "指を滑らせて×を付けよう",
  reason: "置けない理由を考えよう",
  hint: "ヒントを試そう",
  free: "ここからは自由に解こう",
  complete: "チュートリアル完了！",
};
const title = computed(() => titles[phase.value]);
const dragInstruction = `${lesson.dragReason.explanation[0]} 赤枠のマスには置けないので、指を滑らせて×を付けましょう。`;
const hintButtonLabel = computed(() =>
  shownHint.value && shownHintStage.value < hintStageCount(shownHint.value)
    ? "次のヒント"
    : "ヒントを見る",
);

watch(
  () => props.open,
  async (open) => {
    cancelPointer();
    if (!open) return;
    state.value = createInitialPlayerState(0, puzzle.givens);
    phase.value = props.firstVisit ? "intro" : "place";
    selectedAutoExclusions.value = props.autoExclusionsEnabled;
    message.value = "";
    shownHint.value = undefined;
    shownHintKey.value = "";
    shownHintStage.value = 0;
    await nextTick();
    dialog.value?.focus();
  },
  { immediate: true },
);

watch(phase, async () => {
  await nextTick();
  if (dialog.value) dialog.value.scrollTop = 0;
  dialog.value?.focus();
});
onUnmounted(() => cancelPointer());

function cellStyle(index: number): Record<string, string> {
  const color = regionColorForCell(puzzle, colorIndexes, index);
  const border = cellRegionBorders(puzzle, index);
  return {
    backgroundColor: color.background,
    color: color.foreground ?? "#2a1b14",
    "--error-color": color.foreground ? "#ff9b9b" : "#d11f1f",
    borderTopWidth: border.top ? "2px" : "1px",
    borderRightWidth: border.right ? "2px" : "1px",
    borderBottomWidth: border.bottom ? "2px" : "1px",
    borderLeftWidth: border.left ? "2px" : "1px",
  };
}

function emphasized(index: number): boolean {
  if (phase.value === "place" || phase.value === "shortcut")
    return index === lesson.firstPiece;
  if (phase.value === "drag") return lesson.dragTargets.includes(index);
  if (phase.value === "reason") return index === lesson.reasoningTarget;
  return false;
}

function cellLabel(index: number): string {
  const { row, col } = cellCoord(index, puzzle.size);
  return `${row + 1}行${col + 1}列、Region ${puzzle.regions[index] + 1}、${getCellViewState(state.value, index)}`;
}

function startLesson(): void {
  phase.value = "place";
}

function chooseAuto(enabled: boolean): void {
  selectedAutoExclusions.value = enabled;
  emit("autoExclusionsChange", enabled);
  phase.value = "drag";
}

function place(index: number): void {
  if (phase.value === "place" && index !== lesson.firstPiece) return;
  if (phase.value !== "place" && phase.value !== "free") return;
  const previous = state.value;
  const next = placePieceWithAutoExclusions(
    puzzle,
    previous,
    index,
    phase.value === "free" && selectedAutoExclusions.value,
  );
  state.value = next;
  if (next !== previous) clearHint();
  if (phase.value === "place" && next.pieces.has(lesson.firstPiece))
    phase.value = "shortcut";
  else if (phase.value === "free" && isComplete(puzzle, next))
    phase.value = "complete";
}

function shortcut(index: number): void {
  clearHint();
  state.value = addExcludedMarks(
    state.value,
    shortcutExclusionsForCell(puzzle, state.value, index),
    puzzle.size,
  );
  if (phase.value === "shortcut" && index === lesson.firstPiece)
    phase.value = "auto";
}

function tap(index: number, keyboard = false): void {
  if (phase.value === "place") {
    if (keyboard) place(index);
    return;
  }
  if (phase.value === "shortcut") {
    if (index !== lesson.firstPiece) return;
    if (keyboard) shortcut(index);
    else {
      const now = Date.now();
      if (lastTap?.index === index && now - lastTap.at < DOUBLE_TAP_MS) {
        shortcut(index);
        lastTap = undefined;
      } else lastTap = { index, at: now };
    }
    return;
  }
  if (phase.value === "drag") {
    if (lesson.dragTargets.includes(index)) {
      state.value = addExcludedMarks(state.value, [index], puzzle.size);
      if (
        lesson.dragTargets.every((target) => state.value.excluded.has(target))
      )
        phase.value = "reason";
    }
    return;
  }
  if (phase.value === "reason") {
    if (index !== lesson.reasoningTarget) return;
    state.value = addExcludedMarks(state.value, [index], puzzle.size);
    phase.value = "hint";
    return;
  }
  if (phase.value !== "free") return;
  const now = Date.now();
  if (
    state.value.pieces.has(index) &&
    (keyboard || (lastTap?.index === index && now - lastTap.at < DOUBLE_TAP_MS))
  ) {
    shortcut(index);
    lastTap = undefined;
  } else {
    const next = toggleExcluded(state.value, index, puzzle.size);
    if (next !== state.value) clearHint();
    state.value = next;
    lastTap = { index, at: now };
  }
}

function showHint(): void {
  if (phase.value !== "hint" && phase.value !== "free") return;
  const move = findLogicalMoves(puzzle, state.value)[0];
  if (!move) {
    message.value =
      "今は対応済みの定石から次のヒントを見つけられませんでした。";
    return;
  }
  const key = JSON.stringify(move);
  if (shownHintKey.value !== key) {
    state.value = countHintUsed(state.value);
    shownHintStage.value = 1;
  } else {
    shownHintStage.value = Math.min(
      shownHintStage.value + 1,
      hintStageCount(move),
    );
  }
  shownHint.value = move;
  shownHintKey.value = key;
  state.value = recordHintStage(state.value, shownHintStage.value);
  message.value = `${move.title}：${hintStageLines(move, shownHintStage.value).join(" ")}`;
  if (phase.value === "hint") phase.value = "free";
}

function clearHint(): void {
  shownHint.value = undefined;
  shownHintKey.value = "";
  shownHintStage.value = 0;
  message.value = "";
}

function pointerCell(event: PointerEvent): number | undefined {
  if (!board.value) return undefined;
  const bounds = board.value.getBoundingClientRect();
  return cellIndexAtPoint(
    event.clientX,
    event.clientY,
    {
      left: bounds.left + board.value.clientLeft,
      top: bounds.top + board.value.clientTop,
      width: bounds.width - 2 * board.value.clientLeft,
      height: bounds.height - 2 * board.value.clientTop,
    },
    puzzle.size,
  );
}

function startPointer(event: PointerEvent): void {
  if (
    !event.isPrimary ||
    event.button !== 0 ||
    pointer ||
    phase.value === "auto" ||
    phase.value === "hint"
  )
    return;
  const index = pointerCell(event);
  if (index === undefined) return;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  pointer = {
    id: event.pointerId,
    start: index,
    x: event.clientX,
    y: event.clientY,
    at: Date.now(),
    dragging: false,
    ready: false,
    canceled: false,
    dragAction: state.value.excluded.has(index) ? "remove" : "add",
  };
  if (phase.value === "place" || phase.value === "free") {
    if (!state.value.excluded.has(index)) {
      holdingCell.value = index;
      holdTimer = window.setTimeout(() => {
        if (pointer?.start === index && !pointer.dragging) {
          pointer.ready = true;
          readyCell.value = index;
          holdingCell.value = undefined;
        }
      }, LONG_PRESS_MS);
    }
  }
}

function dragMark(index: number): void {
  if (!pointer) return;
  if (phase.value === "drag" && !lesson.dragTargets.includes(index)) return;
  if (phase.value !== "drag" && phase.value !== "free") return;
  if (phase.value === "free") clearHint();
  state.value =
    pointer.dragAction === "remove" && phase.value === "free"
      ? removeExcludedMarks(state.value, [index], puzzle.size)
      : addExcludedMarks(state.value, [index], puzzle.size);
}

function movePointer(event: PointerEvent): void {
  if (!pointer || pointer.id !== event.pointerId) return;
  const index = pointerCell(event);
  if (index === undefined && !pointer.dragging) {
    cancelPointer();
    return;
  }
  if (
    !pointer.dragging &&
    Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) >= 12
  ) {
    pointer.dragging = true;
    pointer.ready = false;
    clearHoldTimer();
    holdingCell.value = undefined;
    readyCell.value = undefined;
    dragMark(pointer.start);
  }
  if (pointer.dragging && index !== undefined) dragMark(index);
}

function endPointer(event: PointerEvent): void {
  if (!pointer || pointer.id !== event.pointerId) return;
  const index = pointerCell(event);
  const action = pointerReleaseAction({
    elapsedMs: Date.now() - pointer.at,
    longPressMs: LONG_PRESS_MS,
    dragging: pointer.dragging,
    longPressReady: pointer.ready,
    longPressCanceled: pointer.canceled || index !== pointer.start,
    pieceDisabled: state.value.excluded.has(pointer.start),
  });
  const start = pointer.start;
  const dragged = pointer.dragging;
  cancelPointer(false);
  if (action === "place-piece") place(start);
  else if (action === "tap") tap(start);
  else if (
    dragged &&
    phase.value === "drag" &&
    lesson.dragTargets.every((target) => state.value.excluded.has(target))
  )
    phase.value = "reason";
}

function clearHoldTimer(): void {
  if (holdTimer !== undefined) window.clearTimeout(holdTimer);
  holdTimer = undefined;
}

function cancelPointer(clearTap = true): void {
  clearHoldTimer();
  pointer = undefined;
  holdingCell.value = undefined;
  readyCell.value = undefined;
  if (clearTap) lastTap = undefined;
}

function pointerCanceled(event: PointerEvent): void {
  if (pointer?.id === event.pointerId) cancelPointer();
}

function pointerLeft(event: PointerEvent): void {
  if (pointer?.id === event.pointerId && !pointer.dragging) cancelPointer();
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
  } else trapDialogFocus(event, dialog.value);
}
</script>

<template>
  <div
    v-if="open"
    class="dialog-backdrop tutorial-backdrop"
    @click.self="emit('close')"
  >
    <section
      ref="dialog"
      class="dialog-card interactive-tutorial-card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tutorial-title"
      tabindex="-1"
      @keydown="onKeydown"
    >
      <div class="dialog-header">
        <h2 id="tutorial-title">{{ title }}</h2>
        <button
          type="button"
          class="dialog-close"
          aria-label="遊び方を閉じる"
          @click="emit('close')"
        >
          ×
        </button>
      </div>
      <p v-if="stageNumber" class="tutorial-progress">
        練習 {{ stageNumber }} / 7
      </p>
      <template v-if="phase === 'intro'">
        <p>
          実際の盤面で操作を練習しながら、ルールを覚えられます。通常のプレイ記録や時間には影響しません。
        </p>
        <div class="dialog-actions">
          <button type="button" @click="startLesson">はい、練習する</button>
          <button type="button" @click="emit('close')">いいえ、すぐ遊ぶ</button>
        </div>
      </template>
      <template v-else-if="phase === 'complete'">
        <p>
          8匹のタコを置けました！各行・列・エリアに1匹ずつ、タコ同士は隣接できません。
        </p>
        <p>
          ログインしてゲーム名と公開ルールに同意すると、これからのクリアが同期され、初回スコアがランキングに載ります。
        </p>
        <div v-if="onlineEnabled" class="dialog-actions">
          <Show when="signed-out"
            ><SignInButton
              ><button type="button" @click="emit('close')">
                ログインして参加
              </button></SignInButton
            ></Show
          >
        </div>
        <p>後からメニューの「遊び方」で何度でも練習できます。</p>
        <div class="dialog-actions">
          <button type="button" @click="emit('close')">通常プレイへ</button>
        </div>
      </template>
      <template v-else>
        <p v-if="phase === 'place'">
          青く点滅する枠はタコが必ず入る1マスのエリアです。ここを長押しし、枠が太くなったら離してタコを置きましょう。
        </p>
        <p v-if="phase === 'place'">
          タコは各行・各列・各エリアに1匹ずつ置き、縦・横・斜めに隣り合えません。
        </p>
        <p v-else-if="phase === 'shortcut'">
          置いたタコをダブルタップすると、同じ行・列・エリアと隣接マスに×をまとめて置けます。
        </p>
        <p v-else-if="phase === 'auto'">
          正しいタコを置いた直後、自動で×を付ける設定もできます。通常プレイにも反映されます。
        </p>
        <p v-else-if="phase === 'drag'">
          {{ dragInstruction }}
        </p>
        <p v-else-if="phase === 'reason'">
          {{ lesson.reasoningMove.explanation[0] }}
          赤枠のマスをタップして×を付けましょう。
        </p>
        <p v-else-if="phase === 'hint'">
          迷ったときはヒントを使えます。下の「ヒントを見る」を押してみましょう。
        </p>
        <p v-else>
          あとは自由に進めてみてください。タップで×、長押しでタコ、タコのダブルタップで×を一括追加します。すべて置くと練習完了です。
        </p>
        <p v-if="phase === 'free'">
          ×は間違っても付け直せます。誤ったタコは消せない赤い×になり、ミスが増えます。
        </p>
        <p
          v-if="phase === 'place' || phase === 'shortcut' || phase === 'drag'"
          class="tutorial-a11y-note"
        >
          キーボードでは赤枠のマスを Enter または Space で操作できます。
        </p>
        <div class="board-wrap interactive-tutorial-board-wrap">
          <div
            ref="board"
            class="board interactive-tutorial-board"
            role="grid"
            aria-label="チュートリアルの8×8盤面"
            :style="{ '--long-press-duration': `${LONG_PRESS_MS}ms` }"
            @pointerdown.prevent="startPointer"
            @pointermove.prevent="movePointer"
            @pointerup="endPointer"
            @pointercancel="pointerCanceled"
            @lostpointercapture="pointerCanceled"
            @pointerleave="pointerLeft"
          >
            <button
              v-for="index in cells"
              :key="index"
              type="button"
              class="cell"
              :class="{
                'tutorial-target': emphasized(index),
                'tutorial-place-target':
                  phase === 'place' && index === lesson.firstPiece,
                'is-holding': holdingCell === index,
                'is-pressed': readyCell === index,
                'is-hint-focus':
                  phase === 'free' &&
                  shownHint &&
                  hintFocusCells(puzzle, shownHint, shownHintStage).includes(
                    index,
                  ),
                'is-hint-exclude':
                  phase === 'free' &&
                  shownHint &&
                  hintExcludeCells(shownHint, shownHintStage).includes(index),
              }"
              :style="cellStyle(index)"
              :data-tutorial-cell="index"
              :aria-label="cellLabel(index)"
              role="gridcell"
              @click="
                (event) => {
                  if (event.detail === 0) tap(index, true);
                }
              "
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
                class="fixed-error"
                aria-hidden="true"
                >×</span
              >
              <span
                v-else-if="state.excluded.has(index)"
                class="mark"
                aria-hidden="true"
                >×</span
              >
            </button>
          </div>
        </div>
        <div v-if="phase === 'auto'" class="dialog-actions">
          <button type="button" @click="chooseAuto(true)">
            はい、自動で付ける
          </button>
          <button type="button" @click="chooseAuto(false)">
            いいえ、手動で付ける
          </button>
        </div>
        <div v-if="phase === 'hint' || phase === 'free'" class="dialog-actions">
          <button type="button" @click="showHint">{{ hintButtonLabel }}</button>
        </div>
        <p v-if="message" role="status">{{ message }}</p>
        <p v-if="phase === 'free'">
          通常プレイとは独立した練習盤面です。終了すると元の盤面へ戻ります。
        </p>
        <p v-if="phase === 'free'">
          練習中のヒント {{ state.hintsUsed }}回 · ミス {{ state.mistakes }}回
        </p>
        <div class="dialog-actions">
          <button type="button" @click="emit('close')">練習を終了</button>
        </div>
      </template>
    </section>
  </div>
</template>
