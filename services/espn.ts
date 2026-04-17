import AsyncStorage from '@react-native-async-storage/async-storage';

export const ESPN_BASE = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl';
export const ESPN_SEASON = new Date().getFullYear();

export interface ESPNCredentials {
  espnS2: string;
  swid: string;
  leagueId?: number;
  teamName?: string;
}

export async function saveESPNCredentials(creds: ESPNCredentials) {
  await AsyncStorage.setItem('espn_s2', creds.espnS2);
  await AsyncStorage.setItem('espn_swid', creds.swid);
}

export async function loadESPNCredentials(): Promise<ESPNCredentials | null> {
  const espnS2 = await AsyncStorage.getItem('espn_s2');
  const swid = await AsyncStorage.getItem('espn_swid');
  if (!espnS2 || !swid) return null;
  const leagueIdsStr = await AsyncStorage.getItem('espn_league_ids');
  const teamName = await AsyncStorage.getItem('espn_team_name');
  let leagueId: number | undefined;
  if (leagueIdsStr) {
    try {
      const ids = JSON.parse(leagueIdsStr);
      leagueId = Array.isArray(ids) ? ids[0] : parseInt(leagueIdsStr);
    } catch {
      leagueId = parseInt(leagueIdsStr);
    }
  }
  return { espnS2, swid, leagueId, teamName: teamName ?? undefined };
}

export async function clearESPNCredentials() {
  await AsyncStorage.multiRemove(['espn_s2', 'espn_swid', 'espn_league_ids']);
}

async function espnFetch(path: string, creds: ESPNCredentials): Promise<any> {
  const url = `${ESPN_BASE}${path}`;
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      Cookie: `espn_s2=${creds.espnS2}; SWID=${creds.swid}`,
    },
  });
  if (res.status === 401) throw new Error('ESPN auth failed — cookies expired');
  if (!res.ok) throw new Error(`ESPN API error ${res.status}`);
  return res.json();
}

export async function getESPNLeagues(creds: ESPNCredentials, year: number = 2025): Promise<any[]> {
  const data = await espnFetch(
    `/seasons/${year}/segments/0/leagues?view=mSettings`,
    creds
  );
  return data || [];
}

export async function getESPNLeague(leagueId: number, creds: ESPNCredentials, year: number = 2025): Promise<any> {
  return espnFetch(
    `/seasons/${year}/segments/0/leagues/${leagueId}?view=mSettings&view=mStatus&view=mTeam&view=mRoster`,
    creds
  );
}

export async function getESPNRoster(leagueId: number, creds: ESPNCredentials, year: number = 2025): Promise<any> {
  return espnFetch(
    `/seasons/${year}/segments/0/leagues/${leagueId}?view=mTeam&view=mRoster`,
    creds
  );
}

export function findMyESPNTeam(data: any, swid: string): any {
  const teams = data.teams || [];
  const normalizedSwid = swid.replace(/[{}]/g, '').toLowerCase();
  return teams.find((t: any) =>
    t.primaryOwner?.replace(/[{}]/g, '').toLowerCase() === normalizedSwid
  );
}

export const ESPN_SLOTS: Record<number, string> = {
  0: 'QB', 2: 'RB', 4: 'WR', 6: 'TE',
  16: 'D/ST', 17: 'K', 20: 'BN', 21: 'IR', 23: 'FLEX', 24: 'OP',
};

export const ESPN_POSITIONS: Record<number, string> = {
  1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DST',
};

export function isESPNStarter(slotId: number): boolean {
  return slotId !== 20 && slotId !== 21;
}

export function formatESPNPosition(defaultPositionId: number): string {
  return ESPN_POSITIONS[defaultPositionId] || '?';
}

