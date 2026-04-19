// services/nflPlayers.ts
// ─────────────────────────────────────────────────────────
// Read canonical NFL player data from Supabase.
// This is AIOmni's source of truth for "who is a real NFL player."
// Sleeper/ESPN/Yahoo IDs get joined onto THIS table.

import { supabase } from './supabase';

export interface NFLPlayer {
  gsis_id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  display_name: string | null;
  position: string | null;
  position_group: string | null;
  team: string | null;
  jersey_number: number | null;
  height: string | null;
  weight: number | null;
  age: number | null;
  years_exp: number | null;
  rookie_year: number | null;
  college: string | null;
  draft_year: number | null;
  status: string | null;
  is_active: boolean;
  is_retired: boolean;
  sleeper_id: string | null;
  espn_id: string | null;
  yahoo_id: string | null;
  fantasypros_id: string | null;
  last_synced_at: string;
}

// ─── IN-MEMORY CACHES ────────────────────────────────────
// These caches load once per app session. Data updates daily server-side,
// so refresh-on-session is enough freshness for most reads.

const TTL_MS = 30 * 60 * 1000; // 30 min
let allActiveCache: { data: NFLPlayer[]; at: number } | null = null;
let sleeperIdIndex: Map<string, NFLPlayer> | null = null;
let espnIdIndex: Map<string, NFLPlayer> | null = null;
let yahooIdIndex: Map<string, NFLPlayer> | null = null;
let nameIndex: Map<string, NFLPlayer> | null = null;

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, '');
}

function buildIndexes(players: NFLPlayer[]) {
  sleeperIdIndex = new Map();
  espnIdIndex = new Map();
  yahooIdIndex = new Map();
  nameIndex = new Map();
  for (const p of players) {
    if (p.sleeper_id) sleeperIdIndex.set(p.sleeper_id, p);
    if (p.espn_id)    espnIdIndex.set(p.espn_id, p);
    if (p.yahoo_id)   yahooIdIndex.set(p.yahoo_id, p);
    nameIndex.set(normalizeName(p.full_name), p);
  }
}

export function invalidateNFLPlayerCache(): void {
  allActiveCache = null;
  sleeperIdIndex = null;
  espnIdIndex = null;
  yahooIdIndex = null;
  nameIndex = null;
}

// ─── LOADERS ─────────────────────────────────────────────

/**
 * Get every active NFL player. Cached in memory for the session.
 * Use this as the source of truth for "who exists in the NFL right now."
 */
export async function getAllActivePlayers(): Promise<NFLPlayer[]> {
  const now = Date.now();
  if (allActiveCache && (now - allActiveCache.at) < TTL_MS) {
    return allActiveCache.data;
  }

  // Supabase defaults to 1000 rows/response — we need all ~1700 active players.
  // Paginate in chunks of 1000.
  const all: NFLPlayer[] = [];
  let from = 0;
  const CHUNK = 1000;
  for (;;) {
    const { data, error } = await supabase
      .from('nfl_players')
      .select('*')
      .eq('is_active', true)
      .order('full_name', { ascending: true })
      .range(from, from + CHUNK - 1);

    if (error) {
      console.log('getAllActivePlayers error:', error);
      break;
    }
    if (!data || data.length === 0) break;
    all.push(...(data as NFLPlayer[]));
    if (data.length < CHUNK) break;
    from += CHUNK;
  }

  allActiveCache = { data: all, at: now };
  buildIndexes(all);
  return all;
}

/**
 * Find a player by their platform-specific ID.
 * Supports sleeper, espn, yahoo.
 */
export async function getPlayerByPlatformId(
  platform: 'sleeper' | 'espn' | 'yahoo',
  platformId: string
): Promise<NFLPlayer | null> {
  // Ensure caches are built
  if (!sleeperIdIndex) await getAllActivePlayers();

  const idx =
    platform === 'sleeper' ? sleeperIdIndex :
    platform === 'espn'    ? espnIdIndex :
    platform === 'yahoo'   ? yahooIdIndex : null;

  if (idx) {
    const hit = idx.get(platformId);
    if (hit) return hit;
  }

  // Fallback: direct query (in case cache is stale or player is inactive)
  const col = `${platform}_id`;
  const { data, error } = await supabase
    .from('nfl_players')
    .select('*')
    .eq(col, platformId)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.log('getPlayerByPlatformId error:', error);
    return null;
  }
  return (data as NFLPlayer) ?? null;
}

/**
 * Find a player by name. Used when we only have a text name from user input
 * (e.g. trade analyzer input, search box).
 */
export async function getPlayerByName(name: string): Promise<NFLPlayer | null> {
  if (!nameIndex) await getAllActivePlayers();
  const norm = normalizeName(name);
  return nameIndex?.get(norm) ?? null;
}

/**
 * Return only the sleeper_ids that correspond to active NFL players.
 * Used by waiver wire to filter out retired/inactive players that Sleeper still lists.
 */
export async function getActiveSleeperIds(): Promise<Set<string>> {
  const players = await getAllActivePlayers();
  const ids = new Set<string>();
  for (const p of players) {
    if (p.sleeper_id) ids.add(p.sleeper_id);
  }
  return ids;
}

/**
 * Same for ESPN ids.
 */
export async function getActiveESPNIds(): Promise<Set<string>> {
  const players = await getAllActivePlayers();
  const ids = new Set<string>();
  for (const p of players) {
    if (p.espn_id) ids.add(p.espn_id);
  }
  return ids;
}

/**
 * Check if a Sleeper player_id represents a currently-active NFL player.
 */
export async function isActiveSleeperId(sleeperId: string): Promise<boolean> {
  const ids = await getActiveSleeperIds();
  return ids.has(sleeperId);
}

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
