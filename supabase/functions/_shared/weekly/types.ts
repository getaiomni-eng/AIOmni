// Shared contract for the weekly ranking models.
//
// Every model is a pure function WeekInput -> ModelRow[]. No fetch, no Deno or
// Node APIs, so the same file runs in the weekly-rankings edge function and in
// the local backtest harness (scripts/weekly). Row shapes mirror the Postgres
// tables one-for-one.
//
// LEAKAGE RULE. Whoever builds a WeekInput for (season, week) passes only
// stats and snaps from BEFORE that week. Injury reports, depth charts, lines
// and forecasts for the target week are allowed: all of them exist before
// kickoff. Models must never reach around this -- there is nothing to reach,
// by construction.

export type Pos = 'QB' | 'RB' | 'WR' | 'TE';

// nfl_weekly_stats joined to nfl_players for name/position. PPR.
export interface StatRow {
  season: number; week: number;
  gsis_id: string; player_name: string; position: Pos;
  team: string; opponent: string;
  attempts: number; completions: number; passing_yards: number; passing_tds: number; interceptions: number;
  carries: number; rushing_yards: number; rushing_tds: number;
  targets: number; receptions: number; receiving_yards: number; receiving_tds: number;
  receiving_air_yards: number;
  target_share: number | null; air_yards_share: number | null; wopr: number | null;
  fantasy_pts_ppr: number | null;
}

// nfl_games (nflverse games.csv). spread_line is from the HOME team's view:
// positive = home favoured. Scores are null for unplayed games.
export interface GameRow {
  game_id: string; season: number; week: number;
  gameday: string; gametime: string; weekday: string;
  away_team: string; home_team: string;
  away_score: number | null; home_score: number | null;
  location: string;                 // 'Home' | 'Neutral'
  away_rest: number | null; home_rest: number | null;
  spread_line: number | null; total_line: number | null;
  div_game: boolean;
  roof: string | null;              // outdoors | dome | closed | open
  surface: string | null;
  temp: number | null; wind: number | null;   // at kickoff, played games only
  stadium_id: string; stadium: string;
}

// nfl_snap_counts. gsis_id resolved from pfr id; null when unmapped.
export interface SnapRow {
  season: number; week: number; game_id: string;
  gsis_id: string | null; pfr_player_id: string; player_name: string;
  position: Pos; team: string; opponent: string;
  offense_snaps: number | null; offense_pct: number | null;
}

// nfl_injury_reports (official NFL report; report_status is the final game status).
export interface InjuryRow {
  season: number; week: number; team: string;
  gsis_id: string; player_name: string; position: Pos;
  report_status: string | null;        // Out | Doubtful | Questionable | null
  report_primary_injury: string | null;
  practice_status: string | null;
}

// nfl_depth_weekly: the last depth-chart snapshot before each team's kickoff.
export interface DepthRow {
  season: number; week: number; team: string;
  gsis_id: string | null; player_name: string; position: Pos;
  slot: string; slot_rank: number;     // 1 = starter in that slot
  captured_at: string;
}

// nfl_player_status (live Sleeper mirror). Only present for the live week.
export interface StatusRow {
  sleeper_id: string; gsis_id: string | null; player_name: string; position: Pos; team: string;
  status: string | null; injury_status: string | null; practice_participation: string | null;
  depth_chart_order: number | null; depth_chart_position: string | null;
}

export interface Forecast { wind: number | null; temp: number | null; precip: boolean | null }

// One player the models are asked to rank this week. Built once by
// common.buildPool so every model ranks the SAME players -- otherwise the
// ensemble compares different sets and the backtest is not a fair fight.
export interface PoolPlayer {
  gsis_id: string; player_name: string; position: Pos;
  team: string; opponent: string; game_id: string; home: boolean;
  injury_status: string | null;       // official report status for the target week
  practice_status: string | null;
  depth_rank: number | null;          // best slot_rank on the target-week chart
  rookie: boolean;
  draft_round: number | null; draft_pick: number | null;
}

export interface WeekInput {
  season: number; week: number;
  stats: StatRow[];          // strictly before (season, week); includes prior seasons
  games: GameRow[];          // all loaded games, target week included (scores null)
  snaps: SnapRow[];          // strictly before (season, week)
  injuries: InjuryRow[];     // up to and including the target week
  depth: DepthRow[];         // weeks <= target
  status?: StatusRow[];      // live week only
  forecast?: Record<string, Forecast>;  // game_id -> kickoff forecast; live week only
  pool: PoolPlayer[];
}

export interface ModelRow {
  gsis_id: string; position: Pos;
  proj: number;              // projected PPR points this week; higher = better
  notes?: string[];          // human-readable reasons ("usage spike: teammate X out")
  detail?: Record<string, number | string | boolean | null>;
}

export type WeeklyModel = (input: WeekInput) => ModelRow[];
