-- Schedule the rebuilt weekly rankings and their context sync (2026-09-25).
--
-- Order matters, and the daily jobs run in this sequence (UTC):
--   08:40  nflverse-context-sync   games/lines, snaps, injury report, depth chart
--   08:50  player-status-sync      Sleeper injury + depth mirror (existing)
--   09:15  weekly-rankings         models + ensemble for the next unplayed week
--
-- Sunday gets a second pass so the Friday injury report and the final depth
-- chart are in before the 1pm ET slate. nflverse snapshots depth charts at
-- ~06:00 and ~12:40 UTC; 13:30 catches the later one, 17:00 is kickoff.
--
-- weekly-rankings writes to weekly_rankings in SHADOW. The app still reads
-- nfl_weekly_board.

SELECT cron.schedule('aiomni-nflverse-context-daily', '40 8 * * *', $$
  SELECT net.http_post(
    url := 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/nflverse-context-sync',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'apikey',        (SELECT value FROM public.app_settings WHERE key = 'anon_key'),
      'Authorization', 'Bearer ' || (SELECT value FROM public.app_settings WHERE key = 'anon_key')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$$);

SELECT cron.schedule('aiomni-nflverse-context-sunday', '30 13 * * 0', $$
  SELECT net.http_post(
    url := 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/nflverse-context-sync',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'apikey',        (SELECT value FROM public.app_settings WHERE key = 'anon_key'),
      'Authorization', 'Bearer ' || (SELECT value FROM public.app_settings WHERE key = 'anon_key')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$$);

SELECT cron.schedule('aiomni-weekly-rankings-daily', '15 9 * * *', $$
  SELECT net.http_post(
    url := 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/weekly-rankings',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'apikey',        (SELECT value FROM public.app_settings WHERE key = 'anon_key'),
      'Authorization', 'Bearer ' || (SELECT value FROM public.app_settings WHERE key = 'anon_key')),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
$$);

SELECT cron.schedule('aiomni-weekly-rankings-sunday', '45 13 * * 0', $$
  SELECT net.http_post(
    url := 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/weekly-rankings',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'apikey',        (SELECT value FROM public.app_settings WHERE key = 'anon_key'),
      'Authorization', 'Bearer ' || (SELECT value FROM public.app_settings WHERE key = 'anon_key')),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
$$);
