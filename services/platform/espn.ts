// services/platform/espn.ts
// ESPN implementation of FantasyPlatform.
// Thin wrapper around services/espn.ts — all ESPN-specific cookie auth and
// API shape lives there. This file just conforms the results to our contract.

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ESPNCredentials,
  ESPN_POSITIONS,
  getESPNFreeAgents,
  getESPNLeague,
  getESPNLeagues,
  loadESPNCredentials,
  ESPN_SEASON,
} from '../espn';
import {
  AvailablePlayer,
  ConnectionStatus,
  DraftInfo,
  DraftPick,
  FantasyPlatform,
  HeatSignals,
  League,
  LeagueDetail,
  LeagueType,
  Matchup,
  MatchupSide,
  PlatformAuthError,
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

// ─── CONSTANTS ──────────────────────────────────────────────

const ESPN_BASE = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl';
const ESPN_PRO_TEAMS: Record<number, string> = {
  1:'ATL',2:'BUF',3:'CHI',4:'CIN',5:'CLE',6:'DAL',7:'DEN',8:'DET',
  9:'GB',10:'TEN',11:'IND',12:'KC',13:'LV',14:'LAR',15:'MIA',16:'MIN',
  17:'NE',18:'NO',19:'NYG',20:'NYJ',21:'PHI',22:'ARI',23:'PIT',24:'LAC',
  25:'SF',26:'SEA',27:'TB',28:'WSH',29:'CAR',30:'JAX',33:'BAL',34:'HOU',
};

// ESPN lineupSlotId → position name
const ESPN_SLOTS: Record<number, string> = {
  0: 'QB', 2: 'RB', 4: 'WR', 6: 'TE',
  16: 'DEF', 17: 'K', 20: 'BN', 21: 'IR', 23: 'FLEX', 24: 'OP',
};

// ─── HOT CACHE ──────────────────────────────────────────────

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

export function invalidateESPNCache(leagueId?: string): void {
  if (leagueId) {
    for (const key of hotCache.keys()) {
      if (key.includes(leagueId)) hotCache.delete(key);
    }
  } else {
    hotCache.clear();
  }
}

// ─── HELPERS ────────────────────────────────────────────────

async function espnFetch(path: string, creds: ESPNCredentials): Promise<any> {
  const url = `${ESPN_BASE}${path}`;
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      Cookie: `espn_s2=${creds.espnS2}; SWID=${creds.swid}`,
    },
  });
  if (res.status === 401) {
    throw new PlatformAuthError('espn', 'ESPN session expired — reconnect in Settings');
  }
  if (!res.ok) {
    throw new PlatformError(`ESPN API ${res.status}: ${path}`, 'espn');
  }
  return res.json();
}

function normalizeSwid(swid: string): string {
  return swid.replace(/[{}]/g, '').toLowerCase();
}

function normalizePlayer(raw: any): Player {
  const p = raw.player ?? raw;
  return {
    id: String(p.id),
    platformId: 'espn',
    name: p.fullName ?? `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim(),
    firstName: p.firstName ?? '',
    lastName: p.lastName ?? '',
    position: ESPN_POSITIONS[p.defaultPositionId] ?? '?',
    team: ESPN_PRO_TEAMS[p.proTeamId] ?? 'FA',
    injuryStatus: p.injuryStatus && p.injuryStatus !== 'ACTIVE' ? p.injuryStatus : null,
    photoUrl: `https://a.espncdn.com/i/headshots/nfl/players/full/${p.id}.png`,
  };
}

function mapScoringFormat(settings: any): ScoringFormat {
  const items = settings?.scoringSettings?.scoringItems ?? [];
  const recItem = items.find((i: any) => i.statId === 53);
  if (!recItem) return 'standard';
  if (recItem.points === 1) return 'ppr';
  if (recItem.points === 0.5) return 'half';
  return 'standard';
}

