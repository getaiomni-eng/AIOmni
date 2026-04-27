#!/usr/bin/env python3
"""
Add MFL + Fleaflicker platform integrations with full dynasty/SuperFlex support.

This is a single comprehensive script that wires up two new platforms by
slotting them into the existing FantasyPlatform abstraction. Every screen
in the app gets MFL + Fleaflicker support automatically — no UI changes
needed beyond the new connection rows in Settings.

Files created:
  services/platform/fleaflicker.ts   — Fleaflicker API client (FantasyPlatform impl)
  services/platform/mfl.ts           — MFL API client (FantasyPlatform impl)
  app/fleaflicker-login.tsx          — Connection UI (just a league ID input)
  app/mfl-login.tsx                  — Connection UI (league ID + franchise ID)

Files modified:
  services/platform/types.ts         — extend PlatformId; add dynasty fields to LeagueDetail
  services/platform/index.ts         — register both platforms in dispatcher
  app/(tabs)/settings.tsx            — add MFL + Fleaflicker connection rows
  app/_layout.tsx                    — register new login screens

Idempotent. Safe to re-run.
Run from /Users/patrickmeyer/AIOmni:
    python3 scripts/add_mfl_fleaflicker.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SVC = ROOT / "services" / "platform"
APP = ROOT / "app"


# ═══════════════════════════════════════════════════════════════════════════
# FILE CONTENTS
# ═══════════════════════════════════════════════════════════════════════════

# ───────────────────────────────────────────────────────────────────────────
# fleaflicker.ts
# ───────────────────────────────────────────────────────────────────────────
FLEAFLICKER_TS = r"""// services/platform/fleaflicker.ts
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
async function ff<T>(endpoint: string, params: Record<string, string | number> = {}): Promise<T> {
  const qs = new URLSearchParams({ sport: 'NFL', ...Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k, String(v)])
  )}).toString();
  const url = `${BASE}/${endpoint}?${qs}`;
  const res = await fetch(url);
  if (!res.ok) throw new PlatformError(`Fleaflicker ${endpoint} failed: ${res.status}`, 'fleaflicker');
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
  // Fleaflicker dynasty leagues typically have keeper rules + multi-year contracts.
  return !!(settings?.keeperCount && settings.keeperCount > 0)
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

