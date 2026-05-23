// services/platform/fleaflicker.ts
// Fleaflicker implementation of FantasyPlatform.
// Public API — no auth tokens needed for read access. The user just
// enters their league ID and roster ID; we store both in AsyncStorage.

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AvailablePlayer,
  ConnectionStatus,
  DraftInfo,
  DraftPick,
  FantasyPlatform,
  HeatSignals,
  League,
  LeagueDetail,
  Matchup,
  PlatformError,
  PlatformNotSupportedError,
  Player,
  Roster,
  RosterSlot,
  ScoringFormat,
  Standing,
  Transaction,
  WaiverType,
} from './types';

const BASE = 'https://www.fleaflicker.com/api';
const STORAGE_LEAGUE = 'fleaflicker_league_id';
const STORAGE_TEAM = 'fleaflicker_team_id';

// ─── short-lived hot cache for read-heavy endpoints ──────────────────────
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
// Sentinel raised on any 404, so callers can implement endpoint-specific
// fallbacks. We do NOT auto-classify 404s as "private league" — empirically
// the Fleaflicker public API is inconsistent: some leagues 404 on FetchLeague
// but happily serve FetchLeagueStandings / FetchLeagueScoreboard for the
// same league_id. Callers with a fallback (see getLeagues) catch this;
// callers without one can let it propagate.
export class FleaflickerNotFoundError extends Error {
  constructor(public readonly endpoint: string, public readonly leagueId?: string) {
    super(`Fleaflicker ${endpoint} returned 404${leagueId ? ` for league ${leagueId}` : ''}`);
    this.name = 'FleaflickerNotFoundError';
  }
}

async function ff<T>(endpoint: string, params: Record<string, string | number> = {}): Promise<T> {
  const qs = new URLSearchParams({ sport: 'NFL', ...Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k, String(v)])
  )}).toString();
  const url = `${BASE}/${endpoint}?${qs}`;
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) {
      throw new FleaflickerNotFoundError(endpoint, params.league_id ? String(params.league_id) : undefined);
    }
    throw new PlatformError(`Fleaflicker ${endpoint} failed: ${res.status}`, 'fleaflicker');
  }
  return res.json() as Promise<T>;
}

// ─── credential helpers ───────────────────────────────────────────────────
async function getCreds(): Promise<{ leagueId: string; teamId: string } | null> {
  const [l, t] = await Promise.all([
    AsyncStorage.getItem(STORAGE_LEAGUE),
    AsyncStorage.getItem(STORAGE_TEAM),
  ]);
  if (!l || !t) return null;
  return { leagueId: l, teamId: t };
}

export async function setFleaflickerCredentials(leagueId: string, teamId: string): Promise<void> {
  await AsyncStorage.multiSet([
    [STORAGE_LEAGUE, leagueId],
    [STORAGE_TEAM, teamId],
  ]);
}

export async function clearFleaflickerCredentials(): Promise<void> {
  await AsyncStorage.multiRemove([STORAGE_LEAGUE, STORAGE_TEAM]);
  hot.clear();
}

// ─── mapping helpers ──────────────────────────────────────────────────────
function mapScoring(scoringPeriod: any): ScoringFormat {
  // Fleaflicker doesn't expose a single scoring flag — infer from rules.
  // Default to PPR which covers the most common case.
  const rules = scoringPeriod?.rules || [];
  for (const r of rules) {
    if (r?.category?.id === 'reception') {
      const v = parseFloat(r?.points?.value ?? '0');
      if (v >= 0.9) return 'ppr';
      if (v >= 0.4) return 'half';
      return 'standard';
    }
  }
  return 'ppr';
}

function isDynastyLeague(settings: any): boolean {
  // Fleaflicker dynasty leagues typically have keeper rules + multi-year
  // contracts. Different endpoints surface the keeper count under different
  // field names (`keeperCount` on FetchLeague, `maxKeepers` on FetchLeague-
  // Standings) — check both. Treat ≥10 keepers as dynasty (5–9 is keeper).
  const kc = settings?.keeperCount ?? settings?.maxKeepers ?? 0;
  return (kc >= 10)
      || !!(settings?.salaryCapDollars)
      || !!(settings?.contractsEnabled);
}