function mapLeagueType(settings: any): LeagueType {
  // ESPN: no explicit dynasty flag. Detect via keeper count + draft type.
  const keeperCount = settings?.draftSettings?.keeperCount ?? 0;
  const draftType = settings?.draftSettings?.type;
  if (draftType === 'OFFLINE' && keeperCount >= 15) return 'dynasty';
  if (keeperCount > 0 && keeperCount < 15) return 'keeper';
  return 'redraft';
}

function mapWaiverType(settings: any): WaiverType {
  // ESPN waiverMode: 0=waivers, 1=FA, 7 likely custom
  // Use acquisitionBudget flag — if set, FAAB
  const isFAAB = settings?.acquisitionSettings?.isUsingAcquisitionBudget === true;
  if (isFAAB) return 'faab';
  const waiverOrderReset = settings?.acquisitionSettings?.waiverOrderReset;
  if (waiverOrderReset === 'NEVER') return 'reverse_standings';
  if (waiverOrderReset) return 'rolling';
  return 'unknown';
}

// ─── IMPLEMENTATION ─────────────────────────────────────────

class ESPNPlatform implements FantasyPlatform {
  readonly platformId = 'espn' as const;

  async isAuthenticated(): Promise<boolean> {
    return (await this.getConnectionStatus()) === 'connected';
  }

  async getConnectionStatus(): Promise<ConnectionStatus> {
    const creds = await loadESPNCredentials();
    if (!creds) return 'never_connected';

    // Validate by hitting an endpoint that requires auth
    try {
      await espnFetch(`/seasons/${new Date().getFullYear()}/segments/0/leagues?view=mSettings`, creds);
      return 'connected';
    } catch (e) {
      if (e instanceof PlatformAuthError) return 'expired';
      // Network error or other — treat as expired conservatively
      return 'expired';
    }
  }

  async getMyUserId(): Promise<string | null> {
    // ESPN identifies users by SWID cookie, not a user ID
    const creds = await loadESPNCredentials();
    return creds ? normalizeSwid(creds.swid) : null;
  }

  async getLeagues(season = String(new Date().getFullYear())): Promise<League[]> {
    const creds = await loadESPNCredentials();
    if (!creds) throw new PlatformAuthError('espn');

    const cacheKey = `espn:leagues:${creds.swid}:${season}`;
    const cached = hotGet<League[]>(cacheKey);
    if (cached) return cached;

    const raw = await getESPNLeagues(creds, parseInt(season, 10));

    const leagues: League[] = (raw || []).map((lg: any) => ({
      id: String(lg.id),
      platformId: 'espn',
      name: lg.settings?.name ?? `League ${lg.id}`,
      season: String(season),
      teamCount: lg.size ?? 12,
      scoringFormat: mapScoringFormat(lg.settings),
      leagueType: mapLeagueType(lg.settings),
      currentWeek: lg.status?.currentMatchupPeriod,
    }));

    hotSet(cacheKey, leagues);
    return leagues;
  }

  async getLeague(leagueId: string): Promise<LeagueDetail> {
    const creds = await loadESPNCredentials();
    if (!creds) throw new PlatformAuthError('espn');

    const cacheKey = `espn:league:${leagueId}`;
    const cached = hotGet<LeagueDetail>(cacheKey);
    if (cached) return cached;

    const raw = await getESPNLeague(parseInt(leagueId, 10), creds);
    if (!raw) throw new PlatformError(`ESPN league ${leagueId} not found`, 'espn');

    const settings = raw.settings ?? {};
    const waiverType = mapWaiverType(settings);
    const faabBudget = waiverType === 'faab'
      ? settings?.acquisitionSettings?.acquisitionBudget
      : undefined;

    // FAAB remaining requires finding my team
    let faabRemaining: number | undefined;
    if (faabBudget !== undefined) {
      const swid = normalizeSwid(creds.swid);
      const myTeam = (raw.teams ?? []).find((t: any) =>
        normalizeSwid(t.primaryOwner ?? '') === swid
      );
      const spent = myTeam?.transactionCounter?.acquisitionBudgetSpent ?? 0;
      faabRemaining = faabBudget - spent;
    }

    // Map lineupSlotCounts to roster_positions array
    const lineupCounts = settings?.rosterSettings?.lineupSlotCounts ?? {};
    const rosterSlots: string[] = [];
    for (const [slotId, count] of Object.entries(lineupCounts)) {
      const slotName = ESPN_SLOTS[parseInt(slotId, 10)] ?? 'FLEX';
      for (let i = 0; i < (count as number); i++) rosterSlots.push(slotName);
    }

    const detail: LeagueDetail = {
      id: String(raw.id),
      platformId: 'espn',
      name: settings.name ?? `League ${raw.id}`,
      season: String(raw.seasonId ?? new Date().getFullYear()),
      teamCount: raw.size ?? 12,
      scoringFormat: mapScoringFormat(settings),
      leagueType: mapLeagueType(settings),
      currentWeek: raw.status?.currentMatchupPeriod,
      rosterSlots,
      waiverType,
      faabBudget,
      faabRemaining,
      scoringSettings: settings.scoringSettings,
      isDynasty: mapLeagueType(settings) === 'dynasty',
    };

    hotSet(cacheKey, detail);
    return detail;
  }

