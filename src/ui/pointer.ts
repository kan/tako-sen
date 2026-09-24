export const LONG_PRESS_MS = 420;

export type PointerReleaseAction = "tap" | "place-piece" | "suppress-click";

export interface PointerReleaseInput {
  readonly elapsedMs: number;
  readonly longPressMs: number;
  readonly dragging: boolean;
  readonly longPressReady: boolean;
  readonly longPressCanceled: boolean;
  readonly pieceDisabled?: boolean;
}

export function pointerReleaseAction({
  elapsedMs,
  longPressMs,
  dragging,
  longPressReady,
  longPressCanceled,
  pieceDisabled = false,
}: PointerReleaseInput): PointerReleaseAction {
  if (dragging) return "suppress-click";
  if (longPressCanceled) return "suppress-click";
  if (pieceDisabled) return elapsedMs >= longPressMs ? "suppress-click" : "tap";
  if (longPressReady || elapsedMs >= longPressMs) return "place-piece";
  return "tap";
}
