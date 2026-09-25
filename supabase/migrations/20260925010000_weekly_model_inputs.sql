-- Inputs and outputs for the rebuilt weekly rankings (2026-09-25).
--
-- WHY A REBUILD. The weekly board was the season engine plus nudges, and every
-- fix on 2026-09-24 was a patch around that foundation: season totals where a
-- week needs a per-game rate, swings of 176 spots, a base 0.10 Spearman behind
-- the market before any weekly code ran. The new weekly rankings never read
-- nfl_proprietary_rankings_v2. They are an ensemble of four independent views:
--
--   recency  -- last-5 / last-7 games blended, with usage spikes checked
--               against injuries and depth-chart changes
--   matchup  -- current season only: what each defense allowed to a ROLE
--               (WR1, RB1, ...) relative to that player's norm, applied to
--               this week's player in the same role, with Vegas and weather
--   context  -- current season only: usage, production, opponent strength,
--               travel and weather
--   manual   -- the top 25 per position ranked by hand (manual_weekly_rankings)
--
-- The model code is shared with the local backtest harness
-- (supabase/functions/_shared/weekly, scripts/weekly), so what ships is what
-- was measured.
--
-- NEW INPUTS. The models need four things we did not store. All come from
-- nflverse and are synced by nflverse-context-sync:
--
--   nfl_games           lines, rest days, roof, neutral sites, kickoff temp/wind
--   nfl_snap_counts     offense snap share -- the only way to see a player (or
--                       a teammate) leave a game early
--   nfl_injury_reports  the official Wed-Fri report with final game status,
--                       historical, unlike Sleeper's live-only field
--   nfl_depth_weekly    the last depth chart before each team's kickoff

