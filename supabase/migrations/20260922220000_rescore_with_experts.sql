-- Rescore weeks 1 and 2 now that espn_expert, fantasypros_ecr, espn_proj and
-- sleeper_proj are in ranking_snapshots (2026-09-22).
--
-- CORRECTION to 20260922180000. I claimed ESPN does not retain past weeks,
-- based on a five-player sample where those players happened to have
-- unpublished period-2 rows. At full scale weeks 1 AND 2 are published and
-- sane: week 2 ESPN has Trey McBride TE1 unanimous across all 8 analysts,
-- Puka Nacua WR1 unanimous, Lamar Jackson QB1. Both weeks are now backfilled,
-- so the weekly board can be graded against real weekly experts retroactively
-- rather than only from week 3 forward.
--
-- The corpus stays capture-first by design. Nothing guarantees how long either
-- provider keeps a week, the Thursday cron costs nothing, and being wrong in
-- that direction is free while being wrong the other way is permanent.
SELECT public.score_ranking_week(2026, 1);
SELECT public.score_ranking_week(2026, 2);
