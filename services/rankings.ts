// services/rankings.ts
// Rankings data aggregator — pulls real data from every wired source
// Sleeper search_rank as baseline + trending, ESPN injuries + stats, nflverse snaps, RotoWire news, Vegas

import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchNFLInjuries, fetchVegasLines, InjuryReport, VegasLine } from './liveData';
import { fetchRotoWireNFL, findNewsForPlayer, formatNewsAge } from './rotowire';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface RankedPlayer {
  id:            string;
  name:          string;
  team:          string;
  position:      string;
  rank:          number;
  posRank:       number;
  statLine:      string;
  statValue:     number;
  injuryStatus:  string | null;
  injuryDetail:  string | null;
  trendingAdds:  number;
  trendingDrops: number;
  snapPct:       number | null;
  newsHeadline:  string | null;
  newsAge:       string | null;
  impliedTeamScore: number | null;
  isDrafted:     boolean;
}

export type ScoringFormat = 'ppr' | 'half' | 'standard';

// ─── Sleeper Players DB (cached 24h) ──────────────────────────────────────────
const SLEEPER_CACHE_KEY = 'sleeper_players_db';
const SLEEPER_CACHE_TTL = 24 * 60 * 60 * 1000;

interface SleeperPlayer {
  player_id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  position: string;
  team: string | null;
  status: string;
  active: boolean;
  age?: number;
  years_exp?: number;
  search_rank?: number;
  fantasy_positions?: string[];
}

let sleeperPlayersCache: Record<string, SleeperPlayer> | null = null;

export async function fetchSleeperPlayers(): Promise<Record<string, SleeperPlayer>> {
  if (sleeperPlayersCache) return sleeperPlayersCache;

  try {
    const cached = await AsyncStorage.getItem(SLEEPER_CACHE_KEY);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < SLEEPER_CACHE_TTL) {
        sleeperPlayersCache = data;
        return data;
      }
    }
  } catch (e) { /* cache miss */ }

  try {
    const res = await fetch('https://api.sleeper.app/v1/players/nfl');
    const data = await res.json();
    const slim: Record<string, SleeperPlayer> = {};
    for (const [id, p] of Object.entries(data as Record<string, any>)) {
      if (p.active && p.team && ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(p.position)) {
        slim[id] = {
          player_id: id,
          first_name: p.first_name || '',
          last_name: p.last_name || '',
          full_name: p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim(),
          position: p.position,
          team: p.team,
          status: p.status || 'Active',
          active: true,
          age: p.age,
          years_exp: p.years_exp,
          search_rank: p.search_rank ?? 9999,
          fantasy_positions: p.fantasy_positions,
        };
      }
    }
    await AsyncStorage.setItem(SLEEPER_CACHE_KEY, JSON.stringify({ data: slim, timestamp: Date.now() }));
    sleeperPlayersCache = slim;
    return slim;
  } catch (e) {
    console.log('fetchSleeperPlayers error:', e);
    return {};
  }
}

// ─── Sleeper Trending ─────────────────────────────────────────────────────────
interface TrendingItem { player_id: string; count: number; }

export async function fetchSleeperTrending(): Promise<{ adds: TrendingItem[]; drops: TrendingItem[] }> {
  try {
    const [addRes, dropRes] = await Promise.all([
      fetch('https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=24&limit=50'),
      fetch('https://api.sleeper.app/v1/players/nfl/trending/drop?lookback_hours=24&limit=50'),
    ]);
    const adds  = await addRes.json();
    const drops = await dropRes.json();
    return {
      adds:  Array.isArray(adds)  ? adds  : [],
      drops: Array.isArray(drops) ? drops : [],
    };
  } catch (e) {
    console.log('fetchSleeperTrending error:', e);
    return { adds: [], drops: [] };
  }
}

// ─── ESPN Stat Leaders ────────────────────────────────────────────────────────
interface ESPNLeader {
  name: string;
  team: string;
  position: string;
  statType: string;
  value: number;
  espnId: string;
}

