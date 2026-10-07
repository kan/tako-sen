export type HintStage = 0 | 1 | 2 | 3 | 4;

export interface HintProgress {
  readonly hintsUsed?: number;
  readonly maxHintStage?: HintStage | null;
}

/** 旧記録でヒント使用ありの場合、過去の開示段階は推測しない。 */
export function maximumHintStage(progress: HintProgress): HintStage | null {
  if (progress.hintsUsed === 0) return 0;
  return progress.maxHintStage ?? null;
}

export function validHintProgress(stage: unknown, hintsUsed: number): boolean {
  if (stage === undefined || stage === null) return true;
  return (
    Number.isInteger(stage) &&
    Number(stage) >= 0 &&
    Number(stage) <= 4 &&
    (hintsUsed === 0 ? stage === 0 : Number(stage) > 0)
  );
}

export function hintStageLabel(progress: HintProgress): string {
  const stage = maximumHintStage(progress);
  return stage === null
    ? "深さ不明"
    : stage === 0
      ? "未使用"
      : `深さ${stage}/4`;
}
