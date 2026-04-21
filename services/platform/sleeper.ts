// services/platform/sleeper.ts
// Sleeper implementation of FantasyPlatform.
// All Sleeper API calls live here. No other file in the app should import
// from api.sleeper.app.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getActiveSleeperIds } from '../nflPlayers';
import {
  AvailablePlayer,
  ConnectionStatus,
  DraftInfo,
  DraftPick,
  DraftStatus,
  DraftType,
  FantasyPlatform,
  HeatSignals,
  League,
  LeagueDetail,
  LeagueType,
  Matchup,
  MatchupSide,
  PlatformAuthError,
  PlatformError,
  Player,
  Roster,
  RosterSlot,
  ScoringFormat,
  Standing,
  Transaction,
  WaiverType,
} from './types';

const SLEEPER_BASE = 'https://api.sleeper.app/v1';
const SLEEPER_CDN = 'https://sleepercdn.com';

// ─── CACHES ─────────────────────────────────────────────────

const PLAYERS_CACHE_KEY = 'sleeper_players_cache';
const PLAYERS_CACHE_TS_KEY = 'sleeper_players_cache_ts';
const PLAYERS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

let playersMemCache: Record<string, SleeperPlayerRaw> | null = null;

// Short-lived hot cache for leagues/rosters/matchups/trending
const hotCache = new Map<string, { data: any; expires: number }>();
const HOT_TTL = 60 * 1000;

function hotGet<T>(key: string): T | null {
  const entry = hotCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    hotCache.delete(key);
    return null;
  }
  return entry.data as T;
}

function hotSet(key: string, data: any, ttl = HOT_TTL): void {
  hotCache.set(key, { data, expires: Date.now() + ttl });
}

export function invalidateSleeperCache(leagueId?: string): void {
  if (leagueId) {
    for (const key of hotCache.keys()) {
      if (key.includes(leagueId)) hotCache.delete(key);
    }
  } else {
    hotCache.clear();
  }
}

// ─── RAW SLEEPER TYPES (internal) ───────────────────────────

interface SleeperPlayerRaw {
  player_id: string;
  first_name: string;
  last_name: string;
  full_name?: string;
  position: string;
  team: string | null;
  active: boolean;
  age?: number;
  years_exp?: number;
  injury_status?: string | null;
  search_rank?: number;
  fantasy_positions?: string[];
}

interface SleeperLeagueRaw {
  league_id: string;
  name: string;
  season: string;
  total_rosters: number;
  status: string;
  settings: {
    type?: number;          // 0=redraft, 1=keeper, 2=dynasty
    waiver_type?: number;   // 0=rolling, 1=reverse, 2=FAAB
    waiver_budget?: number;
    leg?: number;
    [key: string]: any;
  };
  scoring_settings: Record<string, number>;
  roster_positions: string[];
  previous_league_id: string | null;
  avatar: string | null;
}

interface SleeperRosterRaw {
  roster_id: number;
  owner_id: string;
  players: string[] | null;
  starters: string[] | null;
  reserve: string[] | null;
  taxi: string[] | null;
  settings: {
    wins: number;
    losses: number;
    ties: number;
    fpts: number;
    fpts_decimal?: number;
    fpts_against?: number;
    fpts_against_decimal?: number;
    waiver_budget_used?: number;
    [key: string]: any;
  };
}

// ─── HELPERS ────────────────────────────────────────────────

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new PlatformError(`Sleeper API ${res.status}: ${url}`, 'sleeper');
  }
  return res.json() as Promise<T>;
}

async function getPlayersDB(): Promise<Record<string, SleeperPlayerRaw>> {
  if (playersMemCache) return playersMemCache;

  try {
    const cached = await AsyncStorage.getItem(PLAYERS_CACHE_KEY);
    const ts = await AsyncStorage.getItem(PLAYERS_CACHE_TS_KEY);
    const age = ts ? Date.now() - parseInt(ts, 10) : Infinity;

    if (cached && age < PLAYERS_CACHE_TTL) {
      playersMemCache = JSON.parse(cached);
      return playersMemCache!;
    }
  } catch {
    // Fall through to network
  }

  const data = await fetchJson<Record<string, SleeperPlayerRaw>>(`${SLEEPER_BASE}/players/nfl`);
  await AsyncStorage.setItem(PLAYERS_CACHE_KEY, JSON.stringify(data));
  await AsyncStorage.setItem(PLAYERS_CACHE_TS_KEY, String(Date.now()));
  playersMemCache = data;
  return data;
}