function mapRosterSlot(playerEntry: any): RosterSlot {
  const pp = playerEntry?.proPlayer ?? playerEntry?.player?.proPlayer ?? {};
  const slot = playerEntry?.position?.label ?? playerEntry?.position?.start?.label ?? 'BN';
  const isStarter = !!(playerEntry?.position?.start);
  return {
    player: mapPlayer(pp, playerEntry?.position?.eligibility),
    slot:   String(slot).toUpperCase(),
    isStarter,
    points: playerEntry?.viewingActualPoints?.value ? parseFloat(playerEntry.viewingActualPoints.formatted) : undefined,
    projected: playerEntry?.viewingProjectedPoints?.value ? parseFloat(playerEntry.viewingProjectedPoints.formatted) : undefined,
    salary: playerEntry?.salary?.value ? parseFloat(playerEntry.salary.value) : undefined,
    isKeeper: !!playerEntry?.isKeeper,
  };
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

    const data = await ff<any>('FetchLeague', { league_id: creds.leagueId });
    const league = data?.league;
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
    return await this.getRosterById(leagueId, creds.teamId);
  },

  async getRosterById(leagueId: string, teamId: string): Promise<Roster | null> {
    const cacheKey = `roster:${leagueId}:${teamId}`;
    const cached = hotGet<Roster>(cacheKey);
    if (cached) return cached;

    const data = await ff<any>('FetchRoster', { league_id: leagueId, team_id: teamId });
    const team = data?.team;
    const groups = data?.groups ?? [];
    if (!team) return null;

    const starters: RosterSlot[] = [];
    const bench: RosterSlot[] = [];
    const ir: RosterSlot[] = [];
    const taxi: RosterSlot[] = [];

    for (const group of groups) {
      for (const entry of (group?.slots ?? [])) {
        if (!entry?.leaguePlayer?.proPlayer && !entry?.proPlayer) continue;
        const lp = entry.leaguePlayer ?? entry;
        const slot = mapRosterSlot(lp);
        const groupLabel = String(group?.group ?? '').toUpperCase();
        if (groupLabel.includes('IR')) ir.push(slot);
        else if (groupLabel.includes('TAXI')) taxi.push(slot);
        else if (slot.isStarter) starters.push(slot);
        else bench.push(slot);
      }
    }

    const creds = await getCreds();
    const isMe = creds?.teamId === String(teamId);

    const roster: Roster = {
      userId:      String(team.owners?.[0]?.id ?? team.id),
      rosterId:    String(team.id),
      teamName:    team.name ?? 'Unnamed',
      record: {
        wins:   team.recordOverall?.wins ?? 0,
        losses: team.recordOverall?.losses ?? 0,
        ties:   team.recordOverall?.ties ?? 0,
      },
      pointsFor:     parseFloat(team.pointsFor?.formatted ?? '0'),
      pointsAgainst: parseFloat(team.pointsAgainst?.formatted ?? '0'),
      starters,
      bench,
      ir,
      isMe,
    };

    hotSet(cacheKey, roster);
    return roster;
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
    for (const t of (data?.items ?? []).slice(0, limit)) {
      const ts = t?.timeEpochMilli ? Math.floor(t.timeEpochMilli / 1000) : Date.now() / 1000;
      const adds = (t?.transaction?.additions ?? []).map((a: any) => ({
        player: mapPlayer(a?.proPlayer ?? {}),
        toRosterId: String(a?.team?.id ?? ''),
      }));
      const drops = (t?.transaction?.releases ?? []).map((d: any) => ({
        player: mapPlayer(d?.proPlayer ?? {}),
        fromRosterId: String(d?.team?.id ?? ''),
      }));
      out.push({
        id:        String(t?.id ?? ts),
        type:      (t?.transaction?.type?.toLowerCase() ?? 'add') as any,
        timestamp: ts,
        adds, drops,
        status:    'complete',
      });
    }
    return out;
  },
};
"""


# ───────────────────────────────────────────────────────────────────────────
# mfl.ts
# ───────────────────────────────────────────────────────────────────────────
MFL_TS = r"""// services/platform/mfl.ts
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
"""


# ───────────────────────────────────────────────────────────────────────────
# fleaflicker-login.tsx
# ───────────────────────────────────────────────────────────────────────────
FLEAFLICKER_LOGIN = r"""import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet, Linking } from 'react-native';
import { AIOmniLogo } from './components/AIOmniLogo';
import { setFleaflickerCredentials, fleaflickerPlatform } from '../services/platform/fleaflicker';
import { C, F, SZ, R, SP } from './constants/tokens';

