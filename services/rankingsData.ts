// services/rankingsData.ts
// AIOmni Unified Rankings Engine
// Sources: Sleeper ADP + trending, ESPN ADP + leaders, Yahoo ADP,
//          NFL injuries, Vegas lines, nflverse snap counts, Rotowire news,
//          College Football Data API, NCAA API
// All free. No paid APIs required.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { syncRankingsToCloud, loadRankingsFromCloud } from './userSync';
import { getActiveSleeperIds, getCurrentStatsSeason } from './nflPlayers';
import { normalizePlayerName } from './util/normalizeName';

// ─── TYPES ──────────────────────────────────────────────────

export type RankingsSource = 'sleeper' | 'espn' | 'yahoo' | 'mfl' | 'fleaflicker' | 'fantasypros' | 'nfl' | 'aiomni' | 'aiomni_formula';

export interface RankedPlayer {
  id: string;
  sleeperId?: string;
  name: string;
  position: string;
  team: string;
  rank: number;
  adp: string;
  trend: 'up' | 'down' | 'flat';
  trendVal: number;
  tier: number;
  // Extended fields from live data
  posRank?: number;
  injuryStatus?: string | null;
  injuryDetail?: string | null;
  trendingAdds?: number;
  trendingDrops?: number;
  snapPct?: number | null;
  newsHeadline?: string | null;
  newsAge?: string | null;
  impliedTeamScore?: number | null;
  statLine?: string;
  sourceCount?: number;
}

export type ScoringFormat = 'PPR' | 'HALF' | 'STD' | 'SF' | 'DYN';

// ─── FORMAT-AWARE BLEND TYPES (Piece 1) ─────────────────────────────────
// LeagueType + ScoringRules supersede ScoringFormat for the SOURCE BLEND
// step (deciding how much each platform's ADP contributes). The legacy
// ScoringFormat enum stays for the post-blend position-boost step in
// applyFormatAdjustments() — that's orthogonal and works on tiers, not
// source aggregation. New callers should pass these two params; old
// callers that pass nothing get redraft/PPR defaults.

export type LeagueType = 'redraft' | 'dynasty';
export type ScoringRules = 'ppr' | 'half' | 'std' | 'superflex';

// Per-format source weights. These determine how much each platform's
// rank contributes to the blended consensus rank.
//   - Redraft: ESPN/Sleeper/Yahoo are crowd-sourced ADP gold standards.
//     NFL.com is editorial (one analyst), weighted lower. MFL/Fleaflicker
//     are smaller user bases for redraft.
//   - Dynasty: MFL/Fleaflicker are the gold standard (smartest dynasty
//     demographics). Sleeper has decent dynasty signal. ESPN/Yahoo
//     dynasty data is weak. NFL.com doesn't publish dynasty rankings.
//
// Weights sum to 100 within each format.
export const SOURCE_WEIGHTS: Record<LeagueType, Record<RankingsSource, number>> = {
  redraft: {
    sleeper: 24,
    espn: 24,
    yahoo: 24,
    nfl: 12,
    mfl: 8,
    fleaflicker: 8,
    fantasypros: 0,    // not implemented; reserved
    aiomni: 0,         // Pulse blend output, not a source input
    aiomni_formula: 0, // proprietary algorithmic engine, never blended
  },
  dynasty: {
    sleeper: 20,
    espn: 12.5,
    yahoo: 12.5,
    nfl: 0,            // NFL.com doesn't publish dynasty rankings
    mfl: 30,
    fleaflicker: 25,
    fantasypros: 0,
    aiomni: 0,
    aiomni_formula: 0,
  },
};

// Map legacy ScoringFormat -> (LeagueType, ScoringRules) so old callers
// continue to work. Used as fallback when callers pass only ScoringFormat.
export function legacyFormatToBlendParams(
  format: ScoringFormat
): { leagueType: LeagueType; scoringRules: ScoringRules } {
  switch (format) {
    case 'DYN':  return { leagueType: 'dynasty', scoringRules: 'ppr' };
    case 'SF':   return { leagueType: 'redraft', scoringRules: 'superflex' };
    case 'HALF': return { leagueType: 'redraft', scoringRules: 'half' };
    case 'STD':  return { leagueType: 'redraft', scoringRules: 'std' };
    case 'PPR':
    default:     return { leagueType: 'redraft', scoringRules: 'ppr' };
  }
}


export interface CollegeProspect {
  id: string;
  name: string;
  school: string;
  position: string;
  year: string;
  height?: string;
  weight?: number;
  fortyTime?: number;
  grade?: number;
  posRank?: string;
}

// ─── CONSTANTS ──────────────────────────────────────────────

const SLEEPER_CACHE_KEY = 'sleeper_players_cache';
const SLEEPER_CACHE_TS  = 'sleeper_players_cache_ts';
const CACHE_TTL         = 24 * 60 * 60 * 1000; // 24 hours

// ─── Tier breaks (format-aware) ───────────────────────────────
// Tier 1 ends at idx 0, Tier 2 at idx 1, etc. Anything past idx 3
// becomes Tier 5 (deep depth / dart throws).
//
// Calibration rationale:
//   - Standard redraft cliff is RB-driven; top 4 form an RB1/elite tier
//   - Superflex tightens because elite QBs clump
//   - Dynasty extends because young assets have multi-year relevance
//     (a Tier 3 dynasty player is still a long-term piece)
const TIER_BREAKS_DEFAULT  = [4, 10, 18, 25];
const TIER_BREAKS_SUPERFLEX = [3, 8, 16, 24];
const TIER_BREAKS_DYNASTY  = [5, 14, 26, 40];

function getTierBreaks(format?: string): number[] {
  if (format === 'SF' || format === 'superflex') return TIER_BREAKS_SUPERFLEX;
  if (format === 'DYN' || format === 'dynasty')  return TIER_BREAKS_DYNASTY;
  return TIER_BREAKS_DEFAULT;
}

// Backwards-compatible alias for any existing callers
const TIER_BREAKS = TIER_BREAKS_DEFAULT;

