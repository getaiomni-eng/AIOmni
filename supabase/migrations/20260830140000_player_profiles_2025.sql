-- Rebuild player_profiles for the 2025 season (2026-08-30)
--
-- WHY: player_profiles is what the AI Coach reads for player intelligence
-- (via the player-lookup edge function). It held ONLY 2024 rows, written
-- once by hand on 2026-04-04. Nothing in the repo creates or fills this
-- table — there is no sync feeding it, so it was never going to advance
-- on its own. In August 2026 the Coach was citing two-year-old production
-- to people drafting for 2026, and doing it with no date on the numbers.
--
-- The data to fix it was already here: nfl_weekly_stats holds 41,979 rows
-- including a complete 2025 REG season (weeks 1-18), synced by
-- nflverse-weekly-sync. That function writes to nfl_weekly_stats, NOT to
-- player_profiles, which is why a healthy sync never helped.
--
-- Verified before writing: gsis 00-0039075 (Nacua) aggregates to 16 games /
-- 375.0 PPR / 166 tgt / 1715 yds / 30.1% target share; gsis 00-0038542
-- (Bijan) to 17 games / 370.8 PPR / 287 car / 1478 rush yds. Row count
-- equals active-week count for both, so COUNT(*) is a sound games proxy.
--
-- NOTES
--  · target_share is stored as a FRACTION in nfl_weekly_stats (0.5909) and
--    as a PERCENT in player_profiles (32.5). Hence the x100.
--  · dynasty_value is not derivable from box scores — it is carried forward
--    from each player's 2024 row and left NULL for players with no 2024 row.
--    The formatter already omits it when absent.
--  · 2024 rows are KEPT. They are the only source of dynasty_value, and the
--    edge function now selects the latest season rather than assuming one.
--  · age lives in nfl_players, not player_profiles — the formatter was
--    emitting the literal string "Age undefined" into the Coach prompt for
--    every player. Add the column and populate it.

ALTER TABLE player_profiles ADD COLUMN IF NOT EXISTS age int;

-- Idempotent: re-running replaces the 2025 slice rather than duplicating it.
DELETE FROM player_profiles WHERE season = 2025;

INSERT INTO player_profiles (
  player_id, name, position, team, season, games, age,
  targets, receptions, rec_yards, rec_tds,
  carries, rush_yards, rush_tds,
  passing_yards, passing_tds, interceptions,
  total_points, target_share, air_yards, dynasty_value, updated_at
)
SELECT
  w.gsis_id,
  COALESCE(p.full_name, p.display_name),
  p.position,
  p.team,
  2025,
  COUNT(*)::int,
  MAX(p.age)::int,
  SUM(w.targets)::int,
  SUM(w.receptions)::int,
  SUM(w.receiving_yards)::int,
  SUM(w.receiving_tds)::int,
  SUM(w.carries)::int,
  SUM(w.rushing_yards)::int,
  SUM(w.rushing_tds)::int,
  SUM(w.passing_yards)::int,
  SUM(w.passing_tds)::int,
  SUM(w.interceptions)::int,
  ROUND(SUM(w.fantasy_pts_ppr)::numeric, 2),
  ROUND((AVG(NULLIF(w.target_share, 0)) * 100)::numeric, 1),
  SUM(w.receiving_air_yards)::int,
  MAX(prev.dynasty_value)::int,
  NOW()
FROM nfl_weekly_stats w
JOIN nfl_players p
  ON p.gsis_id = w.gsis_id
LEFT JOIN player_profiles prev
  ON prev.player_id = w.gsis_id
 AND prev.season    = 2024
WHERE w.season      = 2025
  AND w.season_type = 'REG'
  AND p.position IN ('QB','RB','WR','TE')
GROUP BY w.gsis_id, p.full_name, p.display_name, p.position, p.team
HAVING SUM(w.fantasy_pts_ppr) > 0;
