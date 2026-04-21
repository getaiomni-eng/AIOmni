// services/platform/yahoo.ts
// Yahoo implementation of FantasyPlatform.
// Wraps services/yahoo.ts which handles the OAuth dance and token refresh.

import {
  clearYahooTokens,
  getMyYahooTeam,
  getMyYahooGuid,
  getValidYahooToken,
  getYahooFreeAgents,
  getYahooLeagues,
  getYahooStandings,
  getYahooMatchups,
  getYahooTransactions,
  getYahooAllRosters,
  loadYahooTokens,
  YAHOO_API_BASE,
  YahooLeague,
  YahooPlayer,
  YahooTeam,
} from '../yahoo';
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
  Player,
  Roster,
  RosterSlot,
  ScoringFormat,
  Standing,
  Transaction,
  WaiverType,
} from './types';

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

export function invalidateYahooCache(leagueId?: string): void {
  if (leagueId) {
    for (const key of hotCache.keys()) {
      if (key.includes(leagueId)) hotCache.delete(key);
    }
  } else {
    hotCache.clear();
  }
}

// ─── HELPERS ────────────────────────────────────────────────

async function yahooFetch(path: string): Promise<any> {
  const token = await getValidYahooToken();
  if (!token) throw new PlatformAuthError('yahoo');

  const sep = path.includes('?') ? '&' : '?';
  const url = `${YAHOO_API_BASE}${path}${sep}format=json`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    throw new PlatformAuthError('yahoo', 'Yahoo token expired — reconnect in Settings');
  }
  if (!res.ok) {
    throw new PlatformError(`Yahoo API ${res.status}: ${path}`, 'yahoo');
  }
  return res.json();
}

function normalizePlayer(p: YahooPlayer | any): Player {
  const name = p.name ?? {};
  return {
    id: p.player_key ?? p.player_id ?? '',
    platformId: 'yahoo',
    name: name.full ?? `${name.first ?? ''} ${name.last ?? ''}`.trim(),
    firstName: name.first ?? '',
    lastName: name.last ?? '',
    position: p.display_position ?? p.position ?? '?',
    team: p.editorial_team_abbr ?? p.team ?? 'FA',
    injuryStatus: p.status && p.status !== 'ACTIVE' ? p.status : null,
    photoUrl: p.image_url ?? p.headshot?.url,
  };
}

function mapScoringFormat(leagueMeta: any): ScoringFormat {
  // Yahoo's scoring_type: 'head' (head-to-head), 'points' (rotisserie points)
  // Can't easily detect PPR vs standard without fetching scoring settings per league.
  // Default to PPR as the most common and override per-league if needed.
  const stat_categories = leagueMeta?.stat_categories;
  if (stat_categories) {
    // TODO: parse stat_categories to detect rec scoring
  }
  return 'ppr';
}

function mapLeagueType(leagueMeta: any): LeagueType {
  // Yahoo: league.league_type = 'private' or 'public'. Keeper/dynasty is separate flag.
  const isKeeper = leagueMeta?.is_keeper === '1' || leagueMeta?.is_keeper === 1;
  const isProEagueOrPlus = leagueMeta?.felo_tier;  // Yahoo calls dynasty "commish leagues"
  const numKeepers = parseInt(leagueMeta?.num_keepers ?? '0', 10);
  if (numKeepers >= 15) return 'dynasty';
  if (isKeeper || numKeepers > 0) return 'keeper';
  return 'redraft';
}

function mapWaiverType(settings: any): WaiverType {
  if (settings?.uses_faab === '1') return 'faab';
  const waiverRule = settings?.waiver_rule;
  if (waiverRule === 'all' || waiverRule === 'gametime') return 'rolling';
  return 'unknown';
}

// ─── IMPLEMENTATION ─────────────────────────────────────────

class YahooPlatform implements FantasyPlatform {
  readonly platformId = 'yahoo' as const;

  async isAuthenticated(): Promise<boolean> {
    return (await this.getConnectionStatus()) === 'connected';
  }

  async getConnectionStatus(): Promise<ConnectionStatus> {
    const tokens = await loadYahooTokens();
    if (!tokens) return 'never_connected';

    // getValidYahooToken auto-refreshes. If it returns null, refresh failed.
    const token = await getValidYahooToken();
    return token ? 'connected' : 'expired';
  }

  async getMyUserId(): Promise<string | null> {
    const token = await getValidYahooToken();
    if (!token) return null;
    return getMyYahooGuid(token);
  }