function mapPlayer(proPlayer: any, positionEligibility?: string[]): Player {
  return {
    id:          String(proPlayer?.id ?? ''),
    platformId:  'fleaflicker',
    name:        proPlayer?.nameFull ?? '',
    firstName:   proPlayer?.nameFirst ?? '',
    lastName:    proPlayer?.nameLast ?? '',
    position:    proPlayer?.position ?? (positionEligibility?.[0] ?? ''),
    team:        proPlayer?.proTeamAbbreviation ?? proPlayer?.proTeam?.abbreviation ?? '',
    injuryStatus: proPlayer?.injury?.severity ?? null,
    photoUrl:    proPlayer?.headshotUrl ?? undefined,
  };
}

// Maps either a FetchRoster slot (entry has .position + .leaguePlayer
// wrappers) or a FetchLeagueRosters player (entry has .proPlayer at the
// top level, no position info). Empirically both shapes flow through here.
function mapRosterSlot(entry: any): RosterSlot {
  const pp = entry?.leaguePlayer?.proPlayer ?? entry?.proPlayer ?? entry?.player?.proPlayer ?? {};
  const pos = entry?.position ?? {};
  const slot = pos?.label ?? 'BN';
  // Fleaflicker marks a starter slot with `position.start` set to the count
  // of starters needed at that position (e.g. 1 for QB, 2 for RB). Bench
  // slots either omit the field or set it to 0/null.
  const isStarter = !!pos?.start && pos.start > 0;
  const stats = entry?.leaguePlayer ?? entry;
  return {
    player: mapPlayer(pp, pos?.eligibility),
    slot:   String(slot).toUpperCase(),
    isStarter,
    points:    stats?.viewingActualPoints?.value    ? parseFloat(stats.viewingActualPoints.formatted)    : undefined,
    projected: stats?.viewingProjectedPoints?.value ? parseFloat(stats.viewingProjectedPoints.formatted) : undefined,
    salary:    stats?.salary?.value                 ? parseFloat(stats.salary.value)                     : undefined,
    isKeeper: !!stats?.isKeeper,
  };
}

// ─── roster fetch helper (used by getMyRoster) ────────────────────────────
async function fetchRoster(leagueId: string, teamId: string): Promise<Roster | null> {
  const cacheKey = `roster:${leagueId}:${teamId}`;
  const cached = hotGet<Roster>(cacheKey);
  if (cached) return cached;

  const data = await ff<any>('FetchRoster', { league_id: leagueId, team_id: teamId });
  // FetchRoster doesn't return a `team` block — just the lineup groups.
  // Team metadata (name/record/points) is filled in by getStandings; here
  // we just need the players. (Previously we bailed if !team, leaving the
  // user's roster perpetually empty.)
  const groups = data?.groups ?? [];

  const starters: RosterSlot[] = [];
  const bench: RosterSlot[] = [];
  const ir: RosterSlot[] = [];
  const taxi: RosterSlot[] = [];

  for (const group of groups) {
    const groupLabel = String(group?.group ?? '').toUpperCase();
    for (const entry of (group?.slots ?? [])) {
      if (!entry?.leaguePlayer?.proPlayer && !entry?.proPlayer) continue;
      const slot = mapRosterSlot(entry);
      // Group labels observed in the wild: START, INJURED, TAXI, plus an
      // unlabeled group used as the bench. Match each explicitly so we
      // don't accidentally classify a bench player as IR.
      if (groupLabel === 'INJURED' || groupLabel === 'IR') ir.push(slot);
      else if (groupLabel === 'TAXI') taxi.push(slot);
      else if (groupLabel === 'START' && slot.isStarter) starters.push(slot);
      else bench.push(slot);
    }
  }

  const creds = await getCreds();
  const isMe = creds?.teamId === String(teamId);

  const roster: Roster = {
    userId:      String(teamId),
    rosterId:    String(teamId),
    teamName:    '',
    record:      { wins: 0, losses: 0, ties: 0 },
    pointsFor:     0,
    pointsAgainst: 0,
    starters,
    bench,
    ir,
    isMe,
  };

  hotSet(cacheKey, roster);
  return roster;
}

