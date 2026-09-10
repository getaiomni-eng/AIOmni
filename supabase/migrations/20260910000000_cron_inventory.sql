-- Cron inventory: put every scheduled job under version control (2026-09-09).
--
-- WHY THIS EXISTS
-- Production was running 33 cron jobs. Twelve were declared in migrations.
-- The other 21 existed ONLY in the Supabase dashboard, so the repo could not
-- answer "what does this system do on a schedule?" -- and neither could I.
-- That gap produced a real bug: on 2026-09-07 I grepped the migrations for a
-- league-recap schedule, found none, concluded the flagship AI-commissioner
-- feature was unscheduled, and created 'aiomni-league-recap' at 09:40 Tuesday.
-- 'aiomni-league-recaps' already existed at 09:45, invisible to the repo.
-- Two jobs, five minutes apart, writing the same recaps.
--
-- Every job below is declared VERBATIM as it runs in production. This is a
-- capture, not a refactor -- it lands during week 1 kickoff, so behavior is
-- held identical on purpose. cron.schedule() is idempotent on jobname: it
-- updates an existing job in place, so re-running this file is safe and is a
-- no-op for the 32 jobs that already match.
--
-- FOLLOW-UP (deliberately NOT done here): 20 of these repeat the same 8-line
-- net.http_post block with the anon JWT pasted inline. public.kick_edge_function
-- already wraps exactly that and reads the key from app_settings, which would
-- make key rotation a one-row UPDATE instead of a 20-site edit. Consolidating
-- is the right cleanup -- after the season opener, not during it. It needs a
-- timeout parameter first: the helper is hardcoded to 60s and several of these
-- jobs allow 150-300s, and shortening them would make pg_net log timeouts for
-- runs that actually succeeded.
--
-- NOTE ON THE ANON KEY: it is public by design (it ships in the client bundle
-- and every table behind it is RLS-gated), so its presence here is not a leak.
--
-- ALL TIMES ARE UTC. Central is UTC-5 during the season (CDT).

-- ---------------------------------------------------------------------
-- The duplicate
-- ---------------------------------------------------------------------
-- Drop the dashboard copy, keep the version-controlled one. The survivor
-- goes through kick_edge_function, so the key lives in app_settings rather
-- than frozen into a cron string.
SELECT cron.unschedule('aiomni-league-recaps') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'aiomni-league-recaps');

-- ---------------------------------------------------------------------
-- Drafting and leagues
-- ---------------------------------------------------------------------
SELECT cron.schedule('aiomni-autopick', '*/5 * * * *',
  $job$ SELECT public.autopick_stalled(); $job$);

-- Tuesday chain: 08:00 stats land -> 09:00 scored -> 09:40 recapped.
SELECT cron.schedule('aiomni-bestball-weekly', '0 9 * * 2',
  $job$ SELECT public.compute_all_bestball(); $job$);

SELECT cron.schedule('aiomni-league-recap', '40 9 * * 2',
  $job$ SELECT public.kick_edge_function('league-recap'); $job$);

