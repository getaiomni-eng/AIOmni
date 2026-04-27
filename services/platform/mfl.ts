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
const STORAGE_LEAGUE = 'mfl_league_id';
const STORAGE_FRANCHISE = 'mfl_franchise_id';
const STORAGE_SEASON = 'mfl_season';
const STORAGE_HOST = 'mfl_host';   // e.g. 'www45.myfantasyleague.com' — found from initial league lookup

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

async function mflFetch<T>(type: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const host = await mflHost();
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
async function getCreds(): Promise<{ leagueId: string; franchiseId: string } | null> {
  const [l, f] = await Promise.all([
    AsyncStorage.getItem(STORAGE_LEAGUE),
    AsyncStorage.getItem(STORAGE_FRANCHISE),
  ]);
  if (!l || !f) return null;
  return { leagueId: l, franchiseId: f };
}

export async function setMflCredentials(opts: {
  leagueId: string;
  franchiseId: string;
  season?: string;
  host?: string;
}): Promise<void> {
  const items: [string, string][] = [
    [STORAGE_LEAGUE, opts.leagueId],
    [STORAGE_FRANCHISE, opts.franchiseId],
  ];
  if (opts.season) items.push([STORAGE_SEASON, opts.season]);
  if (opts.host)   items.push([STORAGE_HOST,   opts.host]);
  await AsyncStorage.multiSet(items);
}

export async function clearMflCredentials(): Promise<void> {
  await AsyncStorage.multiRemove([STORAGE_LEAGUE, STORAGE_FRANCHISE, STORAGE_SEASON, STORAGE_HOST]);
  hot.clear();
}

// ─── player cache ─────────────────────────────────────────────────────────
// MFL has a single huge `/players` export (~10MB). Cache it for 24h.
const PLAYERS_CACHE_KEY = 'mfl_players_cache';
const PLAYERS_CACHE_TS  = 'mfl_players_cache_ts';
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
    const creds = await getCreds();
    if (!creds) return [];

    const cached = hotGet<League[]>('leagues');
    if (cached) return cached;

    const data = await mflFetch<any>('league', { L: creds.leagueId });
    const league = data?.league;
    if (!league) return [];

    const result: League[] = [{
      id:            String(league.id ?? creds.leagueId),
      platformId:    'mfl',
      name:          league.name ?? 'MFL League',
      season:        await mflSeason(),
      teamCount:     parseInt(league.franchises?.count ?? '12', 10),
      scoringFormat: inferScoringFormat(league),
      leagueType:    isMflDynasty(league) ? 'dynasty' : 'redraft',
      currentWeek:   undefined,
    }];

    hotSet('leagues', result, 5 * 60 * 1000);
    return result;
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
    const creds = await getCreds();
    if (!creds) return null;
    const all = await this.getAllRosters(leagueId);
    return all.find(r => r.rosterId === creds.franchiseId) ?? null;
  },

  async getAllRosters(leagueId: string): Promise<Roster[]> {
    const cacheKey = `rosters:${leagueId}`;
    const cached = hotGet<Roster[]>(cacheKey);
    if (cached) return cached;

    const [rostersData, leagueData, players, standingsData] = await Promise.all([
      mflFetch<any>('rosters', { L: leagueId }),
      mflFetch<any>('league',  { L: leagueId }),
      getPlayers(),
      mflFetch<any>('leagueStandings', { L: leagueId }).catch(() => null),
    ]);

    const franchiseList: any[] = leagueData?.league?.franchises?.franchise ?? [];
    const franchiseById = Object.fromEntries(franchiseList.map((f: any) => [f.id, f]));

    const standingsByFranchise: Record<string, any> = {};
    const stRows = standingsData?.leagueStandings?.franchise ?? [];
    for (const r of (Array.isArray(stRows) ? stRows : [stRows])) {
      if (r?.id) standingsByFranchise[r.id] = r;
    }

    const creds = await getCreds();
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

      rosters.push({
        userId:   String(fid),
        rosterId: String(fid),
        teamName: meta.name ?? `Franchise ${fid}`,
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
    const limit = opts.limit ?? 50;
    const cacheKey = `available:${leagueId}:${limit}`;
    const cached = hotGet<AvailablePlayer[]>(cacheKey);
    if (cached) return cached;

    const [data, players] = await Promise.all([
      mflFetch<any>('freeAgents', { L: leagueId }),
      getPlayers(),
    ]);

    const list: any[] = data?.freeAgents?.leagueUnit?.player ?? [];
    const out: AvailablePlayer[] = list.slice(0, limit).map((p: any) => {
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
    const data = await mflFetch<any>('leagueStandings', { L: leagueId });
    const rows = data?.leagueStandings?.franchise ?? [];
    const list = Array.isArray(rows) ? rows : [rows];
    const creds = await getCreds();

    return list
      .map((r: any, idx: number) => ({
        rosterId:  String(r.id),
        teamName:  r.name ?? `Franchise ${r.id}`,
        rank:      idx + 1,
        record: {
          wins:   parseInt(r.h2hw ?? '0', 10),
          losses: parseInt(r.h2hl ?? '0', 10),
          ties:   parseInt(r.h2ht ?? '0', 10),
        },
        pointsFor:     parseFloat(r.pf ?? '0'),
        pointsAgainst: parseFloat(r.pa ?? '0'),
        isMe:          creds?.franchiseId === String(r.id),
      }))
      .sort((a, b) => b.pointsFor - a.pointsFor)
      .map((s, i) => ({ ...s, rank: i + 1 }));
  },

  async getMatchups(leagueId: string, week?: number): Promise<Matchup[]> {
    const params: any = { L: leagueId };
    if (week) params.W = week;
    const data = await mflFetch<any>('liveScoring', params);
    const matchups = data?.liveScoring?.matchup ?? [];
    const list = Array.isArray(matchups) ? matchups : [matchups];
    const creds = await getCreds();
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

  async getDraft(_leagueId: string): Promise<DraftInfo | null> {
    // MFL draft API returns format-specific data. Defer to v2.
    return null;
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