  async getLeagues(season = '2025'): Promise<League[]> {
    const token = await getValidYahooToken();
    if (!token) throw new PlatformAuthError('yahoo');

    const cacheKey = `yahoo:leagues:${season}`;
    const cached = hotGet<League[]>(cacheKey);
    if (cached) return cached;

    const raw = await getYahooLeagues(token, season);

    const leagues: League[] = (raw || []).map((lg: any) => ({
      id: lg.league_key,
      platformId: 'yahoo',
      name: lg.name,
      season: String(lg.season ?? season),
      teamCount: parseInt(lg.num_teams ?? '12', 10),
      scoringFormat: mapScoringFormat(lg),
      leagueType: mapLeagueType(lg),
      currentWeek: parseInt(lg.current_week ?? '1', 10),
    }));

    hotSet(cacheKey, leagues);
    return leagues;
  }

  async getLeague(leagueKey: string): Promise<LeagueDetail> {
    const cacheKey = `yahoo:league:${leagueKey}`;
    const cached = hotGet<LeagueDetail>(cacheKey);
    if (cached) return cached;

    const data = await yahooFetch(`/league/${leagueKey}/settings`);
    const leagueMeta = data?.fantasy_content?.league?.[0] ?? {};
    const settings = data?.fantasy_content?.league?.[1]?.settings?.[0] ?? {};

    const waiverType = mapWaiverType(settings);
    const faabBudget = waiverType === 'faab'
      ? parseInt(settings.faab_budget ?? '100', 10)
      : undefined;

    // FAAB remaining — need to fetch my team
    let faabRemaining: number | undefined = faabBudget;
    if (faabBudget !== undefined) {
      try {
        const teamData = await yahooFetch(`/team/${leagueKey}.t.1`); // placeholder — we'll fix below
        // Actually, we need my team key. Use getMyYahooTeam.
        const token = await getValidYahooToken();
        if (token) {
          const result = await getMyYahooTeam(leagueKey, token);
          const teamArr = (result?.team as any);
          const balanceEntry = Array.isArray(teamArr?.[0])
            ? teamArr[0].find((x: any) => x?.faab_balance)
            : null;
          if (balanceEntry?.faab_balance) {
            faabRemaining = parseInt(balanceEntry.faab_balance, 10);
          }
        }
      } catch {}
    }

    // Roster slots
    const rosterPositions = settings?.roster_positions ?? [];
    const rosterSlots: string[] = [];
    for (const rp of rosterPositions) {
      const pos = rp?.roster_position;
      if (!pos) continue;
      const count = parseInt(pos.count ?? '1', 10);
      for (let i = 0; i < count; i++) rosterSlots.push(pos.position);
    }

    const detail: LeagueDetail = {
      id: leagueKey,
      platformId: 'yahoo',
      name: leagueMeta.name ?? 'Yahoo League',
      season: String(leagueMeta.season ?? '2025'),
      teamCount: parseInt(leagueMeta.num_teams ?? '12', 10),
      scoringFormat: mapScoringFormat(leagueMeta),
      leagueType: mapLeagueType(leagueMeta),
      currentWeek: parseInt(leagueMeta.current_week ?? '1', 10),
      rosterSlots,
      waiverType,
      faabBudget,
      faabRemaining,
      isDynasty: mapLeagueType(leagueMeta) === 'dynasty',
    };

    hotSet(cacheKey, detail);
    return detail;
  }

  async getMyRoster(leagueKey: string): Promise<Roster | null> {
    const token = await getValidYahooToken();
    if (!token) throw new PlatformAuthError('yahoo');

    const result = await getMyYahooTeam(leagueKey, token);
    if (!result) return null;

    const { team, roster } = result;
    const teamArr = team as any;
    const teamName = Array.isArray(teamArr[0])
      ? teamArr[0].find((x: any) => x?.name)?.name ?? 'My Team'
      : 'My Team';
    const standings = teamArr[2]?.team_standings ?? {};
    const outcome = standings.outcome_totals ?? {};
    const teamKey = Array.isArray(teamArr[0])
      ? teamArr[0].find((x: any) => x?.team_key)?.team_key ?? ''
      : '';
    const myGuid = await getMyYahooGuid(token);

    const toSlot = (p: YahooPlayer): RosterSlot => ({
      player: normalizePlayer(p),
      slot: p.selected_position?.position ?? 'BN',
      isStarter: p.selected_position?.position !== 'BN' && p.selected_position?.position !== 'IR',
    });

    return {
      userId: myGuid ?? '',
      rosterId: teamKey,
      teamName,
      record: {
        wins: parseInt(outcome.wins ?? '0', 10),
        losses: parseInt(outcome.losses ?? '0', 10),
        ties: parseInt(outcome.ties ?? '0', 10),
      },
      pointsFor: parseFloat(standings.points_for ?? '0'),
      pointsAgainst: parseFloat(standings.points_against ?? '0'),
      starters: roster.starters.map(toSlot),
      bench: roster.bench.filter(p => p.selected_position?.position === 'BN').map(toSlot),
      ir: roster.bench.filter(p => p.selected_position?.position === 'IR').map(toSlot),
      isMe: true,
    };
  }

