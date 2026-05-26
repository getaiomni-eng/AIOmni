-- Security event log. Foundation for future alerting / SIEM integration.
-- Edge functions and triggers write here; never write client-side.
--
-- Bounded by automatic 90-day TTL purge — events older than that have
-- almost no investigative value relative to their disk cost.

CREATE TABLE IF NOT EXISTS public.security_events (
  id          BIGSERIAL    PRIMARY KEY,
  kind        TEXT         NOT NULL,           -- 'auth_fail' | 'rate_limit' | 'admin_action' | 'unusual_spend' | ...
  user_id     UUID,                            -- nullable: not all events tie to a user
  ip          TEXT,
  scope       TEXT,                            -- which proxy / function triggered the event
  detail      JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_events_recent
  ON public.security_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_kind
  ON public.security_events(kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_user
  ON public.security_events(user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

-- RLS: locked down. Only service role writes. No reads from the client
-- — security events frequently include IPs + user-ids that one user
-- shouldn't see for another. Read via Supabase dashboard or admin
-- backplane only.
ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;

-- Convenience writer. Edge functions call this RPC so they don't need
-- to construct INSERT SQL inline.
CREATE OR REPLACE FUNCTION public.log_security_event(
  p_kind   TEXT,
  p_user   UUID,
  p_ip     TEXT,
  p_scope  TEXT,
  p_detail JSONB
) RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO public.security_events (kind, user_id, ip, scope, detail)
  VALUES (p_kind, p_user, p_ip, p_scope, COALESCE(p_detail, '{}'::jsonb));
$$;

-- TTL purge: drop events older than 90 days. Runs daily.
CREATE OR REPLACE FUNCTION public.purge_security_events()
RETURNS void
LANGUAGE sql
AS $$
  DELETE FROM public.security_events
  WHERE created_at < now() - INTERVAL '90 days';
$$;

CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule(
  'aiomni-security-events-purge',
  '15 8 * * *',
  $$ SELECT public.purge_security_events(); $$
);
