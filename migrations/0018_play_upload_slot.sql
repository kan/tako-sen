-- POST /api/plays now takes an upload slot before it regenerates the board
-- (src/worker/history.ts takeUploadSlot), so an upload past the limit costs no
-- generation and a resend of a stored record takes no slot. The trigger that
-- counted after the insertion would count each new record twice. The counts
-- stay in publication_limits, whose name is from when only ranked clears were
-- limited.
DROP TRIGGER limit_play_uploads;
