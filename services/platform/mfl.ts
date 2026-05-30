// services/platform/mfl.ts
// MyFantasyLeague implementation of FantasyPlatform.
// MFL uses User-Agent based identification (registered via their site)
// rather than API keys. Read access for public leagues works without auth.
//
// User-Agent: AIOmni 1.0 (registered with MFL Developer Program)

import AsyncStorage from '@react-native-async-storage/async-storage';
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
  PlatformError,
  Player,
  Roster,
  RosterSlot,
  ScoringFormat,
  Standing,
  Transaction,
  WaiverType,
} from './types';

const USER_AGENT = 'AIOmni 1.0';
const STORAGE_LEAGUE    = 'mfl_league_id';        // legacy single-league
const STORAGE_FRANCHISE = 'mfl_franchise_id';     // legacy single-league
const STORAGE_SEASON    = 'mfl_season';
const STORAGE_HOST      = 'mfl_host';             // legacy single-league host
const STORAGE_LEAGUES   = 'mfl_leagues_v2';       // JSON array of {leagueId, franchiseId, host, season}

// ─── short-lived hot cache ────────────────────────────────────────────────
const hot = new Map<string, { data: any; expires: number }>();
const TTL = 60 * 1000;
function hotGet<T>(k: string): T | null {
  const e = hot.get(k);
  if (!e || Date.now() > e.expires) { hot.delete(k); return null; }
  return e.data as T;
}
function hotSet(k: string, d: any, ttl = TTL) {
  hot.set(k, { data: d, expires: Date.now() + ttl });
}

// ─── HTTP ──────────────────────────────────────────────────────────────────
async function mflHost(): Promise<string> {
  return (await AsyncStorage.getItem(STORAGE_HOST)) ?? 'www45.myfantasyleague.com';
}

async function mflSeason(): Promise<string> {
  return (await AsyncStorage.getItem(STORAGE_SEASON)) ?? String(new Date().getFullYear());
}

// MFL routes endpoints by host:
//   - League-specific (league, rosters, freeAgents, leagueStandings, etc.)
//     MUST go to the league's home host (e.g. www45.myfantasyleague.com).
//   - League-independent globals (players, injuries, nflSchedule, …) MUST
//     go to api.myfantasyleague.com — calling them on a www-host returns
//     {"error":"Invalid request. This API request must go to
//     api.myfantasyleague.com"} and the response is unusable.
// We tag globals here so callers don't have to know the rule.
const GLOBAL_TYPES = new Set([
  'players', 'injuries', 'nflSchedule', 'adp', 'topAdds', 'topDrops',
  'topStarters', 'topOwns', 'projectedScores',
]);

async function mflFetch<T>(type: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const host = GLOBAL_TYPES.has(type) ? 'api.myfantasyleague.com' : await mflHost();
  const season = await mflSeason();
  const cleaned: Record<string, string> = { TYPE: type, JSON: '1' };
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') cleaned[k] = String(v);
  }
  const qs = new URLSearchParams(cleaned).toString();
  const url = `https://${host}/${season}/export?${qs}`;

  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new PlatformError(`MFL ${type} failed: ${res.status}`, 'mfl');
  return res.json() as Promise<T>;
}

// ─── credential helpers ───────────────────────────────────────────────────
export type MflLeagueCreds = {
  leagueId:    string;
  franchiseId: string;
  host?:       string;
  season?:     string;
};

/**
 * Read every MFL league the user has connected. Migrates the legacy
 * single-league storage into the v2 array on first read.
 */
async function getAllCreds(): Promise<MflLeagueCreds[]> {
  const raw = await AsyncStorage.getItem(STORAGE_LEAGUES);
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr.filter((c: any) => c?.leagueId && c?.franchiseId);
    } catch {}
  }
  const [l, f, season, host] = await Promise.all([
    AsyncStorage.getItem(STORAGE_LEAGUE),
    AsyncStorage.getItem(STORAGE_FRANCHISE),
    AsyncStorage.getItem(STORAGE_SEASON),
    AsyncStorage.getItem(STORAGE_HOST),
  ]);
  if (l && f) {
    const arr: MflLeagueCreds[] = [{
      leagueId: l, franchiseId: f,
      host: host ?? undefined, season: season ?? undefined,
    }];
    try { await AsyncStorage.setItem(STORAGE_LEAGUES, JSON.stringify(arr)); } catch {}
    return arr;
  }
  return [];
}