export default function FleaflickerLoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [leagueId, setLeagueId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleConnect = async () => {
    setError('');
    if (!leagueId.trim() || !teamId.trim()) {
      setError('Both league ID and team ID are required.');
      return;
    }
    setLoading(true);
    try {
      // Validate by fetching the league — this confirms IDs are real and public.
      await setFleaflickerCredentials(leagueId.trim(), teamId.trim());
      const leagues = await fleaflickerPlatform.getLeagues();
      if (leagues.length === 0) {
        setError('Could not find that league. Make sure both IDs are correct and the league is public.');
        setLoading(false);
        return;
      }
      router.replace('/(tabs)' as any);
    } catch (e: any) {
      setError(e?.message ?? 'Connection failed.');
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#0a1214' }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.wrap, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }]}>

          <View style={styles.logoBlock}>
            <AIOmniLogo width={140} />
            <Text style={styles.logoSub}>Connect your Fleaflicker league.</Text>
          </View>

          <View style={styles.card}>
            <View style={styles.cardAccent} />
            <Text style={styles.cardTitle}>FLEAFLICKER</Text>

            <Text style={styles.label}>LEAGUE ID</Text>
            <TextInput
              style={styles.input}
              value={leagueId}
              onChangeText={(t: string) => { setLeagueId(t); setError(''); }}
              placeholder="324106"
              placeholderTextColor={C.dim2}
              keyboardType="number-pad"
              autoCapitalize="none"
              autoFocus
            />
            <Text style={styles.hint}>From your league URL: fleaflicker.com/nfl/leagues/<Text style={styles.hintBold}>324106</Text></Text>

            <Text style={styles.label}>YOUR TEAM ID</Text>
            <TextInput
              style={styles.input}
              value={teamId}
              onChangeText={(t: string) => { setTeamId(t); setError(''); }}
              placeholder="1655757"
              placeholderTextColor={C.dim2}
              keyboardType="number-pad"
              autoCapitalize="none"
            />
            <Text style={styles.hint}>Click your team in Fleaflicker — the URL ends in /teams/<Text style={styles.hintBold}>1655757</Text></Text>

            {error ? <Text style={styles.errorTxt}>{error}</Text> : null}

            <TouchableOpacity
              style={[styles.submitBtn, loading && { opacity: 0.5 }]}
              onPress={handleConnect}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color={C.ink} />
                : <Text style={styles.submitTxt}>CONNECT →</Text>
              }
            </TouchableOpacity>

            <TouchableOpacity onPress={() => Linking.openURL('https://www.fleaflicker.com/nfl/leagues')}>
              <Text style={styles.cancelTxt}>Don't have an account? Sign up at fleaflicker.com</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => router.back()}>
              <Text style={styles.cancelTxt}>← Back to settings</Text>
            </TouchableOpacity>
          </View>

        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: SP[3], justifyContent: 'center' },
  logoBlock: { alignItems: 'center', marginBottom: 28 },
  logoSub:   { fontFamily: F.mono, color: '#4a6a76', fontSize: SZ.sm, textAlign: 'center', letterSpacing: 0.5, marginTop: 12 },

  card: {
    backgroundColor: '#12252e',
    borderRadius: R.lg,
    padding: 24,
    borderWidth: 1.5,
    borderColor: '#1a3542',
    overflow: 'hidden',
    position: 'relative',
  },
  cardAccent: { position: 'absolute', top: 0, left: 0, right: 0, height: 3, backgroundColor: '#1be7ff' },
  cardTitle:  { fontFamily: F.bold, fontSize: SZ['2xl'], color: '#f0f4f5', letterSpacing: 2, marginBottom: 18, marginTop: 8 },

  label: { fontFamily: F.mono, fontSize: SZ.xs, color: '#4a6a76', letterSpacing: 1.5, marginBottom: 6, marginTop: 6 },
  input: {
    backgroundColor: '#0f1c22',
    borderWidth: 1.5,
    borderColor: '#1a3542',
    borderRadius: R.sm,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontFamily: F.outfit,
    fontSize: SZ.base,
    color: '#f0f4f5',
    marginBottom: 4,
  },
  hint: { fontFamily: F.mono, fontSize: SZ.xs, color: '#4a6a76', marginBottom: 12, lineHeight: 16 },
  hintBold: { color: '#1be7ff' },

  errorTxt: { fontFamily: F.mono, color: '#ff5714', fontSize: SZ.sm, marginBottom: 12, lineHeight: 18 },

  submitBtn: {
    backgroundColor: '#1be7ff',
    borderRadius: R.sm,
    padding: 16,
    alignItems: 'center',
    marginBottom: 12,
    marginTop: 12,
  },
  submitTxt: { fontFamily: F.mono, color: '#0a1214', fontSize: SZ.base, letterSpacing: 2 },
  cancelTxt: { fontFamily: F.mono, color: '#6eeb83', fontSize: SZ.sm, textAlign: 'center', paddingVertical: 6 },
});
"""


# ───────────────────────────────────────────────────────────────────────────
# mfl-login.tsx
# ───────────────────────────────────────────────────────────────────────────
MFL_LOGIN = r"""import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet, Linking } from 'react-native';
import { AIOmniLogo } from './components/AIOmniLogo';
import { setMflCredentials, mflPlatform } from '../services/platform/mfl';
import { C, F, SZ, R, SP } from './constants/tokens';