  async getMyRoster(leagueId: string): Promise<Roster | null> {
    const all = await this.getAllRosters(leagueId);
    return all.find(r => r.isMe) || null;
  }

  async getAllRosters(leagueId: string): Promise<Roster[]> {
    const creds = await loadESPNCredentials();
    if (!creds) throw new PlatformAuthError('espn');

    const cacheKey = `espn:rosters:${leagueId}`;
    const cached = hotGet<Roster[]>(cacheKey);
    if (cached) return cached;

    const raw = await espnFetch(
      `/seasons/${ESPN_SEASON}/segments/0/leagues/${leagueId}?view=mTeam&view=mRoster`,
      creds
    );

    const mySwid = normalizeSwid(creds.swid);

    const rosters: Roster[] = (raw.teams ?? []).map((t: any) => {
      const entries = t.roster?.entries ?? [];

      const toSlot = (e: any): RosterSlot => ({
        player: normalizePlayer(e.playerPoolEntry),
        slot: ESPN_SLOTS[e.lineupSlotId] ?? 'FLEX',
        isStarter: e.lineupSlotId !== 20 && e.lineupSlotId !== 21,
      });

      const slots: RosterSlot[] = entries.map(toSlot);
      const starters = slots.filter(s => s.isStarter && s.slot !== 'IR');
      const bench = slots.filter(s => s.slot === 'BN');
      const ir = slots.filter(s => s.slot === 'IR');

      const record = t.record?.overall ?? { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 };
      const teamName = `${t.location ?? ''} ${t.nickname ?? ''}`.trim() || `Team ${t.id}`;

      return {
        userId: normalizeSwid(t.primaryOwner ?? ''),
        rosterId: String(t.id),
        teamName,
        record: {
          wins: record.wins ?? 0,
          losses: record.losses ?? 0,
          ties: record.ties ?? 0,
        },
        pointsFor: record.pointsFor ?? 0,
        pointsAgainst: record.pointsAgainst ?? 0,
        starters,
        bench,
        ir,
        isMe: normalizeSwid(t.primaryOwner ?? '') === mySwid,
      };
    });

    hotSet(cacheKey, rosters);
    return rosters;
  }

  async getAvailablePlayers(
    leagueId: string,
    opts: { limit?: number } = {}
  ): Promise<AvailablePlayer[]> {
    const limit = opts.limit ?? 150;
    const creds = await loadESPNCredentials();
    if (!creds) throw new PlatformAuthError('espn');

    const cacheKey = `espn:available:${leagueId}:${limit}`;
    const cached = hotGet<AvailablePlayer[]>(cacheKey);
    if (cached) return cached;

    const fas = await getESPNFreeAgents(parseInt(leagueId, 10), creds, limit);

    const results: AvailablePlayer[] = fas.map(fa => {
      const [first, ...rest] = (fa.name || '').split(' ');
      const signals: HeatSignals = {
        percentOwned: fa.percentOwned,
        percentStarted: fa.percentStarted,
      };
      return {
        id: fa.id,
        platformId: 'espn',
        name: fa.name,
        firstName: first ?? '',
        lastName: rest.join(' '),
        position: fa.position,
        team: fa.team,
        injuryStatus: fa.injuryStatus,
        photoUrl: `https://a.espncdn.com/i/headshots/nfl/players/full/${fa.id}.png`,
        percentOwned: fa.percentOwned,
        percentStarted: fa.percentStarted,
        heatSignals: signals,
      };
    });

    hotSet(cacheKey, results);
    return results;
  }

