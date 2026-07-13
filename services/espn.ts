import AsyncStorage from '@react-native-async-storage/async-storage';
import { setSecure, getSecure, deleteSecure, migrateAsyncToSecure } from './util/secureStore';
import { getNFLSeason } from './season';

export const ESPN_BASE = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl';
export const ESPN_SEASON = new Date().getFullYear();

export interface ESPNCredentials {
  espnS2: string;
  swid: string;
  leagueId?: number;
  teamName?: string;
}

// ESPN session cookies (espn_s2 + SWID) grant full account access to
// any league the user is in. Stored in iOS Keychain via expo-secure-store
// instead of AsyncStorage. Non-secret fields (league IDs, team name)
// stay in AsyncStorage.
export async function saveESPNCredentials(creds: ESPNCredentials) {
  await setSecure('espn_s2',   creds.espnS2);
  await setSecure('espn_swid', creds.swid);
}

export async function loadESPNCredentials(): Promise<ESPNCredentials | null> {
  // Auto-migrate any tokens left in AsyncStorage from earlier builds.
  const espnS2 = await migrateAsyncToSecure('espn_s2');
  const swid   = await migrateAsyncToSecure('espn_swid');
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
  await Promise.all([
    deleteSecure('espn_s2'),
    deleteSecure('espn_swid'),
  ]);
  await AsyncStorage.multiRemove(['espn_s2', 'espn_swid', 'espn_league_ids', 'espn_team_name']);
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

// Resolve the active NFL season from the app's canonical source (Sleeper
// state, same as every other platform) instead of a hardcoded year. A
// hardcoded 2025 silently dropped any league joined for a later season.
async function espnSeason(): Promise<number> {
  const s = parseInt(await getNFLSeason(), 10);
  return Number.isFinite(s) ? s : new Date().getFullYear();
}

export async function getESPNLeagues(creds: ESPNCredentials, year?: number): Promise<any[]> {
  const yr = year ?? await espnSeason();
  const data = await espnFetch(
    `/seasons/${yr}/segments/0/leagues?view=mSettings`,
    creds
  );
  return data || [];
}

export async function getESPNLeague(leagueId: number, creds: ESPNCredentials, year?: number): Promise<any> {
  const yr = year ?? await espnSeason();
  return espnFetch(
    `/seasons/${yr}/segments/0/leagues/${leagueId}?view=mSettings&view=mStatus&view=mTeam&view=mRoster`,
    creds
  );
}

export async function getESPNRoster(leagueId: number, creds: ESPNCredentials, year?: number): Promise<any> {
  const yr = year ?? await espnSeason();
  return espnFetch(
    `/seasons/${yr}/segments/0/leagues/${leagueId}?view=mTeam&view=mRoster`,
    creds
  );
}

// ─── LEAGUE DISCOVERY ───────────────────────────────────────
// Enumerate every football league the user belongs to via ESPN's fan API
// — the canonical "all my fantasy teams" source. Verified response shape
// (2026-07):
//   data.preferences[]  — one entry per fantasy team
//     .metaData.entry.gameId === 1     // 1 = football (abbrev "FFL")
//     .metaData.entry.seasonId         // the league's REAL season
//     .metaData.entry.groups[] → { groupId, groupName, draftDate }
// groupId is the league ID, groupName the league name, and draftDate
// (when present) means the league has drafted — an active, populated
// league vs. a pre-draft shell. We surface every league tagged with its
// real season + a `drafted` flag so the app can group by season and put
// active (drafted) leagues first. This is why the old approach failed:
// ESPN's per-league v3 endpoint returns data regardless of the season in
// the URL, so it couldn't tell an active league from stale history — the
// fan API's seasonId is the only reliable per-league season signal.

export interface ESPNLeagueSummary {
  id: number;
  name: string;
  season: number;
  drafted: boolean;
}

function brace(swid: string): string {
  const bare = swid.replace(/[{}]/g, '');
  return `{${bare}}`;
}

async function fanApiLeagues(creds: ESPNCredentials): Promise<ESPNLeagueSummary[]> {
  const swid = brace(creds.swid);
  const url = `https://fan.api.espn.com/apis/v2/fans/${encodeURIComponent(swid)}?context=fantasy&displayHiddenPrefs=true&useSiteWebApi=true&featureFlags=challengeEntries`;
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      Cookie: `espn_s2=${creds.espnS2}; SWID=${swid}`,
    },
  });
  if (!res.ok) return [];
  const data = await res.json();
  const prefs: any[] = Array.isArray(data?.preferences) ? data.preferences : [];
  const byId = new Map<number, ESPNLeagueSummary>();
  for (const p of prefs) {
    const entry = p?.metaData?.entry;
    if (!entry) continue;
    if (entry.gameId !== 1 && entry.abbrev !== 'FFL') continue; // football only
    const season = Number(entry.seasonId);
    if (!Number.isFinite(season)) continue;
    const groups: any[] = Array.isArray(entry.groups) ? entry.groups : [];
    for (const g of groups) {
      const id = Number(g?.groupId);
      if (!Number.isFinite(id)) continue;
      const summary: ESPNLeagueSummary = {
        id,
        name: String(g?.groupName || entry.name || `ESPN League ${id}`).trim(),
        season,
        drafted: !!g?.draftDate,
      };
      // If the same league surfaces under two seasons, keep the newest.
      const prev = byId.get(id);
      if (!prev || summary.season > prev.season) byId.set(id, summary);
    }
  }
  return Array.from(byId.values());
}

// Active (drafted) first, newest season first, then alphabetical.
function sortLeagues(a: ESPNLeagueSummary, b: ESPNLeagueSummary): number {
  if (a.season !== b.season) return b.season - a.season;
  if (a.drafted !== b.drafted) return a.drafted ? -1 : 1;
  return a.name.localeCompare(b.name);
}

export async function discoverESPNLeagues(creds: ESPNCredentials): Promise<ESPNLeagueSummary[]> {
  // Primary: fan API (gives season + drafted per league).
  try {
    const leagues = await fanApiLeagues(creds);
    if (leagues.length > 0) return leagues.sort(sortLeagues);
  } catch (e) {
    console.log('discoverESPNLeagues: fan API failed', e);
  }

  // Fallback: v3 per-season leagues endpoint (current season only, no
  // draft info) if the fan API is unavailable.
  const season = await espnSeason();
  try {
    const raw = await getESPNLeagues(creds, season);
    return (raw || [])
      .map((l: any): ESPNLeagueSummary => ({
        id: Number(l?.id),
        name: String(l?.settings?.name || `ESPN League ${l?.id}`),
        season,
        drafted: false,
      }))
      .filter((l: ESPNLeagueSummary) => Number.isFinite(l.id))
      .sort(sortLeagues);
  } catch (e) {
    console.log('discoverESPNLeagues: v3 fallback failed', e);
    return [];
  }
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