-- ---------------------------------------------------------------------
-- Content pipeline (podcasts + articles)
-- ---------------------------------------------------------------------
SELECT cron.schedule('aiomni-content-poll', '5 */2 * * *',
  $job$
  SELECT net.http_post(
    url := 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/content-poll',
    headers := '{"apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$);

SELECT cron.schedule('aiomni-content-transcribe', '*/10 * * * *',
  $job$
  SELECT net.http_post(
    url := 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/content-transcribe',
    headers := '{"apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
  $job$);

SELECT cron.schedule('aiomni-content-extract-podcasts', '3,33 * * * *',
  $job$
  SELECT net.http_post(
    url := 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/content-extract-podcasts',
    headers := '{"apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $job$);

SELECT cron.schedule('aiomni-content-extract-articles', '20 */2 * * *',
  $job$
  SELECT net.http_post(
    url := 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/content-extract-articles',
    headers := '{"apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $job$);

-- Retention. Transcripts are the expensive artifact and the shortest-lived:
-- once takes are extracted, the raw text has served its purpose.
SELECT cron.schedule('aiomni-takes-retention', '0 6 * * 0',
  $job$
  DELETE FROM analyst_takes WHERE published_at < now() - interval '45 days';
  DELETE FROM content_items WHERE created_at   < now() - interval '90 days';
  $job$);

SELECT cron.schedule('aiomni-transcripts-retention', '30 6 * * 0',
  $job$
  DELETE FROM transcript_chunks WHERE created_at < now() - interval '14 days';
  $job$);

-- ---------------------------------------------------------------------
-- Data ingestion
-- ---------------------------------------------------------------------
SELECT cron.schedule('aiomni-nflverse-daily', '0 7 * * *',
  $job$
  SELECT net.http_post(
    url := 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/nflverse-daily-sync',
    headers := '{"apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$);

SELECT cron.schedule('aiomni-nflverse-weekly', '0 8 * * 2',
  $job$
  SELECT net.http_post(
    url := 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/nflverse-weekly-sync',
    headers := '{"apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$);

SELECT cron.schedule('aiomni-sleeper-depth', '10 7 * * *',
  $job$
  SELECT net.http_post(
    url := 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/sleeper-depth-sync',
    headers := '{"apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$);

-- Season is frozen into the query string. Bump it every August, or move this
-- one onto kick_edge_function with jsonb_build_object like populate-dvp.
SELECT cron.schedule('aiomni-coaching-staff', '20 7 * * *',
  $job$
  SELECT net.http_post(
    url := 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/coaching-staff-sync?season=2026',
    headers := '{"apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$);

SELECT cron.schedule('aiomni-populate-win-totals', '35 7 * * *',
  $job$
  SELECT net.http_post(
    url := 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/populate-win-totals',
    headers := '{"apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$);

-- Season computed at fire time, not frozen into the cron string -- the reason
-- this one was wrapped in the first place (see 20260907050000).
SELECT cron.schedule('aiomni-populate-dvp', '25 7 * * *',
  $job$ SELECT public.kick_edge_function('populate-dvp',
       jsonb_build_object('season', public.nfl_season())); $job$);

-- ---------------------------------------------------------------------
-- Rankings
-- ---------------------------------------------------------------------
-- 08:00 engine reruns -> 08:05 the public JSON is regenerated from it.
SELECT cron.schedule('aiomni-rankings-rerun', '0 8 * * *',
  $job$
  SELECT net.http_post(
    url := 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/aiomni-rankings-engine-v2',
    headers := '{"apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $job$);

SELECT cron.schedule('aiomni-rankings-json', '5 8 * * *',
  $job$
  SELECT net.http_post(
    url := 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/regenerate-rankings-json',
    headers := '{"apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$);

-- Thursday 12:30 UTC = 07:30 CT, ahead of Thursday Night Football.
SELECT cron.schedule('aiomni-weekly-board', '30 12 * * 4',
  $job$ SELECT public.kick_edge_function('weekly-board'); $job$);

SELECT cron.schedule('aiomni-snapshot-rankings', '0 13 * * 4',
  $job$ SELECT public.kick_edge_function('snapshot-rankings'); $job$);

-- Tuesday scoring, after nflverse-weekly at 08:00 has landed the stats.
-- Both score the LAST week with data, so they self-discover the week.
SELECT cron.schedule('aiomni-score-rankings', '15 10 * * 2',
  $job$ SELECT public.score_ranking_week(
       public.nfl_season(),
       (SELECT COALESCE(MAX(week), 0) FROM public.nfl_weekly_stats
         WHERE season = public.nfl_season() AND season_type = 'REG')); $job$);

SELECT cron.schedule('aiomni-score-projections', '20 10 * * 2',
  $job$ SELECT public.score_projections(
       public.nfl_season(),
       (SELECT COALESCE(MAX(week),0) FROM public.nfl_weekly_stats
         WHERE season = public.nfl_season() AND season_type = 'REG')); $job$);

-- ---------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------
SELECT cron.schedule('aiomni-notification-news', '*/15 * * * *',
  $job$
  SELECT net.http_post(
    url := 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/notification-news-scanner',
    headers := '{"apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$);

SELECT cron.schedule('aiomni-notification-heat-alerts', '7 * * * *',
  $job$
  SELECT net.http_post(
    url := 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/notification-heat-alerts',
    headers := '{"apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$);

-- Sunday 16:00 UTC = 11:00 CT, two hours before the 1pm ET window.
SELECT cron.schedule('aiomni-notification-lineup', '0 16 * * 0',
  $job$
  SELECT net.http_post(
    url := 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/notification-lineup-check',
    headers := '{"apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 90000
  );
  $job$);

SELECT cron.schedule('aiomni-notification-log-purge', '5 8 * * *',
  $job$ SELECT public.purge_old_notification_log(); $job$);

-- ---------------------------------------------------------------------
-- Pipeline snapshots
-- ---------------------------------------------------------------------
-- Four fixed observation points across the Sunday-to-Tuesday window, so
-- results can be diffed against what the board said before kickoff. Labels
-- are Central; the cron expressions are UTC.
SELECT cron.schedule('aiomni-snap-sun-late-afternoon', '0 21 * * 0',
  $job$ SELECT public.capture_pipeline_snapshot('sun_4pm_ct'); $job$);

SELECT cron.schedule('aiomni-snap-sun-evening', '0 0 * * 1',
  $job$ SELECT public.capture_pipeline_snapshot('sun_7pm_ct'); $job$);

SELECT cron.schedule('aiomni-snap-sun-midnight', '0 5 * * 1',
  $job$ SELECT public.capture_pipeline_snapshot('sun_midnight_ct'); $job$);

SELECT cron.schedule('aiomni-snap-mon-midnight', '0 5 * * 2',
  $job$ SELECT public.capture_pipeline_snapshot('mon_midnight_ct'); $job$);

-- ---------------------------------------------------------------------
-- Housekeeping
-- ---------------------------------------------------------------------
SELECT cron.schedule('aiomni-sweep-expired-tiers', '5 * * * *',
  $job$ SELECT public.sweep_expired_tiers(); $job$);

SELECT cron.schedule('aiomni-proxy-rate-limit-purge', '0 * * * *',
  $job$ SELECT public.purge_proxy_rate_limit(); $job$);

SELECT cron.schedule('aiomni-security-events-purge', '15 8 * * *',
  $job$ SELECT public.purge_security_events(); $job$);
