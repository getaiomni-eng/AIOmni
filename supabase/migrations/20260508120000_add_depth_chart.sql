-- Adds depth_chart_position + depth_chart_order to nfl_players.
-- Synced periodically from Sleeper's /players/nfl endpoint by
-- supabase/functions/sleeper-depth-sync. Used by aiomni-rankings-engine
-- for heir selection (vacancy detection) and surrounding cast multipliers.
ALTER TABLE nfl_players
  ADD COLUMN IF NOT EXISTS depth_chart_position text,
  ADD COLUMN IF NOT EXISTS depth_chart_order    int;

CREATE INDEX IF NOT EXISTS idx_nfl_players_depth_chart
  ON nfl_players (team, position, depth_chart_order);
