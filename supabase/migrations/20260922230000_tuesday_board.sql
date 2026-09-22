-- Build our weekly board on TUESDAY, when everyone else publishes (2026-09-22).
--
-- Measured today: FantasyPros' week-3 consensus was last updated 20:49 UTC on a
-- TUESDAY, and ESPN already had 8 analysts' week-3 ranks published. The experts
-- put next week's rankings out as soon as Monday night finishes.
--
-- Our board did not build week 3 until THURSDAY 12:30. Two problems:
--
--   PRODUCT. For two days after MNF the app shows last week's rankings while
--   every competitor has the new week up. That is the exact window when people
--   start planning, and we were absent from it.
--
--   FAIRNESS. Freezing their Tuesday opinion against our Thursday board hands
--   us two extra days of injury news. That is the same asymmetry that made
--   week 2's aiomni_weekly number unusable, pointed the other way -- and it
--   would have flattered us instead of them, which is worse.
--
-- Both are fixed by everyone freezing at the same moment, on Tuesday.
--
--   13:00  score-rankings      (grades the week that just finished)
--   13:10  score-projections
--   13:30  trade-corpus
--   14:00  weekly-board        <- NEW, builds the UPCOMING week
--   14:15  expert-harvest      (moved off Thursday, 15 min after ours)
--
-- The week is passed EXPLICITLY as max(stats week)+1 rather than left to
-- nflWeek(), which rolls over on Thursday and would rebuild the week that just
-- ended. Shifting nflWeek's boundary instead was rejected: the natural place
-- for it is Tuesday ~00:00 UTC, which lands BEFORE Monday night football has
-- even kicked off.
--
-- Thursday 12:30 and Sunday 13:00 board builds stay. They refresh what USERS
-- see with newer injury and weather data; the graded snapshot is already
-- locked by then because ranking_snapshots is write-once per week.

SELECT cron.unschedule('aiomni-weekly-board-tuesday')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aiomni-weekly-board-tuesday');

SELECT cron.schedule(
  'aiomni-weekly-board-tuesday',
  '0 14 * * 2',
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

-- Expert harvest moves Thursday 12:45 -> Tuesday 14:15, so every ranking in
-- ranking_snapshots freezes within 15 minutes of ours.
SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname='aiomni-expert-harvest'),
                      schedule := '15 14 * * 2');
SELECT cron.unschedule('aiomni-espn-expert')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aiomni-espn-expert');