  async getHeatSignals(leagueId: string, playerId: string): Promise<HeatSignals> {
    // ESPN doesn't expose per-player ownership history cheaply.
    // For now, pull from the current free agent list if the player is there.
    try {
      const available = await this.getAvailablePlayers(leagueId);
      const p = available.find(x => x.id === playerId);
      if (p?.heatSignals) return p.heatSignals;
    } catch {}
    return {};
  }

  async searchPlayers(query: string, opts: { limit?: number } = {}): Promise<Player[]> {
    const limit = opts.limit ?? 25;
    if (!query || query.trim().length < 2) return [];

    const creds = await loadESPNCredentials();
    if (!creds) return [];

    // ESPN's kona_player_info view supports name filtering via x-fantasy-filter
    try {
      const filter = {
        players: {
          filterName: { value: query.trim() },
          limit,
        },
      };
      const res = await fetch(
        `${ESPN_BASE}/seasons/${ESPN_SEASON}/players?view=players_wl`,
        {
          headers: {
            'Content-Type': 'application/json',
            Cookie: `espn_s2=${creds.espnS2}; SWID=${creds.swid}`,
            'x-fantasy-filter': JSON.stringify(filter),
          },
        }
      );
      if (!res.ok) return [];
      const data = await res.json();
      return (Array.isArray(data) ? data : data.players ?? [])
        .slice(0, limit)
        .map((p: any) => normalizePlayer({ player: p }));
    } catch {
      return [];
    }
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
    const creds = await loadESPNCredentials();
    if (!creds) throw new PlatformAuthError('espn');

    const league = await this.getLeague(leagueId);
    const targetWeek = week ?? league.currentWeek ?? 1;

    const cacheKey = `espn:matchups:${leagueId}:${targetWeek}`;
    const cached = hotGet<Matchup[]>(cacheKey);
    if (cached) return cached;

    const raw = await espnFetch(
      `/seasons/${ESPN_SEASON}/segments/0/leagues/${leagueId}?view=mMatchup&view=mMatchupScore`,
      creds
    );

    const rosters = await this.getAllRosters(leagueId);
    const rosterById = new Map(rosters.map(r => [r.rosterId, r]));

    const schedule = raw.schedule ?? [];
    const weekGames = schedule.filter((g: any) => g.matchupPeriodId === targetWeek);

    const result: Matchup[] = weekGames.map((g: any) => {
      const makeSide = (side: any): MatchupSide => {
        const r = rosterById.get(String(side.teamId));
        return {
          rosterId: String(side.teamId),
          teamName: r?.teamName ?? `Team ${side.teamId}`,
          points: side.totalPoints ?? 0,
          projected: side.totalProjectedPointsLive,
          isMe: r?.isMe ?? false,
        };
      };
      return {
        week: targetWeek,
        matchupId: String(g.id),
        home: makeSide(g.home),
        away: makeSide(g.away),
      };
    });

    hotSet(cacheKey, result);
    return result;
  }

