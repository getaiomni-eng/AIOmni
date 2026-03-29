// services/rankings.ts
// Rankings data aggregator — pulls real data from every wired source
// Sleeper players DB + trending, ESPN injuries + stats, nflverse snaps, RotoWire news, Vegas lines

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
  statLine:      string;        // e.g. "1,247 yds · 9 TD"
  statValue:     number;        // raw sort value (yards, points, etc.)
  injuryStatus:  string | null; // Out, Doubtful, Questionable, IR, null
  injuryDetail:  string | null;
  trendingAdds:  number;        // Sleeper trending add count (0 = not trending)
  trendingDrops: number;        // Sleeper trending drop count
  snapPct:       number | null; // nflverse snap share 0-100
  newsHeadline:  string | null;
  newsAge:       string | null; // "2h ago", "1d ago"
  impliedTeamScore: number | null; // Vegas
  isDrafted:     boolean;       // local draft mode state
}

export type ScoringFormat = 'ppr' | 'half' | 'standard';

// ─── Sleeper Players DB (cached 24h) ──────────────────────────────────────────
const SLEEPER_CACHE_KEY = 'sleeper_players_db';
const SLEEPER_CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

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
  // Check memory cache
  if (sleeperPlayersCache) return sleeperPlayersCache;

  // Check AsyncStorage cache
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

  // Fetch fresh
  try {
    const res = await fetch('https://api.sleeper.app/v1/players/nfl');
    const data = await res.json();
    sleeperPlayersCache = data;
    // Cache in AsyncStorage (store only active NFL players to save space)
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
          search_rank: p.search_rank,
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
      const cat = categories[i];

      for (const group of data.leaders) {
        const statName = group.name || cat;
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

// ─── nflverse Snap Counts (latest week) ───────────────────────────────────────
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

    // Find the latest week in the data
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
  // Fetch all sources in parallel
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

  // Merge ESPN leaders into a player map (deduped by name)
  const playerMap = new Map<string, RankedPlayer>();

  // Primary stat for each position
  const primaryStat: Record<string, string[]> = {
    QB:  ['passingYards', 'passingTouchdowns'],
    RB:  ['rushingYards', 'rushingTouchdowns'],
    WR:  ['receivingYards', 'receivingTouchdowns', 'receptions'],
    TE:  ['receivingYards', 'receivingTouchdowns', 'receptions'],
    K:   ['scoring'],
    DEF: [],
  };

  for (const l of espnLeaders) {
    const key = l.name.toLowerCase();
    const existing = playerMap.get(key);

    if (existing) {
      // Append stat info
      if (l.value > 0) {
        const parts = existing.statLine ? existing.statLine.split(' · ') : [];
        const newStat = formatStatLabel(l.statType, l.value);
        if (newStat && !parts.includes(newStat)) parts.push(newStat);
        existing.statLine = parts.join(' · ');
        // Use the highest stat value for sorting
        if (l.value > existing.statValue) existing.statValue = l.value;
      }
    } else {
      playerMap.set(key, {
        id:           l.espnId,
        name:         l.name,
        team:         l.team,
        position:     l.position || guessPosition(l.statType),
        rank:         0,
        posRank:      0,
        statLine:     formatStatLabel(l.statType, l.value) || '',
        statValue:    l.value,
        injuryStatus: null,
        injuryDetail: null,
        trendingAdds: 0,
        trendingDrops:0,
        snapPct:      null,
        newsHeadline: null,
        newsAge:      null,
        impliedTeamScore: null,
        isDrafted:    false,
      });
    }
  }

  // Enrich with Sleeper data — add trending players not already in ESPN leaders
  for (const [playerId, count] of trendingAddMap) {
    const sp = sleeperPlayers[playerId];
    if (!sp || !sp.team) continue;
    const key = sp.full_name.toLowerCase();
    const existing = playerMap.get(key);
    if (existing) {
      existing.trendingAdds = count;
      if (!existing.id) existing.id = playerId;
    } else {
      playerMap.set(key, {
        id:           playerId,
        name:         sp.full_name,
        team:         sp.team,
        position:     sp.position,
        rank:         0,
        posRank:      0,
        statLine:     `🔥 ${count.toLocaleString()} adds`,
        statValue:    0,
        injuryStatus: null,
        injuryDetail: null,
        trendingAdds: count,
        trendingDrops:0,
        snapPct:      null,
        newsHeadline: null,
        newsAge:      null,
        impliedTeamScore: null,
        isDrafted:    false,
      });
    }
  }

  // Apply drops
  for (const [playerId, count] of trendingDropMap) {
    const sp = sleeperPlayers[playerId];
    if (!sp) continue;
    const key = sp.full_name.toLowerCase();
    const existing = playerMap.get(key);
    if (existing) existing.trendingDrops = count;
  }

  // Enrich all players with injury, snaps, news, vegas
  for (const [, player] of playerMap) {
    // Injury
    const inj = injuryMap.get(player.name.toLowerCase());
    if (inj) {
      player.injuryStatus = inj.status;
      player.injuryDetail = inj.injury;
    }

    // Snap %
    const snap = snapMap.get(player.name.toLowerCase());
    if (snap !== undefined) player.snapPct = snap;

    // News
    const playerNews = findNewsForPlayer(news, player.name, 1);
    if (playerNews.length > 0) {
      player.newsHeadline = playerNews[0].title;
      player.newsAge = formatNewsAge(playerNews[0].pubDate);
    }

    // Vegas implied score
    const teamKey = player.team?.toLowerCase();
    if (teamKey) {
      // Try common abbreviation mappings
      const implied = vegasTeamMap.get(teamKey) ??
        findVegasForTeam(vegas, player.team);
      if (implied) player.impliedTeamScore = implied;
    }
  }

  // Convert to array and apply format-based scoring adjustments
  let players = Array.from(playerMap.values());

  // Format weight multipliers
  const formatWeights: Record<ScoringFormat, Record<string, number>> = {
    ppr:      { QB: 1.0, RB: 0.95, WR: 1.15, TE: 1.2, K: 1.0, DEF: 1.0 },
    half:     { QB: 1.0, RB: 1.0,  WR: 1.05, TE: 1.1, K: 1.0, DEF: 1.0 },
    standard: { QB: 1.0, RB: 1.1,  WR: 0.95, TE: 0.9, K: 1.0, DEF: 1.0 },
  };

  const weights = formatWeights[format];

  // Compute composite score: stat value × format weight + trending bonus
  for (const p of players) {
    const w = weights[p.position] ?? 1.0;
    const trendBonus = (p.trendingAdds > 0 ? Math.log10(p.trendingAdds + 1) * 50 : 0)
                     - (p.trendingDrops > 0 ? Math.log10(p.trendingDrops + 1) * 30 : 0);
    const snapBonus  = p.snapPct ? (p.snapPct / 100) * 20 : 0;
    p.statValue = (p.statValue * w) + trendBonus + snapBonus;

    // Penalize injured players slightly in rankings
    if (p.injuryStatus === 'Out' || p.injuryStatus === 'Injured Reserve') {
      p.statValue *= 0.3;
    } else if (p.injuryStatus === 'Doubtful') {
      p.statValue *= 0.6;
    } else if (p.injuryStatus === 'Questionable') {
      p.statValue *= 0.9;
    }
  }

  // Sort by composite score
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

function guessPosition(statType: string): string {
  const t = statType.toLowerCase();
  if (t.includes('passing'))   return 'QB';
  if (t.includes('rushing'))   return 'RB';
  if (t.includes('receiving')) return 'WR';
  if (t.includes('scoring'))   return 'K';
  return 'WR';
}

function findVegasForTeam(vegas: VegasLine[], teamAbbr: string): number | null {
  const abbr = teamAbbr.toUpperCase();
  for (const v of vegas) {
    if (v.homeTeam.toUpperCase().includes(abbr)) return v.homeImpliedScore;
    if (v.awayTeam.toUpperCase().includes(abbr)) return v.awayImpliedScore;
  }
  return null;
}