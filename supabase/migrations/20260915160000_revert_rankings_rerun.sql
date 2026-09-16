-- Revert the 2026-09-15 rankings rerun (2026-09-15).
--
-- The rerun that followed the young-elite-floor change produced a board with
-- the INJURY multiplier missing entirely. Diffed against the pre-run
-- snapshot, the method strings show it plainly:
--
--   BEFORE  ... floor 16.4): 1.6 ppg · INJURY: Meniscus (0.10x) · ...
--   AFTER   ... floor 16.4): 16.0 ppg · [age/exp 1.05x] ...
--
-- Brock Bowers went TE15 -> TE2 and TreVeyon Henderson RB35 -> RB16, both by
-- losing an injury discount they should still carry. Bowers is Out with a
-- meniscus and a surgery note on Sleeper as of an hour before the run. A
-- board that ranks him TE2 actively misleads anyone setting a lineup.
--
-- This is NOT the floor change misbehaving. The floor edit only ever removes
-- a boost, so it cannot raise a player; every upward move in that diff came
-- from the absent injury multiplier. The run also completed in 8 seconds,
-- which is fast enough to suggest a fetch in the engine's Promise.all
-- returned empty rather than throwing.
--
-- So: restore the pre-change board, then find out why injuryMap came back
-- empty before re-running anything. The floor change stays deployed in the
-- function but takes effect only on the next clean run, which is worth
-- knowing -- the daily 08:00 cron will apply it.

BEGIN;
DELETE FROM public.nfl_proprietary_rankings_v2;
INSERT INTO public.nfl_proprietary_rankings_v2
  SELECT * FROM public.rankings_v2_bak_20260915;
COMMIT;
