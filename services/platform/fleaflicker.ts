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
const STORAGE_LEAGUE  = 'fleaflicker_league_id';   // legacy single-league
const STORAGE_TEAM    = 'fleaflicker_team_id';     // legacy single-league
const STORAGE_LEAGUES = 'fleaflicker_leagues_v2';  // JSON array of {leagueId,teamId}

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
export type FleaflickerLeagueCreds = { leagueId: string; teamId: string };

/**
 * Read every Fleaflicker league the user has connected. Migrates the
 * legacy single-league keys into the v2 array on first read.
 */
async function getAllCreds(): Promise<FleaflickerLeagueCreds[]> {
  const raw = await AsyncStorage.getItem(STORAGE_LEAGUES);
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr.filter((c: any) => c?.leagueId && c?.teamId);
    } catch {}
  }
  // Legacy migration: promote the single-league pair into the v2 array.
  const [l, t] = await Promise.all([
    AsyncStorage.getItem(STORAGE_LEAGUE),
    AsyncStorage.getItem(STORAGE_TEAM),
  ]);
  if (l && t) {
    const arr: FleaflickerLeagueCreds[] = [{ leagueId: l, teamId: t }];
    try { await AsyncStorage.setItem(STORAGE_LEAGUES, JSON.stringify(arr)); } catch {}
    return arr;
  }
  return [];
}

/** Backward-compat — returns the first connected league (or null). */
async function getCreds(): Promise<FleaflickerLeagueCreds | null> {
  const all = await getAllCreds();
  return all[0] ?? null;
}

/** Return the {leagueId, teamId} pair for a specific league, or null. */
async function getCredsForLeague(leagueId: string): Promise<FleaflickerLeagueCreds | null> {
  const all = await getAllCreds();
  return all.find(c => c.leagueId === String(leagueId)) ?? null;
}

/**
 * Persist N leagues at once. Merge semantics: existing leagueIds are
 * replaced with the new teamId, new leagueIds are appended. The single-
 * league keys are also updated to the first entry for any code still
 * using the legacy path.
 */
export async function setFleaflickerLeagues(leagues: FleaflickerLeagueCreds[]): Promise<void> {
  if (!leagues || leagues.length === 0) return;
  const existing = await getAllCreds();
  const map = new Map<string, FleaflickerLeagueCreds>();
  for (const c of existing) map.set(c.leagueId, c);
  for (const c of leagues)  map.set(c.leagueId, c);
  const merged = Array.from(map.values());
  await AsyncStorage.setItem(STORAGE_LEAGUES, JSON.stringify(merged));
  // Keep the legacy single-league keys pointed at the first entry so any
  // older callers don't see stale data.
  await AsyncStorage.multiSet([
    [STORAGE_LEAGUE, merged[0].leagueId],
    [STORAGE_TEAM,   merged[0].teamId],
  ]);
  hot.clear();
}

/** Legacy single-league setter — kept for any old call sites. */
export async function setFleaflickerCredentials(leagueId: string, teamId: string): Promise<void> {
  await setFleaflickerLeagues([{ leagueId, teamId }]);
}

