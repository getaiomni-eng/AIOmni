-- Injury and depth-chart persistence (2026-09-24).
--
-- None of this was stored anywhere. Every question about who is hurt or who is
-- second on a depth chart meant a live fetch of Sleeper's 5 MB player blob and
-- a throwaway script, and a correction to a wrong injury status meant editing
-- WEEKLY_INJURY_OVERRIDES in weekly-board and redeploying the function.
--
-- IT ALSO UNBLOCKS THE DEPTH MULTIPLIER. That block in the engine carries the
-- comment "Disabled in backtest (depth chart not historical)" -- so the
-- coefficients have never been measured, and they are badly wrong. Against
-- real 2025 production a team's TE2 scores 44% of its TE1, while the engine
-- charges TE2 0.98. That is why a doubtful TE4 (Goedert), two backup tight
-- ends and a third-string QB (J.J. McCarthy) are inside our week-3 top 25.
-- Sleeper serves only CURRENT depth charts with no history endpoint, so the
-- weekly archive below is the only way that coefficient ever becomes testable.
-- Nothing reads it yet; it accumulates until there is enough to backtest.
--
-- THREE TABLES, because freshness and grading are different jobs and one table
-- cannot honestly do both. A row that keeps being updated is right for "who is
-- hurt right now" and wrong for "what did we know before kickoff" -- mixing
-- them is how look-ahead contamination gets in.

-- 1. CURRENT MIRROR. Upserted on every sync, latest always wins. This is what
-- the board and ad-hoc queries read.
CREATE TABLE IF NOT EXISTS public.nfl_player_status (
  sleeper_id             text PRIMARY KEY,
  gsis_id                text,
  player_name            text,
  position               text,
  team                   text,
  status                 text,          -- Active / Inactive / Injured Reserve ...
  injury_status          text,          -- Questionable / Doubtful / Out ...
  injury_body_part       text,
  injury_notes           text,
  practice_participation text,
  practice_description   text,
  depth_chart_order      integer,
  depth_chart_position   text,
  active                 boolean,
  years_exp              integer,
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS player_status_gsis_idx  ON public.nfl_player_status (gsis_id);
CREATE INDEX IF NOT EXISTS player_status_depth_idx ON public.nfl_player_status (team, position, depth_chart_order);
CREATE INDEX IF NOT EXISTS player_status_inj_idx   ON public.nfl_player_status (injury_status) WHERE injury_status IS NOT NULL;

COMMENT ON TABLE public.nfl_player_status IS
  'Live mirror of Sleeper injury and depth-chart state, one row per player, refreshed every sync. For "what did we know before kickoff", use nfl_player_status_weekly instead.';

-- 2. FROZEN WEEKLY ARCHIVE. Write-once per week, same rule as
-- ranking_snapshots: the first capture of a week is the record. Later syncs in
-- the same week leave it alone, so post-game injury news can never rewrite
-- what we knew beforehand.
CREATE TABLE IF NOT EXISTS public.nfl_player_status_weekly (
  season                 integer NOT NULL,
  week                   integer NOT NULL,
  sleeper_id             text    NOT NULL,
  gsis_id                text,
  player_name            text,
  position               text,
  team                   text,
  status                 text,
  injury_status          text,
  injury_body_part       text,
  practice_participation text,
  depth_chart_order      integer,
  depth_chart_position   text,
  captured_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season, week, sleeper_id)
);
CREATE INDEX IF NOT EXISTS player_status_wk_idx   ON public.nfl_player_status_weekly (season, week, position);
CREATE INDEX IF NOT EXISTS player_status_wk_gsis  ON public.nfl_player_status_weekly (gsis_id, season, week);

COMMENT ON TABLE public.nfl_player_status_weekly IS
  'Injury and depth-chart state frozen at the first capture of each week. Sleeper has no history endpoint, so a week not captured before kickoff is gone permanently. This is the table that makes the depth-chart multiplier backtestable.';

-- 3. MANUAL OVERRIDES, replacing the hardcoded WEEKLY_INJURY_OVERRIDES map in
-- weekly-board. Sleeper's feed lags the Friday practice report, and the fix
-- used to be a code edit plus a function deploy. Now it is one INSERT.
--
-- Keyed by normalized name + position, not an id, so a correction can be typed
-- from a news alert without looking anything up. Position is part of the key
-- because same-name collisions across positions are real here and a name-only
-- join has already put a linebacker's "Out" on Justin Jefferson once.
--
-- NULL week means "until removed"; a set week applies to that week only.
CREATE TABLE IF NOT EXISTS public.player_status_overrides (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  season            integer,
  week              integer,
  norm_name         text NOT NULL,
  position          text NOT NULL,
  injury_status     text,
  depth_chart_order integer,
  reason            text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS status_override_key
  ON public.player_status_overrides (norm_name, position, COALESCE(season,0), COALESCE(week,0));

COMMENT ON TABLE public.player_status_overrides IS
  'Manual injury/depth corrections applied on top of the Sleeper feed. Replaces a hardcoded map that required a function redeploy to change. norm_name is lowercase, punctuation and generational suffix stripped.';

ALTER TABLE public.nfl_player_status        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nfl_player_status_weekly ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_status_overrides  ENABLE ROW LEVEL SECURITY;

-- Carry over the one override that currently lives in code.
INSERT INTO public.player_status_overrides (season, week, norm_name, position, injury_status, reason)
VALUES (2026, 3, 'brock bowers', 'TE', 'Questionable',
        'Sleeper feed lagged the Friday practice report; migrated from WEEKLY_INJURY_OVERRIDES in weekly-board')
ON CONFLICT DO NOTHING;