function assignTier(rank: number, format?: string): number {
  const breaks = getTierBreaks(format);
  if (rank <= breaks[0]) return 1;
  if (rank <= breaks[1]) return 2;
  if (rank <= breaks[2]) return 3;
  if (rank <= breaks[3]) return 4;
  return 5;
}

const NCAA_API_BASE = 'https://ncaa-api.henrygd.me';

// ─── CFBD PROXY (key lives in Supabase secrets) ────────────
async function cfbdProxy(endpoint: string, params?: Record<string, string>): Promise<any> {
  try {
    const { data, error } = await supabase.functions.invoke('cfbd-proxy', {
      body: { endpoint, params },
    });
    if (error) throw error;
    return data;
  } catch (e) {
    console.log('cfbdProxy error:', e);
    return [];
  }
}

// CFBD API key moved to Supabase Edge Function — never stored client-side

// ─── DYNAMIC SEASON HELPERS ─────────────────────────────────

// Returns the NFL season identifier ESPN/Sleeper/Yahoo expect for
// "current ADP". Rule: March-Dec returns current calendar year (upcoming
// or in-progress season). Jan-Feb returns previous calendar year (Super
// Bowl is in February of year N for season N).
function getCurrentDraftSeason(): number {
  const now = new Date();
  return now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
}

// ─── PHASE 2 PROXY URLS ─────────────────────────────────────
// MFL + Fleaflicker fetchers go through Supabase edge functions
// to keep XML parsing + scrape regexes off-device and cacheable.
// If a proxy is undeployed or fails, the fetcher returns [] and
// the blender skips that source gracefully (no regression).

const MFL_PROXY_URL = 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/mfl-adp-proxy';
const YH_PROXY_URL  = 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/yahoo-rankings-proxy';
const PHASE2_ANON   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw';

// ─── SLEEPER ────────────────────────────────────────────────

interface SleeperPlayerRaw {
  player_id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  position: string;
  team: string | null;
  active: boolean;
  search_rank?: number;
  age?: number;
  years_exp?: number;
}

let sleeperCache: Record<string, any> | null = null;

async function getSleeperPlayers(): Promise<Record<string, any>> {
  if (sleeperCache) return sleeperCache;

  try {
    const cached = await AsyncStorage.getItem(SLEEPER_CACHE_KEY);
    const ts = await AsyncStorage.getItem(SLEEPER_CACHE_TS);
    const age = ts ? Date.now() - parseInt(ts) : Infinity;

    if (cached && age < CACHE_TTL) {
      sleeperCache = JSON.parse(cached);
      return sleeperCache!;
    }
  } catch {}

  try {
    const res = await fetch('https://api.sleeper.app/v1/players/nfl');
    const data = await res.json();
    await AsyncStorage.setItem(SLEEPER_CACHE_KEY, JSON.stringify(data));
    await AsyncStorage.setItem(SLEEPER_CACHE_TS, String(Date.now()));
    sleeperCache = data;
    return data;
  } catch (e) {
    console.log('getSleeperPlayers error:', e);
    return {};
  }
}

export async function fetchSleeperADP(): Promise<RankedPlayer[]> {
  try {
    const [players, activeIds] = await Promise.all([
      getSleeperPlayers(),
      getActiveSleeperIds().catch(() => new Set<string>()),
    ]);

    const eligible = Object.entries(players)
      .filter(([pid, p]: any) => {
        if (!p.search_rank || p.search_rank >= 500) return false;
        if (!['QB', 'RB', 'WR', 'TE', 'K'].includes(p.position)) return false;
        if (!p.team) return false;
        // If canonical list loaded, require player to be in it
        if (activeIds.size > 0) return activeIds.has(pid);
        // Fallback to Sleeper's own active flag
        return p.active !== false;
      })
      .map(([id, p]: any) => ({
        id, name: p.full_name || `${p.first_name} ${p.last_name}`,
        position: p.position, team: p.team, searchRank: p.search_rank,
      }))
      .sort((a, b) => {
        const w: Record<string, number> = { QB: 1.4, RB: 1.0, WR: 1.0, TE: 1.15, K: 2.0 };
        return (a.searchRank * (w[a.position] || 1)) - (b.searchRank * (w[b.position] || 1));
      })
      .slice(0, 200);

    return eligible.map((p, i) => ({
      id: p.id, name: p.name, position: p.position, team: p.team,
      rank: i + 1, adp: (i + 1).toFixed(1), trend: 'flat' as const, trendVal: 0, tier: assignTier(i + 1),
    }));
  } catch (e) { console.log('fetchSleeperADP error:', e); return []; }
}

// ─── SLEEPER TRENDING ───────────────────────────────────────

interface TrendingItem { player_id: string; count: number; }

export async function fetchSleeperTrending(): Promise<{ adds: TrendingItem[]; drops: TrendingItem[] }> {
  try {
    const [addRes, dropRes] = await Promise.all([
      fetch('https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=24&limit=50'),
      fetch('https://api.sleeper.app/v1/players/nfl/trending/drop?lookback_hours=24&limit=50'),
    ]);
    return {
      adds:  await addRes.json().catch(() => []),
      drops: await dropRes.json().catch(() => []),
    };
  } catch { return { adds: [], drops: [] }; }
}

// ─── ESPN ───────────────────────────────────────────────────

function getESPNTeamAbbr(id: number): string {
  const map: Record<number, string> = {
    1:'ATL',2:'BUF',3:'CHI',4:'CIN',5:'CLE',6:'DAL',7:'DEN',8:'DET',
    9:'GB',10:'TEN',11:'IND',12:'KC',13:'LV',14:'LAR',15:'MIA',16:'MIN',
    17:'NE',18:'NO',19:'NYG',20:'NYJ',21:'PHI',22:'ARI',23:'PIT',24:'LAC',
    25:'SF',26:'SEA',27:'TB',28:'WSH',29:'CAR',30:'JAX',33:'BAL',34:'HOU',
  };
  return map[id] ?? '—';
}

