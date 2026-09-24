import { type PlayerState } from "../core/model";

export type FeedbackSource = "tap" | "drag" | "shortcut" | "piece";

export type CellFeedbackKind =
  | "excluded-add"
  | "excluded-remove"
  | "shortcut-exclude"
  | "piece-place"
  | "fixed-error";

export interface CellFeedback {
  readonly cell: number;
  readonly kind: CellFeedbackKind;
  readonly order: number;
}

export type HapticFeedbackKind = CellFeedbackKind | "clear";

export interface VibrationDevice {
  vibrate(pattern: VibratePattern): boolean;
}

const vibrationPatterns: Record<HapticFeedbackKind, readonly number[]> = {
  "excluded-add": [12],
  "excluded-remove": [8],
  "shortcut-exclude": [8],
  "piece-place": [35],
  "fixed-error": [20, 28, 45],
  clear: [25, 35, 25],
};

export function cellFeedbacksForStateChange(
  previous: PlayerState,
  next: PlayerState,
  source: FeedbackSource,
): CellFeedback[] {
  const feedbacks: CellFeedback[] = [];
  const occupied = new Set<number>();

  for (const cell of next.pieces) {
    if (!previous.pieces.has(cell)) {
      occupied.add(cell);
      feedbacks.push({ cell, kind: "piece-place", order: feedbacks.length });
    }
  }

  for (const cell of next.fixedErrors) {
    if (!previous.fixedErrors.has(cell)) {
      occupied.add(cell);
      feedbacks.push({ cell, kind: "fixed-error", order: feedbacks.length });
    }
  }

  for (const cell of next.excluded) {
    if (!previous.excluded.has(cell) && !occupied.has(cell)) {
      feedbacks.push({
        cell,
        kind: source === "shortcut" ? "shortcut-exclude" : "excluded-add",
        order: feedbacks.length,
      });
    }
  }

  for (const cell of previous.excluded) {
    if (
      !next.excluded.has(cell) &&
      !next.pieces.has(cell) &&
      !next.fixedErrors.has(cell)
    ) {
      feedbacks.push({
        cell,
        kind: "excluded-remove",
        order: feedbacks.length,
      });
    }
  }

  return feedbacks;
}

export function strongestHapticFeedback(
  feedbacks: readonly CellFeedback[],
): HapticFeedbackKind | undefined {
  if (feedbacks.some((feedback) => feedback.kind === "fixed-error"))
    return "fixed-error";
  if (feedbacks.some((feedback) => feedback.kind === "piece-place"))
    return "piece-place";
  if (feedbacks.some((feedback) => feedback.kind === "shortcut-exclude"))
    return "shortcut-exclude";
  return feedbacks[0]?.kind;
}

export function vibrateForFeedback(
  device: Partial<VibrationDevice>,
  kind: HapticFeedbackKind,
  enabled: boolean,
): boolean {
  if (!enabled || typeof device.vibrate !== "function") return false;
  return device.vibrate([...vibrationPatterns[kind]]);
}