export function formatESPNLeagueContext(data: any, myTeam: any): string {
  const settings = data.settings;
  const isPPR = settings?.scoringSettings?.scoringItems?.some(
    (item: any) => item.statId === 53 && item.points > 0
  );
  const record = myTeam?.record?.overall;
  const roster = myTeam?.roster || [];
  const starters = roster
    .filter((e: any) => isESPNStarter(e.lineupSlotId))
    .map((e: any) => {
      const p = e.playerPoolEntry?.player;
      return p ? `${p.fullName} (${formatESPNPosition(p.defaultPositionId)})` : null;
    })
    .filter(Boolean)
    .join(', ');

  return [
    `Platform: ESPN`,
    `League: ${settings?.name || data.id}`,
    `Scoring: ${isPPR ? 'PPR' : 'Standard'}`,
    `Teams: ${data.size}`,
    `Record: ${record?.wins ?? 0}-${record?.losses ?? 0}`,
    `Starters: ${starters}`,
  ].join('\n');
}

export async function getESPNStandings(leagueId: number, creds: any): Promise<any[]> {
  const data = await getESPNLeague(leagueId, creds);
  return (data?.teams ?? []).map((t: any) => ({ teamId: t.id, name: t.name ?? `Team ${t.id}`, wins: t.record?.overall?.wins ?? 0, losses: t.record?.overall?.losses ?? 0, ties: t.record?.overall?.ties ?? 0, pointsFor: t.record?.overall?.pointsFor ?? 0, pointsAgainst: t.record?.overall?.pointsAgainst ?? 0 }));
}
export async function getESPNMatchups(leagueId: number, creds: any): Promise<any> {
  const data = await getESPNLeague(leagueId, creds);
  return data?.schedule ?? null;
}
export async function getESPNTransactions(leagueId: number, creds: any): Promise<any[]> { return []; }
export async function getESPNAllRosters(leagueId: number, creds: any): Promise<any[]> { return []; }

// ─── FREE AGENTS ────────────────────────────────────────────
// Pulls unrostered players from an ESPN league using the kona_player_info view.
// The x-fantasy-filter header narrows to FA/WA status with a position filter.

export interface ESPNFreeAgent {
  id: string;
  name: string;
  position: string;
  team: string;
  injuryStatus?: string | null;
  percentOwned?: number;
  percentStarted?: number;
}

const ESPN_PRO_TEAMS: Record<number, string> = {
  1:'ATL',2:'BUF',3:'CHI',4:'CIN',5:'CLE',6:'DAL',7:'DEN',8:'DET',
  9:'GB',10:'TEN',11:'IND',12:'KC',13:'LV',14:'LAR',15:'MIA',16:'MIN',
  17:'NE',18:'NO',19:'NYG',20:'NYJ',21:'PHI',22:'ARI',23:'PIT',24:'LAC',
  25:'SF',26:'SEA',27:'TB',28:'WSH',29:'CAR',30:'JAX',33:'BAL',34:'HOU',
};

export async function getESPNFreeAgents(
  leagueId: number,
  creds: ESPNCredentials,
  limit: number = 150,
  year: number = ESPN_SEASON
): Promise<ESPNFreeAgent[]> {
  const filter = {
    players: {
      filterStatus: { value: ['FREEAGENT', 'WAIVERS'] },
      filterSlotIds: { value: [0, 2, 4, 6, 16, 17, 23] }, // QB/RB/WR/TE/DST/K/FLEX
      limit,
      sortPercOwned: { sortPriority: 1, sortAsc: false },
    },
  };

  try {
    const url = `${ESPN_BASE}/seasons/${year}/segments/0/leagues/${leagueId}?view=kona_player_info`;
    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        Cookie: `espn_s2=${creds.espnS2}; SWID=${creds.swid}`,
        'x-fantasy-filter': JSON.stringify(filter),
      },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const raw = data.players ?? [];
    return raw.map((entry: any) => {
      const p = entry.player ?? {};
      return {
        id: String(p.id ?? entry.id ?? ''),
        name: p.fullName ?? 'Unknown',
        position: ESPN_POSITIONS[p.defaultPositionId] ?? '?',
        team: ESPN_PRO_TEAMS[p.proTeamId] ?? 'FA',
        injuryStatus: p.injuryStatus && p.injuryStatus !== 'ACTIVE' ? p.injuryStatus : null,
        percentOwned: p.ownership?.percentOwned ?? 0,
        percentStarted: p.ownership?.percentStarted ?? 0,
      };
    });
  } catch (e) {
    console.log('getESPNFreeAgents error:', e);
    return [];
  }
}