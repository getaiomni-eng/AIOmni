-- Rebuild the weekly board daily, right after the engine (2026-09-24).
--
-- The season engine reruns EVERY DAY at 08:30. The board rebuilt only Tue
-- 14:00, Thu 12:30 and Sun 13:00, so it could sit up to two days behind its
-- own source.
--
-- Caught on a real error. Jacksonville's target share flipped hard: through
-- week 2 Parker Washington had 6 then 12 targets (42.9% share, WOPR 1.053)
-- while Brian Thomas Jr. had 3 then 8 for 7.0 points both weeks. The engine
-- picked this up once week-2 stats landed -- its in-season layer moved
-- Washington +7.7% and Thomas -11.5%, putting Washington ahead at rank 86 vs
-- 88. But the board was built 2026-09-23 05:38 off the 09-22 engine run, which
-- had only week-1 data, so the app showed Thomas WR24 ABOVE Washington WR30 --
-- exactly backwards, and backwards on the one JAX receiver actually producing.
--
-- 09:00 UTC daily, 30 minutes after the engine. The board is cheap to rebuild
-- (~4s) and this is purely what USERS see: ranking_snapshots is write-once per
-- week, so the graded prediction stays locked to its Tuesday capture and this
-- cannot smuggle late information into a scored comparison.
SELECT cron.unschedule('aiomni-weekly-board-daily')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aiomni-weekly-board-daily');

SELECT cron.schedule(
  'aiomni-weekly-board-daily',
  '0 9 * * *',
  $$
  SELECT net.http_post(
    url := 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/weekly-board'
           || '?season=' || public.nfl_season()
           || '&week='   || (SELECT COALESCE(MAX(week),0) + 1 FROM public.nfl_weekly_stats
                              WHERE season = public.nfl_season() AND season_type = 'REG'),
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'apikey',        (SELECT value FROM public.app_settings WHERE key = 'anon_key'),
      'Authorization', 'Bearer ' || (SELECT value FROM public.app_settings WHERE key = 'anon_key')),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $$
);