/** Load the latest trending adds/drops snapshot (cached 5min) */
async function getTrendingMaps(): Promise<{
  adds: Map<string, number>;
  drops: Map<string, number>;
}> {
  const cacheKey = 'sleeper:trending';
  const cached = hotGet<{ adds: Map<string, number>; drops: Map<string, number> }>(cacheKey);
  if (cached) return cached;

  const [addsRaw, dropsRaw] = await Promise.all([
    fetchJson<{ player_id: string; count: number }[]>(
      `${SLEEPER_BASE}/players/nfl/trending/add?lookback_hours=48&limit=200`
    ).catch(() => [] as { player_id: string; count: number }[]),
    fetchJson<{ player_id: string; count: number }[]>(
      `${SLEEPER_BASE}/players/nfl/trending/drop?lookback_hours=48&limit=200`
    ).catch(() => [] as { player_id: string; count: number }[]),
  ]);

  const adds = new Map<string, number>();
  const drops = new Map<string, number>();
  for (const t of addsRaw) adds.set(t.player_id, t.count);
  for (const t of dropsRaw) drops.set(t.player_id, t.count);

  const result = { adds, drops };
  hotSet(cacheKey, result, 5 * 60 * 1000);
  return result;
}

function normalizePlayer(raw: SleeperPlayerRaw | undefined, id: string): Player {
  if (!raw) {
    return {
      id,
      platformId: 'sleeper',
      name: id,
      firstName: '',
      lastName: id,
      position: '?',
      team: 'FA',
    };
  }
  return {
    id,
    platformId: 'sleeper',
    name: raw.full_name || `${raw.first_name} ${raw.last_name}`.trim(),
    firstName: raw.first_name || '',
    lastName: raw.last_name || '',
    position: raw.position || '?',
    team: raw.team || 'FA',
    age: raw.age,
    yearsExp: raw.years_exp,
    injuryStatus: raw.injury_status || null,
    photoUrl: `${SLEEPER_CDN}/content/nfl/players/thumb/${id}.jpg`,
  };
}

function mapScoringFormat(scoringSettings: Record<string, number>): ScoringFormat {
  const rec = scoringSettings.rec ?? 0;
  if (rec >= 1) return 'ppr';
  if (rec >= 0.5) return 'half';
  return 'standard';
}

function mapLeagueType(raw: SleeperLeagueRaw): LeagueType {
  const t = raw.settings?.type;
  if (t === 2) return 'dynasty';
  if (t === 1) return 'keeper';
  if (raw.previous_league_id) return 'dynasty';
  return 'redraft';
}

function mapWaiverType(raw: SleeperLeagueRaw): WaiverType {
  const w = raw.settings?.waiver_type;
  if (w === 2) return 'faab';
  if (w === 1) return 'reverse_standings';
  if (w === 0) return 'rolling';
  return 'unknown';
}

function mapDraftType(type: string): DraftType {
  if (type === 'snake') return 'snake';
  if (type === 'linear') return 'linear';
  if (type === 'auction') return 'auction';
  return 'snake';
}

function mapDraftStatus(status: string): DraftStatus {
  if (status === 'drafting') return 'drafting';
  if (status === 'complete') return 'complete';
  return 'pre_draft';
}

function avatarUrl(avatarId: string | null): string | undefined {
  return avatarId ? `${SLEEPER_CDN}/avatars/thumbs/${avatarId}` : undefined;
}

// ─── IMPLEMENTATION ─────────────────────────────────────────

class SleeperPlatform implements FantasyPlatform {
  readonly platformId = 'sleeper' as const;