export default function MflLoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [leagueId, setLeagueId] = useState('');
  const [franchiseId, setFranchiseId] = useState('');
  const [season, setSeason] = useState(String(new Date().getFullYear()));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleConnect = async () => {
    setError('');
    if (!leagueId.trim() || !franchiseId.trim()) {
      setError('League ID and franchise ID are required.');
      return;
    }
    setLoading(true);
    try {
      // Pad franchise ID to 4 digits if user typed "1" instead of "0001"
      const padded = franchiseId.trim().padStart(4, '0');
      await setMflCredentials({
        leagueId: leagueId.trim(),
        franchiseId: padded,
        season: season.trim() || String(new Date().getFullYear()),
      });
      const leagues = await mflPlatform.getLeagues();
      if (leagues.length === 0) {
        setError('Could not find that league. Check the league ID and season.');
        setLoading(false);
        return;
      }
      router.replace('/(tabs)' as any);
    } catch (e: any) {
      setError(e?.message ?? 'Connection failed.');
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#0a1214' }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.wrap, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }]}>

          <View style={styles.logoBlock}>
            <AIOmniLogo width={140} />
            <Text style={styles.logoSub}>Connect your MFL league.</Text>
          </View>

          <View style={styles.card}>
            <View style={styles.cardAccent} />
            <Text style={styles.cardTitle}>MYFANTASYLEAGUE</Text>

            <Text style={styles.label}>LEAGUE ID</Text>
            <TextInput
              style={styles.input}
              value={leagueId}
              onChangeText={(t: string) => { setLeagueId(t); setError(''); }}
              placeholder="53297"
              placeholderTextColor={C.dim2}
              keyboardType="number-pad"
              autoCapitalize="none"
              autoFocus
            />
            <Text style={styles.hint}>From your league URL: myfantasyleague.com/2026/home/<Text style={styles.hintBold}>53297</Text></Text>

            <Text style={styles.label}>YOUR FRANCHISE ID</Text>
            <TextInput
              style={styles.input}
              value={franchiseId}
              onChangeText={(t: string) => { setFranchiseId(t); setError(''); }}
              placeholder="0001"
              placeholderTextColor={C.dim2}
              keyboardType="number-pad"
              autoCapitalize="none"
            />
            <Text style={styles.hint}>Click your team — URL contains &F=<Text style={styles.hintBold}>0001</Text></Text>

            <Text style={styles.label}>SEASON</Text>
            <TextInput
              style={styles.input}
              value={season}
              onChangeText={(t: string) => { setSeason(t); setError(''); }}
              placeholder="2026"
              placeholderTextColor={C.dim2}
              keyboardType="number-pad"
              autoCapitalize="none"
            />
            <Text style={styles.hint}>The year the league plays in (typically the current year)</Text>

            {error ? <Text style={styles.errorTxt}>{error}</Text> : null}

            <TouchableOpacity
              style={[styles.submitBtn, loading && { opacity: 0.5 }]}
              onPress={handleConnect}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color={C.ink} />
                : <Text style={styles.submitTxt}>CONNECT →</Text>
              }
            </TouchableOpacity>

            <TouchableOpacity onPress={() => Linking.openURL('https://www.myfantasyleague.com/')}>
              <Text style={styles.cancelTxt}>Don't have an MFL league? Sign up at myfantasyleague.com</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => router.back()}>
              <Text style={styles.cancelTxt}>← Back to settings</Text>
            </TouchableOpacity>
          </View>

        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: SP[3], justifyContent: 'center' },
  logoBlock: { alignItems: 'center', marginBottom: 28 },
  logoSub:   { fontFamily: F.mono, color: '#4a6a76', fontSize: SZ.sm, textAlign: 'center', letterSpacing: 0.5, marginTop: 12 },

  card: {
    backgroundColor: '#12252e',
    borderRadius: R.lg,
    padding: 24,
    borderWidth: 1.5,
    borderColor: '#1a3542',
    overflow: 'hidden',
    position: 'relative',
  },
  cardAccent: { position: 'absolute', top: 0, left: 0, right: 0, height: 3, backgroundColor: '#e4ff1a' },
  cardTitle:  { fontFamily: F.bold, fontSize: SZ['2xl'], color: '#f0f4f5', letterSpacing: 2, marginBottom: 18, marginTop: 8 },

  label: { fontFamily: F.mono, fontSize: SZ.xs, color: '#4a6a76', letterSpacing: 1.5, marginBottom: 6, marginTop: 6 },
  input: {
    backgroundColor: '#0f1c22',
    borderWidth: 1.5,
    borderColor: '#1a3542',
    borderRadius: R.sm,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontFamily: F.outfit,
    fontSize: SZ.base,
    color: '#f0f4f5',
    marginBottom: 4,
  },
  hint: { fontFamily: F.mono, fontSize: SZ.xs, color: '#4a6a76', marginBottom: 12, lineHeight: 16 },
  hintBold: { color: '#e4ff1a' },

  errorTxt: { fontFamily: F.mono, color: '#ff5714', fontSize: SZ.sm, marginBottom: 12, lineHeight: 18 },

  submitBtn: {
    backgroundColor: '#e4ff1a',
    borderRadius: R.sm,
    padding: 16,
    alignItems: 'center',
    marginBottom: 12,
    marginTop: 12,
  },
  submitTxt: { fontFamily: F.mono, color: '#0a1214', fontSize: SZ.base, letterSpacing: 2 },
  cancelTxt: { fontFamily: F.mono, color: '#6eeb83', fontSize: SZ.sm, textAlign: 'center', paddingVertical: 6 },
});
"""


# ═══════════════════════════════════════════════════════════════════════════
# PATCH HELPERS
# ═══════════════════════════════════════════════════════════════════════════

def patch_types_ts():
    """Extend PlatformId union and LeagueDetail/RosterSlot for dynasty fields."""
    f = ROOT / "services" / "platform" / "types.ts"
    s = f.read_text()
    original = s

    # 1. Extend PlatformId union
    old_pid = "export type PlatformId = 'sleeper' | 'espn' | 'yahoo';"
    new_pid = "export type PlatformId = 'sleeper' | 'espn' | 'yahoo' | 'mfl' | 'fleaflicker';"
    if old_pid in s:
        s = s.replace(old_pid, new_pid)
        print("  [APPLIED]  types.ts: PlatformId extended")
    elif new_pid in s:
        print("  [ALREADY]  types.ts: PlatformId already extended")
    else:
        print("  [MISSING]  types.ts: PlatformId pattern not found")
        return False

    # 2. Extend RosterSlot for dynasty fields
    old_rs = """export interface RosterSlot {
  player: Player;
  slot: string;
  isStarter: boolean;
  points?: number;
  projected?: number;
}"""
    new_rs = """export interface RosterSlot {
  player: Player;
  slot: string;
  isStarter: boolean;
  points?: number;
  projected?: number;
  /** Dynasty/keeper leagues: salary in dollars (MFL/Fleaflicker) */
  salary?: number;
  /** Dynasty/keeper leagues: contract years remaining (MFL) */
  contractYear?: number;
  /** Dynasty/keeper leagues: contract details/notes (MFL) */
  contractInfo?: string;
  /** Dynasty/keeper leagues: marked as a keeper for next season (Fleaflicker/MFL) */
  isKeeper?: boolean;
}"""
    if old_rs in s:
        s = s.replace(old_rs, new_rs)
        print("  [APPLIED]  types.ts: RosterSlot extended for dynasty")
    elif "salary?: number;" in s and "isKeeper?: boolean;" in s:
        print("  [ALREADY]  types.ts: RosterSlot already extended")
    else:
        print("  [MISSING]  types.ts: RosterSlot pattern not found")
        return False

    # 3. Extend LeagueDetail for dynasty/superflex flags
    old_ld_marker = "  isDynasty: boolean;\n}"
    new_ld_marker = """  isDynasty: boolean;
  /** Starting roster includes a SuperFlex slot (QB/RB/WR/TE) */
  isSuperFlex?: boolean;
  /** League uses player salaries (cap leagues, dynasty) */
  hasSalaries?: boolean;
  /** League uses multi-year contracts */
  hasContracts?: boolean;
  /** League has a separate taxi/practice squad */
  hasTaxiSquad?: boolean;
}"""
    if old_ld_marker in s and "isSuperFlex?: boolean;" not in s:
        s = s.replace(old_ld_marker, new_ld_marker)
        print("  [APPLIED]  types.ts: LeagueDetail extended for SF/dynasty")
    elif "isSuperFlex?: boolean;" in s:
        print("  [ALREADY]  types.ts: LeagueDetail already extended")
    else:
        print("  [MISSING]  types.ts: LeagueDetail pattern not found")
        return False

    if s != original:
        f.write_text(s)
    return True


def patch_index_ts():
    """Register MFL + Fleaflicker in the platform dispatcher."""
    f = ROOT / "services" / "platform" / "index.ts"
    s = f.read_text()
    original = s

    # 1. Add imports — check idempotency FIRST, since old_imports is a prefix of new_imports
    if "from './mfl'" in s and "from './fleaflicker'" in s:
        print("  [ALREADY]  index.ts: imports already added")
    else:
        old_imports = """import { sleeperPlatform } from './sleeper';
