#!/usr/bin/env python3
"""
Extend services/nflPlayers.ts with stats helpers:
  - WeeklyStat / PlayerSeason types
  - getPlayerSeasonStats(gsisId, season)
  - getLastNGames(gsisId, n)
  - getCurrentSeason()
"""
path = 'services/nflPlayers.ts'
with open(path) as f: content = f.read()

# Only add if not already there
if "export async function getPlayerSeasonStats" in content:
    print("Stats helpers already present")
else:
    addition = '''

// ═══════════════════════════════════════════════════════════
// STATS HELPERS (Session 2)
// ═══════════════════════════════════════════════════════════

export interface WeeklyStat {
  gsis_id: string;
  season: number;
  week: number;
  season_type: string;
  team: string | null;
  opponent: string | null;
  completions: number;
  attempts: number;
  passing_yards: number;
  passing_tds: number;
  interceptions: number;
  carries: number;
  rushing_yards: number;
  rushing_tds: number;
  targets: number;
  receptions: number;
  receiving_yards: number;
  receiving_tds: number;
  target_share: number | null;
  fantasy_pts_std: number;
  fantasy_pts_half: number;
  fantasy_pts_ppr: number;
}

export interface PlayerSeason {
  season: number;
  games_played: number;
  total_ppr: number;
  avg_ppr: number;
  avg_half: number;
  avg_std: number;
  ceiling: number;   // Best single-week PPR
  floor: number;     // Worst single-week PPR (games played only)
  games_20plus: number;
  total_pass_yds: number;
  total_pass_tds: number;
  total_rush_yds: number;
  total_rush_tds: number;
  total_rec: number;
  total_tgts: number;
  total_rec_yds: number;
  total_rec_tds: number;
}

/**
 * Get all weekly stats for a player in a given season.
 * Returns most recent week first.
 */
export async function getWeeklyStats(
  gsisId: string,
  season?: number
): Promise<WeeklyStat[]> {
  let query = supabase
    .from('nfl_weekly_stats')
    .select('*')
    .eq('gsis_id', gsisId)
    .eq('season_type', 'REG');

  if (season) query = query.eq('season', season);

  const { data, error } = await query.order('week', { ascending: false });
  if (error) {
    console.log('getWeeklyStats error:', error);
    return [];
  }
  return (data as WeeklyStat[]) ?? [];
}

/**
 * Get the most recent N games for a player across seasons.
 */
export async function getLastNGames(
  gsisId: string,
  n: number = 5
): Promise<WeeklyStat[]> {
  const { data, error } = await supabase
    .from('nfl_weekly_stats')
    .select('*')
    .eq('gsis_id', gsisId)
    .eq('season_type', 'REG')
    .order('season', { ascending: false })
    .order('week',   { ascending: false })
    .limit(n);

  if (error) {
    console.log('getLastNGames error:', error);
    return [];
  }
  return (data as WeeklyStat[]) ?? [];
}

/**
 * Compute a player's season summary (games, totals, PPG, ceiling, floor).
 */
export async function getPlayerSeasonStats(
  gsisId: string,
  season: number
): Promise<PlayerSeason | null> {
  const weeks = await getWeeklyStats(gsisId, season);
  if (weeks.length === 0) return null;

  const played = weeks.filter(w =>
    (w.attempts ?? 0) > 0 ||
    (w.carries ?? 0) > 0 ||
    (w.targets ?? 0) > 0
  );
  const gamesPlayed = played.length;
  if (gamesPlayed === 0) return null;

  const pprPoints = played.map(w => w.fantasy_pts_ppr ?? 0);
  const totalPPR  = pprPoints.reduce((a, b) => a + b, 0);
  const ceiling   = Math.max(...pprPoints);
  const floor     = Math.min(...pprPoints);
  const games20   = pprPoints.filter(p => p >= 20).length;

  const sum = (field: keyof WeeklyStat) =>
    weeks.reduce((a, w) => a + (Number(w[field]) || 0), 0);

  return {
    season,
    games_played: gamesPlayed,
    total_ppr:  Math.round(totalPPR * 10) / 10,
    avg_ppr:    Math.round((totalPPR / gamesPlayed) * 10) / 10,
    avg_half:   Math.round((weeks.reduce((a, w) => a + (w.fantasy_pts_half ?? 0), 0) / gamesPlayed) * 10) / 10,
    avg_std:    Math.round((weeks.reduce((a, w) => a + (w.fantasy_pts_std ?? 0), 0) / gamesPlayed) * 10) / 10,
    ceiling,
    floor,
    games_20plus:    games20,
    total_pass_yds:  sum('passing_yards'),
    total_pass_tds:  sum('passing_tds'),
    total_rush_yds:  sum('rushing_yards'),
    total_rush_tds:  sum('rushing_tds'),
    total_rec:       sum('receptions'),
    total_tgts:      sum('targets'),
    total_rec_yds:   sum('receiving_yards'),
    total_rec_tds:   sum('receiving_tds'),
  };
}

/**
 * Quick current-season helper. Returns the most recent season
 * that has any data in nfl_weekly_stats.
 */
let currentSeasonCache: { season: number; at: number } | null = null;

export async function getCurrentStatsSeason(): Promise<number> {
  const now = Date.now();
  if (currentSeasonCache && (now - currentSeasonCache.at) < 60 * 60 * 1000) {
    return currentSeasonCache.season;
  }
  const { data } = await supabase
    .from('nfl_weekly_stats')
    .select('season')
    .order('season', { ascending: false })
    .limit(1)
    .maybeSingle();

  const season = (data?.season as number) ?? new Date().getFullYear();
  currentSeasonCache = { season, at: now };
  return season;
}
'''
    content = content.rstrip() + addition
    with open(path, 'w') as f: f.write(content)
    print("Added stats helpers to services/nflPlayers.ts")
