export function rankingPreview<T>(
  entries: readonly T[],
  isSelf: (entry: T) => boolean,
): T[] {
  const index = entries.findIndex(isSelf);
  if (index < 0) return [];
  const start = Math.max(0, Math.min(index - 1, entries.length - 3));
  return entries.slice(start, start + 3);
}