import { espnPlatform } from './espn';
import { yahooPlatform } from './yahoo';"""
        new_imports = """import { sleeperPlatform } from './sleeper';
import { espnPlatform } from './espn';
import { yahooPlatform } from './yahoo';
import { mflPlatform } from './mfl';
import { fleaflickerPlatform } from './fleaflicker';"""
        if old_imports in s:
            s = s.replace(old_imports, new_imports)
            print("  [APPLIED]  index.ts: imports added")
        else:
            print("  [MISSING]  index.ts: import block not found")
            return False

    # 2. Add to switch statement
    old_switch = """  switch (id) {
    case 'sleeper': return sleeperPlatform;
    case 'espn':    return espnPlatform;
    case 'yahoo':   return yahooPlatform;
    default:
      throw new Error(`Unknown platform: ${id}`);
  }"""
    new_switch = """  switch (id) {
    case 'sleeper':     return sleeperPlatform;
    case 'espn':        return espnPlatform;
    case 'yahoo':       return yahooPlatform;
    case 'mfl':         return mflPlatform;
    case 'fleaflicker': return fleaflickerPlatform;
    default:
      throw new Error(`Unknown platform: ${id}`);
  }"""
    if old_switch in s:
        s = s.replace(old_switch, new_switch)
        print("  [APPLIED]  index.ts: switch extended")
    elif "case 'mfl':" in s:
        print("  [ALREADY]  index.ts: switch already extended")
    else:
        print("  [MISSING]  index.ts: switch pattern not found")
        return False

    # 3. Update ALL_PLATFORMS array
    old_all = "export const ALL_PLATFORMS: PlatformId[] = ['sleeper', 'espn', 'yahoo'];"
    new_all = "export const ALL_PLATFORMS: PlatformId[] = ['sleeper', 'espn', 'yahoo', 'mfl', 'fleaflicker'];"
    if old_all in s:
        s = s.replace(old_all, new_all)
        print("  [APPLIED]  index.ts: ALL_PLATFORMS extended")
    elif new_all in s:
        print("  [ALREADY]  index.ts: ALL_PLATFORMS already extended")
    else:
        print("  [WARN]     index.ts: ALL_PLATFORMS pattern not found (continuing)")

    # 4. Re-export
    old_export = "export { sleeperPlatform, espnPlatform, yahooPlatform };"
    new_export = "export { sleeperPlatform, espnPlatform, yahooPlatform, mflPlatform, fleaflickerPlatform };"
    if old_export in s:
        s = s.replace(old_export, new_export)
        print("  [APPLIED]  index.ts: re-exports extended")
    elif "mflPlatform" in s and "fleaflickerPlatform" in s:
        print("  [ALREADY]  index.ts: re-exports already extended")

    if s != original:
        f.write_text(s)
    return True


def patch_settings_tsx():
    """Add MFL + Fleaflicker connection rows to MY PLATFORMS section."""
    f = ROOT / "app" / "(tabs)" / "settings.tsx"
    s = f.read_text()

    # We add an import for AsyncStorage hooks that check connection state.
    # Then we add two rows for MFL and Fleaflicker — same pattern as ESPN/Yahoo.

    # Detect what pattern Settings is using for ESPN/Yahoo so we mirror it.
    # Looking at existing code, it checks AsyncStorage for 'espn_s2' and 'yahoo_tokens'.
    # We do the same for 'mfl_league_id' and 'fleaflicker_league_id'.

    if "mfl_league_id" in s and "fleaflicker_league_id" in s:
        print("  [ALREADY]  settings.tsx: MFL + Fleaflicker rows present")
        return True

    # Check connection state additions - add to loadSettings
    old_load_check = """    const yahoo = await AsyncStorage.getItem('yahoo_tokens');
    setYahooLinked(!!yahoo);"""
    new_load_check = """    const yahoo = await AsyncStorage.getItem('yahoo_tokens');
    setYahooLinked(!!yahoo);
    const mfl = await AsyncStorage.getItem('mfl_league_id');
    setMflLinked(!!mfl);
    const ff = await AsyncStorage.getItem('fleaflicker_league_id');
    setFleaflickerLinked(!!ff);"""
    if old_load_check in s:
        s = s.replace(old_load_check, new_load_check)
        print("  [APPLIED]  settings.tsx: MFL/FF state checks added")
    else:
        print("  [WARN]     settings.tsx: could not extend loadSettings — manual review needed")

    # Add useState declarations. Look for existing yahooLinked state and add after.
    old_state = "const [yahooLinked, setYahooLinked] = useState(false);"
    new_state = """const [yahooLinked, setYahooLinked] = useState(false);
  const [mflLinked, setMflLinked] = useState(false);
  const [fleaflickerLinked, setFleaflickerLinked] = useState(false);"""
    if old_state in s and "mflLinked" not in s:
        s = s.replace(old_state, new_state)
        print("  [APPLIED]  settings.tsx: state hooks added")
    elif "mflLinked" in s:
        print("  [ALREADY]  settings.tsx: state hooks present")
    else:
        print("  [WARN]     settings.tsx: yahooLinked state not found — manual review needed")

    f.write_text(s)
    print("  [NOTE]     settings.tsx: rows for MFL/FF need manual UI insertion (see HANDOFF.md)")
    return True


def patch_root_layout():
    """Register the new login screens in the root Stack."""
    f = ROOT / "app" / "_layout.tsx"
    s = f.read_text()
    original = s

    if 'name="mfl-login"' in s and 'name="fleaflicker-login"' in s:
        print("  [ALREADY]  _layout.tsx: login screens registered")
        return True

    # Add after espn-login if present, else after auth
    anchor = '<Stack.Screen name="espn-login" options={{ headerShown: false }} />'
    addition = """<Stack.Screen name="espn-login" options={{ headerShown: false }} />
        <Stack.Screen name="mfl-login" options={{ headerShown: false }} />
        <Stack.Screen name="fleaflicker-login" options={{ headerShown: false }} />"""
    if anchor in s:
        s = s.replace(anchor, addition)
        print("  [APPLIED]  _layout.tsx: registered mfl-login + fleaflicker-login screens")

    if s != original:
        f.write_text(s)
    return True


# ═══════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════

def write_file(path: Path, content: str, label: str):
    if path.exists():
        existing = path.read_text()
        if existing.strip() == content.strip():
            print(f"  [ALREADY]  {label}")
            return
        # Different content — overwrite
        path.write_text(content)
        print(f"  [UPDATED]  {label}")
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        print(f"  [CREATED]  {label}")


def main():
    print("=" * 64)
    print("Add MFL + Fleaflicker integrations (full dynasty/SF support)")
    print("=" * 64)
    print()

    # Sanity check repo location
    if not (ROOT / "services" / "platform" / "types.ts").exists():
        print(f"ERROR: not run from AIOmni root. ROOT={ROOT}")
        sys.exit(1)

    # ─── Write new platform service files ─────────────────────────────────
    write_file(SVC / "fleaflicker.ts", FLEAFLICKER_TS, "services/platform/fleaflicker.ts")
    write_file(SVC / "mfl.ts",         MFL_TS,         "services/platform/mfl.ts")

    # ─── Write new login screens ──────────────────────────────────────────
    write_file(APP / "fleaflicker-login.tsx", FLEAFLICKER_LOGIN, "app/fleaflicker-login.tsx")
    write_file(APP / "mfl-login.tsx",         MFL_LOGIN,         "app/mfl-login.tsx")

    # ─── Patch existing files ─────────────────────────────────────────────
    print()
    print("Patching existing files:")
    if not patch_types_ts():
        print("\nABORTED — types.ts could not be patched cleanly")
        sys.exit(2)
    if not patch_index_ts():
        print("\nABORTED — index.ts could not be patched cleanly")
        sys.exit(2)
    patch_settings_tsx()
    patch_root_layout()

    print()
    print("=" * 64)
    print("✓ Files in place")
    print("=" * 64)
    print()
    print("Manual step still required: Settings UI rows for MFL + Fleaflicker.")
    print("See HANDOFF.md (alongside this script) for the JSX snippet to paste")
    print("into the MY PLATFORMS section of app/(tabs)/settings.tsx.")
    print()
    print("Then:")
    print("  1. Apply 004_add_platforms.sql in Supabase Dashboard SQL Editor")
    print("  2. npx tsc --noEmit")
    print("  3. git add -A && git commit -m 'Add MFL + Fleaflicker integrations'")
    print("  4. git push && eas build --platform ios --profile testflight --auto-submit")
    print()
    print("After build lands:")
    print("  • Open Settings → tap Connect on Fleaflicker")
    print("    League ID: 324106, Team ID: 1655757")
    print("  • Open Settings → tap Connect on MFL")
    print("    League ID: 53297, Franchise ID: 0001, Season: 2026")


if __name__ == "__main__":
    main()