/** Backward-compat — returns the first connected league. */
async function getCreds(): Promise<MflLeagueCreds | null> {
  const all = await getAllCreds();
  return all[0] ?? null;
}

async function getCredsForLeague(leagueId: string): Promise<MflLeagueCreds | null> {
  const all = await getAllCreds();
  return all.find(c => c.leagueId === String(leagueId)) ?? null;
}

/**
 * Persist N leagues at once. Merge by leagueId — existing entries are
 * replaced with the new data, new entries are appended. Legacy single-
 * league keys are also updated to point at the first entry.
 */
export async function setMflLeagues(leagues: MflLeagueCreds[]): Promise<void> {
  if (!leagues || leagues.length === 0) return;
  const existing = await getAllCreds();
  const map = new Map<string, MflLeagueCreds>();
  for (const c of existing) map.set(c.leagueId, c);
  for (const c of leagues)  map.set(c.leagueId, { ...map.get(c.leagueId), ...c });
  const merged = Array.from(map.values());
  await AsyncStorage.setItem(STORAGE_LEAGUES, JSON.stringify(merged));
  // Sync the legacy single-league keys to the first entry.
  const items: [string, string][] = [
    [STORAGE_LEAGUE,    merged[0].leagueId],
    [STORAGE_FRANCHISE, merged[0].franchiseId],
  ];
  if (merged[0].season) items.push([STORAGE_SEASON, merged[0].season]);
  if (merged[0].host)   items.push([STORAGE_HOST,   merged[0].host]);
  await AsyncStorage.multiSet(items);
  hot.clear();
}

/** Legacy single-league setter. */
export async function setMflCredentials(opts: MflLeagueCreds): Promise<void> {
  await setMflLeagues([opts]);
}

export async function clearMflCredentials(): Promise<void> {
  await AsyncStorage.multiRemove([STORAGE_LEAGUE, STORAGE_FRANCHISE, STORAGE_SEASON, STORAGE_HOST, STORAGE_LEAGUES]);
  hot.clear();
}

// ─── player cache ─────────────────────────────────────────────────────────
// MFL has a single huge `/players` export (~10MB). Cache it for 24h.
// _v2 cache key: bumped from `mfl_players_cache` so installs with the
// broken pre-2026-05 cache (which stored {} because the API request was
// being sent to the wrong host) get a fresh fetch on next launch instead
// of waiting out the 24h TTL.
const PLAYERS_CACHE_KEY = 'mfl_players_cache_v2';
const PLAYERS_CACHE_TS  = 'mfl_players_cache_v2_ts';
const PLAYERS_TTL = 24 * 60 * 60 * 1000;

let playersMem: Record<string, any> | null = null;

async function getPlayers(): Promise<Record<string, any>> {
  if (playersMem) return playersMem;

  try {
    const ts = await AsyncStorage.getItem(PLAYERS_CACHE_TS);
    const cached = await AsyncStorage.getItem(PLAYERS_CACHE_KEY);
    if (ts && cached && (Date.now() - parseInt(ts, 10)) < PLAYERS_TTL) {
      playersMem = JSON.parse(cached);
      return playersMem!;
    }
  } catch {}

  const data = await mflFetch<any>('players', { DETAILS: '1' });
  const players: any[] = data?.players?.player ?? [];
  const map: Record<string, any> = {};
  for (const p of players) {
    if (p?.id) map[p.id] = p;
  }
  playersMem = map;

  try {
    await AsyncStorage.multiSet([
      [PLAYERS_CACHE_KEY, JSON.stringify(map)],
      [PLAYERS_CACHE_TS, String(Date.now())],
    ]);
  } catch {}

  return map;
}

