-- AIOmni notifications v1 — Tier A: player news + lineup warning.
-- Adds per-user push token + opt-in prefs, a server-side roster cache
-- (so notification jobs can match without holding platform creds), and
-- a notification log to dedupe.

-- ── users: push_token + per-type opt-in prefs ──────────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS push_token TEXT,
  ADD COLUMN IF NOT EXISTS notification_prefs JSONB
    NOT NULL DEFAULT '{"player_news": true, "lineup_warning": true, "pulse_alerts": true}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_users_push_token
  ON public.users(push_token)
  WHERE push_token IS NOT NULL;

-- ── user_rostered_players: flat list of normalized player names ─────────
-- Server-side notification jobs don't have access to client OAuth tokens
-- (ESPN/Yahoo/MFL/FF creds live in AsyncStorage). The client syncs this
-- table whenever it loads rosters; the news-scanner reads from here.
CREATE TABLE IF NOT EXISTS public.user_rostered_players (
  user_id          UUID        NOT NULL REFERENCES public.users(auth_id) ON DELETE CASCADE,
  normalized_name  TEXT        NOT NULL,
  display_name     TEXT        NOT NULL,
  league_id        TEXT,           -- nullable; helps target lineup-warning
  platform         TEXT,           -- 'sleeper'|'espn'|'yahoo'|'mfl'|'fleaflicker'
  position         TEXT,
  team             TEXT,
  is_starter       BOOLEAN     NOT NULL DEFAULT false,
  synced_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, normalized_name, league_id)
);

CREATE INDEX IF NOT EXISTS idx_user_rostered_players_normalized
  ON public.user_rostered_players(normalized_name);

CREATE INDEX IF NOT EXISTS idx_user_rostered_players_user_synced
  ON public.user_rostered_players(user_id, synced_at DESC);

-- ── notification_log: dedupe (no double-fires for the same trigger) ────
CREATE TABLE IF NOT EXISTS public.notification_log (
  id          BIGSERIAL    PRIMARY KEY,
  user_id     UUID         NOT NULL REFERENCES public.users(auth_id) ON DELETE CASCADE,
  kind        TEXT         NOT NULL,   -- 'player_news'|'lineup_warning'|...
  dedupe_key  TEXT         NOT NULL,   -- e.g. news article URL, "lineup:<league_id>:<isoweek>"
  sent_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  title       TEXT,
  body        TEXT,
  UNIQUE (user_id, kind, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_notification_log_user_sent
  ON public.notification_log(user_id, sent_at DESC);

-- Auto-purge log entries older than 30 days (notifications never re-fire
-- after that long anyway, and the dedupe table would grow unbounded).
CREATE OR REPLACE FUNCTION public.purge_old_notification_log()
RETURNS void
LANGUAGE sql
AS $$
  DELETE FROM public.notification_log
  WHERE sent_at < now() - INTERVAL '30 days';
$$;

-- ── RLS ────────────────────────────────────────────────────────────────
ALTER TABLE public.user_rostered_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_log      ENABLE ROW LEVEL SECURITY;

-- Each user can read/write only their own rostered_players rows.
CREATE POLICY user_rostered_players_owner ON public.user_rostered_players
  FOR ALL TO authenticated
  USING      (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Each user can read their own notification_log; only the service role
-- writes. (Edge functions use the service role key.)
CREATE POLICY notification_log_owner_read ON public.notification_log
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
