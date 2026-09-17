export type PointerReleaseAction = "tap" | "place-piece" | "suppress-click";

export interface PointerReleaseInput {
  readonly elapsedMs: number;
  readonly longPressMs: number;
  readonly dragging: boolean;
  readonly longPressReady: boolean;
  readonly longPressCanceled: boolean;
}

export function pointerReleaseAction({
  elapsedMs,
  longPressMs,
  dragging,
  longPressReady,
  longPressCanceled,
}: PointerReleaseInput): PointerReleaseAction {
  if (dragging) return "suppress-click";
  if (longPressCanceled) return "suppress-click";
  if (longPressReady || elapsedMs >= longPressMs) return "place-piece";
  return "tap";
}