// Top-up the in-memory + persisted players map with specific IDs that the
// snapshot is missing. MFL adds new player IDs (2026 rookies, late signings)
// after our 24h cached snapshot was taken, so any roster/FA list that
// references them resolves to "Player {id}" with no name. Call this with
// the IDs you're about to render so they get filled in just-in-time.
async function ensurePlayersResolved(
  ids: string[],
  players: Record<string, any>,
): Promise<Record<string, any>> {
  const missing = Array.from(new Set(ids.filter(id => id && !players[id])));
  if (missing.length === 0) return players;

  // MFL accepts a comma-separated PLAYERS list; chunk to be safe.
  const CHUNK = 80;
  for (let i = 0; i < missing.length; i += CHUNK) {
    const csv = missing.slice(i, i + CHUNK).join(',');
    try {
      const data = await mflFetch<any>('players', { PLAYERS: csv, DETAILS: '1' });
      const raw = data?.players?.player ?? [];
      const list = Array.isArray(raw) ? raw : [raw];
      for (const p of list) {
        if (p?.id) players[p.id] = p;
      }
    } catch (e) {
      console.log('MFL ensurePlayersResolved chunk failed:', e);
    }
  }

  playersMem = players;
  try {
    await AsyncStorage.setItem(PLAYERS_CACHE_KEY, JSON.stringify(players));
  } catch {}
  return players;
}

// ─── mapping helpers ──────────────────────────────────────────────────────
function mapMflPlayer(playerId: string, players: Record<string, any>): Player {
  const raw = players[playerId];
  if (!raw) {
    return {
      id: playerId, platformId: 'mfl', name: `Player ${playerId}`,
      firstName: '', lastName: '', position: '', team: '',
    };
  }
  const fullName = raw.name ?? '';
  // MFL stores "Last, First" — split it
  const [last, first] = fullName.includes(',') ? fullName.split(',').map((s: string) => s.trim()) : ['', fullName];
  return {
    id:         playerId,
    platformId: 'mfl',
    name:       first ? `${first} ${last}` : fullName,
    firstName:  first,
    lastName:   last,
    position:   raw.position ?? '',
    team:       raw.team ?? '',
    yearsExp:   raw.draft_year ? (new Date().getFullYear() - parseInt(raw.draft_year, 10)) : undefined,
  };
}

function inferScoringFormat(_settings: any): ScoringFormat {
  // MFL doesn't expose a single PPR/Half/Std flag. Default to PPR.
  // Refinement: scan scoring rules for 'PtsPerRec' coefficient.
  return 'ppr';
}

function isMflDynasty(settings: any): boolean {
  // Dynasty leagues typically have taxi squad enabled OR salaries OR contracts.
  const hasTaxi = !!(settings?.taxiSquad && settings.taxiSquad !== '0' && settings.taxiSquad !== '');
  const hasSalaries = !!(settings?.usesSalaries && settings.usesSalaries !== '0');
  const hasContracts = !!(settings?.usesContractYear && settings.usesContractYear !== '0');
  return hasTaxi || hasSalaries || hasContracts;
}

function isMflSuperFlex(starters: any): boolean {
  const positions: any[] = Array.isArray(starters?.position) ? starters.position : [starters?.position].filter(Boolean);
  for (const p of positions) {
    const name = String(p?.name ?? '').toUpperCase();
    if (name.includes('QB/RB/WR/TE') || name.includes('SUPERFLEX') || name === 'SF') return true;
  }
  return false;
}

function expandRosterSlots(starters: any): string[] {
  const out: string[] = [];
  const positions: any[] = Array.isArray(starters?.position) ? starters.position : [starters?.position].filter(Boolean);
  for (const p of positions) {
    const limit = parseInt(p?.limit ?? '0', 10);
    const name = String(p?.name ?? '');
    for (let i = 0; i < limit; i++) out.push(name);
  }
  return out;
}

