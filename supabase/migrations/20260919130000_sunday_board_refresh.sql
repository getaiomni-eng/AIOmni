-- Sunday-morning weekly board refresh (2026-09-19).
--
-- TWO PROBLEMS, one cron each week could not solve:
--
-- 1. STALE SOURCE. aiomni-rankings-rerun rebuilds the season engine DAILY at
--    08:30 UTC. aiomni-weekly-board rebuilds from it ONCE, Thursday 12:30.
--    So from Thursday afternoon until the next Thursday the board is built on
--    engine output that has since been replaced six times. Measured today: a
--    board built 03:10 and rebuilt at 12:29, after that morning's 08:30 engine
--    run, moved Noah Fant 21 spots and Mike Evans 6. Real drift, not noise.
--
-- 2. STALE FORECAST. Weather now reads the forecast block nearest kickoff
--    (see 20260918220000), which is a large improvement over current
--    conditions -- but a Thursday build is forecasting ~72 hours out. A Sunday
--    morning build forecasts ~4 hours out, which is where a forecast is
--    actually worth acting on.
--
-- Sunday 13:00 UTC = 9am ET, four hours before the 1pm ET kickoffs and after
-- that morning's 08:30 engine run. Thursday's build stays: it is what people
-- plan the week on, and losing it would leave the board empty for three days.
--
-- DELIBERATELY NOT TOUCHED: aiomni-snapshot-rankings (Thu 13:00), which
-- captures aiomni_weekly for accuracy scoring. Moving it would change WHICH
-- prediction gets graded, days before Tuesday's first real measurement of the
-- in-season layer. Worth revisiting -- a Sunday-morning snapshot grades what
-- users actually acted on -- but not in the same week we are trying to read
-- that result.
SELECT cron.unschedule('aiomni-weekly-board-sunday')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aiomni-weekly-board-sunday');

SELECT cron.schedule(
  'aiomni-weekly-board-sunday',
  '0 13 * * 0',
  $$
  SELECT net.http_post(
    url := 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/weekly-board',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'apikey',        (SELECT value FROM public.app_settings WHERE key = 'anon_key'),
      'Authorization', 'Bearer ' || (SELECT value FROM public.app_settings WHERE key = 'anon_key')),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $$
);