export async function fetchESPNADP(): Promise<RankedPlayer[]> {
  // The original leagues/0 path returns only a ~30-player default subset
  // because league 0 has no draft pool registered. Switching to
  // leaguedefaults/3 (PPR default-league context) gives global ADP: the
  // limit filter is respected and ownership.averageDraftPosition is
  // populated for all 200 players. Format IDs: 1=Standard, 3=PPR, 5=Half.
  try {
    const res = await fetch(
      `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${getCurrentDraftSeason()}/segments/0/leaguedefaults/3?view=kona_player_info`,
      {
        headers: {
          'x-fantasy-filter': JSON.stringify({
            players: {
              filterSlotIds: { value: [0, 2, 4, 6, 16, 17] }, // QB/RB/WR/TE/DST/K eligibility
              limit: 250,
              sortDraftRanks: { sortPriority: 1, sortAsc: true, value: 'PPR' },
            },
          }),
        },
      }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const posMap: Record<number, string> = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DEF' };

    return (data.players ?? [])
      .filter((p: any) => posMap[p.player?.defaultPositionId])
      .slice(0, 200)
      .map((p: any, i: number) => ({
        id: String(p.id),
        name: p.player?.fullName ?? 'Unknown',
        position: posMap[p.player?.defaultPositionId] ?? 'FLEX',
        team: p.player?.proTeamId ? getESPNTeamAbbr(p.player.proTeamId) : '—',
        rank: i + 1,
        adp: (p.player?.ownership?.averageDraftPosition ?? i + 1).toFixed(1),
        trend: 'flat' as const,
        trendVal: 0,
        tier: assignTier(i + 1),
      }));
  } catch (e) { console.log('fetchESPNADP error:', e); return []; }
}

export async function fetchESPNLeaders(): Promise<{ name: string; stats: string[]; value: number }[]> {
  const results: { name: string; stats: string[]; value: number }[] = [];
  try {
    const categories = ['passing', 'rushing', 'receiving', 'scoring'];
    const responses = await Promise.all(
      categories.map(cat =>
        fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/leaders?limit=50&stat=${cat}`)
          .then(r => r.json()).catch(() => null)
      )
    );
    const byName = new Map<string, { stats: string[]; value: number }>();
    for (let i = 0; i < categories.length; i++) {
      const data = responses[i];
      if (!data?.leaders) continue;
      for (const group of data.leaders) {
        for (const l of (group.leaders || [])) {
          const name = l.athlete?.displayName;
          if (!name) continue;
          const key = name.toLowerCase();
          const label = `${Math.round(l.value ?? 0)} ${categories[i]}`;
          const existing = byName.get(key);
          if (existing) {
            existing.stats.push(label);
            if ((l.value ?? 0) > existing.value) existing.value = l.value;
          } else {
            byName.set(key, { stats: [label], value: l.value ?? 0 });
          }
        }
      }
    }
    for (const [name, data] of byName) results.push({ name, ...data });
  } catch (e) { console.log('fetchESPNLeaders error:', e); }
  return results;
}

// ─── YAHOO ──────────────────────────────────────────────────

export async function fetchYahooADP(): Promise<RankedPlayer[]> {
  // 1) Try the server-side service-account proxy first.
  //    Always available, no per-user auth required.
  try {
    const proxyUrl = YH_PROXY_URL;
    const res = await fetch(proxyUrl, {
      method: 'POST',
      headers: {
        'apikey': PHASE2_ANON,
        'Authorization': `Bearer ${PHASE2_ANON}`,
        'Content-Type': 'application/json',
      },
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.ok && Array.isArray(data.players)) {
        return data.players as RankedPlayer[];
      }
    }
  } catch (e) {
    console.log('fetchYahooADP proxy error, falling back to per-user token:', e);
  }

  // 2) Fallback: per-user Yahoo token (works only when user is signed in).
  // Yahoo's API caps single-request responses at 25 players regardless of the
  // count param, so we paginate via ;start=N. 10 parallel pages = 250 players.
  try {
    const { getValidYahooToken } = require('./yahoo');
    const token = await getValidYahooToken();
    if (!token) return [];

    const PAGE_SIZE = 25;
    const PAGES = 8; // 8 × 25 = 200 cap
    const responses = await Promise.all(
      Array.from({ length: PAGES }, (_, i) =>
        fetch(
          `https://fantasysports.yahooapis.com/fantasy/v2/game/nfl/players;sort=OR;start=${i * PAGE_SIZE};count=${PAGE_SIZE}?format=json`,
          { headers: { Authorization: `Bearer ${token}` } }
        ).then(r => (r.ok ? r.json() : null)).catch(() => null)
      )
    );

    const result: RankedPlayer[] = [];
    let rank = 0;
    for (const data of responses) {
      const yahooPlayers = data?.fantasy_content?.game?.[1]?.players;
      if (!yahooPlayers) continue;
      const count = yahooPlayers.count ?? 0;
      for (let i = 0; i < count; i++) {
        const p = yahooPlayers[i]?.player?.[0];
        if (!p) continue;
        rank++;
        result.push({
          id: p.find((x: any) => x.player_key)?.player_key ?? String(rank),
          name: p.find((x: any) => x.name)?.name?.full ?? 'Unknown',
          position: p.find((x: any) => x.display_position)?.display_position ?? 'FLEX',
          team: p.find((x: any) => x.editorial_team_abbr)?.editorial_team_abbr ?? '—',
          rank,
          adp: rank.toFixed(1),
          trend: 'flat' as const,
          trendVal: 0,
          tier: assignTier(rank),
        });
      }
    }
    return result;
  } catch (e) { console.log('fetchYahooADP error:', e); return []; }
}

// ─── MFL ADP (Phase 2 real fetcher) ─────────────────────────────────────
// Goes through supabase/functions/mfl-adp-proxy/index.ts which handles
// XML parsing + name resolution server-side. If the edge function is
// undeployed or returns an error, we return [] and the blender skips
// MFL gracefully (no regression vs Phase 1 stub).