// ─── platform implementation ──────────────────────────────────────────────
export const mflPlatform: FantasyPlatform = {
  platformId: 'mfl',

  async isAuthenticated(): Promise<boolean> {
    return (await getCreds()) !== null;
  },

  async getConnectionStatus(): Promise<ConnectionStatus> {
    return (await getCreds()) ? 'connected' : 'never_connected';
  },

  async getMyUserId(): Promise<string | null> {
    const c = await getCreds();
    return c?.franchiseId ?? null;
  },

  async getLeagues(): Promise<League[]> {
    const allCreds = await getAllCreds();
    if (allCreds.length === 0) return [];

    const cached = hotGet<League[]>('leagues');
    if (cached) return cached;

    const season = await mflSeason();
    const results = await Promise.all(allCreds.map(async (creds) => {
      try {
        const data = await mflFetch<any>('league', { L: creds.leagueId });
        const league = data?.league;
        if (!league) return null;
        const ret: League = {
          id:            String(league.id ?? creds.leagueId),
          platformId:    'mfl',
          name:          league.name ?? 'MFL League',
          season,
          teamCount:     parseInt(league.franchises?.count ?? '12', 10),
          scoringFormat: inferScoringFormat(league),
          leagueType:    isMflDynasty(league) ? 'dynasty' : 'redraft',
          currentWeek:   undefined,
        };
        return ret;
      } catch (e) {
        console.log('MFL getLeagues entry error:', creds.leagueId, (e as any)?.message);
        return null;
      }
    }));

    const valid = results.filter((r): r is League => r !== null);
    hotSet('leagues', valid, 5 * 60 * 1000);
    return valid;
  },

  async getLeague(leagueId: string): Promise<LeagueDetail> {
    const data = await mflFetch<any>('league', { L: leagueId });
    const league = data?.league;
    if (!league) throw new PlatformError('League not found', 'mfl');

    const starters = league.starters ?? {};
    const rosterSlots = expandRosterSlots(starters);
    const isDynasty = isMflDynasty(league);

    return {
      id:            String(league.id ?? leagueId),
      platformId:    'mfl',
      name:          league.name ?? 'MFL League',
      season:        await mflSeason(),
      teamCount:     parseInt(league.franchises?.count ?? '12', 10),
      scoringFormat: inferScoringFormat(league),
      leagueType:    isDynasty ? 'dynasty' : 'redraft',
      currentWeek:   undefined,
      rosterSlots,
      waiverType:    'rolling' as WaiverType,
      isDynasty,
      isSuperFlex:   isMflSuperFlex(starters),
      hasSalaries:   !!(league.usesSalaries && league.usesSalaries !== '0'),
      hasContracts:  !!(league.usesContractYear && league.usesContractYear !== '0'),
      hasTaxiSquad:  !!(league.taxiSquad && league.taxiSquad !== '0' && league.taxiSquad !== ''),
      scoringSettings: {},
    };
  },

  async getMyRoster(leagueId: string): Promise<Roster | null> {
    const creds = await getCredsForLeague(leagueId);
    if (!creds) return null;
    const all = await this.getAllRosters(leagueId);
    return all.find(r => r.rosterId === creds.franchiseId) ?? null;
  },

  async getAllRosters(leagueId: string): Promise<Roster[]> {
    const cacheKey = `rosters:${leagueId}`;
    const cached = hotGet<Roster[]>(cacheKey);
    if (cached) return cached;

    const [rostersData, leagueData, playersBase, standingsData] = await Promise.all([
      mflFetch<any>('rosters', { L: leagueId }),
      mflFetch<any>('league',  { L: leagueId }),
      getPlayers(),
      mflFetch<any>('leagueStandings', { L: leagueId }).catch(() => null),
    ]);

    // Collect every player ID across every roster so we can top-up the
    // players cache once (rather than letting each missing ID fall back
    // to "Player {id}").
    const allRosterPlayerIds: string[] = [];
    const fRostersForIds: any[] = Array.isArray(rostersData?.rosters?.franchise)
      ? rostersData.rosters.franchise
      : [rostersData?.rosters?.franchise].filter(Boolean);
    for (const fr of fRostersForIds) {
      const pList: any[] = Array.isArray(fr?.player) ? fr.player : [fr?.player].filter(Boolean);
      for (const p of pList) if (p?.id) allRosterPlayerIds.push(String(p.id));
    }
    const players = await ensurePlayersResolved(allRosterPlayerIds, playersBase);

    const franchiseList: any[] = leagueData?.league?.franchises?.franchise ?? [];
    const franchiseById = Object.fromEntries(franchiseList.map((f: any) => [f.id, f]));

    const standingsByFranchise: Record<string, any> = {};
    const stRows = standingsData?.leagueStandings?.franchise ?? [];
    for (const r of (Array.isArray(stRows) ? stRows : [stRows])) {
      if (r?.id) standingsByFranchise[r.id] = r;
    }

    const creds = await getCredsForLeague(leagueId);
    const rosters: Roster[] = [];

    const fRosters: any[] = Array.isArray(rostersData?.rosters?.franchise)
      ? rostersData.rosters.franchise
      : [rostersData?.rosters?.franchise].filter(Boolean);

    for (const fr of fRosters) {
      const fid = fr?.id;
      if (!fid) continue;
      const meta = franchiseById[fid] ?? {};
      const standing = standingsByFranchise[fid] ?? {};

      const starters: RosterSlot[] = [];
      const bench: RosterSlot[] = [];
      const ir: RosterSlot[] = [];
      const taxi: RosterSlot[] = [];

      const pList: any[] = Array.isArray(fr?.player) ? fr.player : [fr?.player].filter(Boolean);
      for (const p of pList) {
        if (!p?.id) continue;
        const slot: RosterSlot = {
          player:    mapMflPlayer(p.id, players),
          slot:      String(p.status ?? 'BENCH').toUpperCase(),
          isStarter: p.status === 'STARTER',
          salary:    p.salary ? parseFloat(p.salary) : undefined,
          contractYear:  p.contractYear ? parseInt(p.contractYear, 10) : undefined,
          contractInfo:  p.contractInfo ?? undefined,
        };
        const status = String(p.status ?? '').toUpperCase();
        if (status.includes('IR') || status.includes('INJURED_RESERVE')) ir.push(slot);
        else if (status.includes('TAXI')) taxi.push(slot);
        else if (slot.isStarter) starters.push(slot);
        else bench.push(slot);
      }

      const teamName =
        (meta.name && String(meta.name).trim()) ||
        (meta.owner_name && String(meta.owner_name).trim()) ||
        `Team ${fid}`;
      rosters.push({
        userId:   String(fid),
        rosterId: String(fid),
        teamName,
        record: {
          wins:   parseInt(standing.h2hw ?? '0', 10),
          losses: parseInt(standing.h2hl ?? '0', 10),
          ties:   parseInt(standing.h2ht ?? '0', 10),
        },
        pointsFor:     parseFloat(standing.pf ?? '0'),
        pointsAgainst: parseFloat(standing.pa ?? '0'),
        starters, bench, ir,
        isMe: creds?.franchiseId === String(fid),
      });
    }

    hotSet(cacheKey, rosters);
    return rosters;
  },

  async getAvailablePlayers(leagueId: string, opts: { limit?: number } = {}): Promise<AvailablePlayer[]> {
    // MFL's /freeAgents returns the league's full FA pool in one call —
    // 500–2000 entries depending on roster size. We used to slice to
    // limit=100 here, which silently capped the UI's per-position filter
    // to "first 100 entries alphabetically" (waivers only showed A's
    // through B's because the slice ran out before reaching C). The UI
    // does its own position + sort filter, so just return the full pool
    // and let it pick. Cap at 800 as a safety ceiling.
    const ceiling = Math.max(opts.limit ?? 800, 800);
    const cacheKey = `available:${leagueId}:full`;
    const cached = hotGet<AvailablePlayer[]>(cacheKey);
    if (cached) return cached;

    const [data, playersBase] = await Promise.all([
      mflFetch<any>('freeAgents', { L: leagueId }),
      getPlayers(),
    ]);

    const list: any[] = data?.freeAgents?.leagueUnit?.player ?? [];
    const slice = list.slice(0, ceiling);
    const players = await ensurePlayersResolved(slice.map((p: any) => p?.id), playersBase);
    const out: AvailablePlayer[] = slice.map((p: any) => {
      const base = mapMflPlayer(p.id, players);
      return {
        ...base,
        heatSignals: {},
      } as AvailablePlayer;
    });

    hotSet(cacheKey, out);
    return out;
  },

  async getHeatSignals(_leagueId: string, _playerId: string): Promise<HeatSignals> {
    // MFL does not expose per-player trending data via public API.
    return {};
  },

  async searchPlayers(query: string, opts: { limit?: number } = {}): Promise<Player[]> {
    const limit = opts.limit ?? 20;
    const players = await getPlayers();
    const q = query.toLowerCase();
    const matches: Player[] = [];
    for (const id of Object.keys(players)) {
      const p = mapMflPlayer(id, players);
      if (p.name.toLowerCase().includes(q)) {
        matches.push(p);
        if (matches.length >= limit) break;
      }
    }
    return matches;
  },

  async getStandings(leagueId: string): Promise<Standing[]> {
    // Pull league metadata alongside standings so we can fall back to
    // owner_name when the franchise name is empty/missing (common in
    // freshly-created MFL leagues — e.g. "AIOmni Launch" had every team
    // showing as the literal "Franchise 0001").
    const [data, leagueData] = await Promise.all([
      mflFetch<any>('leagueStandings', { L: leagueId }),
      mflFetch<any>('league',          { L: leagueId }).catch(() => null),
    ]);
    const rows = data?.leagueStandings?.franchise ?? [];
    const list = Array.isArray(rows) ? rows : [rows];
    const creds = await getCredsForLeague(leagueId);

    const franchiseMeta: Record<string, any> = {};
    const fList: any[] = leagueData?.league?.franchises?.franchise ?? [];
    for (const f of (Array.isArray(fList) ? fList : [fList])) {
      if (f?.id) franchiseMeta[f.id] = f;
    }

    return list
      .map((r: any, idx: number) => {
        const meta = franchiseMeta[r.id] ?? {};
        const name = (r.name && String(r.name).trim()) ||
                     (meta.name && String(meta.name).trim()) ||
                     (meta.owner_name && String(meta.owner_name).trim()) ||
                     `Team ${r.id}`;
        return {
        rosterId:  String(r.id),
        teamName:  name,
        rank:      idx + 1,
        record: {
          wins:   parseInt(r.h2hw ?? '0', 10),
          losses: parseInt(r.h2hl ?? '0', 10),
          ties:   parseInt(r.h2ht ?? '0', 10),
        },
        pointsFor:     parseFloat(r.pf ?? '0'),
        pointsAgainst: parseFloat(r.pa ?? '0'),
        isMe:          creds?.franchiseId === String(r.id),
        };
      })
      .sort((a, b) => b.pointsFor - a.pointsFor)
      .map((s, i) => ({ ...s, rank: i + 1 }));
  },

  async getMatchups(leagueId: string, week?: number): Promise<Matchup[]> {
    const params: any = { L: leagueId };
    if (week) params.W = week;
    const data = await mflFetch<any>('liveScoring', params);
    const matchups = data?.liveScoring?.matchup ?? [];
    const list = Array.isArray(matchups) ? matchups : [matchups];
    const creds = await getCredsForLeague(leagueId);
    const w = week ?? parseInt(data?.liveScoring?.week ?? '1', 10);

    const out: Matchup[] = [];
    for (const m of list) {
      const franchises: any[] = Array.isArray(m?.franchise) ? m.franchise : [m?.franchise].filter(Boolean);
      if (franchises.length < 2) continue;
      const [a, b] = franchises;
      out.push({
        week: w,
        matchupId: `${a.id}-${b.id}`,
        home: {
          rosterId: String(a.id),
          teamName: '',
          points:   parseFloat(a.score ?? '0'),
          isMe:     creds?.franchiseId === String(a.id),
        },
        away: {
          rosterId: String(b.id),
          teamName: '',
          points:   parseFloat(b.score ?? '0'),
          isMe:     creds?.franchiseId === String(b.id),
        },
      });
    }
    return out;
  },

  async getDraft(leagueId: string): Promise<DraftInfo | null> {
    // Round-only pick ownership for dynasty/keeper. MFL's tradedPicks
    // endpoint lists picks by season/round/originalPickFor/franchise.id;
    // crossing that with the user's franchise tells us what they own
    // after trades. Slots are NOT derived — MFL leagues don't enforce
    // franchise_id → draft_slot symmetry, so we ship round-only entries
    // and let the Coach format them as "R1, R3" rather than guess "1.08".
    try {
      const myFid = await this.getMyUserId();
      if (!myFid) return null;
      const [tradedRes, leagueRes] = await Promise.all([
        mflFetch<any>('tradedPicks', { L: leagueId }).catch(() => null),
        mflFetch<any>('league',      { L: leagueId }).catch(() => null),
      ]);
      if (!leagueRes) return null;

      // MFL JSON-encoded XML: nested .tradedPicks may be missing if no
      // trades happened, and .tradedPick can be either array or single object.
      const tradedRaw = tradedRes?.tradedPicks?.tradedPick;
      const tradedList: any[] = Array.isArray(tradedRaw)
        ? tradedRaw : tradedRaw ? [tradedRaw] : [];

      // MFL exposes draft round count on rookieDraftPicks or draftRounds
      // depending on league setup. Default to 5 for unknown configs.
      const rounds = parseInt(
        leagueRes?.league?.rookieDraftPicks?.round?.length
          ?? leagueRes?.league?.draftRounds
          ?? '5',
        10
      ) || 5;
      const franchises: any[] = leagueRes?.league?.franchises?.franchise ?? [];
      const franchiseCount = Array.isArray(franchises) ? franchises.length : 12;
      const currentYear = String(new Date().getFullYear());

      const owned: NonNullable<DraftInfo['myOwnedPicks']> = [];
      // Default: I own one pick per round in the current season unless
      // I traded that pick away (originalPickFor === me but franchise.id ≠ me).
      for (let r = 1; r <= rounds; r++) {
        const tradedAway = tradedList.find((p: any) =>
          String(p.season ?? currentYear) === currentYear &&
          parseInt(p.round, 10) === r &&
          String(p.originalPickFor ?? '') === String(myFid) &&
          String(p.franchise?.id ?? '') !== String(myFid) &&
          String(p.franchise?.id ?? '') !== ''
        );
        if (!tradedAway) owned.push({ round: r });
      }
      // Incoming: I own picks originally belonging to someone else.
      for (const p of tradedList) {
        const owner    = String(p.franchise?.id ?? '');
        const original = String(p.originalPickFor ?? '');
        if (
          String(p.season ?? currentYear) === currentYear &&
          owner === String(myFid) && original && original !== String(myFid)
        ) {
          owned.push({ round: parseInt(p.round, 10), viaTeamName: `franchise ${original}` });
        }
      }

      return {
        id:         leagueId,
        platformId: 'mfl',
        leagueId,
        type:       'snake',
        status:     'pre_draft',
        rounds,
        teamCount:  franchiseCount,
        myOwnedPicks: owned,
      };
    } catch { return null; }
  },

  async getDraftPicks(_draftId: string): Promise<DraftPick[]> {
    return [];
  },

  async getTransactions(leagueId: string, limit = 30): Promise<Transaction[]> {
    const data = await mflFetch<any>('transactions', { L: leagueId });
    const list: any[] = data?.transactions?.transaction ?? [];
    const players = await getPlayers();
    const out: Transaction[] = [];

    for (const t of list.slice(0, limit)) {
      const ts = parseInt(t?.timestamp ?? '0', 10);
      const transactionType = String(t?.type ?? 'add').toLowerCase();
      const adds: any[] = [];
      const drops: any[] = [];

      // MFL packs the player IDs into a comma-separated string in `transaction`
      // with prefixes/suffixes that vary by type. We parse permissively.
      const raw = String(t?.transaction ?? '');
      const tokens = raw.split(',').filter(Boolean);
      for (const tok of tokens) {
        const cleaned = tok.replace(/[^0-9]/g, '');
        if (!cleaned) continue;
        adds.push({ player: mapMflPlayer(cleaned, players), toRosterId: String(t.franchise ?? '') });
      }

      out.push({
        id:        String(`${ts}-${t?.franchise ?? 'x'}`),
        type:      (transactionType.includes('drop') ? 'drop'
                  : transactionType.includes('trade') ? 'trade'
                  : transactionType.includes('waiver') ? 'waiver'
                  : 'add') as any,
        timestamp: ts,
        adds, drops,
        status:    'complete',
      });
    }
    return out;
  },
};
