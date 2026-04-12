// services/rankingsData.ts
// Fetches player rankings/ADP from multiple sources
// Used as base rankings that users can customize

import AsyncStorage from '@react-native-async-storage/async-storage';

export type RankingsSource = 'sleeper' | 'espn' | 'yahoo' | 'fantasypros' | 'nfl' | 'aiomni';

export interface RankedPlayer {
  id: string;
  name: string;
  position: string;
  team: string;
  rank: number;
  adp: string;
  trend: 'up' | 'down' | 'flat';
  trendVal: number;
  tier: number;
}

const TIER_BREAKS = [4, 10, 18, 25]; // top 4 = tier 1, 5-10 = tier 2, etc.

function assignTier(rank: number): number {
  if (rank <= TIER_BREAKS[0]) return 1;
  if (rank <= TIER_BREAKS[1]) return 2;
  if (rank <= TIER_BREAKS[2]) return 3;
  if (rank <= TIER_BREAKS[3]) return 4;
  return 5;
}

// ── Sleeper ADP ─────────────────────────────────────────────
export async function fetchSleeperADP(): Promise<RankedPlayer[]> {
  try {
    const cached = await AsyncStorage.getItem('sleeper_players_cache');
    const cacheTime = await AsyncStorage.getItem('sleeper_players_cache_ts');
    const cacheAge = cacheTime ? Date.now() - parseInt(cacheTime) : Infinity;
    const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
    let players: any = {};
    if (cached && cacheAge < CACHE_TTL) {
      players = JSON.parse(cached);
    } else {
      const res = await fetch('https://api.sleeper.app/v1/players/nfl');
      players = await res.json();
      await AsyncStorage.setItem('sleeper_players_cache', JSON.stringify(players));
      await AsyncStorage.setItem('sleeper_players_cache_ts', String(Date.now()));
    }

    const eligible = Object.entries(players)
      .filter(([_, p]: any) => 
        p.active && 
        p.search_rank && 
        p.search_rank < 500 &&
        ['QB', 'RB', 'WR', 'TE', 'K'].includes(p.position) &&
        p.team
      )
      .map(([id, p]: any) => ({
        id,
        name: p.full_name || `${p.first_name} ${p.last_name}`,
        position: p.position,
        team: p.team,
        searchRank: p.search_rank,
      }))
      .sort((a, b) => {
        // Weight search_rank by position scarcity
        // QBs flood the top of search_rank due to popularity — push them down
        const posWeight: Record<string, number> = { QB: 1.4, RB: 1.0, WR: 1.0, TE: 1.15, K: 2.0 };
        const aScore = a.searchRank * (posWeight[a.position] || 1.0);
        const bScore = b.searchRank * (posWeight[b.position] || 1.0);
        return aScore - bScore;
      })
      .slice(0, 200);

    return eligible.map((p, i) => ({
      id: p.id,
      name: p.name,
      position: p.position,
      team: p.team,
      rank: i + 1,
      adp: (i + 1).toFixed(1),
      trend: 'flat' as const,
      trendVal: 0,
      tier: assignTier(i + 1),
    }));
  } catch (e) {
    console.log('fetchSleeperADP error:', e);
    return [];
  }
}

