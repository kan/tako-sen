import type { HintStage } from "./hint-progress";

/** Public response deliberately excludes account IDs, play IDs and dates. */
export interface LeaderboardEntry {
  readonly rank: number;
  readonly displayName: string;
  readonly elapsedSeconds: number;
  readonly hintsUsed: number;
  readonly maxHintStage?: HintStage | null;
  readonly mistakes: number;
}
