-- Move Tuesday's pipeline after nflverse actually publishes (2026-09-22).
--
-- Week 2 scored nothing, and the cause was pure timing:
--
--   08:00:00  aiomni-nflverse-weekly ran  -> week 2 not published, fetched nothing
--   10:15:00  aiomni-score-rankings ran   -> no week 2 stats present
--   10:16:47  nflverse published stats_player_week_2026.csv
--
-- We missed it by 107 seconds. Every cron reported "succeeded", because the
-- cron only reports that the POST was issued, and score_ranking_week picks the
-- max week PRESENT in nfl_weekly_stats -- so with week 2 absent it re-scored
-- week 1, wrote nothing new, and looked healthy. A silent no-op is the worst
-- possible failure for the one job whose entire purpose is to tell us whether
-- the rankings are any good.
--
-- New order, with real margin. nflverse's Tuesday publish was observed at
-- 10:16 UTC once; one observation is not a schedule, so the sync moves to
-- 12:00 and scoring to 13:00 rather than shaving it close.
--
--   12:00  nflverse-weekly    (was 08:00)
--   13:00  score-rankings     (was 10:15)
--   13:10  score-projections  (was 10:20)
--   13:30  trade-corpus       (was 11:00, kept after the scoring jobs)
--
-- The daily nflverse job stays at 07:00: it exists to keep rosters and player
-- profiles current, not to feed Tuesday scoring.

SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname='aiomni-nflverse-weekly'),   schedule := '0 12 * * 2');
SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname='aiomni-score-rankings'),    schedule := '0 13 * * 2');
SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname='aiomni-score-projections'), schedule := '10 13 * * 2');
SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname='aiomni-trade-corpus'),      schedule := '30 13 * * 2');

-- Score week 2 now that the stats are finally in, so this week is not lost.
SELECT public.score_ranking_week(2026, 2);
