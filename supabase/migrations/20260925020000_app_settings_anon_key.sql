-- Restore app_settings.anon_key (2026-09-25).
--
-- Thirteen cron jobs build their auth header from
--   (SELECT value FROM public.app_settings WHERE key = 'anon_key')
-- but that row does not exist: app_settings holds one row (hosted_notify_secret).
-- The subquery returns NULL, jsonb_build_object keeps the NULL, and the edge
-- runtime answers 401 UNAUTHORIZED_NO_AUTH_HEADER. Found when the first manual
-- runs of nflverse-context-sync and weekly-rankings came back 401.
--
-- Affected: expert-harvest, schedule-sync, trade-corpus, weekly-board-daily,
-- -sunday, -tuesday, player-status-daily/-sunday/-archive,
-- nflverse-context-daily/-sunday, weekly-rankings-daily/-sunday.
--
-- kick_edge_function() never failed because it falls back to a hardcoded key
-- when the row is missing. That fallback is the project's ANON key (JWT role
-- "anon", public by design: it ships in the app bundle and already appears in
-- five earlier migrations). Copy it from there rather than paste it again, so
-- there is one source of truth for the value.
INSERT INTO public.app_settings (key, value, updated_at)
SELECT 'anon_key',
       (regexp_match(pg_get_functiondef('public.kick_edge_function'::regproc),
                     'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+'))[1],
       now()
ON CONFLICT (key) DO NOTHING;

-- Fail the migration loudly rather than leave the crons broken.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'anon_key' AND value LIKE 'eyJ%') THEN
    RAISE EXCEPTION 'anon_key was not restored';
  END IF;
END $$;