export async function fetchMFLADP(
  leagueType: LeagueType = 'redraft',
  scoringRules: ScoringRules = 'ppr'
): Promise<RankedPlayer[]> {
  try {
    const url = `${MFL_PROXY_URL}?leagueType=${leagueType}&scoringRules=${scoringRules}`;
    const res = await fetch(url, {
      headers: {
        'apikey': PHASE2_ANON,
        'Authorization': `Bearer ${PHASE2_ANON}`,
      },
    });
    if (!res.ok) {
      console.log('fetchMFLADP HTTP', res.status);
      return [];
    }
    const data = await res.json();
    if (!data?.ok || !Array.isArray(data.players)) return [];
    // Reassign tiers using the local helper so they match the rest of
    // the blend's tier schema before the engine bridge runs.
    return data.players.map((p: any, i: number) => ({
      ...p,
      rank: i + 1,
      tier: assignTier(i + 1),
    }));
  } catch (e) {
    console.log('fetchMFLADP error:', e);
    return [];
  }
}

// ─── Fleaflicker rankings (Phase 2 real fetcher) ────────────────────────
// Goes through supabase/functions/fleaflicker-rankings-proxy which scrapes
// Fleaflicker's public player rankings page. Layout-fragile by nature
// (scraping); fails open to [] on any error so dynasty rankings still work
// off MFL + Sleeper alone.

export async function fetchFleaflickerADP(
  _leagueType: LeagueType = 'redraft',
  _scoringRules: ScoringRules = 'ppr'
): Promise<RankedPlayer[]> {
  // KeepTradeCut source removed (scraping concerns). Stub returns [].
  return [];
}

// ─── NFL.com rankings (stub for Piece 1; scraper lands in Piece 3) ──────
// NFL.com has no public API. Piece 3 implements via Supabase edge
// function that scrapes fantasy.nfl.com/research/rankings and caches.

export async function fetchNFLDotComRankings(
  _scoringRules: ScoringRules = 'ppr'
): Promise<RankedPlayer[]> {
  return [];
}

// ─── NFL INJURIES ───────────────────────────────────────────

interface InjuryInfo { name: string; status: string; detail: string; }

async function fetchNFLInjuries(): Promise<InjuryInfo[]> {
  try {
    const res = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries');
    if (!res.ok) return [];
    const data = await res.json();
    const injuries: InjuryInfo[] = [];
    for (const team of (data.items ?? [])) {
      for (const entry of (team.injuries ?? [])) {
        const athlete = entry.athlete;
        if (!athlete) continue;
        injuries.push({
          name: athlete.displayName?.toLowerCase() ?? '',
          status: entry.status ?? '',
          detail: entry.details?.detail ?? entry.type ?? '',
        });
      }
    }
    return injuries;
  } catch { return []; }
}

// ─── VEGAS LINES ────────────────────────────────────────────

async function fetchVegasLines(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const res = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard');
    if (!res.ok) return map;
    const data = await res.json();
    for (const event of (data.events ?? [])) {
      const comp = event.competitions?.[0];
      if (!comp) continue;
      const odds = comp.odds?.[0];
      if (!odds?.overUnder) continue;
      const ou = parseFloat(odds.overUnder);
      const spread = parseFloat(odds.spread ?? '0');
      for (const team of comp.competitors ?? []) {
        const abbr = team.team?.abbreviation?.toUpperCase();
        if (!abbr) continue;
        const isHome = team.homeAway === 'home';
        const implied = isHome ? (ou / 2) - (spread / 2) : (ou / 2) + (spread / 2);
        map.set(abbr, Math.round(implied * 10) / 10);
      }
    }
  } catch {}
  return map;
}

// ─── SNAP COUNTS (nflverse) ─────────────────────────────────

async function fetchSnapCounts(seasonOverride?: number): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const season = seasonOverride ?? await getCurrentStatsSeason();
    const url = `https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_${season}.csv`;
    const res = await fetch(url);
    if (!res.ok) return map;
    const text = await res.text();
    const lines = text.split('\n');
    if (lines.length < 2) return map;

    const headers = lines[0].split(',');
    const weekIdx = headers.indexOf('week');
    const playerIdx = headers.indexOf('player');
    const offPctIdx = headers.indexOf('offense_pct');

    if (weekIdx === -1 || playerIdx === -1 || offPctIdx === -1) return map;

    const weeks = lines.slice(1).map(l => parseInt(l.split(',')[weekIdx])).filter(w => !isNaN(w));
    const latestWeek = Math.max(...weeks);

    for (const line of lines.slice(1)) {
      const row = line.split(',');
      if (parseInt(row[weekIdx]) !== latestWeek) continue;
      const name = row[playerIdx]?.replace(/"/g, '').toLowerCase();
      const pct = Math.round(parseFloat(row[offPctIdx] || '0') * 100);
      if (name && pct > 0) map.set(name, pct);
    }
  } catch {}
  return map;
}

// ─── NCAA API ───────────────────────────────────────────────

