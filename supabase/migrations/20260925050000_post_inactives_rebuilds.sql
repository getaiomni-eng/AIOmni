-- Rebuild the weekly rankings right after each inactives window (2026-09-25).
--
-- The last scheduled build used to be Sunday 13:45 UTC -- before any
-- inactives. A questionable star ruled out at 11:30 ET stayed on our board
-- all afternoon, while FantasyPros, ESPN and the platforms' projections had
-- already dropped him. These runs pass refresh_status, so weekly-rankings
-- pulls Sleeper's injury feed first (player-status-sync), then rebuilds with
-- the owner's /rank desk calls applied.
--
-- Inactives post ~90 minutes before kickoff. Each window is scheduled twice,
-- an hour apart, so it lands after inactives under both EDT and EST (the
-- clocks change in November and pg_cron runs in UTC):
--   Sun 1pm ET games     15:40 / 16:40 UTC
--   Sun 4pm ET games     19:05 / 20:05 UTC
--   Sun night            23:00 Sun / 00:00 Mon UTC
--   Mon and Thu night    23:00 / 00:00 UTC (the next day)
-- Rebuilds are cheap (~20-40s) and never touch the frozen grading snapshot,
-- which is write-once per week.

DO $$
DECLARE
  job record;
BEGIN
  FOR job IN SELECT * FROM (VALUES
    ('aiomni-rankings-inactives-sun-1pm',  '40 15,16 * * 0'),
    ('aiomni-rankings-inactives-sun-4pm',  '5 19,20 * * 0'),
    ('aiomni-rankings-inactives-sun-night', '0 23 * * 0'),
    ('aiomni-rankings-inactives-sun-night2','0 0 * * 1'),
    ('aiomni-rankings-inactives-mon-thu',  '0 23 * * 1,4'),
    ('aiomni-rankings-inactives-mon-thu2', '0 0 * * 2,5')
  ) AS t(name, sched)
  LOOP
    PERFORM cron.schedule(job.name, job.sched, $cmd$
      SELECT net.http_post(
        url := 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/weekly-rankings',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'apikey',        (SELECT value FROM public.app_settings WHERE key = 'anon_key'),
          'Authorization', 'Bearer ' || (SELECT value FROM public.app_settings WHERE key = 'anon_key')),
        body := '{"refresh_status": true}'::jsonb,
        timeout_milliseconds := 180000
      );
    $cmd$);
  END LOOP;
END $$;
