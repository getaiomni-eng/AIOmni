-- Point-in-time copy of the season rankings before the Brock Bowers
-- injury-override rerun (2026-09-16).
--
-- Sleeper's injury_status for Bowers was Out/Surgery (news_updated
-- 2026-09-14), while Schefter and Raiders coach Kubiak had already called
-- him day-to-day with a real chance to play Week 2 at LAC. Overriding him to
-- Questionable (0.85x, the existing not-serious multiplier) in
-- aiomni-rankings-engine-v2 and rerunning changes his rank; this is the
-- revert path if that rerun does anything unexpected.

DROP TABLE IF EXISTS public.rankings_v2_bak_20260916_prebowers;

CREATE TABLE public.rankings_v2_bak_20260916_prebowers AS
  SELECT * FROM public.nfl_proprietary_rankings_v2;

ALTER TABLE public.rankings_v2_bak_20260916_prebowers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rankings_v2_bak_20260916_prebowers FROM anon, authenticated;
GRANT ALL ON public.rankings_v2_bak_20260916_prebowers TO service_role;

-- Revert, if the diff is wrong:
--   BEGIN;
--   DELETE FROM public.nfl_proprietary_rankings_v2;
--   INSERT INTO public.nfl_proprietary_rankings_v2
--     SELECT * FROM public.rankings_v2_bak_20260916_prebowers;
--   COMMIT;