  async isAuthenticated(): Promise<boolean> {
    const status = await this.getConnectionStatus();
    return status === 'connected';
  }

  async getConnectionStatus(): Promise<ConnectionStatus> {
    const username = await AsyncStorage.getItem('sleeper_username');
    if (!username) return 'never_connected';

    // Sleeper doesn't have session expiry — username either resolves or doesn't.
    // We validate by confirming the username still exists.
    try {
      const user = await fetchJson<{ user_id: string }>(`${SLEEPER_BASE}/user/${username}`);
      return user?.user_id ? 'connected' : 'expired';
    } catch {
      return 'expired';
    }
  }

  async getMyUserId(): Promise<string | null> {
    const username = await AsyncStorage.getItem('sleeper_username');
    if (!username) return null;

    const cacheKey = `sleeper:user:${username}`;
    const cached = hotGet<{ user_id: string }>(cacheKey);
    if (cached) return cached.user_id;

    try {
      const user = await fetchJson<{ user_id: string }>(`${SLEEPER_BASE}/user/${username}`);
      hotSet(cacheKey, user, 10 * 60 * 1000);
      return user.user_id;
    } catch {
      return null;
    }
  }

  async getLeagues(season = '2025'): Promise<League[]> {
    const userId = await this.getMyUserId();
    if (!userId) throw new PlatformAuthError('sleeper');

    const cacheKey = `sleeper:leagues:${userId}:${season}`;
    const cached = hotGet<League[]>(cacheKey);
    if (cached) return cached;

    const raw = await fetchJson<SleeperLeagueRaw[]>(
      `${SLEEPER_BASE}/user/${userId}/leagues/nfl/${season}`
    );

    const leagues: League[] = (raw || []).map(lg => ({
      id: lg.league_id,
      platformId: 'sleeper',
      name: lg.name,
      season: lg.season,
      teamCount: lg.total_rosters,
      scoringFormat: mapScoringFormat(lg.scoring_settings || {}),
      leagueType: mapLeagueType(lg),
      currentWeek: lg.settings?.leg,
      avatarUrl: avatarUrl(lg.avatar),
    }));

    hotSet(cacheKey, leagues);
    return leagues;
  }

  async getLeague(leagueId: string): Promise<LeagueDetail> {
    const cacheKey = `sleeper:league:${leagueId}`;
    const cached = hotGet<LeagueDetail>(cacheKey);
    if (cached) return cached;

    const raw = await fetchJson<SleeperLeagueRaw>(`${SLEEPER_BASE}/league/${leagueId}`);
    if (!raw) throw new PlatformError(`League ${leagueId} not found`, 'sleeper');

    const waiverType = mapWaiverType(raw);
    const faabBudget = waiverType === 'faab' ? (raw.settings?.waiver_budget ?? 100) : undefined;
    let faabRemaining: number | undefined;

    if (faabBudget !== undefined) {
      const userId = await this.getMyUserId();
      if (userId) {
        try {
          const rosters = await fetchJson<SleeperRosterRaw[]>(
            `${SLEEPER_BASE}/league/${leagueId}/rosters`
          );
          const mine = rosters.find(r => r.owner_id === userId);
          if (mine?.settings?.waiver_budget_used !== undefined) {
            faabRemaining = faabBudget - mine.settings.waiver_budget_used;
          } else {
            faabRemaining = faabBudget;
          }
        } catch {
          faabRemaining = faabBudget;
        }
      }
    }

    const detail: LeagueDetail = {
      id: raw.league_id,
      platformId: 'sleeper',
      name: raw.name,
      season: raw.season,
      teamCount: raw.total_rosters,
      scoringFormat: mapScoringFormat(raw.scoring_settings || {}),
      leagueType: mapLeagueType(raw),
      currentWeek: raw.settings?.leg,
      avatarUrl: avatarUrl(raw.avatar),
      rosterSlots: raw.roster_positions || [],
      waiverType,
      faabBudget,
      faabRemaining,
      scoringSettings: raw.scoring_settings,
      isDynasty: mapLeagueType(raw) === 'dynasty',
    };

    hotSet(cacheKey, detail);
    return detail;
  }