export async function clearFleaflickerCredentials(): Promise<void> {
  await AsyncStorage.multiRemove([STORAGE_LEAGUE, STORAGE_TEAM, STORAGE_LEAGUES]);
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

  const creds = await getCredsForLeague(leagueId);
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
    const allCreds = await getAllCreds();
    if (allCreds.length === 0) return [];

    const cached = hotGet<League[]>('leagues');
    if (cached) return cached;

    // Fan out one fetch per connected league. FetchLeague returns the
    // richest payload (scoring rules, currentWeek); we fall back to
    // FetchLeagueStandings on the inconsistent 404s the API sometimes
    // throws there.
    const results = await Promise.all(allCreds.map(async (creds) => {
      let league: any = null;
      try {
        const data = await ff<any>('FetchLeague', { league_id: creds.leagueId });
        league = data?.league;
      } catch (e) {
        if (!(e instanceof FleaflickerNotFoundError)) return null;
        try {
          const fallback = await ff<any>('FetchLeagueStandings', { league_id: creds.leagueId });
          league = fallback?.league
            ? { ...fallback.league, season: fallback.season ?? new Date().getFullYear() }
            : null;
        } catch {
          return null;
        }
      }
      if (!league) return null;
      const ret: League = {
        id:            String(league.id),
        platformId:    'fleaflicker',
        name:          league.name ?? 'Fleaflicker League',
        season:        String(league.season ?? new Date().getFullYear()),
        teamCount:     league.capacity ?? 12,
        scoringFormat: mapScoring(league.rules?.regularScoringPeriod),
        leagueType:    isDynastyLeague(league) ? 'dynasty' : 'redraft',
        currentWeek:   league.currentWeek ?? undefined,
        avatarUrl:     league.logoUrl ?? undefined,
      };
      return ret;
    }));

    const valid = results.filter((r): r is League => r !== null);
    hotSet('leagues', valid, 5 * 60 * 1000);
    return valid;
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
    const creds = await getCredsForLeague(leagueId);
    if (!creds) return null;
    return await fetchRoster(leagueId, creds.teamId);
  },



  async getAllRosters(leagueId: string): Promise<Roster[]> {
    const cacheKey = `rosters:${leagueId}`;
    const cached = hotGet<Roster[]>(cacheKey);
    if (cached) return cached;

    const data = await ff<any>('FetchLeagueRosters', { league_id: leagueId });
    const rosters: Roster[] = [];
    const creds = await getCredsForLeague(leagueId);

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

    // FF's FetchPlayerListing has no server-side "free agents only" filter —
    // every attempt at `filter=AVAILABLE` / `sort=SORT_RANK` / nested
    // filter objects returns 400. The endpoint returns owned + free agents
    // mixed together, sorted by season-total points. Rostered players
    // dominate the first ~300 entries (12 teams × 25-ish roster slots);
    // free agents take over after that.
    //
    // Strategy: fan out parallel pages and filter to entries with no
    // `owner`. Scale offset + page count with the requested limit — for
    // small limits (~50) we sweep across the boundary at offset 300; for
    // large limits (~300, used by the dynasty draft pool) we start past
    // the rostered cliff at offset 600 where ~all entries are FAs.
    const PAGE = 30;
    const startOffset = limit > 100 ? 600 : 300;
    const pagesNeeded = Math.max(6, Math.ceil(limit / PAGE) + 4);
    const offsets = Array.from({ length: pagesNeeded }, (_, i) => startOffset + i * PAGE);
    const pages = await Promise.all(
      offsets.map(off =>
        ff<any>('FetchPlayerListing', { league_id: leagueId, result_offset: off })
          .catch(() => null)
      )
    );

    const out: AvailablePlayer[] = [];
    for (const data of pages) {
      for (const p of (data?.players ?? [])) {
        if (p.owner) continue;
        const pp = p.proPlayer ?? {};
        out.push({ ...mapPlayer(pp), heatSignals: {} } as AvailablePlayer);
        if (out.length >= limit) break;
      }
      if (out.length >= limit) break;
    }

    hotSet(cacheKey, out);
    return out;
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
    const creds = await getCredsForLeague(leagueId);
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
    const creds = await getCredsForLeague(leagueId);
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

  async getDraft(leagueId: string): Promise<DraftInfo | null> {
    // FetchLeagueDraftBoard returns the full pick grid for the league's
    // current/upcoming draft. Shape (verified against league 324106):
    //   { draftOrder: [team, …], rows: [{ round, cells: [{ team, slot }] }] }
    // Snake vs linear is implicit — compare row 2 col 1 against row 1
    // col 1 (linear) vs row 1 last col (snake).
    let data: any = null;
    try {
      data = await ff<any>('FetchLeagueDraftBoard', { league_id: leagueId });
    } catch { return null; }

    const rows: any[] = data?.rows ?? [];
    if (rows.length === 0) return null;

    const draftOrder: any[] = data?.draftOrder ?? [];
    const teamCount = draftOrder.length || rows[0]?.cells?.length || 12;

    const r1FirstTeam = rows[0]?.cells?.[0]?.team?.id;
    const r2FirstTeam = rows[1]?.cells?.[0]?.team?.id;
    const r1LastTeam  = rows[0]?.cells?.[teamCount - 1]?.team?.id;
    const type: 'snake' | 'linear' =
      rows.length > 1 && r2FirstTeam === r1LastTeam ? 'snake'
        : 'linear';

    const creds = await getCredsForLeague(leagueId);
    const myTeamId = creds?.teamId ? String(creds.teamId) : null;

    // Slot 1 = round 1 column 1 for THIS user. Find the earliest cell that
    // belongs to them — handles startup drafts where the user is mid-round,
    // and rookie/keeper drafts where traded picks may shift their slot
    // (we only need the "first pick I own" for the setup-step display).
    let myDraftSlot: number | undefined;
    if (myTeamId) {
      outer: for (const row of rows) {
        for (const cell of (row?.cells ?? [])) {
          if (String(cell?.team?.id ?? '') === myTeamId) {
            myDraftSlot = cell?.slot?.slot ?? undefined;
            break outer;
          }
        }
      }
    }

    const slotToRosterId: Record<number, string> = {};
    for (const cell of (rows[0]?.cells ?? [])) {
      const s = cell?.slot?.slot;
      if (s) slotToRosterId[s] = String(cell?.team?.id ?? '');
    }

    // Build the full list of picks owned by my team after trades. Each
    // row is one round, each cell is one slot — a cell with team.id ===
    // myTeamId means we own that pick. Picks acquired in trades show up
    // here too (Fleaflicker rewrites the cell's team to the new owner).
    // Used by the AI Coach so it can say "1.08, 3.08" instead of "R1".
    let myOwnedPicks: DraftInfo['myOwnedPicks'];
    if (myTeamId) {
      myOwnedPicks = [];
      for (const row of rows) {
        const round = row?.round ?? 0;
        for (const cell of (row?.cells ?? [])) {
          if (String(cell?.team?.id ?? '') === myTeamId) {
            const slot = cell?.slot?.slot;
            if (round && slot) myOwnedPicks.push({ round, slot });
          }
        }
      }
    }

    return {
      id:         String(data?.id ?? leagueId),
      platformId: 'fleaflicker',
      leagueId:   String(leagueId),
      type,
      status:     'pre_draft',
      rounds:     rows.length,
      teamCount,
      myDraftSlot,
      slotToRosterId,
      myOwnedPicks,
    };
  },

  async getDraftPicks(leagueId: string): Promise<DraftPick[]> {
    // The same FetchLeagueDraftBoard payload carries each cell's overall
    // pick number + team — for pre-draft this is the schedule, for in-draft
    // it includes `pick.proPlayer` once a player has been selected.
    let data: any = null;
    try {
      data = await ff<any>('FetchLeagueDraftBoard', { league_id: leagueId });
    } catch { return []; }

    const creds = await getCredsForLeague(leagueId);
    const myId = creds?.teamId ? String(creds.teamId) : null;
    const out: DraftPick[] = [];
    for (const row of (data?.rows ?? [])) {
      for (const cell of (row?.cells ?? [])) {
        const pick = cell?.pick ?? cell;
        const pp = pick?.proPlayer ?? null;
        if (!pp) continue;
        const teamId = String(cell?.team?.id ?? '');
        const mapped = mapPlayer(pp);
        out.push({
          pickNo:     cell?.slot?.overall ?? 0,
          round:      cell?.slot?.round   ?? row?.round ?? 0,
          slot:       cell?.slot?.slot    ?? 0,
          rosterId:   teamId,
          playerId:   mapped.id,
          playerName: mapped.name,
          position:   mapped.position,
          team:       mapped.team,
          isMyPick:   !!myId && teamId === myId,
        });
      }
    }
    return out;
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
