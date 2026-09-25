-- Run social-publisher every 10 minutes (2026-09-26).
--
-- Publishes social_posts rows whose veto window has passed (status 'queued',
-- mode auto/semi, publish_at <= now). Does nothing while
-- app_settings.social_autopost is not 'on'. Same auth pattern as the other
-- crons: the anon key from app_settings (restored 2026-09-25).

SELECT cron.schedule('aiomni-social-publisher', '*/10 * * * *', $$
  SELECT net.http_post(
    url := 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/social-publisher',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'apikey',        (SELECT value FROM public.app_settings WHERE key = 'anon_key'),
      'Authorization', 'Bearer ' || (SELECT value FROM public.app_settings WHERE key = 'anon_key')),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
$$);