// ─── platform implementation ──────────────────────────────────────────────
export const fleaflickerPlatform: FantasyPlatform = {
  platformId: 'fleaflicker',

  async isAuthenticated(): Promise<boolean> {
    return (await getCreds()) !== null;
  },

  async getConnectionStatus(): Promise<ConnectionStatus> {
    return (await getCreds()) ? 'connected' : 'never_connected';
  },

  async getMyUserId(): Promise<string | null> {
    const c = await getCreds();
    return c?.teamId ?? null;
  },

  async getLeagues(): Promise<League[]> {
    const creds = await getCreds();
    if (!creds) return [];

    const cached = hotGet<League[]>('leagues');
    if (cached) return cached;

    // Primary: FetchLeague returns the richest payload (scoring rules,
    // currentWeek, etc.). But Fleaflicker's public API inconsistently
    // 404s this endpoint for some leagues that are otherwise fully
    // readable via FetchLeagueStandings — so fall back to that on 404,
    // synthesizing the same League shape with sensible defaults.
    let league: any = null;
    try {
      const data = await ff<any>('FetchLeague', { league_id: creds.leagueId });
      league = data?.league;
    } catch (e) {
      if (!(e instanceof FleaflickerNotFoundError)) throw e;
      try {
        const fallback = await ff<any>('FetchLeagueStandings', { league_id: creds.leagueId });
        league = fallback?.league
          ? { ...fallback.league, season: fallback.season ?? new Date().getFullYear() }
          : null;
      } catch {
        return [];
      }
    }
    if (!league) return [];

    const result: League[] = [{
      id:            String(league.id),
      platformId:    'fleaflicker',
      name:          league.name ?? 'Fleaflicker League',
      season:        String(league.season ?? new Date().getFullYear()),
      teamCount:     league.capacity ?? 12,
      scoringFormat: mapScoring(league.rules?.regularScoringPeriod),
      leagueType:    isDynastyLeague(league) ? 'dynasty' : 'redraft',
      currentWeek:   league.currentWeek ?? undefined,
      avatarUrl:     league.logoUrl ?? undefined,
    }];

    hotSet('leagues', result, 5 * 60 * 1000);
    return result;
  },

  async getLeague(leagueId: string): Promise<LeagueDetail> {
    const data = await ff<any>('FetchLeague', { league_id: leagueId });
    const league = data?.league;
    if (!league) throw new PlatformError('League not found', 'fleaflicker');

    const settings = league.rules ?? {};
    const rosterSlots: string[] = [];
    for (const slot of (settings?.rosterRequirements ?? [])) {
      const label = slot?.position?.label ?? 'BN';
      const count = slot?.numStarters ?? 0;
      for (let i = 0; i < count; i++) rosterSlots.push(label);
    }

    return {
      id:            String(league.id),
      platformId:    'fleaflicker',
      name:          league.name ?? 'Fleaflicker League',
      season:        String(league.season ?? new Date().getFullYear()),
      teamCount:     league.capacity ?? 12,
      scoringFormat: mapScoring(settings?.regularScoringPeriod),
      leagueType:    isDynastyLeague(league) ? 'dynasty' : 'redraft',
      currentWeek:   league.currentWeek ?? undefined,
      avatarUrl:     league.logoUrl ?? undefined,
      rosterSlots,
      waiverType:   (settings?.waiverType?.toLowerCase().includes('faab') ? 'faab' : 'rolling') as WaiverType,
      faabBudget:   settings?.waiverAcquisitionBudget ?? undefined,
      isDynasty:    isDynastyLeague(league),
      isSuperFlex:  rosterSlots.some(s => s.toUpperCase().includes('SUPER') || s.toUpperCase() === 'OP'),
      hasSalaries:  !!settings?.salaryCapDollars,
      hasContracts: !!settings?.contractsEnabled,
      hasTaxiSquad: false,
      scoringSettings: {},
    };
  },

  async getMyRoster(leagueId: string): Promise<Roster | null> {
    const creds = await getCreds();
    if (!creds) return null;
    return await fetchRoster(leagueId, creds.teamId);
  },



  async getAllRosters(leagueId: string): Promise<Roster[]> {
    const cacheKey = `rosters:${leagueId}`;
    const cached = hotGet<Roster[]>(cacheKey);
    if (cached) return cached;

    const data = await ff<any>('FetchLeagueRosters', { league_id: leagueId });
    const rosters: Roster[] = [];
    const creds = await getCreds();

    for (const r of (data?.rosters ?? [])) {
      const team = r.team;
      if (!team) continue;
      const starters: RosterSlot[] = [];
      const bench: RosterSlot[] = [];
      const ir: RosterSlot[] = [];
      for (const p of (r.players ?? [])) {
        const slot = mapRosterSlot(p);
        if (slot.slot === 'IR') ir.push(slot);
        else if (slot.isStarter) starters.push(slot);
        else bench.push(slot);
      }
      rosters.push({
        userId:   String(team.owners?.[0]?.id ?? team.id),
        rosterId: String(team.id),
        teamName: team.name ?? 'Unnamed',
        record: {
          wins:   team.recordOverall?.wins ?? 0,
          losses: team.recordOverall?.losses ?? 0,
          ties:   team.recordOverall?.ties ?? 0,
        },
        pointsFor:     parseFloat(team.pointsFor?.formatted ?? '0'),
        pointsAgainst: parseFloat(team.pointsAgainst?.formatted ?? '0'),
        starters, bench, ir,
        isMe: creds?.teamId === String(team.id),
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

    const data = await ff<any>('FetchPlayerListing', {
      league_id: leagueId,
      filter: 'AVAILABLE',
      result_offset: 0,
      sort: 'SORT_RANK',
    });

    const players: AvailablePlayer[] = (data?.players ?? []).slice(0, limit).map((p: any) => {
      const pp = p.proPlayer ?? {};
      const base = mapPlayer(pp);
      return {
        ...base,
        percentOwned:  p.rosterStats?.totalRosteredPercent?.value ?? undefined,
        percentStarted: p.rosterStats?.totalStartedPercent?.value ?? undefined,
        heatSignals: {
          percentOwned:    p.rosterStats?.totalRosteredPercent?.value ?? undefined,
          percentStarted:  p.rosterStats?.totalStartedPercent?.value ?? undefined,
        },
      } as AvailablePlayer;
    });

    hotSet(cacheKey, players);
    return players;
  },

  async getHeatSignals(_leagueId: string, _playerId: string): Promise<HeatSignals> {
    // Fleaflicker doesn't expose per-player trending data. Return empty;
    // the Heat engine handles undefined signals gracefully.
    return {};
  },

  async searchPlayers(query: string, opts: { limit?: number } = {}): Promise<Player[]> {
    const limit = opts.limit ?? 20;
    const data = await ff<any>('FetchPlayerListing', {
      league_id: (await getCreds())?.leagueId ?? '',
      filter_query: query,
      result_offset: 0,
    });
    return (data?.players ?? []).slice(0, limit).map((p: any) => mapPlayer(p.proPlayer ?? {}));
  },

  async getStandings(leagueId: string): Promise<Standing[]> {
    const data = await ff<any>('FetchLeagueStandings', { league_id: leagueId });
    const creds = await getCreds();
    const out: Standing[] = [];
    let rank = 1;
    for (const div of (data?.divisions ?? [])) {
      for (const team of (div?.teams ?? [])) {
        out.push({
          rosterId:  String(team.id),
          teamName:  team.name ?? 'Unnamed',
          rank:      team.recordOverall?.rank ?? rank++,
          record: {
            wins:   team.recordOverall?.wins ?? 0,
            losses: team.recordOverall?.losses ?? 0,
            ties:   team.recordOverall?.ties ?? 0,
          },
          pointsFor:     parseFloat(team.pointsFor?.formatted ?? '0'),
          pointsAgainst: parseFloat(team.pointsAgainst?.formatted ?? '0'),
          streak:        team.streak?.value ?? undefined,
          isMe:          creds?.teamId === String(team.id),
        });
      }
    }
    out.sort((a, b) => a.rank - b.rank);
    return out;
  },

  async getMatchups(leagueId: string, week?: number): Promise<Matchup[]> {
    const params: any = { league_id: leagueId };
    if (week) params.scoring_period = week;
    const data = await ff<any>('FetchLeagueScoreboard', params);
    const creds = await getCreds();
    const out: Matchup[] = [];
    for (const game of (data?.games ?? [])) {
      const w = data?.eligibleSchedulePeriods?.[0]?.value ?? week ?? 1;
      out.push({
        week: w,
        matchupId: String(game.id ?? `${game.home?.id}-${game.away?.id}`),
        home: {
          rosterId:  String(game.home?.id ?? ''),
          teamName:  game.home?.name ?? '',
          points:    parseFloat(game.homeScore?.score?.formatted ?? '0'),
          projected: parseFloat(game.homeScore?.scoreProjected?.formatted ?? '0'),
          isMe:      creds?.teamId === String(game.home?.id ?? ''),
        },
        away: {
          rosterId:  String(game.away?.id ?? ''),
          teamName:  game.away?.name ?? '',
          points:    parseFloat(game.awayScore?.score?.formatted ?? '0'),
          projected: parseFloat(game.awayScore?.scoreProjected?.formatted ?? '0'),
          isMe:      creds?.teamId === String(game.away?.id ?? ''),
        },
      });
    }
    return out;
  },

  async getDraft(_leagueId: string): Promise<DraftInfo | null> {
    // Fleaflicker draft API exists but is league-format-dependent. Defer.
    return null;
  },

  async getDraftPicks(_draftId: string): Promise<DraftPick[]> {
    return [];
  },

  async getTransactions(leagueId: string, limit = 30): Promise<Transaction[]> {
    const data = await ff<any>('FetchLeagueTransactions', { league_id: leagueId, result_offset: 0 });
    const out: Transaction[] = [];
    // Real FF shape (verified against league 324106): each item is
    // { timeEpochMilli, transaction: { type?, player, team, ... } }
    // where `type` is one of TRANSACTION_DROP / TRANSACTION_CLAIM /
    // TRANSACTION_TRADE, or absent (= free-agent add). Single player
    // per transaction — there are NO `additions`/`releases` arrays
    // (which the previous implementation looked for, yielding empty
    // adds/drops for every row).
    for (const t of (data?.items ?? []).slice(0, limit)) {
      const ts = t?.timeEpochMilli ? Number(t.timeEpochMilli) : Date.now();
      const tx = t?.transaction ?? {};
      const player = tx.player?.proPlayer ? mapPlayer(tx.player.proPlayer) : null;
      const rosterId = String(tx.team?.id ?? '');
      const rawType = String(tx.type ?? '').toUpperCase();
      const isDrop = rawType === 'TRANSACTION_DROP';
      const isTrade = rawType === 'TRANSACTION_TRADE';
      const isClaim = rawType === 'TRANSACTION_CLAIM';
      const type: Transaction['type'] = isDrop ? 'drop'
                                      : isTrade ? 'trade'
                                      : isClaim ? 'waiver'
                                      :           'add';
      const adds: Transaction['adds'] = (!isDrop && player) ? [{ player, toRosterId: rosterId }] : [];
      const drops: Transaction['drops'] = (isDrop && player) ? [{ player, fromRosterId: rosterId }] : [];
      out.push({
        id:        String(t?.id ?? `${ts}-${player?.id ?? 'x'}`),
        type,
        timestamp: ts,
        adds, drops,
        status:    'complete',
      });
    }
    return out;
  },
};
