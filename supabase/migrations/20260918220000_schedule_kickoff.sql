-- Kickoff times on nfl_schedule (2026-09-18).
--
-- WHY: the weekly board adjusted players for weather by calling OpenWeatherMap's
-- CURRENT-conditions endpoint (/data/2.5/weather) at board time. The board runs
-- Thursday 12:30 UTC, so every "forecast" in the rankings was the sky over that
-- stadium on Thursday MORNING, applied to a game played Sunday afternoon, and
-- never refreshed.
--
-- Measured cost in week 2, against the real kickoff forecast:
--   CLE @ TB   board said 15mph Clear -> docked passers 4 spots for wind.
--              Actual kickoff forecast: 5mph, definite rain. No wind at all.
--   MIN @ CHI  board said 2mph -> no adjustment.
--              Actual kickoff forecast: 15mph, which is exactly the threshold
--              that should have fired.
-- The ONLY weather adjustment on the entire week 2 board was applied to the
-- wrong game, and the game that qualified got nothing. Weather was not inert;
-- it was firing backwards.
--
-- Switching to the forecast endpoint needs a kickoff time to pick the right
-- 3-hour block against, and nfl_schedule had only (season, week, home, away).
-- This adds it.
--
-- STORED AS timestamptz IN UTC. nflverse publishes gameday + gametime as
-- EASTERN WALL CLOCK, which crosses a DST boundary mid-season -- a September
-- 13:00 is 17:00Z and a December 13:00 is 18:00Z. Converting once on write and
-- storing an absolute instant means no reader ever has to know that.

ALTER TABLE public.nfl_schedule
  ADD COLUMN IF NOT EXISTS kickoff_at timestamptz;

COMMENT ON COLUMN public.nfl_schedule.kickoff_at IS
  'Absolute kickoff instant (UTC), converted from nflverse Eastern wall-clock on write. Used to select the weather-forecast block nearest kickoff.';

CREATE INDEX IF NOT EXISTS nfl_schedule_kickoff_idx
  ON public.nfl_schedule (season, week, kickoff_at);

-- Weekly, Wednesday 09:00 UTC. Ahead of the Thursday 12:30 board so the board
-- always reads fresh times, and weekly rather than daily because flex
-- scheduling moves kickoffs only a few times a season.
SELECT cron.unschedule('aiomni-schedule-sync')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aiomni-schedule-sync');

SELECT cron.schedule(
  'aiomni-schedule-sync',
  '0 9 * * 3',
  $$
  SELECT net.http_post(
    url := 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/nfl-schedule-sync',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'apikey',        (SELECT value FROM public.app_settings WHERE key = 'anon_key'),
      'Authorization', 'Bearer ' || (SELECT value FROM public.app_settings WHERE key = 'anon_key')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
