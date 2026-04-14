// services/rankingsData.ts
// AIOmni Unified Rankings Engine
// Sources: Sleeper ADP + trending, ESPN ADP + leaders, Yahoo ADP,
//          NFL injuries, Vegas lines, nflverse snap counts, Rotowire news,
//          College Football Data API, NCAA API
// All free. No paid APIs required.

import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── TYPES ──────────────────────────────────────────────────

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

const TIER_BREAKS = [4, 10, 18, 25];
function assignTier(rank: number): number {
  if (rank <= TIER_BREAKS[0]) return 1;
  if (rank <= TIER_BREAKS[1]) return 2;
  if (rank <= TIER_BREAKS[2]) return 3;
  if (rank <= TIER_BREAKS[3]) return 4;
  return 5;
}

const NCAA_API_BASE = 'https://ncaa-api.henrygd.me';
const CFBD_API_KEY  = 'FXYJqCTsSGNxj67UAcWxd6pDdgYZ15hvXE/WscfGOnUW09lvRDEvZe/xngs/bMuo';

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
    const players = await getSleeperPlayers();

    const eligible = Object.entries(players)
      .filter(([_, p]: any) =>
        p.active && p.search_rank && p.search_rank < 500 &&
        ['QB', 'RB', 'WR', 'TE', 'K'].includes(p.position) && p.team
      )
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
  try {
    const res = await fetch(
      'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/0?view=kona_player_info',
      { headers: { 'x-fantasy-filter': JSON.stringify({ players: { limit: 200, sortDraftRanks: { sortPriority: 1, sortAsc: true, value: "STANDARD" } } }) } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const posMap: Record<number, string> = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DEF' };

    return (data.players ?? [])
      .filter((p: any) => posMap[p.player?.defaultPositionId])
      .slice(0, 200)
      .map((p: any, i: number) => ({
        id: String(p.id), name: p.player?.fullName ?? 'Unknown',
        position: posMap[p.player?.defaultPositionId] ?? 'FLEX',
        team: p.player?.proTeamId ? getESPNTeamAbbr(p.player.proTeamId) : '—',
        rank: i + 1, adp: (p.player?.ownership?.averageDraftPosition ?? i + 1).toFixed(1),
        trend: 'flat' as const, trendVal: 0, tier: assignTier(i + 1),
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
      result.push({
        id: p.find((x: any) => x.player_key)?.player_key ?? String(i),
        name: p.find((x: any) => x.name)?.name?.full ?? 'Unknown',
        position: p.find((x: any) => x.display_position)?.display_position ?? 'FLEX',
        team: p.find((x: any) => x.editorial_team_abbr)?.editorial_team_abbr ?? '—',
        rank: i + 1, adp: (i + 1).toFixed(1), trend: 'flat' as const, trendVal: 0, tier: assignTier(i + 1),
      });
    }
    return result;
  } catch (e) { console.log('fetchYahooADP error:', e); return []; }
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

async function fetchSnapCounts(season = 2024): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
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

const PROSPECT_SEED_2026: CollegeProspect[] = [
  { id: 'p01', name: 'Travis Hunter', school: 'Colorado', position: 'WR', year: '2026', height: '6-1', weight: 185, grade: 98 },
  { id: 'p02', name: 'Cam Ward', school: 'Miami', position: 'QB', year: '2026', height: '6-2', weight: 223, grade: 96 },
  { id: 'p03', name: 'Shedeur Sanders', school: 'Colorado', position: 'QB', year: '2026', height: '6-2', weight: 215, grade: 95 },
  { id: 'p04', name: 'Abdul Carter', school: 'Penn State', position: 'EDGE', year: '2026', height: '6-3', weight: 252, grade: 95 },
  { id: 'p05', name: 'Mason Graham', school: 'Michigan', position: 'DT', year: '2026', height: '6-3', weight: 318, grade: 94 },
  { id: 'p06', name: 'Tetairoa McMillan', school: 'Arizona', position: 'WR', year: '2026', height: '6-5', weight: 212, grade: 94 },
  { id: 'p07', name: 'Will Johnson', school: 'Michigan', position: 'CB', year: '2026', height: '6-2', weight: 202, grade: 93 },
  { id: 'p08', name: 'Ashton Jeanty', school: 'Boise State', position: 'RB', year: '2026', height: '5-9', weight: 215, grade: 93 },
  { id: 'p09', name: 'Mykel Williams', school: 'Georgia', position: 'EDGE', year: '2026', height: '6-5', weight: 265, grade: 92 },
  { id: 'p10', name: 'Kelvin Banks Jr.', school: 'Texas', position: 'OT', year: '2026', height: '6-4', weight: 324, grade: 92 },
  { id: 'p11', name: 'Luther Burden III', school: 'Missouri', position: 'WR', year: '2026', height: '5-11', weight: 208, grade: 91 },
  { id: 'p12', name: 'Will Campbell', school: 'LSU', position: 'OT', year: '2026', height: '6-6', weight: 323, grade: 91 },
  { id: 'p13', name: 'Malaki Starks', school: 'Georgia', position: 'S', year: '2026', height: '6-1', weight: 205, grade: 90 },
  { id: 'p14', name: 'James Pearce Jr.', school: 'Tennessee', position: 'EDGE', year: '2026', height: '6-5', weight: 243, grade: 90 },
  { id: 'p15', name: 'Tyler Warren', school: 'Penn State', position: 'TE', year: '2026', height: '6-6', weight: 260, grade: 89 },
  { id: 'p16', name: 'Colston Loveland', school: 'Michigan', position: 'TE', year: '2026', height: '6-5', weight: 245, grade: 89 },
  { id: 'p17', name: 'Jalon Walker', school: 'Georgia', position: 'LB', year: '2026', height: '6-2', weight: 245, grade: 88 },
  { id: 'p18', name: 'Nick Singleton', school: 'Penn State', position: 'RB', year: '2026', height: '6-0', weight: 224, grade: 88 },
  { id: 'p19', name: 'Emeka Egbuka', school: 'Ohio State', position: 'WR', year: '2026', height: '6-1', weight: 206, grade: 87 },
  { id: 'p20', name: 'Nic Scourton', school: 'Texas A&M', position: 'EDGE', year: '2026', height: '6-4', weight: 280, grade: 87 },
  { id: 'p21', name: 'Jalen Milroe', school: 'Alabama', position: 'QB', year: '2026', height: '6-2', weight: 225, grade: 86 },
  { id: 'p22', name: 'Derrick Harmon', school: 'Oregon', position: 'DT', year: '2026', height: '6-5', weight: 310, grade: 86 },
  { id: 'p23', name: 'Kenneth Grant', school: 'Michigan', position: 'DT', year: '2026', height: '6-3', weight: 339, grade: 85 },
  { id: 'p24', name: 'Matthew Golden', school: 'Texas', position: 'WR', year: '2026', height: '6-0', weight: 195, grade: 85 },
  { id: 'p25', name: 'Tre Harris', school: 'Ole Miss', position: 'WR', year: '2026', height: '6-3', weight: 210, grade: 84 },
  { id: 'p26', name: 'Omarion Hampton', school: 'North Carolina', position: 'RB', year: '2026', height: '6-0', weight: 220, grade: 84 },
  { id: 'p27', name: 'Shemar Stewart', school: 'Texas A&M', position: 'EDGE', year: '2026', height: '6-6', weight: 270, grade: 83 },
  { id: 'p28', name: 'Cameron Williams', school: 'Texas', position: 'OT', year: '2026', height: '6-5', weight: 335, grade: 83 },
  { id: 'p29', name: 'Donovan Ezeiruaku', school: 'Boston College', position: 'EDGE', year: '2026', height: '6-2', weight: 250, grade: 82 },
  { id: 'p30', name: 'Quinn Ewers', school: 'Texas', position: 'QB', year: '2026', height: '6-2', weight: 210, grade: 82 },
  { id: 'p31', name: 'Tyleik Williams', school: 'Ohio State', position: 'DT', year: '2026', height: '6-3', weight: 290, grade: 81 },
  { id: 'p32', name: 'Benjamin Morrison', school: 'Notre Dame', position: 'CB', year: '2026', height: '6-0', weight: 190, grade: 81 },
  { id: 'p33', name: 'Carson Beck', school: 'Georgia', position: 'QB', year: '2026', height: '6-4', weight: 230, grade: 80 },
  { id: 'p34', name: 'Shavon Revel Jr.', school: 'East Carolina', position: 'CB', year: '2026', height: '6-3', weight: 195, grade: 80 },
  { id: 'p35', name: 'Grey Zabel', school: 'North Dakota State', position: 'OG', year: '2026', height: '6-5', weight: 305, grade: 79 },
  { id: 'p36', name: 'Isaiah Bond', school: 'Texas', position: 'WR', year: '2026', height: '5-11', weight: 180, grade: 79 },
  { id: 'p37', name: 'Josh Simmons', school: 'Ohio State', position: 'OT', year: '2026', height: '6-5', weight: 310, grade: 78 },
  { id: 'p38', name: 'Jihaad Campbell', school: 'Alabama', position: 'LB', year: '2026', height: '6-3', weight: 244, grade: 78 },
  { id: 'p39', name: 'Deone Walker', school: 'Kentucky', position: 'DT', year: '2026', height: '6-6', weight: 345, grade: 77 },
  { id: 'p40', name: 'Landon Jackson', school: 'Arkansas', position: 'EDGE', year: '2026', height: '6-7', weight: 275, grade: 77 },
  { id: 'p41', name: 'Princely Umanmielen', school: 'Ole Miss', position: 'EDGE', year: '2026', height: '6-4', weight: 260, grade: 76 },
  { id: 'p42', name: 'Tyler Booker', school: 'Alabama', position: 'OG', year: '2026', height: '6-5', weight: 325, grade: 76 },
  { id: 'p43', name: 'Jaylin Noel', school: 'Iowa State', position: 'WR', year: '2026', height: '5-11', weight: 200, grade: 75 },
  { id: 'p44', name: 'Trey Amos', school: 'Ole Miss', position: 'CB', year: '2026', height: '6-1', weight: 195, grade: 75 },
  { id: 'p45', name: 'Kalel Mullings', school: 'Michigan', position: 'RB', year: '2026', height: '6-1', weight: 228, grade: 74 },
  { id: 'p46', name: 'Cam Skattebo', school: 'Arizona State', position: 'RB', year: '2026', height: '5-10', weight: 218, grade: 74 },
  { id: 'p47', name: 'Jack Sawyer', school: 'Ohio State', position: 'EDGE', year: '2026', height: '6-4', weight: 260, grade: 73 },
  { id: 'p48', name: 'Garrett Nussmeier', school: 'LSU', position: 'QB', year: '2026', height: '6-2', weight: 210, grade: 73 },
  { id: 'p49', name: 'Wyatt Milum', school: 'West Virginia', position: 'OT', year: '2026', height: '6-6', weight: 315, grade: 72 },
  { id: 'p50', name: 'Maxwell Hairston', school: 'Kentucky', position: 'CB', year: '2026', height: '6-1', weight: 190, grade: 72 },
];


// ─── 2026 PROSPECT SEED (fallback when CFBD is down) ────────


export async function fetchCFBDProspects(year = 2026): Promise<CollegeProspect[]> {
  if (!CFBD_API_KEY) return [];
  try {
    const res = await fetch(
      `https://api.collegefootballdata.com/draft/prospects?year=${year}`,
      { headers: { Authorization: `Bearer ${CFBD_API_KEY}` } }
    );
    if (!res.ok) return [];
    const data = await res.json();
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
  if (!CFBD_API_KEY) return [];
  try {
    const res = await fetch(
      `https://api.collegefootballdata.com/stats/player/season?year=${year}&category=receiving`,
      { headers: { Authorization: `Bearer ${CFBD_API_KEY}` } }
    );
    if (!res.ok) return [];
    return await res.json();
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

export async function fetchBlendedConsensus(): Promise<RankedPlayer[]> {
  // Pull ALL data sources in parallel
  const [
    sleeperResult, espnResult, yahooResult,
    trendingResult, leadersResult,
    injuriesResult, vegasResult, snapsResult, newsResult,
  ] = await Promise.allSettled([
    fetchSleeperADP(),
    fetchESPNADP(),
    fetchYahooADP(),
    fetchSleeperTrending(),
    fetchESPNLeaders(),
    fetchNFLInjuries(),
    fetchVegasLines(),
    fetchSnapCounts(),
    fetchRotoNews(),
  ]);

  // Unpack results safely
  const sleeperData = sleeperResult.status === 'fulfilled' ? sleeperResult.value : [];
  const espnData    = espnResult.status === 'fulfilled' ? espnResult.value : [];
  const yahooData   = yahooResult.status === 'fulfilled' ? yahooResult.value : [];
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

  // ── Step 1: Multi-source ADP blend ──
  const sources: { name: string; data: RankedPlayer[] }[] = [];
  if (sleeperData.length > 0) sources.push({ name: 'Sleeper', data: sleeperData });
  if (espnData.length > 0)    sources.push({ name: 'ESPN', data: espnData });
  if (yahooData.length > 0)   sources.push({ name: 'Yahoo', data: yahooData });

  if (sources.length === 0) return fetchSleeperADP(); // absolute fallback

  const normalize = (name: string) => name.toLowerCase().replace(/[^a-z]/g, '');

  const playerMap = new Map<string, {
    name: string; position: string; team: string; id: string;
    ranks: number[]; sourceCount: number;
  }>();

  for (const source of sources) {
    for (const p of source.data) {
      const key = normalize(p.name);
      if (playerMap.has(key)) {
        const existing = playerMap.get(key)!;
        existing.ranks.push(p.rank);
        existing.sourceCount++;
      } else {
        playerMap.set(key, {
          name: p.name, position: p.position, team: p.team, id: p.id,
          ranks: [p.rank], sourceCount: 1,
        });
      }
    }
  }

  // ── Step 2: Score each player with all data ──
  const scored: (RankedPlayer & { score: number })[] = [];

  for (const [key, p] of playerMap) {
    // Median ADP across sources
    const sorted = [...p.ranks].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

    // Base score: lower median = better (invert for sorting)
    let score = 600 - Math.min(median, 500);

    // Confidence bonus: more sources = more reliable
    score += (p.sourceCount - 1) * 3;

    // Trending momentum
    const adds  = trendAddMap.get(p.id) ?? 0;
    const drops = trendDropMap.get(p.id) ?? 0;
    if (adds > 0)  score += Math.log10(adds + 1) * 15;
    if (drops > 0) score -= Math.log10(drops + 1) * 10;

    // ESPN leader bonus
    const leaderData = leaderMap.get(p.name.toLowerCase());
    if (leaderData && leaderData.value > 0) {
      score += Math.min(leaderData.value * 0.1, 50);
    }

    // Snap share bonus
    const snap = snapMap.get(p.name.toLowerCase());
    if (snap && snap > 50) score += (snap - 50) * 0.3;

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

    // Trend direction
    const spread = sorted.length > 1 ? sorted[sorted.length - 1] - sorted[0] : 0;
    const trend: 'up' | 'down' | 'flat' =
      adds > drops * 2 ? 'up' :
      drops > adds * 2 ? 'down' :
      spread <= 5 ? 'up' : spread <= 15 ? 'flat' : 'down';

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
      rank: 0, adp: median.toFixed(1), trend, trendVal: p.sourceCount, tier: 0,
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

// ─── SOURCE DISPATCHER ──────────────────────────────────────

export async function fetchBaseRankings(source: RankingsSource): Promise<RankedPlayer[]> {
  switch (source) {
    case 'sleeper':     return fetchSleeperADP();
    case 'espn':        return fetchESPNADP();
    case 'yahoo':       return fetchYahooADP();
    case 'fantasypros': return fetchBlendedConsensus();
    case 'nfl':         return fetchBlendedConsensus();
    case 'aiomni':      return fetchBlendedConsensus();
    default:            return fetchSleeperADP();
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

export async function getCustomRankings(format: string = 'PPR'): Promise<RankedPlayer[] | null> {
  const val = await AsyncStorage.getItem('my_custom_rankings_' + format);
  if (!val) {
    const legacy = await AsyncStorage.getItem('my_custom_rankings_v7');
    if (legacy) return JSON.parse(legacy);
    return null;
  }
  try { return JSON.parse(val); } catch { return null; }
}

export async function saveCustomRankings(rankings: RankedPlayer[], format: string = 'PPR'): Promise<void> {
  await AsyncStorage.setItem('my_custom_rankings_' + format, JSON.stringify(rankings));
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
  let prospects = await fetchCFBDProspects(year);
  // Fallback to seed if CFBD is down
  if (prospects.length === 0) prospects = [...PROSPECT_SEED_2026];
  const sleeperPlayers = await getSleeperPlayers();

  // Build a set of normalized NFL player names from Sleeper
  const nflNames = new Set<string>();
  for (const p of Object.values(sleeperPlayers)) {
    if (p.active && p.team) {
      const name = (p.full_name || `${p.first_name} ${p.last_name}`).toLowerCase().replace(/[^a-z]/g, '');
      nflNames.add(name);
    }
  }

  // Filter out any prospect whose name matches an active NFL player
  return prospects.filter(p => {
    const normalized = p.name.toLowerCase().replace(/[^a-z]/g, '');
    return !nflNames.has(normalized);
  });
}
