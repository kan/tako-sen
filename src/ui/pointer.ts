export const LONG_PRESS_MS = 150;
export const DOUBLE_TAP_MS = 300;

// Coordinates and bounds must both use viewport CSS pixels (not page coordinates).
export function cellIndexAtPoint(
  x: number,
  y: number,
  bounds: { left: number; top: number; width: number; height: number },
  size: number,
): number | undefined {
  const dx = x - bounds.left;
  const dy = y - bounds.top;
  if (
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    dx < 0 ||
    dy < 0 ||
    dx >= bounds.width ||
    dy >= bounds.height
  )
    return undefined;
  return (
    Math.floor((dy / bounds.height) * size) * size +
    Math.floor((dx / bounds.width) * size)
  );
}

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
