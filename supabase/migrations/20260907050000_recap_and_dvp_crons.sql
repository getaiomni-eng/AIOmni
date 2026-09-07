-- Schedule the Commissioner recap, and fix the DVP season (2026-09-07).
--
-- 1. league-recap has been deployed since 2026-09-05 and scheduled by
--    NOTHING. hosted_recaps has never received a row, and the league page
--    renders the card behind {recap && ...} so there is not even an empty
--    state to notice. The flagship AI-commissioner feature has been 100%
--    dead since it shipped. The first recap is due the Tuesday after week 1.
--
--    Timing chain, all UTC Tuesday:
--      08:00  aiomni-nflverse-weekly   stats land
--      09:00  aiomni-bestball-weekly   compute_all_bestball scores them
--      09:40  aiomni-league-recap      writes recaps for newly scored weeks
--    The function self-discovers scored weeks missing a recap, so it needs
--    no body and is safe to re-run.
--
-- 2. populate-dvp posts an empty body, so the function falls back to its
--    default season of '2025' and nfl_dvp never gains a 2026 row. Its own
--    `games < 4` guard means nothing publishes until about week 5 either
--    way, so this is a fix-before-October, not a fix-tonight.
--    Fixed with a wrapper so the season is computed at fire time rather
--    than frozen into the cron string.

CREATE OR REPLACE FUNCTION public.kick_edge_function(p_fn text, p_body jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
declare v_key text;
begin
  select value into v_key from public.app_settings where key = 'anon_key';
  perform net.http_post(
    url := 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/' || p_fn,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'apikey',        coalesce(v_key, 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw'),
      'Authorization', 'Bearer ' || coalesce(v_key, 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw')),
    body := p_body,
    timeout_milliseconds := 60000
  );
end;
$$;
REVOKE ALL ON FUNCTION public.kick_edge_function(text, jsonb) FROM public, anon, authenticated;

SELECT cron.unschedule('aiomni-league-recap') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'aiomni-league-recap');
SELECT cron.schedule('aiomni-league-recap', '40 9 * * 2',
  $$ SELECT public.kick_edge_function('league-recap'); $$);

SELECT cron.unschedule('aiomni-populate-dvp') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'aiomni-populate-dvp');
SELECT cron.schedule('aiomni-populate-dvp', '25 7 * * *',
  $$ SELECT public.kick_edge_function('populate-dvp',
       jsonb_build_object('season', public.nfl_season())); $$);