// ── ESPN ADP ────────────────────────────────────────────────
export async function fetchESPNADP(): Promise<RankedPlayer[]> {
  try {
    // ESPN fantasy player rankings endpoint
    const res = await fetch(
      'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2025/segments/0/leagues/0?view=kona_player_info',
      { headers: { 'x-fantasy-filter': JSON.stringify({ players: { limit: 200, sortDraftRanks: { sortPriority: 1, sortAsc: true, value: "STANDARD" } } }) } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const espnPlayers = data.players ?? [];
    
    const posMap: Record<number, string> = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DEF' };

    return espnPlayers
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
  } catch (e) {
    console.log('fetchESPNADP error:', e);
    return [];
  }
}

// ── Yahoo ADP (requires OAuth) ──────────────────────────────
export async function fetchYahooADP(): Promise<RankedPlayer[]> {
  try {
    const { getValidYahooToken } = require('./yahoo');
    const token = await getValidYahooToken();
    if (!token) return [];

    const res = await fetch(
      'https://fantasysports.yahooapis.com/fantasy/v2/game/nfl/players;sort=OR;count=200?format=json',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const yahooPlayers = data?.fantasy_content?.game?.[1]?.players;
    if (!yahooPlayers) return [];

    const result: RankedPlayer[] = [];
    const count = yahooPlayers.count ?? 0;
    for (let i = 0; i < count; i++) {
      const p = yahooPlayers[i]?.player?.[0];
      if (!p) continue;
      const nameObj = p.find((x: any) => x.name);
      const posObj = p.find((x: any) => x.display_position);
      const teamObj = p.find((x: any) => x.editorial_team_abbr);
      const keyObj = p.find((x: any) => x.player_key);
      result.push({
        id: keyObj?.player_key ?? String(i),
        name: nameObj?.name?.full ?? 'Unknown',
        position: posObj?.display_position ?? 'FLEX',
        team: teamObj?.editorial_team_abbr ?? '—',
        rank: i + 1,
        adp: (i + 1).toFixed(1),
        trend: 'flat' as const,
        trendVal: 0,
        tier: assignTier(i + 1),
      });
    }
    return result;
  } catch (e) {
    console.log('fetchYahooADP error:', e);
    return [];
  }
}

// ── Source dispatcher ────────────────────────────────────────
export async function fetchBaseRankings(source: RankingsSource): Promise<RankedPlayer[]> {
  switch (source) {
    case 'sleeper':     return fetchSleeperADP();
    case 'espn':        return fetchESPNADP();
    case 'yahoo':       return fetchYahooADP();
    // fantasypros and nfl.com — future integration
    case 'fantasypros': return fetchSleeperADP(); // fallback to Sleeper for now
    case 'nfl':         return fetchSleeperADP(); // fallback to Sleeper for now
    case 'aiomni':      return fetchAIOmniRankings();
    default:            return fetchSleeperADP();
  }
}



// ── AIOmni AI Rankings — synthesized from all sources ───────
export async function fetchBlendedConsensus(): Promise<RankedPlayer[]> {
  return fetchAIOmniRankings();
}

export async function fetchAIOmniRankings(): Promise<RankedPlayer[]> {
  // Pull from all available sources in parallel
  const [sleeper, espn, yahoo] = await Promise.allSettled([
    fetchSleeperADP(),
    fetchESPNADP(),
    fetchYahooADP(),
  ]);

  const sources: { name: string; data: RankedPlayer[] }[] = [];
  if (sleeper.status === 'fulfilled' && sleeper.value.length > 0)
    sources.push({ name: 'Sleeper ADP', data: sleeper.value });
  if (espn.status === 'fulfilled' && espn.value.length > 0)
    sources.push({ name: 'ESPN ADP', data: espn.value });
  if (yahoo.status === 'fulfilled' && yahoo.value.length > 0)
    sources.push({ name: 'Yahoo ADP', data: yahoo.value });

  if (sources.length === 0) {
    // Fallback to Sleeper if all fail
    return fetchSleeperADP();
  }

  // Build a unified player map with ranks from each source
  const playerMap = new Map<string, {
    name: string;
    position: string;
    team: string;
    id: string;
    ranks: { source: string; rank: number }[];
  }>();

  const normalize = (name: string) => name.toLowerCase().replace(/[^a-z]/g, '');

  for (const source of sources) {
    for (const p of source.data) {
      const key = normalize(p.name);
      if (playerMap.has(key)) {
        playerMap.get(key)!.ranks.push({ source: source.name, rank: p.rank });
      } else {
        playerMap.set(key, {
          name: p.name,
          position: p.position,
          team: p.team,
          id: p.id,
          ranks: [{ source: source.name, rank: p.rank }],
        });
      }
    }
  }

  // Calculate weighted score for each player
  // Players ranked by more sources get boosted
  // Lower median rank = better
  const scored = Array.from(playerMap.values()).map(p => {
    const rankValues = p.ranks.map(r => r.rank);
    rankValues.sort((a, b) => a - b);

    // Weighted median — more sources = more confidence
    const mid = Math.floor(rankValues.length / 2);
    const median = rankValues.length % 2 === 0
      ? (rankValues[mid - 1] + rankValues[mid]) / 2
      : rankValues[mid];

    // Confidence bonus: subtract 0.5 for each additional source
    const confidenceBonus = (p.ranks.length - 1) * 0.5;
    const aiScore = median - confidenceBonus;

    // Calculate agreement — how close sources are
    const spread = rankValues.length > 1
      ? rankValues[rankValues.length - 1] - rankValues[0]
      : 0;

    return {
      ...p,
      aiScore,
      median,
      sourceCount: p.ranks.length,
      spread,
      trend: spread <= 5 ? 'up' as const : spread <= 15 ? 'flat' as const : 'down' as const,
      trendVal: p.ranks.length,
    };
  });

  // Sort by AI score (lower = better)
  scored.sort((a, b) => a.aiScore - b.aiScore);

  return scored.slice(0, 200).map((p, i) => ({
    id: p.id,
    name: p.name,
    position: p.position,
    team: p.team,
    rank: i + 1,
    adp: p.median.toFixed(1),
    tier: i < 4 ? 1 : i < 10 ? 2 : i < 18 ? 3 : i < 25 ? 4 : 5,
    trend: p.trend,
    trendVal: p.sourceCount, // shows how many sources agree
  }));
}

// ── ESPN team ID → abbreviation ─────────────────────────────
function getESPNTeamAbbr(id: number): string {
  const map: Record<number, string> = {
    1:'ATL',2:'BUF',3:'CHI',4:'CIN',5:'CLE',6:'DAL',7:'DEN',8:'DET',
    9:'GB',10:'TEN',11:'IND',12:'KC',13:'LV',14:'LAR',15:'MIA',16:'MIN',
    17:'NE',18:'NO',19:'NYG',20:'NYJ',21:'PHI',22:'ARI',23:'PIT',24:'LAC',
    25:'SF',26:'SEA',27:'TB',28:'WSH',29:'CAR',30:'JAX',33:'BAL',34:'HOU',
  };
  return map[id] ?? '—';
}



// ── Format-based positional adjustments ─────────────────────
export type ScoringFormat = 'PPR' | 'HALF' | 'STD' | 'SF' | 'DYN';

const FORMAT_BOOSTS: Record<ScoringFormat, Record<string, number>> = {
  PPR:  { WR: -8, TE: -5, RB: 4, QB: 0, K: 0 },     // WR/TE surge in PPR
  HALF: { WR: -4, TE: -3, RB: 2, QB: 0, K: 0 },      // moderate WR boost
  STD:  { RB: -8, WR: 5, TE: 6, QB: 0, K: 0 },       // RBs dominate standard
  SF:   { QB: -15, RB: 2, WR: 3, TE: 3, K: 0 },      // QBs way up in SF
  DYN:  { QB: -5, RB: 0, WR: -3, TE: -2, K: 4 },     // youth + QB value
};

export function applyFormatAdjustments(
  rankings: RankedPlayer[],
  format: ScoringFormat
): RankedPlayer[] {
  const boosts = FORMAT_BOOSTS[format] || FORMAT_BOOSTS.PPR;

  const adjusted = rankings.map(p => ({
    ...p,
    adjustedRank: p.rank + (boosts[p.position] || 0),
  }));

  // Re-sort by adjusted rank
  adjusted.sort((a, b) => a.adjustedRank - b.adjustedRank);

  // Re-assign clean ranks and tiers
  return adjusted.map((p, i) => ({
    ...p,
    rank: i + 1,
    tier: i < 4 ? 1 : i < 10 ? 2 : i < 18 ? 3 : i < 25 ? 4 : 5,
  }));
}

// ── Persistence helpers ─────────────────────────────────────
export async function getSelectedBase(): Promise<RankingsSource | null> {
  const val = await AsyncStorage.getItem('rankings_base_source');
  return val as RankingsSource | null;
}

export async function setSelectedBase(source: RankingsSource): Promise<void> {
  await AsyncStorage.setItem('rankings_base_source', source);
}

export async function getCustomRankings(format: string = 'PPR'): Promise<RankedPlayer[] | null> {
  const val = await AsyncStorage.getItem('my_custom_rankings_' + format);
  if (!val) {
    // Fallback to legacy key for migration
    const legacy = await AsyncStorage.getItem('my_custom_rankings_v7');
    if (legacy) return JSON.parse(legacy);
    return null;
  }
  try { return JSON.parse(val); } catch { return null; }
}

export async function saveCustomRankings(rankings: RankedPlayer[], format: string = 'PPR'): Promise<void> {
  await AsyncStorage.setItem('my_custom_rankings_' + format, JSON.stringify(rankings));
}