  async getAllRosters(leagueKey: string): Promise<Roster[]> {
    const token = await getValidYahooToken();
    if (!token) throw new PlatformAuthError('yahoo');

    const cacheKey = `yahoo:rosters:${leagueKey}`;
    const cached = hotGet<Roster[]>(cacheKey);
    if (cached) return cached;

    const [raw, myGuid] = await Promise.all([
      getYahooAllRosters(leagueKey, token),
      getMyYahooGuid(token),
    ]);

    const rosters: Roster[] = (raw || []).map((r: any) => {
      const starters: RosterSlot[] = (r.players || [])
        .filter((p: any) => p.isStarter)
        .map((p: any) => ({
          player: normalizePlayer({ player_key: p.id, name: { full: p.name }, display_position: p.position, editorial_team_abbr: p.team }),
          slot: p.position,
          isStarter: true,
        }));
      const bench: RosterSlot[] = (r.players || [])
        .filter((p: any) => !p.isStarter)
        .map((p: any) => ({
          player: normalizePlayer({ player_key: p.id, name: { full: p.name }, display_position: p.position, editorial_team_abbr: p.team }),
          slot: 'BN',
          isStarter: false,
        }));

      return {
        userId: '',  // Yahoo doesn't expose owner GUID via this endpoint
        rosterId: r.rosterId,
        teamName: r.username,
        record: { wins: 0, losses: 0, ties: 0 },
        pointsFor: 0,
        pointsAgainst: 0,
        starters,
        bench,
        ir: [],
        isMe: false,  // Yahoo all-rosters endpoint doesn't flag ownership; use getMyRoster for that
      };
    });

    hotSet(cacheKey, rosters);
    return rosters;
  }

  async getAvailablePlayers(
    leagueKey: string,
    opts: { limit?: number } = {}
  ): Promise<AvailablePlayer[]> {
    const limit = opts.limit ?? 150;
    const token = await getValidYahooToken();
    if (!token) throw new PlatformAuthError('yahoo');

    const cacheKey = `yahoo:available:${leagueKey}:${limit}`;
    const cached = hotGet<AvailablePlayer[]>(cacheKey);
    if (cached) return cached;

    // Yahoo requires per-position queries. Pull 25 per position.
    const positions = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
    const perPos = Math.ceil(limit / positions.length);

    const batches = await Promise.all(
      positions.map(pos => getYahooFreeAgents(leagueKey, pos, token, 0, perPos).catch(() => []))
    );

    const results: AvailablePlayer[] = [];
    for (const batch of batches) {
      for (const p of batch as YahooPlayer[]) {
        // Yahoo exposes ownership via separate percent_owned call — for batch performance,
        // leave undefined. getHeatSignals() pulls it when needed.
        const signals: HeatSignals = {};
        results.push({
          ...normalizePlayer(p),
          heatSignals: signals,
        });
      }
    }

    hotSet(cacheKey, results);
    return results;
  }

  async getHeatSignals(leagueKey: string, playerKey: string): Promise<HeatSignals> {
    // Yahoo exposes percent_owned via a player details call
    try {
      const data = await yahooFetch(`/league/${leagueKey}/players;player_keys=${playerKey}/percent_owned`);
      const players = data?.fantasy_content?.league?.[1]?.players;
      const player = players?.['0']?.player;
      if (!player) return {};

      const ownership = player[1]?.percent_owned;
      if (!ownership) return {};

      return {
        percentOwned: parseFloat(ownership.value ?? '0'),
        ownershipDelta7d: parseFloat(ownership.delta ?? '0'),
      };
    } catch {
      return {};
    }
  }

  async searchPlayers(query: string, opts: { limit?: number } = {}): Promise<Player[]> {
    const limit = opts.limit ?? 25;
    if (!query || query.trim().length < 2) return [];

    const token = await getValidYahooToken();
    if (!token) return [];

    try {
      // Yahoo's player search: /game/nfl/players;search={query}
      const data = await yahooFetch(`/game/nfl/players;search=${encodeURIComponent(query.trim())};count=${limit}`);
      const players = data?.fantasy_content?.game?.[1]?.players;
      if (!players) return [];

      const results: Player[] = [];
      const count = players.count ?? 0;
      for (let i = 0; i < count && results.length < limit; i++) {
        const playerArr = players[i]?.player?.[0];
        if (!playerArr) continue;
        // Yahoo player arrays are annoying flat arrays of single-key objects. Reconstitute.
        const p: any = {};
        for (const entry of playerArr) Object.assign(p, entry);
        results.push(normalizePlayer(p));
      }
      return results;
    } catch {
      return [];
    }
  }