export async function fetchNCAAFootballRankings(): Promise<any[]> {
  try {
    const res = await fetch(`${NCAA_API_BASE}/rankings/football/fbs`);
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

export async function fetchNCAAFootballNews(): Promise<{ title: string; link?: string }[]> {
  try {
    const res = await fetch(`${NCAA_API_BASE}/news/football/fbs`);
    if (!res.ok) return [];
    const data = await res.json();
    if (Array.isArray(data)) return data.slice(0, 20);
    if (data?.articles) return data.articles.slice(0, 20);
    return [];
  } catch { return []; }
}

export async function fetchNCAAPlayerStats(year = 2025): Promise<any[]> {
  try {
    const res = await fetch(`${NCAA_API_BASE}/stats/football/fbs/${year}/player/total`);
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

export async function fetchNCAAScoreboard(): Promise<any> {
  try {
    const res = await fetch(`${NCAA_API_BASE}/scoreboard/football/fbs`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

export async function fetchNCAAStandings(conference = 'all-conf'): Promise<any> {
  try {
    const res = await fetch(`${NCAA_API_BASE}/standings/football/${conference}`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// ─── CFBD DRAFT PROSPECTS ───────────────────────────────────


// ─── 2026 PROSPECT SEED (fallback when CFBD is down) ────────

// 2026 NFL Draft completed April 23-25, 2026. Every previously-listed
// 2026 college prospect is now an NFL player (rookie). Until a 2027
// prospect dataset is curated, this seed is empty -- fetchDedupedProspects
// returns [] and the UI shows "No prospects available right now."
// TODO: source 2027 NFL Draft prospects (current college juniors/seniors)
const PROSPECT_SEED_2026: CollegeProspect[] = [];


// ─── 2026 PROSPECT SEED (fallback when CFBD is down) ────────


export async function fetchCFBDProspects(year = 2026): Promise<CollegeProspect[]> {
  // CFBD calls go through server-side proxy
  try {
    const data = await cfbdProxy('/recruiting/players', { year: String(year) });
    return (data ?? []).slice(0, 100).map((p: any, i: number) => ({
      id: String(p.id ?? i),
      name: p.name ?? 'Unknown',
      school: p.school ?? '',
      position: p.position ?? '',
      year: String(year),
      class_year: p.year ? String(p.year) : String(year),
      height: p.height ? `${Math.floor(p.height / 12)}-${p.height % 12}` : undefined,
      weight: p.weight ?? undefined,
      forty_time: p.forty_time ?? undefined,
      consensus_rank: i + 1,
      positional_rank: p.position_rank ?? undefined,
      prospect_grade: p.grade ?? 0,
      grade: p.grade ?? undefined,
    }));
  } catch { return []; }
}

export async function fetchCFBDCollegeStats(year = 2025): Promise<any[]> {
  // CFBD calls go through server-side proxy
  try {
    return await cfbdProxy('/stats/player/season', { year: String(year), category: 'receiving' });
  } catch { return []; }
}

// ─── ROTOWIRE NEWS ──────────────────────────────────────────

interface NewsItem { title: string; player?: string; pubDate?: string; }

async function fetchRotoNews(): Promise<NewsItem[]> {
  try {
    const [nflRes, ncaaRes] = await Promise.allSettled([
      fetch('https://www.rotowire.com/rss/current.xml').then(r => r.text()),
      fetch('https://www.rotowire.com/rss/ncaa-football.xml').then(r => r.text()),
    ]);

    const items: NewsItem[] = [];
    const parseRSS = (xml: string) => {
      const regex = /<item>[\s\S]*?<title>(.*?)<\/title>[\s\S]*?<\/item>/g;
      let match;
      while ((match = regex.exec(xml)) !== null) {
        const title = match[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim();
        // Extract player name (usually before the colon)
        const colonIdx = title.indexOf(':');
        const player = colonIdx > 0 ? title.substring(0, colonIdx).trim() : undefined;
        items.push({ title, player });
      }
    };

    if (nflRes.status === 'fulfilled') parseRSS(nflRes.value);
    if (ncaaRes.status === 'fulfilled') parseRSS(ncaaRes.value);
    return items;
  } catch { return []; }
}

// ─── BLENDED CONSENSUS (the main engine) ────────────────────

export async function fetchBlendedConsensus(
  leagueType: LeagueType = 'redraft',
  scoringRules: ScoringRules = 'ppr'
): Promise<RankedPlayer[]> {
  // Pull ALL data sources in parallel
  const [
    sleeperResult, espnResult, yahooResult,
    mflResult, fleaflickerResult, nflcomResult,
    trendingResult, leadersResult,
    injuriesResult, vegasResult, snapsResult, newsResult,
  ] = await Promise.allSettled([
    fetchSleeperADP(),
    fetchESPNADP(),
    fetchYahooADP(),
    fetchMFLADP(leagueType, scoringRules),
    fetchFleaflickerADP(leagueType, scoringRules),
    fetchNFLDotComRankings(scoringRules),
    fetchSleeperTrending(),
    fetchESPNLeaders(),
    fetchNFLInjuries(),
    fetchVegasLines(),
    fetchSnapCounts(),
    fetchRotoNews(),
  ]);

  // Unpack results safely
  const sleeperData     = sleeperResult.status === 'fulfilled' ? sleeperResult.value : [];
  const espnData        = espnResult.status === 'fulfilled' ? espnResult.value : [];
  const yahooData       = yahooResult.status === 'fulfilled' ? yahooResult.value : [];
  const mflData         = mflResult.status === 'fulfilled' ? mflResult.value : [];
  const fleaflickerData = fleaflickerResult.status === 'fulfilled' ? fleaflickerResult.value : [];
  const nflcomData      = nflcomResult.status === 'fulfilled' ? nflcomResult.value : [];
  const trending    = trendingResult.status === 'fulfilled' ? trendingResult.value : { adds: [], drops: [] };
  const leaders     = leadersResult.status === 'fulfilled' ? leadersResult.value : [];
  const injuries    = injuriesResult.status === 'fulfilled' ? injuriesResult.value : [];
  const vegasMap    = vegasResult.status === 'fulfilled' ? vegasResult.value : new Map<string, number>();
  const snapMap     = snapsResult.status === 'fulfilled' ? snapsResult.value : new Map<string, number>();
  const newsItems   = newsResult.status === 'fulfilled' ? newsResult.value : [];

  // Build lookup maps
  const trendAddMap  = new Map<string, number>();
  const trendDropMap = new Map<string, number>();
  for (const t of trending.adds)  trendAddMap.set(t.player_id, t.count);
  for (const t of trending.drops) trendDropMap.set(t.player_id, t.count);

  const injuryMap = new Map<string, InjuryInfo>();
  for (const inj of injuries) injuryMap.set(inj.name, inj);

  const leaderMap = new Map<string, { stats: string[]; value: number }>();
  for (const l of leaders) leaderMap.set(l.name, { stats: l.stats, value: l.value });

  const newsMap = new Map<string, string>();
  for (const n of newsItems) {
    if (n.player) newsMap.set(n.player.toLowerCase(), n.title);
  }

  // ── Step 1: Multi-source ADP blend (format-aware weighting) ──
  // Each platform contributes its rank weighted by SOURCE_WEIGHTS[leagueType].
  // Sources with weight 0 OR empty data are skipped. Median fallback is used
  // when only one platform contributed (common for niche dynasty data).
  const sources: { name: RankingsSource; data: RankedPlayer[]; weight: number }[] = [];
  const weights = SOURCE_WEIGHTS[leagueType];
  if (sleeperData.length > 0     && weights.sleeper > 0)     sources.push({ name: 'sleeper',     data: sleeperData,     weight: weights.sleeper });
  if (espnData.length > 0        && weights.espn > 0)        sources.push({ name: 'espn',        data: espnData,        weight: weights.espn });
  if (yahooData.length > 0       && weights.yahoo > 0)       sources.push({ name: 'yahoo',       data: yahooData,       weight: weights.yahoo });
  if (mflData.length > 0         && weights.mfl > 0)         sources.push({ name: 'mfl',         data: mflData,         weight: weights.mfl });
  if (fleaflickerData.length > 0 && weights.fleaflicker > 0) sources.push({ name: 'fleaflicker', data: fleaflickerData, weight: weights.fleaflicker });
  if (nflcomData.length > 0      && weights.nfl > 0)         sources.push({ name: 'nfl',         data: nflcomData,      weight: weights.nfl });

  if (sources.length === 0) return fetchSleeperADP(); // absolute fallback

  // Strip Jr/Sr/II/III/IV/V suffix BEFORE the alpha-only collapse so that
  // "James Cook" and "James Cook III" key to the same bucket. Uses the
  // pure-string implementation in util/normalizeName to avoid the Hermes
  // GC regex crash this used to trigger over large player lists.
  const normalize = normalizePlayerName;

  const playerMap = new Map<string, {
    name: string; position: string; team: string; id: string;
    weightedSum: number; totalWeight: number; sourceCount: number;
  }>();

  for (const source of sources) {
    for (const p of source.data) {
      const key = normalize(p.name);
      if (playerMap.has(key)) {
        const existing = playerMap.get(key)!;
        existing.weightedSum += p.rank * source.weight;
        existing.totalWeight += source.weight;
        existing.sourceCount++;
      } else {
        playerMap.set(key, {
          name: p.name, position: p.position, team: p.team, id: p.id,
          weightedSum: p.rank * source.weight,
          totalWeight: source.weight,
          sourceCount: 1,
        });
      }
    }
  }

  // ── Step 2: Score each player with all data ──
  const scored: (RankedPlayer & { score: number })[] = [];

  for (const [key, p] of playerMap) {
    // Weighted average rank across sources (was median; now respects SOURCE_WEIGHTS)
    const blendedRank = p.weightedSum / p.totalWeight;

    // Base score: ADP dominates. Lower ADP = much higher score.
    // Using log-scaled inversion so #1 vs #10 gap is much larger than #100 vs #110.
    let score = 1000 - (Math.log(Math.max(blendedRank, 1)) * 80);

    // Confidence bonus: more sources = slight edge (tiebreaker only)
    score += (p.sourceCount - 1) * 2;

    // Trending momentum: subtle tiebreaker, capped so it can't override ADP
    const adds  = trendAddMap.get(p.id) ?? 0;
    const drops = trendDropMap.get(p.id) ?? 0;
    if (adds > 0)  score += Math.min(Math.log10(adds + 1) * 4, 15);
    if (drops > 0) score -= Math.min(Math.log10(drops + 1) * 3, 12);

    // ESPN leader bonus: tiny boost, can't override ADP order
    const leaderData = leaderMap.get(p.name.toLowerCase());
    if (leaderData && leaderData.value > 0) {
      score += Math.min(leaderData.value * 0.02, 8);
    }

    // Snap share bonus: capped
    const snap = snapMap.get(p.name.toLowerCase());
    if (snap && snap > 50) score += Math.min((snap - 50) * 0.1, 8);

    // Injury penalty
    const inj = injuryMap.get(p.name.toLowerCase());
    if (inj) {
      if (inj.status === 'Out' || inj.status === 'Injured Reserve') score *= 0.3;
      else if (inj.status === 'Doubtful') score *= 0.6;
      else if (inj.status === 'Questionable') score *= 0.9;
    }

    // Vegas boost (high-implied-score teams)
    const teamImplied = vegasMap.get(p.team?.toUpperCase());
    if (teamImplied && teamImplied > 24) score += (teamImplied - 24) * 2;

    // Trend direction -- based purely on Sleeper add/drop velocity.
    // (Was using a hardcoded spread=0 placeholder which made the
    // fallback always 'up'. Per-source rank dispersion lands later.)
    const trend: 'up' | 'down' | 'flat' =
      adds > drops * 2 ? 'up' :
      drops > adds * 2 ? 'down' :
      'flat';

    // Build stat line
    let statLine = '';
    if (leaderData && leaderData.stats.length > 0) {
      statLine = leaderData.stats.slice(0, 2).join(' · ');
    } else if (adds > 100) {
      statLine = `${adds.toLocaleString()} adds (24h)`;
    }

    // News headline
    const headline = newsMap.get(p.name.toLowerCase()) ?? null;

    scored.push({
      id: p.id, name: p.name, position: p.position, team: p.team,
      rank: 0, adp: blendedRank.toFixed(1), trend, trendVal: p.sourceCount, tier: 0,
      posRank: 0, injuryStatus: inj?.status ?? null, injuryDetail: inj?.detail ?? null,
      trendingAdds: adds, trendingDrops: drops, snapPct: snap ?? null,
      newsHeadline: headline, newsAge: null,
      impliedTeamScore: teamImplied ?? null, statLine, sourceCount: p.sourceCount,
      score,
    });
  }

  // ── Step 3: Sort and assign ranks ──
  scored.sort((a, b) => b.score - a.score);

  const posCounters: Record<string, number> = {};
  return scored.slice(0, 200).map((p, i) => {
    posCounters[p.position] = (posCounters[p.position] || 0) + 1;
    return {
      ...p,
      rank: i + 1,
      posRank: posCounters[p.position],
      tier: assignTier(i + 1),
    };
  });
}

// ─── AIOmni Formula (proprietary algorithmic engine) ─────────
// Reads from nfl_proprietary_rankings_v2, populated DAILY by the
// supabase/functions/aiomni-rankings-engine-v2 edge function.
// This is the pure stats-based projection -- separate from Pulse.
//
// NOTE (2026-06-02): repointed from the legacy `nfl_proprietary_rankings`
// table, which the retired v1 engine stopped writing on 2026-05-16. The v2
// engine writes `_v2` daily; the app was still reading the frozen v1 table,
// so users saw 17-day-stale rankings while fresh ones were generated unseen.

const PROPRIETARY_RANKINGS_URL =
  'https://khoruzvsprxyocisuhet.supabase.co/rest/v1/nfl_proprietary_rankings_v2';

export async function fetchAIOmniFormula(
  format: ScoringFormat = 'PPR',
): Promise<RankedPlayer[]> {
  try {
    // Step 1: Pull rankings from nfl_proprietary_rankings
    const url = `${PROPRIETARY_RANKINGS_URL}?format=eq.${format}&select=rank,gsis_id,name,position,team,score,tier,pos_rank,method&order=rank`;
    const res = await fetch(url, {
      headers: {
        'apikey': PHASE2_ANON,
        'Authorization': `Bearer ${PHASE2_ANON}`,
      },
    });
    if (!res.ok) {
      console.log('fetchAIOmniFormula HTTP', res.status);
      return [];
    }
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    
    // Step 2: Pull sleeper_id mapping from nfl_players for these gsis_ids
    // (Avoids embedding by FK; clean two-query approach.)
    const gsisIds = data.map((r: any) => r.gsis_id).filter(Boolean);
    const sleeperIdMap = new Map<string, string>();
    if (gsisIds.length > 0) {
      try {
        const idsCsv = gsisIds.map(id => `"${id}"`).join(',');
        const playersUrl = `https://khoruzvsprxyocisuhet.supabase.co/rest/v1/nfl_players?gsis_id=in.(${idsCsv})&select=gsis_id,sleeper_id`;
        const playersRes = await fetch(playersUrl, {
          headers: {
            'apikey': PHASE2_ANON,
            'Authorization': `Bearer ${PHASE2_ANON}`,
          },
        });
        if (playersRes.ok) {
          const players = await playersRes.json();
          if (Array.isArray(players)) {
            for (const p of players) {
              if (p.gsis_id && p.sleeper_id) {
                sleeperIdMap.set(p.gsis_id, p.sleeper_id);
              }
            }
          }
        }
      } catch (e) {
        console.log('fetchAIOmniFormula sleeper_id lookup error:', e);
        // Non-fatal: ranking still returns, just without headshots
      }
    }
    
    return data.map((r: any, i: number): RankedPlayer => ({
      id: r.gsis_id ?? String(i),
      sleeperId: sleeperIdMap.get(r.gsis_id),
      name: r.name ?? 'Unknown',
      position: r.position ?? 'FLEX',
      team: r.team ?? '—',
      rank: r.rank ?? (i + 1),
      adp: String(r.rank ?? (i + 1)),
      trend: 'flat' as const,
      trendVal: 0,
      tier: r.tier ?? assignTier(r.rank ?? (i + 1)),
      method: r.method ?? null,
    }) as any);
  } catch (e) {
    console.log('fetchAIOmniFormula error:', e);
    return [];
  }
}

// ─── SOURCE DISPATCHER ──────────────────────────────────────

export async function fetchBaseRankings(
  source: RankingsSource,
  leagueType: LeagueType = 'redraft',
  scoringRules: ScoringRules = 'ppr',
): Promise<RankedPlayer[]> {
  switch (source) {
    case 'sleeper':         return fetchSleeperADP();
    case 'espn':            return fetchESPNADP();
    case 'yahoo':           return fetchYahooADP();
    case 'mfl':             return fetchMFLADP(leagueType, scoringRules);
    // KeepTradeCut source removed -- using Yahoo + Sleeper + MFL instead
    case 'fantasypros':     return fetchBlendedConsensus(leagueType, scoringRules);
    case 'nfl':             return fetchBlendedConsensus(leagueType, scoringRules);
    case 'aiomni':          return fetchBlendedConsensus(leagueType, scoringRules);
    case 'aiomni_formula':  return fetchAIOmniFormula();
    default:                return fetchSleeperADP();
  }
}

// Alias for backward compat
export async function fetchAIOmniRankings(): Promise<RankedPlayer[]> {
  return fetchBlendedConsensus();
}

// ─── FORMAT ADJUSTMENTS ─────────────────────────────────────

const FORMAT_BOOSTS: Record<ScoringFormat, Record<string, number>> = {
  PPR:  { WR: -8, TE: -5, RB: 4, QB: 0, K: 0 },
  HALF: { WR: -4, TE: -3, RB: 2, QB: 0, K: 0 },
  STD:  { RB: -8, WR: 5, TE: 6, QB: 0, K: 0 },
  SF:   { QB: -15, RB: 2, WR: 3, TE: 3, K: 0 },
  DYN:  { QB: -5, RB: 0, WR: -3, TE: -2, K: 4 },
};

export function applyFormatAdjustments(
  rankings: RankedPlayer[], format: ScoringFormat
): RankedPlayer[] {
  const boosts = FORMAT_BOOSTS[format] || FORMAT_BOOSTS.PPR;
  const adjusted = rankings.map(p => ({ ...p, adjustedRank: p.rank + (boosts[p.position] || 0) }));
  adjusted.sort((a, b) => a.adjustedRank - b.adjustedRank);
  return adjusted.map((p, i) => ({
    ...p, rank: i + 1, tier: assignTier(i + 1),
  }));
}

// ─── PERSISTENCE ────────────────────────────────────────────

export async function getSelectedBase(): Promise<RankingsSource | null> {
  const val = await AsyncStorage.getItem('rankings_base_source');
  return val as RankingsSource | null;
}

export async function setSelectedBase(source: RankingsSource): Promise<void> {
  await AsyncStorage.setItem('rankings_base_source', source);
}

export async function getCustomRankings(format: string = 'PPR', leagueId?: string): Promise<RankedPlayer[] | null> {
  // Try cloud first for cross-device sync
  const cloudData = await loadRankingsFromCloud(leagueId ? format + '_' + leagueId : format);
  if (cloudData && cloudData.length > 0) return cloudData;
  const localKey = leagueId ? 'my_custom_rankings_' + format + '_' + leagueId : 'my_custom_rankings_' + format;
  const val = await AsyncStorage.getItem(localKey);
  if (!val) {
    const legacy = await AsyncStorage.getItem('my_custom_rankings_v7');
    if (legacy) return JSON.parse(legacy);
    return null;
  }
  try { return JSON.parse(val); } catch { return null; }
}

export async function saveCustomRankings(rankings: RankedPlayer[], format: string = 'PPR', leagueId?: string): Promise<void> {
  const key = leagueId ? 'my_custom_rankings_' + format + '_' + leagueId : 'my_custom_rankings_' + format;
  await AsyncStorage.setItem(key, JSON.stringify(rankings));
  const tsKey = leagueId ? 'rankings_ts_' + format + '_' + leagueId : 'rankings_ts_' + format;
  await AsyncStorage.setItem(tsKey, Date.now().toString());
  syncRankingsToCloud(rankings, leagueId ? format + '_' + leagueId : format); // fire and forget
}
// ─── WALTERFOOTBALL RSS ─────────────────────────────────────

export async function fetchWalterFootballNews(): Promise<{ title: string; link?: string }[]> {
  try {
    const res = await fetch('https://walterfootball.com/rss.xml');
    if (!res.ok) return [];
    const xml = await res.text();
    const items: { title: string; link?: string }[] = [];
    const regex = /<item>[\s\S]*?<title>(.*?)<\/title>[\s\S]*?(?:<link>(.*?)<\/link>)?[\s\S]*?<\/item>/g;
    let match;
    while ((match = regex.exec(xml)) !== null) {
      items.push({
        title: match[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim(),
        link: match[2]?.trim(),
      });
    }
    return items.slice(0, 20);
  } catch { return []; }
}

// ─── DEDUP: Remove drafted players from prospects ───────────

export async function fetchDedupedProspects(year = 2026): Promise<CollegeProspect[]> {
  // Use curated NFL draft prospect list (PROSPECT_SEED_2026).
  // CFBD's /recruiting/players returns HIGH SCHOOL recruits committing to college —
  // wrong pool for NFL dynasty rookie drafts. Swap in a real NFL prospects source later.
  const prospects = [...PROSPECT_SEED_2026];
  const sleeperPlayers = await getSleeperPlayers();

  // Same suffix-stripping normalization as fetchBlendedConsensus, so
  // "Kenneth Walker" (prospect) and "Kenneth Walker III" (active NFL) key
  // Uses the pure-string implementation from util/normalizeName to avoid
  // the Hermes GC regex crash. Same bucket-key semantics as the rankings
  // blend.
  const normalizeName = normalizePlayerName;

  const nflNames = new Set<string>();
  for (const p of Object.values(sleeperPlayers)) {
    if (p.active && p.team) {
      nflNames.add(normalizeName(p.full_name || `${p.first_name} ${p.last_name}`));
    }
  }

  return prospects.filter(p => !nflNames.has(normalizeName(p.name)));
}

// Once a draft class enters the NFL, PROSPECT_SEED_<year> is emptied (those
// players are now rookies in nfl_players, not college prospects), so
// fetchDedupedProspects returns []. For dynasty ROOKIE drafts we still need a
// board — the incoming class. Pull it straight from nfl_players, ordered by
// NFL draft capital (round, then pick), which is the best available proxy for
// rookie value since the proprietary engine doesn't score zero-snap rookies.
export async function fetchNFLRookieClass(year = 2026): Promise<CollegeProspect[]> {
  try {
    const url =
      `https://khoruzvsprxyocisuhet.supabase.co/rest/v1/nfl_players` +
      `?select=gsis_id,full_name,position,team,draft_round,draft_pick` +
      `&draft_year=eq.${year}&position=in.(QB,RB,WR,TE)` +
      `&order=draft_round.asc,draft_pick.asc`;
    const res = await fetch(url, {
      headers: { apikey: PHASE2_ANON, Authorization: `Bearer ${PHASE2_ANON}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    // school holds the NFL team here — fetchProspectDB maps it to `team`.
    return data
      .filter((p: any) => p?.gsis_id && p?.full_name)
      .map((p: any) => ({
        id: p.gsis_id,
        name: p.full_name,
        school: p.team || 'FA',
        position: p.position || 'WR',
        year: String(year),
      }));
  } catch {
    return [];
  }
}

// Rookie class as RankedPlayer[] for the quiz position-ranking picker, so
// dynasty users can rank incoming rookies (e.g. Carsen Ryan) that the redraft
// formula can't score. Ordered by NFL draft capital and tagged 'RK'; ranks are
// offset high so they always sort/append after the established players.
export async function fetchRookieRankedPlayers(year = 2026): Promise<RankedPlayer[]> {
  const rookies = await fetchNFLRookieClass(year);
  return rookies.map((p, i) => ({
    id: p.id,
    name: p.name,
    position: p.position,
    team: p.school,        // school holds the NFL team for rookie rows
    rank: 10000 + i,
    adp: 'RK',
    trend: 'flat' as const,
    trendVal: 0,
    tier: 0,
  }));
}
