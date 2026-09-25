-- Capture crowd ownership/start rates (2026-09-24).
--
-- ESPN's kona_player_info carries player.ownership.percentStarted -- the share
-- of ESPN leagues that actually START a player in a given week, across
-- millions of teams. That is the weekly start/sit question answered by the
-- crowd, and it is the single largest behavioural dataset available to us. We
-- were not storing it.
--
-- Also captures percentOwned (rostered vs available) and the ESPN ADP fields,
-- so roster churn is visible week to week.
--
-- CAPTURE-FIRST, deliberately. ESPN serves only CURRENT values -- there is no
-- history endpoint. Exactly like the KTC snapshots and the expert rankings,
-- a week not captured before kickoff can never be reconstructed, so this
-- cannot be validated before it is collected. Nothing reads it yet; it
-- accumulates until there is enough to backtest against.
--
-- Our own linked leagues give the same signal at a far smaller scale (467
-- roster rows across 25 leagues), so they stay a cross-check rather than the
-- primary source.
CREATE TABLE IF NOT EXISTS public.player_ownership_snapshots (
  season          integer     NOT NULL,
  week            integer     NOT NULL,
  provider        text        NOT NULL DEFAULT 'espn',
  gsis_id         text        NOT NULL,
  player_name     text,
  position        text,
  percent_owned   numeric,
  percent_started numeric,
  percent_change  numeric,
  adp             numeric,
  captured_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season, week, provider, gsis_id)
);

COMMENT ON TABLE public.player_ownership_snapshots IS
  'Weekly crowd ownership and start rates from ESPN, across millions of leagues. percent_started is the crowd answering the same weekly start/sit question our board answers. No history endpoint exists, so gaps here are permanent.';

CREATE INDEX IF NOT EXISTS ownership_week_idx
  ON public.player_ownership_snapshots (season, week, provider);

ALTER TABLE public.player_ownership_snapshots ENABLE ROW LEVEL SECURITY;
