-- Point-in-time copy of the season rankings before the young-elite-floor
-- change (2026-09-15).
--
-- aiomni-rankings-engine-v2 writes straight to nfl_proprietary_rankings_v2
-- with no dry-run mode, so a formula change is applied to every user's board
-- the moment the function runs. This is the revert path: if the diff after
-- the rerun is not what was predicted, restore from here in one statement.
--
-- The change: the young-elite-floor (engine ~line 2163) floors a young
-- player's baseline at his best season's per-game rate whenever that season
-- cleared a positional threshold. It never looks at what happened NEXT.
-- Brian Thomas Jr. put up 284 fpts in 2024 (16.7 ppg), then 9.9 ppg in 2025,
-- and the floor held his baseline at 17.7 regardless -- worth about 4.4 ppg
-- and the difference between WR7 and roughly WR10.
--
-- Checked against all 20 currently-floored players before writing this:
-- twelve of them peaked in the MOST RECENT season or confirmed it, so
-- decaying the floor by age would have punished Jeanty, Warren, Loveland and
-- others for nothing. Only three regressed hard enough to matter --
-- James Conner, Brian Thomas Jr., Ladd McConkey -- which is why the new
-- condition tests whether the follow-up season contradicted the peak rather
-- than how old the peak is.

DROP TABLE IF EXISTS public.rankings_v2_bak_20260915;

CREATE TABLE public.rankings_v2_bak_20260915 AS
  SELECT * FROM public.nfl_proprietary_rankings_v2;

ALTER TABLE public.rankings_v2_bak_20260915 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rankings_v2_bak_20260915 FROM anon, authenticated;
GRANT ALL ON public.rankings_v2_bak_20260915 TO service_role;

-- Revert, if the diff is wrong:
--   BEGIN;
--   DELETE FROM public.nfl_proprietary_rankings_v2;
--   INSERT INTO public.nfl_proprietary_rankings_v2
--     SELECT * FROM public.rankings_v2_bak_20260915;
--   COMMIT;