  async getMyRoster(leagueId: string): Promise<Roster | null> {
    const userId = await this.getMyUserId();
    if (!userId) throw new PlatformAuthError('sleeper');

    const all = await this.getAllRosters(leagueId);
    return all.find(r => r.userId === userId) || null;
  }

  async getAllRosters(leagueId: string): Promise<Roster[]> {
    const cacheKey = `sleeper:rosters:${leagueId}`;
    const cached = hotGet<Roster[]>(cacheKey);
    if (cached) return cached;

    const [rostersRaw, users, playersDB, myUserId, league] = await Promise.all([
      fetchJson<SleeperRosterRaw[]>(`${SLEEPER_BASE}/league/${leagueId}/rosters`),
      fetchJson<any[]>(`${SLEEPER_BASE}/league/${leagueId}/users`),
      getPlayersDB(),
      this.getMyUserId(),
      this.getLeague(leagueId),
    ]);

    const userMap: Record<string, { name: string; avatar: string | null }> = {};
    for (const u of users || []) {
      userMap[u.user_id] = {
        name: u.display_name || u.metadata?.team_name || `Team ${u.user_id}`,
        avatar: u.avatar || null,
      };
    }

    const rosterSlots = league.rosterSlots;

    const rosters: Roster[] = (rostersRaw || []).map(r => {
      const starterIds = r.starters || [];
      const allIds = r.players || [];
      const reserveIds = r.reserve || [];
      const benchIds = allIds.filter(id => !starterIds.includes(id) && !reserveIds.includes(id));

      const toSlot = (id: string, slotName: string, isStarter: boolean): RosterSlot => ({
        player: normalizePlayer(playersDB[id], id),
        slot: slotName,
        isStarter,
      });

      const nonBenchSlots = rosterSlots.filter(s => s !== 'BN' && s !== 'IR');
      const starters: RosterSlot[] = starterIds
        .filter(id => id && id !== '0')
        .map((id, i) => toSlot(id, nonBenchSlots[i] || 'FLEX', true));

      const bench: RosterSlot[] = benchIds
        .filter(id => id && id !== '0')
        .map(id => toSlot(id, 'BN', false));

      const ir: RosterSlot[] = reserveIds
        .filter(id => id && id !== '0')
        .map(id => toSlot(id, 'IR', false));

      const fpts = (r.settings?.fpts ?? 0) + (r.settings?.fpts_decimal ?? 0) / 100;
      const fptsAgainst = (r.settings?.fpts_against ?? 0) + (r.settings?.fpts_against_decimal ?? 0) / 100;

      return {
        userId: r.owner_id,
        rosterId: String(r.roster_id),
        teamName: userMap[r.owner_id]?.name || `Team ${r.roster_id}`,
        record: {
          wins: r.settings?.wins ?? 0,
          losses: r.settings?.losses ?? 0,
          ties: r.settings?.ties ?? 0,
        },
        pointsFor: fpts,
        pointsAgainst: fptsAgainst,
        starters,
        bench,
        ir,
        isMe: r.owner_id === myUserId,
      };
    });

    hotSet(cacheKey, rosters);
    return rosters;
  }

  async getAvailablePlayers(
    leagueId: string,
    opts: { limit?: number } = {}
  ): Promise<AvailablePlayer[]> {
    const limit = opts.limit ?? 200;
    const cacheKey = `sleeper:available:${leagueId}:${limit}`;
    const cached = hotGet<AvailablePlayer[]>(cacheKey);
    if (cached) return cached;

    const [rosters, trending, playersDB, league, activeIds] = await Promise.all([
      fetchJson<SleeperRosterRaw[]>(`${SLEEPER_BASE}/league/${leagueId}/rosters`),
      getTrendingMaps(),
      getPlayersDB(),
      this.getLeague(leagueId),
      getActiveSleeperIds().catch(() => new Set<string>()),
    ]);

    const rostered = new Set<string>();
    for (const r of rosters || []) {
      for (const pid of r.players || []) rostered.add(pid);
      for (const pid of r.reserve || []) rostered.add(pid);
      for (const pid of r.taxi || []) rostered.add(pid);
    }

    const isDynasty = league.leagueType === 'dynasty';
    const validPositions = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);

