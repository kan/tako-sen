-- 週間ランキングを平均スコア順にしたので、スコアの計算に使うミスとヒントの回数も
-- 索引に含め、表を引かずに集計できるようにする。索引の作り直しだけなので、
-- 新しい Worker より先に適用しても、今の Worker はそのまま動く。
DROP INDEX completed_plays_weekly_eligible;
CREATE INDEX completed_plays_weekly_eligible
  ON completed_plays (completed_at, account_id, puzzle_id, play_id, difficulty,
    elapsed_seconds, mistakes, hints_used, generator_version)
  WHERE ranking_eligible = 1;
