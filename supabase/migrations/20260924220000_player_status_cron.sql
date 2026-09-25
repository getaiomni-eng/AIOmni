-- Schedule player-status-sync (2026-09-24).
--
-- The function shipped without a cron. Week 3 was archived by hand; without a
-- schedule the live mirror goes stale by the weekend and week 4 is never
-- captured -- and a week not captured before kickoff is gone for good.
--
-- TWO JOBS, matching the two tables.
--
--   * Mirror, daily 08:50 UTC -- ten minutes ahead of the 09:00 daily board
--     rebuild, so the board reads today's injury and depth state. Plus Sunday
--     12:50 UTC, ahead of the 13:00 Sunday board, so the Friday practice
--     report is in. week=0: mirror only, the archive is not touched.
--
--   * Archive, Thursday 21:00 UTC (4pm CT) -- before TNF kickoff, so no team's
--     row can contain post-kickoff news. Later in the week would catch the
--     Friday report for Sunday teams, but it would freeze TNF teams AFTER their
--     game, which is exactly the look-ahead the write-once rule exists to keep
--     out. Week number is derived the same way the board crons derive it.

SELECT cron.schedule('aiomni-player-status-daily', '50 8 * * *', $$
  SELECT net.http_post(
    url := 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/player-status-sync',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'apikey',        (SELECT value FROM public.app_settings WHERE key = 'anon_key'),
      'Authorization', 'Bearer ' || (SELECT value FROM public.app_settings WHERE key = 'anon_key')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$$);

SELECT cron.schedule('aiomni-player-status-sunday', '50 12 * * 0', $$
  SELECT net.http_post(
    url := 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/player-status-sync',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'apikey',        (SELECT value FROM public.app_settings WHERE key = 'anon_key'),
      'Authorization', 'Bearer ' || (SELECT value FROM public.app_settings WHERE key = 'anon_key')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$$);

SELECT cron.schedule('aiomni-player-status-archive', '0 21 * * 4', $$
  SELECT net.http_post(
    url := 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/player-status-sync',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'apikey',        (SELECT value FROM public.app_settings WHERE key = 'anon_key'),
      'Authorization', 'Bearer ' || (SELECT value FROM public.app_settings WHERE key = 'anon_key')),
    body := jsonb_build_object(
      'season', public.nfl_season(),
      'week',   (SELECT COALESCE(MAX(week),0) + 1 FROM public.nfl_weekly_stats
                  WHERE season = public.nfl_season() AND season_type = 'REG')),
    timeout_milliseconds := 120000
  );
$$);
