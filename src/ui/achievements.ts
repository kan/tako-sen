import { shallowRef, watch } from "vue";
import {
  ACHIEVEMENTS,
  achievementDefinition,
  type AchievementDefinition,
} from "../core/achievements";
import { apiFetch, useId } from "./auth";

/**
 * 実績の画面側の共有部分（docs/NEXT_PHASE.md「実績の導入計画」、
 * docs/DATA_CONTRACT.md「実績の契約」）。
 */

/**
 * 実績のアイコン（src/assets/achievements/<id>.svg）。secret は未解除の秘密の実績。
 * 起動時には要らないので、本体の JS に埋め込まず別のファイルにする（no-inline）。
 */
const icons = import.meta.glob<string>("../assets/achievements/*.svg", {
  eager: true,
  query: "?url&no-inline",
  import: "default",
});

export function achievementIcon(id: string): string {
  return icons[`../assets/achievements/${id}.svg`] ?? "";
}

/** GET /api/achievements の 1 項目と、その定義 */
export interface AchievementStatus {
  readonly definition: AchievementDefinition;
  readonly unlockedAt: number | null;
  /** 記録から判定する実績の現在値。サーバーが伏せると決めたものは null */
  readonly progress: number | null;
}

/** 応答を検証する。定義にない id は捨て、定義の順に並べる。形が違えば null */
export function parseAchievementList(
  value: unknown,
): AchievementStatus[] | null {
  const items = (value as { achievements?: unknown } | null)?.achievements;
  if (!Array.isArray(items)) return null;
  const byId = new Map<
    string,
    { unlockedAt: number | null; progress: number | null }
  >();
  for (const item of items) {
    if (!item || typeof item !== "object") return null;
    const { id, unlockedAt, progress } = item as Record<string, unknown>;
    if (
      typeof id !== "string" ||
      !(unlockedAt === null || Number.isSafeInteger(unlockedAt)) ||
      !(progress === null || Number.isSafeInteger(progress))
    )
      return null;
    byId.set(id, {
      unlockedAt: unlockedAt as number | null,
      progress: progress as number | null,
    });
  }
  return ACHIEVEMENTS.map((definition) => ({
    definition,
    ...(byId.get(definition.id) ?? { unlockedAt: null, progress: null }),
  }));
}

/**
 * 完了の応答の newAchievements を、その試行の playId と組で覚える。クリアダイアログは
 * 今の playId の分だけを出す。送信待ちの列から後で送られた試行の分は、ダイアログには
 * 出さず、一覧の「NEW」で知らせる。
 */
const unlocksByPlay = shallowRef<ReadonlyMap<string, readonly string[]>>(
  new Map(),
);

export function reportUnlocks(playId: string, value: unknown): void {
  const ids = (value as { newAchievements?: unknown } | null)?.newAchievements;
  if (!Array.isArray(ids)) return;
  const known = ids.filter(
    (id): id is string => typeof id === "string" && !!achievementDefinition(id),
  );
  if (!known.length) return;
  const next = new Map(unlocksByPlay.value);
  next.set(playId, [...new Set([...(next.get(playId) ?? []), ...known])]);
  unlocksByPlay.value = next;
}

/** その試行で解除した実績の名前とアイコン（クリアダイアログに出す）。リアクティブに読む */
export function unlockSummaries(
  playId: string | undefined,
): { id: string; name: string; icon: string }[] {
  return (playId ? (unlocksByPlay.value.get(playId) ?? []) : []).map((id) => ({
    id,
    name: achievementDefinition(id)!.name,
    icon: achievementIcon(id),
  }));
}

/** 「NEW」の基準: この端末で一覧を最後に見たとき、解除日時がいちばん新しかったもの */
function seenKey(accountId: string): string {
  return `tako-sen.achievements-seen.v1:${accountId}`;
}

export function lastSeenUnlock(accountId: string): number {
  try {
    const value = Number(localStorage.getItem(seenKey(accountId)));
    return Number.isSafeInteger(value) ? value : 0;
  } catch {
    return 0;
  }
}

/**
 * 一覧を見たことを残す。端末の時計ではなく、サーバーが付けた解除日時の最大値を
 * 使うので、時計のずれで「NEW」が消えたり残ったりしない。
 */
export function markUnlocksSeen(
  accountId: string,
  list: readonly AchievementStatus[],
): void {
  const newest = Math.max(0, ...list.map((item) => item.unlockedAt ?? 0));
  if (newest <= lastSeenUnlock(accountId)) return;
  try {
    localStorage.setItem(seenKey(accountId), String(newest));
  } catch {
    // 保存できなければ、次に開いたときも「NEW」が残るだけ。
  }
}

/**
 * 遊び方の実績の送り待ち。値は、遊び方を終えたときの ID（送れたら消す）。ID が
 * まだない端末で終えたときは空文字で、次に確かめられた ID 1 つがそれを引き取る。
 * 後でこの端末を使う別の ID には送らない（その ID は遊び方を終えていない）。
 * core/tutorial.ts の TUTORIAL_KEY（既読）とは別のキー。辞退や途中終了でも既読になるため。
 */
const TUTORIAL_PENDING_KEY = "tako-sen.tutorial-achievement-pending.v1";

function readPending(): string | null {
  try {
    return localStorage.getItem(TUTORIAL_PENDING_KEY);
  } catch {
    return null;
  }
}

function writePending(value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(TUTORIAL_PENDING_KEY);
    else localStorage.setItem(TUTORIAL_PENDING_KEY, value);
  } catch {
    // 保存できなければ、終えたその場で送る分だけになる。
  }
}

/** 送り直しても通る見込みがあるのは、通信の失敗、ID の確認待ち、混雑、サーバーの障害だけ */
function worthRetrying(status: number): boolean {
  return status === 401 || status === 429 || status >= 500;
}

async function sendTutorialAchievement(accountId: string): Promise<void> {
  try {
    const response = await apiFetch("/api/achievements/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "tutorial_complete" }),
    });
    if (worthRetrying(response.status)) return;
  } catch {
    return; // オフラインなど。次に ID が確かめられたときに送り直す。
  }
  if (readPending() === accountId) writePending(null);
}

/** 遊び方を最後まで終えたとき。今の ID に結び付けて残し、ID があればすぐ送る */
export function completeTutorial(): Promise<void> {
  const accountId = useId().id.value;
  writePending(accountId ?? "");
  return accountId ? sendTutorialAchievement(accountId) : Promise.resolve();
}

/** ID が確かめられるたびに、その ID の送り待ちがあれば送る（App の起動時に 1 度呼ぶ） */
export function startTutorialAchievementSync(): () => void {
  return watch(
    useId().id,
    (accountId) => {
      if (!accountId) return;
      const pending = readPending();
      if (pending === "") writePending(accountId);
      if (pending === "" || pending === accountId)
        void sendTutorialAchievement(accountId);
    },
    { immediate: true },
  );
}
