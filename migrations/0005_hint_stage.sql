-- NULL means an older hinted result whose disclosure depth was not recorded.
ALTER TABLE completed_plays ADD COLUMN max_hint_stage INTEGER
  CHECK (max_hint_stage IS NULL OR (
    typeof(max_hint_stage) = 'integer' AND max_hint_stage BETWEEN 0 AND 4 AND
    ((hints_used = 0 AND max_hint_stage = 0) OR (hints_used > 0 AND max_hint_stage > 0))
  ));

UPDATE completed_plays SET max_hint_stage = 0 WHERE hints_used = 0;