export async function fetchESPNLeaders(): Promise<ESPNLeader[]> {
  const leaders: ESPNLeader[] = [];
  const categories = ['passing', 'rushing', 'receiving', 'scoring'];

  try {
    const responses = await Promise.all(
      categories.map(cat =>
        fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/leaders?limit=50&stat=${cat}`)
          .then(r => r.json())
          .catch(() => null)
      )
    );

    for (let i = 0; i < categories.length; i++) {
      const data = responses[i];
      if (!data?.leaders) continue;
      for (const group of data.leaders) {
        const statName = group.name || categories[i];
        for (const l of (group.leaders || [])) {
          const athlete = l.athlete;
          if (!athlete) continue;
          leaders.push({
            name:     athlete.displayName || 'Unknown',
            team:     l.team?.abbreviation || '',
            position: athlete.position?.abbreviation || '',
            statType: statName,
            value:    l.value ?? 0,
            espnId:   athlete.id || '',
          });
        }
      }
    }
  } catch (e) {
    console.log('fetchESPNLeaders error:', e);
  }

  return leaders;
}

// ─── nflverse Snap Counts ─────────────────────────────────────────────────────
interface SnapData { player: string; team: string; position: string; snapPct: number; }

export async function fetchLatestSnaps(season = 2024): Promise<SnapData[]> {
  try {
    const url = `https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_${season}.csv`;
    const res = await fetch(url);
    if (!res.ok) return [];

    const text = await res.text();
    const lines = text.split('\n');
    if (lines.length < 2) return [];

    const headers = lines[0].split(',');
    const weekIdx    = headers.indexOf('week');
    const playerIdx  = headers.indexOf('player');
    const teamIdx    = headers.indexOf('team');
    const posIdx     = headers.indexOf('position');
    const offPctIdx  = headers.indexOf('offense_pct');

    if (weekIdx === -1 || playerIdx === -1) return [];

    const weeks = lines.slice(1).map(l => parseInt(l.split(',')[weekIdx])).filter(w => !isNaN(w));
    const latestWeek = Math.max(...weeks);

    return lines.slice(1)
      .map(l => l.split(','))
      .filter(row => parseInt(row[weekIdx]) === latestWeek && ['QB', 'WR', 'RB', 'TE'].includes(row[posIdx]))
      .map(row => ({
        player:   row[playerIdx]?.replace(/"/g, '') || '',
        team:     row[teamIdx] || '',
        position: row[posIdx] || '',
        snapPct:  Math.round(parseFloat(row[offPctIdx] || '0') * 100),
      }))
      .filter(s => s.snapPct > 0);
  } catch (e) {
    console.log('fetchLatestSnaps error:', e);
    return [];
  }
}

// ─── Build unified rankings ───────────────────────────────────────────────────
export async function buildRankings(format: ScoringFormat = 'ppr'): Promise<RankedPlayer[]> {
  const [sleeperPlayers, trending, espnLeaders, injuries, snaps, news, vegas] = await Promise.all([
    fetchSleeperPlayers(),
    fetchSleeperTrending(),
    fetchESPNLeaders(),
    fetchNFLInjuries(),
    fetchLatestSnaps(),
    fetchRotoWireNFL(),
    fetchVegasLines(),
  ]);

  // Build lookup maps
  const trendingAddMap  = new Map<string, number>();
  const trendingDropMap = new Map<string, number>();
  for (const t of trending.adds)  trendingAddMap.set(t.player_id, t.count);
  for (const t of trending.drops) trendingDropMap.set(t.player_id, t.count);

  const injuryMap = new Map<string, InjuryReport>();
  for (const inj of injuries) injuryMap.set(inj.playerName.toLowerCase(), inj);

  const snapMap = new Map<string, number>();
  for (const s of snaps) snapMap.set(s.player.toLowerCase(), s.snapPct);

  const vegasTeamMap = new Map<string, number>();
  for (const v of vegas) {
    vegasTeamMap.set(v.homeTeam.toLowerCase(), v.homeImpliedScore);
    vegasTeamMap.set(v.awayTeam.toLowerCase(), v.awayImpliedScore);
  }

  // ESPN stats by player name
  const espnStatMap = new Map<string, { stats: string[]; value: number }>();
  for (const l of espnLeaders) {
    const key = l.name.toLowerCase();
    const existing = espnStatMap.get(key);
    const label = formatStatLabel(l.statType, l.value);
    if (existing) {
      if (label && !existing.stats.includes(label)) existing.stats.push(label);
      if (l.value > existing.value) existing.value = l.value;
    } else {
      espnStatMap.set(key, { stats: label ? [label] : [], value: l.value });
    }
  }

  // ── BASE RANKINGS: Sleeper search_rank (works year-round) ──────────────
  // search_rank is Sleeper's fantasy consensus rank for every active player
  // This ensures we always have proper rankings even in offseason

  const formatWeights: Record<ScoringFormat, Record<string, number>> = {
    ppr:      { QB: 1.0, RB: 0.95, WR: 1.1, TE: 1.15, K: 1.0, DEF: 1.0 },
    half:     { QB: 1.0, RB: 1.0,  WR: 1.05, TE: 1.05, K: 1.0, DEF: 1.0 },
    standard: { QB: 1.0, RB: 1.1,  WR: 0.95, TE: 0.85, K: 1.0, DEF: 1.0 },
  };
  const weights = formatWeights[format];

  // Convert all Sleeper players with a valid search_rank into ranked players
  let players: RankedPlayer[] = [];

  for (const [id, sp] of Object.entries(sleeperPlayers)) {
    if (!sp.team || !sp.active) continue;
    const searchRank = sp.search_rank ?? 9999;
    if (searchRank > 500) continue; // Only top 500 fantasy-relevant players

    const nameKey = sp.full_name.toLowerCase();
    const espnStats = espnStatMap.get(nameKey);
    const inj = injuryMap.get(nameKey);
    const snap = snapMap.get(nameKey);
    const playerNews = findNewsForPlayer(news, sp.full_name, 1);
    const trendAdds = trendingAddMap.get(id) ?? 0;
    const trendDrops = trendingDropMap.get(id) ?? 0;

    // Vegas implied score for team
    const teamKey = sp.team?.toLowerCase();
    let implied: number | null = null;
    if (teamKey) {
      implied = vegasTeamMap.get(teamKey) ?? findVegasForTeam(vegas, sp.team) ?? null;
    }

    // Composite score: lower search_rank = better player
    // Invert so higher score = better rank
    const posWeight = weights[sp.position] ?? 1.0;
    let score = (600 - Math.min(searchRank, 500)) * posWeight;

    // Boost from ESPN stats (season leaders get a bump)
    if (espnStats && espnStats.value > 0) {
      score += Math.min(espnStats.value * 0.1, 100);
    }

    // Trending momentum
    if (trendAdds > 0)  score += Math.log10(trendAdds + 1) * 15;
    if (trendDrops > 0) score -= Math.log10(trendDrops + 1) * 10;

    // Snap share bonus
    if (snap && snap > 50) score += (snap - 50) * 0.3;

    // Injury penalty
    if (inj) {
      if (inj.status === 'Out' || inj.status === 'Injured Reserve') score *= 0.3;
      else if (inj.status === 'Doubtful') score *= 0.6;
      else if (inj.status === 'Questionable') score *= 0.9;
    }

    // Build stat line
    let statLine = '';
    if (espnStats && espnStats.stats.length > 0) {
      statLine = espnStats.stats.join(' · ');
    } else if (trendAdds > 0) {
      statLine = `🔥 ${trendAdds.toLocaleString()} adds`;
    }

    players.push({
      id,
      name:         sp.full_name,
      team:         sp.team,
      position:     sp.position,
      rank:         0,
      posRank:      0,
      statLine,
      statValue:    score,
      injuryStatus: inj?.status ?? null,
      injuryDetail: inj?.injury ?? null,
      trendingAdds: trendAdds,
      trendingDrops: trendDrops,
      snapPct:      snap ?? null,
      newsHeadline: playerNews.length > 0 ? playerNews[0].title : null,
      newsAge:      playerNews.length > 0 ? formatNewsAge(playerNews[0].pubDate) : null,
      impliedTeamScore: implied,
      isDrafted:    false,
    });
  }

  // Sort by composite score descending
  players.sort((a, b) => b.statValue - a.statValue);

  // Assign overall rank and position rank
  const posCounters: Record<string, number> = {};
  players.forEach((p, i) => {
    p.rank = i + 1;
    posCounters[p.position] = (posCounters[p.position] || 0) + 1;
    p.posRank = posCounters[p.position];
  });

  return players;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatStatLabel(statType: string, value: number): string {
  if (!value) return '';
  const type = statType.toLowerCase();
  if (type.includes('yard'))       return `${value.toLocaleString()} yds`;
  if (type.includes('touchdown'))  return `${value} TD`;
  if (type.includes('reception'))  return `${value} rec`;
  if (type.includes('scoring'))    return `${value} pts`;
  if (type.includes('passing'))    return `${value.toLocaleString()} yds`;
  if (type.includes('rushing'))    return `${value.toLocaleString()} yds`;
  if (type.includes('receiving'))  return `${value.toLocaleString()} yds`;
  return `${value}`;
}

function findVegasForTeam(vegas: VegasLine[], teamAbbr: string): number | null {
  const abbr = teamAbbr.toUpperCase();
  for (const v of vegas) {
    if (v.homeTeam.toUpperCase().includes(abbr)) return v.homeImpliedScore;
    if (v.awayTeam.toUpperCase().includes(abbr)) return v.awayImpliedScore;
  }
  return null;
}