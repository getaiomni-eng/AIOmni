-- Capture ESPN's weekly EXPERT rankings (2026-09-22).
--
-- We had been grading our matchup-adjusted weekly board against espn_adp. ADP
-- is a DRAFT signal -- where a player goes in August -- so using it to judge a
-- weekly start/sit board is unfair to both sides and answers the wrong
-- question. ESPN publishes real weekly rankings from named analysts. That is
-- the like-for-like opponent.
--
-- CAPTURE OR LOSE IT. ESPN does not retain past weeks. On 2026-09-22 week 3
-- was fully published and week 2 was already gone, leaving only a few
-- unpublished rows with nonsense ranks. There is no backfill and no archive.
-- A week not captured before kickoff can never be compared, which is why this
-- is scheduled rather than run on demand.
--
-- Thursday 12:45 UTC: after the weekly board builds at 12:30 and before the
-- Thursday-night games, so every source in ranking_snapshots is frozen at
-- roughly the same moment. That symmetry is the whole point -- an hour of
-- extra injury news is worth more than any modelling difference, which is the
-- mistake that made week 2's aiomni_weekly number unusable.
SELECT cron.unschedule('aiomni-espn-expert')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aiomni-espn-expert');

SELECT cron.schedule(
  'aiomni-espn-expert',
  '45 12 * * 4',
  $$
  SELECT net.http_post(
    url := 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/espn-expert-snapshot',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'apikey',        (SELECT value FROM public.app_settings WHERE key = 'anon_key'),
      'Authorization', 'Bearer ' || (SELECT value FROM public.app_settings WHERE key = 'anon_key')),
    body := jsonb_build_object('season', public.nfl_season(), 'week',
              (SELECT COALESCE(MAX(week),0) + 1 FROM public.nfl_weekly_stats
                WHERE season = public.nfl_season() AND season_type = 'REG')),
    timeout_milliseconds := 120000
  );
  $$
);