    // Dynasty: accept rookies/prospects (team may be null until NFL assignment).
    // Redraft: require active NFL team.
    const isEligible = (pid: string, p: SleeperPlayerRaw): boolean => {
      if (!p) return false;
      if (!validPositions.has(p.position)) return false;
      if (rostered.has(pid)) return false;

      if (p.position === 'DEF') return true;

      if (isDynasty) {
        if (p.active === false) return false;
        if (p.search_rank && p.search_rank >= 9999999) return false;
        // Must be on canonical active NFL list OR a genuine rookie/prospect.
        // Sleeper's `active` flag is unreliable — retired players like Big Ben
        // still show active=true, so we cross-check against the real NFL roster.
        if (activeIds.size > 0) {
          if (activeIds.has(pid)) return true;
          // Not on active list — only allow if clearly a rookie or prospect
          const isRookie = (p.years_exp === 0 || p.years_exp === undefined || p.years_exp === null)
                        && (p.age === undefined || p.age === null || p.age <= 24);
          return isRookie;
        }
        return true;
      }

      if (activeIds.size > 0) return activeIds.has(pid);
      if (p.active === false) return false;
      if (!p.team) return false;
      return true;
    };

    type Candidate = { id: string; raw: SleeperPlayerRaw; score: number };
    const candidates: Candidate[] = [];

    for (const [pid, p] of Object.entries(playersDB)) {
      if (!isEligible(pid, p)) continue;
      const adds = trending.adds.get(pid) ?? 0;
      // Rookies/prospects have search_rank=null in Sleeper's DB until they're
      // drafted. Give them a waiver-tier default (500) so they compete fairly
      // with veterans instead of being dumped to the bottom.
      const isRookie = (p.years_exp === 0 || p.years_exp === undefined || p.years_exp === null)
                    && (p.search_rank === null || p.search_rank === undefined);
      const searchRank = p.search_rank ?? (isRookie ? 100 : 99999);
      const score = adds * 10 - searchRank;
      candidates.push({ id: pid, raw: p, score });
    }

    // [AIOMNI_DEBUG_v3] BEGIN
    console.log('[AIOMNI_DEBUG_v3] league:', league.name, 'isDynasty:', isDynasty);
    console.log('[AIOMNI_DEBUG_v3] rostered:', rostered.size, 'activeIds:', activeIds.size, 'trending.adds:', trending.adds.size);
    const _rookieCandidates = candidates.filter(c => {
      const p = c.raw;
      return (p.years_exp === 0 || p.years_exp == null) && p.search_rank == null;
    });
    console.log('[AIOMNI_DEBUG_v3] candidates total:', candidates.length, 'rookies in candidates:', _rookieCandidates.length);
    console.log('[AIOMNI_DEBUG_v3] sample rookies:', _rookieCandidates.slice(0, 5).map(c => `${c.raw.full_name} score=${c.score}`).join(' | '));
    // [AIOMNI_DEBUG_v3] END
    candidates.sort((a, b) => b.score - a.score);
    // [AIOMNI_DEBUG_v3] post-sort top 15:
    console.log('[AIOMNI_DEBUG_v3] TOP 15:', candidates.slice(0, 15).map(c => `${c.raw.full_name}(${c.raw.position},sr=${c.raw.search_rank},score=${c.score})`).join(' | '));

    const results: AvailablePlayer[] = candidates.slice(0, limit).map(c => {
      const adds = trending.adds.get(c.id) ?? 0;
      const drops = trending.drops.get(c.id) ?? 0;
      const signals: HeatSignals = {
        addsLast48h: adds,
        dropsLast48h: drops,
      };
      return {
        ...normalizePlayer(c.raw, c.id),
        trendingAdds: adds,
        trendingDrops: drops,
        heatSignals: signals,
      };
    });

