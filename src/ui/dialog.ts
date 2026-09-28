/** Keep keyboard focus inside the currently displayed modal. */
export function trapDialogFocus(
  event: KeyboardEvent,
  dialog: HTMLElement | undefined,
): void {
  if (event.key !== "Tab" || !dialog) return;
  const focusable = [
    ...dialog.querySelectorAll<HTMLElement>(
      "button:not([disabled]), select:not([disabled]), input:not([disabled]), a[href], summary",
    ),
  ].filter((element) => element.getClientRects().length > 0);
  if (!focusable.length) {
    event.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
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