  async getStandings(leagueKey: string): Promise<Standing[]> {
    const token = await getValidYahooToken();
    if (!token) throw new PlatformAuthError('yahoo');

    const raw = await getYahooStandings(leagueKey, token);
    const myGuid = await getMyYahooGuid(token);

    return (raw || []).map((r: any, i: number) => ({
      rosterId: r.teamKey,
      teamName: r.name,
      rank: i + 1,
      record: { wins: r.wins, losses: r.losses, ties: r.ties },
      pointsFor: r.pointsFor,
      pointsAgainst: r.pointsAgainst,
      streak: r.streak,
      isMe: false, // Yahoo standings endpoint doesn't return GUIDs per team
    }));
  }

  async getMatchups(leagueKey: string, week?: number): Promise<Matchup[]> {
    const token = await getValidYahooToken();
    if (!token) throw new PlatformAuthError('yahoo');

    const league = await this.getLeague(leagueKey);
    const targetWeek = week ?? league.currentWeek ?? 1;

    const cacheKey = `yahoo:matchups:${leagueKey}:${targetWeek}`;
    const cached = hotGet<Matchup[]>(cacheKey);
    if (cached) return cached;

    const raw = await getYahooMatchups(leagueKey, token);
    const allMatchups = raw?.allMatchups ?? [];

    const result: Matchup[] = [];
    for (const m of allMatchups) {
      const matchup = Array.isArray(m) ? m[0] : m;
      const teams = matchup?.['0']?.teams;
      if (!teams) continue;

      const sides: MatchupSide[] = [];
      for (let i = 0; i < 2; i++) {
        const t = teams[String(i)]?.team;
        if (!t) continue;
        const teamInfo = Array.isArray(t[0]) ? t[0] : [];
        const teamKey = teamInfo.find((x: any) => x?.team_key)?.team_key ?? '';
        const teamName = teamInfo.find((x: any) => x?.name)?.name ?? 'Team';
        const points = parseFloat(t[1]?.team_points?.total ?? '0');
        sides.push({
          rosterId: teamKey,
          teamName,
          points,
          isMe: false,
        });
      }

      if (sides.length === 2) {
        result.push({
          week: targetWeek,
          matchupId: String(matchup.matchup_id ?? result.length),
          home: sides[0],
          away: sides[1],
        });
      }
    }

    hotSet(cacheKey, result);
    return result;
  }

  async getDraft(leagueKey: string): Promise<DraftInfo | null> {
    // Yahoo's draft API is sparse. We return minimal info.
    const league = await this.getLeague(leagueKey).catch(() => null);
    if (!league) return null;

    return {
      id: `${leagueKey}.draft`,
      platformId: 'yahoo',
      leagueId: leagueKey,
      type: 'snake',  // Yahoo default; auction detectable from settings if needed
      status: 'complete',  // Yahoo doesn't expose live draft state via public API
      rounds: league.rosterSlots.length,
      teamCount: league.teamCount,
    };
  }

  async getDraftPicks(draftId: string): Promise<DraftPick[]> {
    const leagueKey = draftId.replace(/\.draft$/, '');

    try {
      const data = await yahooFetch(`/league/${leagueKey}/draftresults`);
      const results = data?.fantasy_content?.league?.[1]?.draft_results;
      if (!results) return [];

      const picks: DraftPick[] = [];
      const count = results.count ?? 0;

      for (let i = 0; i < count; i++) {
        const dr = results[String(i)]?.draft_result;
        if (!dr) continue;

        picks.push({
          pickNo: parseInt(dr.pick, 10),
          round: parseInt(dr.round, 10),
          slot: parseInt(dr.pick, 10) % 12 || 12,  // approximate
          rosterId: dr.team_key,
          playerId: dr.player_key,
          playerName: dr.player_key,  // Yahoo doesn't include names here; we'd need a second call
          position: '?',
          team: 'FA',
          isMyPick: false,
        });
      }

      return picks;
    } catch {
      return [];
    }
  }

  async getTransactions(leagueKey: string, limit = 25): Promise<Transaction[]> {
    const token = await getValidYahooToken();
    if (!token) return [];

    const raw = await getYahooTransactions(leagueKey, token);
    return (raw || []).slice(0, limit).map((tx: any): Transaction => ({
      id: String(tx.time ?? Math.random()),
      type: tx.type === 'trade' ? 'trade' : tx.type === 'drop' ? 'drop' : 'add',
      timestamp: tx.time ?? 0,
      adds: (tx.adds || []).map((name: string) => ({
        player: {
          id: name, platformId: 'yahoo', name, firstName: '', lastName: name,
          position: '?', team: 'FA',
        },
        toRosterId: '',
      })),
      drops: (tx.drops || []).map((name: string) => ({
        player: {
          id: name, platformId: 'yahoo', name, firstName: '', lastName: name,
          position: '?', team: 'FA',
        },
        fromRosterId: '',
      })),
      status: 'complete',
    }));
  }
}

export const yahooPlatform = new YahooPlatform();