    hotSet(cacheKey, results);
    return results;
  }

  async getHeatSignals(_leagueId: string, playerId: string): Promise<HeatSignals> {
    const trending = await getTrendingMaps();
    return {
      addsLast48h: trending.adds.get(playerId) ?? 0,
      dropsLast48h: trending.drops.get(playerId) ?? 0,
    };
  }

  async searchPlayers(query: string, opts: { limit?: number } = {}): Promise<Player[]> {
    const limit = opts.limit ?? 25;
    if (!query || query.trim().length < 2) return [];

    const q = query.toLowerCase().trim();
    const playersDB = await getPlayersDB();

    const matches: { id: string; raw: SleeperPlayerRaw; score: number }[] = [];
    for (const [pid, p] of Object.entries(playersDB)) {
      if (!p.active) continue;
      const name = (p.full_name || `${p.first_name} ${p.last_name}`).toLowerCase();
      const team = (p.team || '').toLowerCase();

      let score = 0;
      if (name.startsWith(q)) score = 100;
      else if (name.includes(q)) score = 50;
      else if (team === q) score = 30;
      else continue;

      // Boost by search_rank (lower = better player)
      score += Math.max(0, 1000 - (p.search_rank ?? 10000)) / 10;
      matches.push({ id: pid, raw: p, score });
    }

    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, limit).map(m => normalizePlayer(m.raw, m.id));
  }

  async getStandings(leagueId: string): Promise<Standing[]> {
    const rosters = await this.getAllRosters(leagueId);

    const sorted = [...rosters].sort((a, b) => {
      if (a.record.wins !== b.record.wins) return b.record.wins - a.record.wins;
      return b.pointsFor - a.pointsFor;
    });

    return sorted.map((r, i) => ({
      rosterId: r.rosterId,
      teamName: r.teamName,
      rank: i + 1,
      record: r.record,
      pointsFor: r.pointsFor,
      pointsAgainst: r.pointsAgainst,
      isMe: r.isMe,
    }));
  }

  async getMatchups(leagueId: string, week?: number): Promise<Matchup[]> {
    const league = await this.getLeague(leagueId);
    const targetWeek = week ?? league.currentWeek ?? 1;

    const cacheKey = `sleeper:matchups:${leagueId}:${targetWeek}`;
    const cached = hotGet<Matchup[]>(cacheKey);
    if (cached) return cached;

    const [matchupsRaw, rosters] = await Promise.all([
      fetchJson<any[]>(`${SLEEPER_BASE}/league/${leagueId}/matchups/${targetWeek}`),
      this.getAllRosters(leagueId),
    ]);

    const rosterById = new Map(rosters.map(r => [r.rosterId, r]));

    const groups = new Map<number, any[]>();
    for (const m of matchupsRaw || []) {
      if (!groups.has(m.matchup_id)) groups.set(m.matchup_id, []);
      groups.get(m.matchup_id)!.push(m);
    }

    const result: Matchup[] = [];
    for (const [matchupId, pair] of groups) {
      if (pair.length !== 2) continue;
      const sides: MatchupSide[] = pair.map(p => {
        const r = rosterById.get(String(p.roster_id));
        return {
          rosterId: String(p.roster_id),
          teamName: r?.teamName || `Team ${p.roster_id}`,
          points: p.points ?? 0,
          projected: undefined,
          isMe: r?.isMe ?? false,
        };
      });
      result.push({
        week: targetWeek,
        matchupId: String(matchupId),
        home: sides[0],
        away: sides[1],
      });
    }

    hotSet(cacheKey, result);
    return result;
  }

  async getDraft(leagueId: string): Promise<DraftInfo | null> {
    const cacheKey = `sleeper:draft:${leagueId}`;
    const cached = hotGet<DraftInfo | null>(cacheKey);
    if (cached !== null) return cached;

    try {
      const drafts = await fetchJson<any[]>(`${SLEEPER_BASE}/league/${leagueId}/drafts`);
      if (!drafts || drafts.length === 0) {
        hotSet(cacheKey, null);
        return null;
      }

      const active = drafts.find(d => d.status === 'drafting')
        || drafts.find(d => d.status === 'pre_draft')
        || drafts.sort((a, b) => b.created - a.created)[0];

      if (!active) {
        hotSet(cacheKey, null);
        return null;
      }

      const userId = await this.getMyUserId();
      let myDraftSlot: number | undefined;
      if (userId && active.draft_order && active.draft_order[userId]) {
        myDraftSlot = active.draft_order[userId];
      }

      const info: DraftInfo = {
        id: active.draft_id,
        platformId: 'sleeper',
        leagueId,
        type: mapDraftType(active.type),
        status: mapDraftStatus(active.status),
        rounds: active.settings?.rounds ?? 15,
        teamCount: active.settings?.teams ?? 12,
        myDraftSlot,
        slotToRosterId: active.slot_to_roster_id,
        pickTimer: active.settings?.pick_timer ?? 0,
        startTime: active.start_time,
      };

      hotSet(cacheKey, info);
      return info;
    } catch {
      return null;
    }
  }

  async getDraftPicks(draftId: string): Promise<DraftPick[]> {
    // NOT cached — polled every 3s during live drafts, must be fresh
    const raw = await fetchJson<any[]>(`${SLEEPER_BASE}/draft/${draftId}/picks`);
    const userId = await this.getMyUserId();

    const draft = await fetchJson<any>(`${SLEEPER_BASE}/draft/${draftId}`);
    let myRosterId: number | undefined;
    if (userId && draft.draft_order && draft.draft_order[userId]) {
      const mySlot = draft.draft_order[userId];
      myRosterId = draft.slot_to_roster_id?.[String(mySlot)];
    }

    return (raw || []).map(p => ({
      pickNo: p.pick_no,
      round: p.round,
      slot: p.draft_slot,
      rosterId: String(p.roster_id),
      playerId: p.player_id,
      playerName: `${p.metadata?.first_name || ''} ${p.metadata?.last_name || ''}`.trim() || p.player_id,
      position: p.metadata?.position || '?',
      team: p.metadata?.team || 'FA',
      isMyPick: p.roster_id === myRosterId,
    }));
  }

  async getTransactions(leagueId: string, limit = 25): Promise<Transaction[]> {
    const league = await this.getLeague(leagueId);
    const week = league.currentWeek ?? 1;

    const weeks = [week, Math.max(1, week - 1), Math.max(1, week - 2)].filter((v, i, arr) => arr.indexOf(v) === i);
    const [playersDB, ...weeklyTxs] = await Promise.all([
      getPlayersDB(),
      ...weeks.map(w =>
        fetchJson<any[]>(`${SLEEPER_BASE}/league/${leagueId}/transactions/${w}`).catch(() => [])
      ),
    ]);

    const all: Transaction[] = [];
    for (const txs of weeklyTxs) {
      for (const tx of txs || []) {
        const type: Transaction['type'] =
          tx.type === 'trade' ? 'trade' :
          tx.type === 'waiver' ? 'waiver' :
          tx.type === 'free_agent' ? 'add' :
          'commish';

        const adds: Transaction['adds'] = [];
        const drops: Transaction['drops'] = [];

        if (tx.adds) {
          for (const [pid, rosterId] of Object.entries(tx.adds)) {
            adds.push({
              player: normalizePlayer(playersDB[pid], pid),
              toRosterId: String(rosterId),
            });
          }
        }
        if (tx.drops) {
          for (const [pid, rosterId] of Object.entries(tx.drops)) {
            drops.push({
              player: normalizePlayer(playersDB[pid], pid),
              fromRosterId: String(rosterId),
            });
          }
        }

        all.push({
          id: String(tx.transaction_id),
          type,
          timestamp: tx.status_updated || tx.created || 0,
          adds,
          drops,
          faabBid: tx.settings?.waiver_bid,
          status: tx.status === 'complete' ? 'complete' : tx.status === 'failed' ? 'failed' : 'pending',
        });
      }
    }

    return all.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
  }
}

export const sleeperPlatform = new SleeperPlatform();