CREATE TABLE IF NOT EXISTS public.nfl_games (
  game_id      text PRIMARY KEY,
  season       integer NOT NULL,
  week         integer NOT NULL,
  gameday      text, gametime text, weekday text,
  away_team    text NOT NULL,
  home_team    text NOT NULL,
  away_score   integer, home_score integer,
  location     text,             -- Home | Neutral
  away_rest    integer, home_rest integer,
  spread_line  numeric,          -- HOME team's view: positive = home favoured
  total_line   numeric,
  div_game     boolean,
  roof         text, surface text,
  temp         numeric, wind numeric,   -- at kickoff, played games only
  stadium_id   text, stadium text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nfl_games_sw_idx ON public.nfl_games (season, week);

CREATE TABLE IF NOT EXISTS public.nfl_snap_counts (
  game_id        text NOT NULL,
  pfr_player_id  text NOT NULL,
  season         integer NOT NULL,
  week           integer NOT NULL,
  gsis_id        text,           -- resolved via nfl_players.pfr_id; null when unmapped
  player_name    text,
  position       text,
  team           text,
  opponent       text,
  offense_snaps  integer,
  offense_pct    numeric,
  PRIMARY KEY (game_id, pfr_player_id)
);
CREATE INDEX IF NOT EXISTS nfl_snaps_sw_idx ON public.nfl_snap_counts (season, week);
CREATE INDEX IF NOT EXISTS nfl_snaps_gsis_idx ON public.nfl_snap_counts (gsis_id);

CREATE TABLE IF NOT EXISTS public.nfl_injury_reports (
  season                 integer NOT NULL,
  week                   integer NOT NULL,
  gsis_id                text NOT NULL,
  team                   text,
  player_name            text,
  position               text,
  report_status          text,   -- final game status: Out | Doubtful | Questionable | null
  report_primary_injury  text,
  practice_status        text,
  PRIMARY KEY (season, week, gsis_id)
);

CREATE TABLE IF NOT EXISTS public.nfl_depth_weekly (
  season       integer NOT NULL,
  week         integer NOT NULL,
  team         text NOT NULL,
  player_name  text NOT NULL,
  slot         text NOT NULL,
  gsis_id      text,
  position     text NOT NULL,
  slot_rank    integer NOT NULL,
  captured_at  timestamptz NOT NULL,
  PRIMARY KEY (season, week, team, player_name, slot)
);
CREATE INDEX IF NOT EXISTS nfl_depth_weekly_gsis_idx ON public.nfl_depth_weekly (gsis_id, season, week);

COMMENT ON TABLE public.nfl_depth_weekly IS
  'Offensive skill-position depth chart (nflverse/ESPN), the last snapshot before each team''s kickoff. Rows for a team-week stop changing once that team kicks off, so it is safe to grade against.';

-- Skill-position stat lines with name and position, in the row shape the
-- weekly models read (types.ts StatRow). A view rather than a copy so it can
-- never drift from nfl_weekly_stats.
CREATE OR REPLACE VIEW public.weekly_model_stats WITH (security_invoker = true) AS
SELECT s.season, s.week, s.gsis_id, p.full_name AS player_name,
       CASE WHEN p.position = 'FB' THEN 'RB' ELSE p.position END AS position,
       s.team, s.opponent,
       COALESCE(s.attempts, 0) AS attempts, COALESCE(s.completions, 0) AS completions,
       COALESCE(s.passing_yards, 0) AS passing_yards, COALESCE(s.passing_tds, 0) AS passing_tds,
       COALESCE(s.interceptions, 0) AS interceptions,
       COALESCE(s.carries, 0) AS carries, COALESCE(s.rushing_yards, 0) AS rushing_yards,
       COALESCE(s.rushing_tds, 0) AS rushing_tds,
       COALESCE(s.targets, 0) AS targets, COALESCE(s.receptions, 0) AS receptions,
       COALESCE(s.receiving_yards, 0) AS receiving_yards, COALESCE(s.receiving_tds, 0) AS receiving_tds,
       COALESCE(s.receiving_air_yards, 0) AS receiving_air_yards,
       s.target_share, s.air_yards_share, s.wopr, s.fantasy_pts_ppr
  FROM public.nfl_weekly_stats s
  JOIN public.nfl_players p USING (gsis_id)
 WHERE s.season_type = 'REG'
   AND p.position IN ('QB', 'RB', 'WR', 'TE', 'FB');

-- ── outputs ────────────────────────────────────────────────────────────────
-- One row per model per player per week, so every component of the ensemble
-- can be inspected and graded on its own.
CREATE TABLE IF NOT EXISTS public.weekly_model_rankings (
  season       integer NOT NULL,
  week         integer NOT NULL,
  model        text    NOT NULL,     -- recency | matchup | context
  gsis_id      text    NOT NULL,
  player_name  text,
  position     text,
  team         text,
  opponent     text,
  proj         numeric,
  pos_rank     integer,
  notes        text[],
  detail       jsonb,
  computed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season, week, model, gsis_id)
);

-- The ensemble: what the app will show once it earns the switch from
-- nfl_weekly_board.
CREATE TABLE IF NOT EXISTS public.weekly_rankings (
  season         integer NOT NULL,
  week           integer NOT NULL,
  gsis_id        text    NOT NULL,
  sleeper_id     text,
  player_name    text,
  position       text,
  team           text,
  opponent       text,
  pos_rank       integer,
  ensemble_score numeric,           -- mean component rank; lower is better
  rank_recency   integer,
  rank_matchup   integer,
  rank_context   integer,
  rank_manual    integer,           -- null when not in the manual top 25
  proj_pts       numeric,           -- mean of the three model projections
  injury_status  text,
  notes          text[],
  computed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season, week, gsis_id)
);
CREATE INDEX IF NOT EXISTS weekly_rankings_pos_idx ON public.weekly_rankings (season, week, position, pos_rank);

ALTER TABLE public.nfl_games             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nfl_snap_counts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nfl_injury_reports    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nfl_depth_weekly      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_model_rankings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_rankings       ENABLE ROW LEVEL SECURITY;
