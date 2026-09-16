-- Stop the rankings rerun racing the stats sync it depends on (2026-09-15).
--
-- aiomni-nflverse-weekly is '0 8 * * 2' and aiomni-rankings-rerun is
-- '0 8 * * *'. On Tuesdays both fire in the SAME MINUTE, and the rerun reads
-- nfl_weekly_stats, which the sync is still writing.
--
-- Observed this morning: the sync landed 1,117 week-1 rows and the rankings
-- engine started at 08:00:10, ten seconds later. It almost certainly read a
-- table without the new week in it.
--
-- It self-heals on Wednesday's run, which is exactly why nobody would ever
-- notice: the ranks are simply a day stale every Tuesday, silently, and
-- Tuesday is the day the weekly accuracy scoring runs against them.
--
-- 30 minutes is generous for a sync that takes well under a minute, and it
-- still lands long before aiomni-score-rankings at 10:15.
--
-- alter_job changes only the schedule; the command text stays where it was
-- declared, in 20260910000000_cron_inventory.sql.
SELECT cron.alter_job(jobid, schedule := '30 8 * * *')
  FROM cron.job WHERE jobname = 'aiomni-rankings-rerun';

-- aiomni-rankings-json regenerates the public JSON from whatever the engine
-- last wrote, and it runs at '5 8 * * *' -- which was after the old 08:00
-- rerun but is now BEFORE the new 08:30 one. Left at 08:05 it would publish
-- yesterday's ranks every morning. Move it behind the engine.
SELECT cron.alter_job(jobid, schedule := '45 8 * * *')
  FROM cron.job WHERE jobname = 'aiomni-rankings-json';
