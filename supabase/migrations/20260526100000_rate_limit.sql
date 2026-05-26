-- Per-IP rate-limit storage for edge function proxies.
--
-- Each row is one bucket: (scope, ip, window_start) — incremented on
-- every request, periodically purged. The window is 60s; cap defaults
-- to 60 req/window per (scope, ip).
--
-- Why a table instead of in-memory: Supabase edge functions are stateless
-- and warm-pool instances aren't sticky per IP. A shared store is the
-- simplest correct option that doesn't require Redis. Cost is one
-- INSERT/UPDATE per proxied request — negligible at this scale.

CREATE TABLE IF NOT EXISTS public.proxy_rate_limit (
  scope         TEXT         NOT NULL,        -- 'claude-proxy' | 'external-api-proxy' | …
  ip            TEXT         NOT NULL,        -- request source IP
  window_start  TIMESTAMPTZ  NOT NULL,        -- bucket boundary (truncated to minute)
  hits          INTEGER      NOT NULL DEFAULT 1,
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, ip, window_start)
);

CREATE INDEX IF NOT EXISTS idx_proxy_rate_limit_purge
  ON public.proxy_rate_limit(window_start);

-- RLS: only the service role (edge functions) touches this table; no
-- client-side access whatsoever.
ALTER TABLE public.proxy_rate_limit ENABLE ROW LEVEL SECURITY;
-- (no policies → all non-service-role access denied by default)

-- Purge windows older than 1 hour. Runs on its own cron schedule below.
CREATE OR REPLACE FUNCTION public.purge_proxy_rate_limit()
RETURNS void
LANGUAGE sql
AS $$
  DELETE FROM public.proxy_rate_limit
  WHERE window_start < now() - INTERVAL '1 hour';
$$;

-- Atomic increment-or-insert. Edge functions call this RPC to avoid
-- a race where two concurrent requests both think the bucket doesn't
-- exist and both INSERT. Returns the new hit count for the bucket.
CREATE OR REPLACE FUNCTION public.proxy_rate_limit_bump(
  p_scope TEXT,
  p_ip    TEXT
) RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_window TIMESTAMPTZ := date_trunc('minute', now());
  v_count  INTEGER;
BEGIN
  INSERT INTO public.proxy_rate_limit (scope, ip, window_start, hits, updated_at)
  VALUES (p_scope, p_ip, v_window, 1, now())
  ON CONFLICT (scope, ip, window_start) DO UPDATE
    SET hits = proxy_rate_limit.hits + 1, updated_at = now()
  RETURNING hits INTO v_count;
  RETURN v_count;
END;
$$;

-- Cron: purge old rate-limit rows hourly.
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule(
  'aiomni-proxy-rate-limit-purge',
  '0 * * * *',
  $$ SELECT public.purge_proxy_rate_limit(); $$
);