  async getDraft(leagueId: string): Promise<DraftInfo | null> {
    const creds = await loadESPNCredentials();
    if (!creds) return null;

    try {
      const raw = await espnFetch(
        `/seasons/${ESPN_SEASON}/segments/0/leagues/${leagueId}?view=mDraftDetail&view=mSettings`,
        creds
      );
      const draft = raw.draftDetail;
      if (!draft) return null;

      const settings = raw.settings ?? {};
      const draftSettings = settings.draftSettings ?? {};

      // My draft slot — find the team I own, then use its draft position
      const mySwid = normalizeSwid(creds.swid);
      const myTeam = (raw.teams ?? []).find((t: any) =>
        normalizeSwid(t.primaryOwner ?? '') === mySwid
      );
      const myDraftSlot = myTeam?.draftDayProjectedRank;

      return {
        id: String(raw.id),  // ESPN uses the league ID for the draft
        platformId: 'espn',
        leagueId,
        type: draftSettings.type === 'AUCTION' ? 'auction' : 'snake',
        status: draft.drafted ? 'complete' : 'pre_draft',
        rounds: settings.rosterSettings?.rosterSlotCounts ? Object.values(settings.rosterSettings.rosterSlotCounts).reduce((a: number, b: any) => a + (b as number), 0) : 16,
        teamCount: raw.size ?? 12,
        myDraftSlot,
        pickTimer: draftSettings.timePerSelection ?? 0,
      };
    } catch {
      return null;
    }
  }

  async getDraftPicks(draftId: string): Promise<DraftPick[]> {
    const creds = await loadESPNCredentials();
    if (!creds) throw new PlatformAuthError('espn');

    // ESPN uses league ID as draft ID
    const raw = await espnFetch(
      `/seasons/${ESPN_SEASON}/segments/0/leagues/${draftId}?view=mDraftDetail`,
      creds
    );

    const picks = raw.draftDetail?.picks ?? [];
    const mySwid = normalizeSwid(creds.swid);
    const teamById = new Map<number, any>();
    for (const t of raw.teams ?? []) teamById.set(t.id, t);

    return picks.map((p: any): DraftPick => {
      const team = teamById.get(p.teamId);
      const isMyPick = team && normalizeSwid(team.primaryOwner ?? '') === mySwid;
      return {
        pickNo: p.overallPickNumber,
        round: p.roundId,
        slot: p.roundPickNumber,
        rosterId: String(p.teamId),
        playerId: String(p.playerId),
        playerName: p.playerName ?? String(p.playerId),
        position: ESPN_POSITIONS[p.playerDefaultPositionId] ?? '?',
        team: ESPN_PRO_TEAMS[p.playerProTeamId] ?? 'FA',
        isMyPick: !!isMyPick,
      };
    });
  }

  async getTransactions(leagueId: string, limit = 25): Promise<Transaction[]> {
    const creds = await loadESPNCredentials();
    if (!creds) throw new PlatformAuthError('espn');

    try {
      const raw = await espnFetch(
        `/seasons/${ESPN_SEASON}/segments/0/leagues/${leagueId}?view=mTransactions2`,
        creds
      );

      const txs = raw.transactions ?? [];
      const results: Transaction[] = [];

      for (const tx of txs.slice(0, limit)) {
        const adds: Transaction['adds'] = [];
        const drops: Transaction['drops'] = [];

        for (const item of tx.items ?? []) {
          if (!item.playerId) continue;
          const playerStub: Player = {
            id: String(item.playerId),
            platformId: 'espn',
            name: `Player ${item.playerId}`,
            firstName: '',
            lastName: '',
            position: '?',
            team: 'FA',
          };
          if (item.type === 'ADD') {
            adds.push({ player: playerStub, toRosterId: String(item.toTeamId) });
          } else if (item.type === 'DROP') {
            drops.push({ player: playerStub, fromRosterId: String(item.fromTeamId) });
          }
        }

        results.push({
          id: String(tx.id),
          type: tx.type === 'TRADE_ACCEPT' ? 'trade' : tx.type === 'WAIVER' ? 'waiver' : 'add',
          timestamp: tx.processDate ?? 0,
          adds,
          drops,
          faabBid: tx.bidAmount,
          status: tx.status === 'EXECUTED' ? 'complete' : tx.status === 'CANCELED' ? 'failed' : 'pending',
        });
      }

      return results;
    } catch {
      return [];
    }
  }
}

export const espnPlatform = new ESPNPlatform();
