// services/yahoo.ts
// Yahoo Fantasy Football — OAuth 2.0 with PKCE (Public Client)
// No client secret required — uses PKCE for mobile app security

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

// ─── CREDENTIALS ──────────────────────────────────────────────────────────────
const YAHOO_CLIENT_ID = 'dj0yJmk9NTBMQWF0N3l2RUthJmQ9WVdrOVNrbHpZVlF3YTI4bWNHbzlNQT09JnM9Y29uc3VtZXJzZWNyZXQmc3Y9MCZ4PWZj';
// ─────────────────────────────────────────────────────────────────────────────

export const YAHOO_API_BASE   = 'https://fantasysports.yahooapis.com/fantasy/v2';
export const YAHOO_AUTH_URL   = 'https://api.login.yahoo.com/oauth2/request_auth';
export const YAHOO_TOKEN_URL  = 'https://api.login.yahoo.com/oauth2/get_token';
export const YAHOO_REDIRECT_URI = 'aiomnifantasy://oauth/yahoo';
export const YAHOO_NFL_GAME_KEY = '449'; // 2025 season — update to 450 for 2026

export interface YahooTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface YahooLeague {
  league_key: string;
  league_id: string;
  name: string;
  num_teams: number;
  scoring_type: string;
  current_week: number;
  season: string;
  url: string;
}

export interface YahooTeam {
  team_key: string;
  team_id: string;
  name: string;
  managers: Array<{ manager: { guid: string; nickname: string } }>;
  team_standings: {
    outcome_totals: { wins: string; losses: string; ties: string };
    points_for: string;
    rank: number;
  };
}

export interface YahooPlayer {
  player_key: string;
  player_id: string;
  name: { full: string; first: string; last: string };
  editorial_team_abbr: string;
  display_position: string;
  eligible_positions: Array<{ position: string }>;
  status?: string;
  injury_note?: string;
  selected_position?: { position: string };
}

export interface YahooRoster {
  players: YahooPlayer[];
  starters: YahooPlayer[];
  bench: YahooPlayer[];
}

// ─── PKCE Helpers ──────────────────────────────────────────────────────────────

function base64urlEncode(buffer: Uint8Array): string {
  let str = '';
  buffer.forEach(b => { str += String.fromCharCode(b); });
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function generateCodeVerifier(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(32);
  return base64urlEncode(bytes);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    verifier,
    { encoding: Crypto.CryptoEncoding.BASE64 }
  );
  return digest.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ─── Token Storage ─────────────────────────────────────────────────────────────

export async function saveYahooTokens(tokens: YahooTokens): Promise<void> {
  await AsyncStorage.setItem('yahoo_tokens', JSON.stringify(tokens));
}

export async function loadYahooTokens(): Promise<YahooTokens | null> {
  const raw = await AsyncStorage.getItem('yahoo_tokens');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function clearYahooTokens(): Promise<void> {
  await AsyncStorage.removeItem('yahoo_tokens');
  await AsyncStorage.removeItem('yahoo_code_verifier');
}

export function isYahooConnected(): Promise<boolean> {
  return loadYahooTokens().then(t => t !== null);
}

function isExpired(tokens: YahooTokens): boolean {
  return Date.now() >= tokens.expiresAt - 60_000;
}

// ─── OAuth URL with PKCE ───────────────────────────────────────────────────────

export async function getYahooAuthURL(state = 'aiomniyahoo'): Promise<string> {
  const verifier   = await generateCodeVerifier();
  const challenge  = await generateCodeChallenge(verifier);

  // Store verifier so we can use it during token exchange
  await AsyncStorage.setItem('yahoo_code_verifier', verifier);

  const params = new URLSearchParams({
    client_id:             YAHOO_CLIENT_ID,
    redirect_uri:          YAHOO_REDIRECT_URI,
    response_type:         'code',
    scope:                 'openid fspt-r fspt-w',
    state,
    code_challenge:        challenge,
    code_challenge_method: 'S256',
  });
  return `${YAHOO_AUTH_URL}?${params}`;
}

// ─── Token Exchange with PKCE ──────────────────────────────────────────────────

export async function exchangeYahooCode(code: string): Promise<YahooTokens> {
  const verifier = await AsyncStorage.getItem('yahoo_code_verifier');
  if (!verifier) throw new Error('No PKCE code verifier found — restart auth flow');

  const body = new URLSearchParams({
    client_id:     YAHOO_CLIENT_ID,
    redirect_uri:  YAHOO_REDIRECT_URI,
    grant_type:    'authorization_code',
    code,
    code_verifier: verifier,
  });

  const res = await fetch(YAHOO_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body:    body.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Yahoo token exchange failed: ${err}`);
  }

  const data = await res.json();
  const tokens: YahooTokens = {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token,
    expiresAt:    Date.now() + data.expires_in * 1000,
  };
  await saveYahooTokens(tokens);
  await AsyncStorage.removeItem('yahoo_code_verifier');
  return tokens;
}

// ─── Token Refresh ─────────────────────────────────────────────────────────────

export async function refreshYahooToken(refreshToken: string): Promise<YahooTokens> {
  const body = new URLSearchParams({
    client_id:     YAHOO_CLIENT_ID,
    redirect_uri:  YAHOO_REDIRECT_URI,
    grant_type:    'refresh_token',
    refresh_token: refreshToken,
  });

  const res = await fetch(YAHOO_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body:    body.toString(),
  });

  if (!res.ok) {
    await clearYahooTokens();
    throw new Error('Yahoo refresh token expired — user must re-authenticate');
  }

  const data = await res.json();
  const tokens: YahooTokens = {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt:    Date.now() + data.expires_in * 1000,
  };
  await saveYahooTokens(tokens);
  return tokens;
}

export async function getValidYahooToken(): Promise<string | null> {
  let tokens = await loadYahooTokens();
  if (!tokens) return null;
  if (isExpired(tokens)) {
    try {
      tokens = await refreshYahooToken(tokens.refreshToken);
    } catch {
      return null;
    }
  }
  return tokens.accessToken;
}

// ─── API Fetcher ───────────────────────────────────────────────────────────────

async function yahooFetch(path: string, accessToken: string): Promise<any> {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${YAHOO_API_BASE}${path}${sep}format=json`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) throw new Error('Yahoo token expired — call refreshYahooToken()');
  if (!res.ok) throw new Error(`Yahoo API error ${res.status} for ${path}`);
  return res.json();
}

// ─── League Data ───────────────────────────────────────────────────────────────

export async function getYahooLeagues(accessToken: string): Promise<YahooLeague[]> {
  const data = await yahooFetch(
    `/users;use_login=1/games;game_keys=${YAHOO_NFL_GAME_KEY}/leagues`,
    accessToken
  );
  try {
    const gamesData = data.fantasy_content.users[0].user[1].games;
    const game = gamesData[0]?.game;
    if (!game) return [];
    const leaguesData = game[1]?.leagues;
    if (!leaguesData) return [];
    return Object.values(leaguesData)
      .filter((v: any) => typeof v === 'object' && v.league)
      .map((v: any) => v.league[0] as YahooLeague);
  } catch {
    return [];
  }
}

export async function getMyYahooGuid(accessToken: string): Promise<string | null> {
  try {
    const data = await yahooFetch('/users;use_login=1', accessToken);
    const userArr = data?.fantasy_content?.users?.[0]?.user?.[0];
    const guidEntry = Array.isArray(userArr) ? userArr.find((u: any) => u.guid) : null;
    return guidEntry?.guid ?? null;
  } catch {
    return null;
  }
}

export async function getMyYahooTeam(
  leagueKey: string,
  accessToken: string
): Promise<{ team: YahooTeam; roster: YahooRoster } | null> {
  try {
    const [teamsData, myGuid] = await Promise.all([
      yahooFetch(`/league/${leagueKey}/teams/roster`, accessToken),
      getMyYahooGuid(accessToken),
    ]);
    if (!myGuid) return null;

    const allTeams = teamsData.fantasy_content?.league?.[1]?.teams;
    if (!allTeams) return null;

    const myTeamEntry = Object.values(allTeams).find((v: any) => {
      if (typeof v !== 'object' || !v.team) return false;
      return v.team[0]?.managers?.some((m: any) => m.manager?.guid === myGuid);
    }) as any;

    if (!myTeamEntry) return null;
    const team = myTeamEntry.team[0] as YahooTeam;
    const rosterEntries = myTeamEntry.team[1]?.roster?.['0']?.players || {};
    const players: YahooPlayer[] = Object.values(rosterEntries)
      .filter((v: any) => typeof v === 'object' && v.player)
      .map((v: any) => {
        const pArr = v.player[0];
        const selectedPos = v.player[1]?.selected_position?.[1]?.position;
        return { ...pArr, selected_position: { position: selectedPos } } as YahooPlayer;
      });

    const starters = players.filter(p => p.selected_position?.position !== 'BN' && p.selected_position?.position !== 'IR');
    const bench    = players.filter(p => p.selected_position?.position === 'BN' || p.selected_position?.position === 'IR');
    return { team, roster: { players, starters, bench } };
  } catch (e) {
    console.error('Yahoo roster parse error:', e);
    return null;
  }
}

export async function getYahooFreeAgents(
  leagueKey: string,
  position: string,
  accessToken: string,
  start = 0,
  count = 25
): Promise<YahooPlayer[]> {
  try {
    const data = await yahooFetch(
      `/league/${leagueKey}/players;status=FA;position=${position};sort=OR;start=${start};count=${count}`,
      accessToken
    );
    const playersData = data.fantasy_content?.league?.[1]?.players;
    if (!playersData) return [];
    return Object.values(playersData)
      .filter((v: any) => typeof v === 'object' && v.player)
      .map((v: any) => v.player[0] as YahooPlayer);
  } catch {
    return [];
  }
}

export async function getYahooStandings(leagueKey: string, accessToken: string): Promise<any[]> {
  try {
    const data = await yahooFetch(`/league/${leagueKey}/standings`, accessToken);
    const teams = data.fantasy_content?.league?.[1]?.standings?.[0]?.teams;
    if (!teams) return [];
    return Object.values(teams)
      .filter((v: any) => typeof v === 'object' && v.team)
      .map((v: any) => {
        const t = v.team[0];
        const s = v.team[2]?.team_standings;
        return {
          teamKey: t.find((x: any) => x.team_key)?.team_key,
          name: t.find((x: any) => x.name)?.name,
          wins: parseInt(s?.outcome_totals?.wins || '0'),
          losses: parseInt(s?.outcome_totals?.losses || '0'),
          ties: parseInt(s?.outcome_totals?.ties || '0'),
          pointsFor: parseFloat(s?.points_for || '0'),
          pointsAgainst: parseFloat(s?.points_against || '0'),
          streak: s?.streak?.value ? `${s.streak.type === 'win' ? 'W' : 'L'}${s.streak.value}` : '',
        };
      });
  } catch { return []; }
}

export async function getYahooMatchups(leagueKey: string, accessToken: string): Promise<any> {
  try {
    const data = await yahooFetch(`/league/${leagueKey}/scoreboard`, accessToken);
    const matchups = data.fantasy_content?.league?.[1]?.scoreboard?.['0']?.matchups;
    if (!matchups) return null;
    return { allMatchups: Object.values(matchups).filter((v: any) => typeof v === 'object' && v.matchup).map((v: any) => v.matchup) };
  } catch { return null; }
}

export async function getYahooTransactions(leagueKey: string, accessToken: string): Promise<any[]> {
  try {
    const data = await yahooFetch(`/league/${leagueKey}/transactions;types=add,drop,trade`, accessToken);
    const txs = data.fantasy_content?.league?.[1]?.transactions;
    if (!txs) return [];
    return Object.values(txs).filter((v: any) => typeof v === 'object' && v.transaction).map((v: any) => {
      const tx = v.transaction[0];
      const players = v.transaction[1]?.players || {};
      const adds: string[] = [], drops: string[] = [];
      Object.values(players).forEach((p: any) => {
        if (!p?.player) return;
        const name = p.player[0]?.find((x: any) => x.name)?.name?.full || 'Unknown';
        const type = p.player[1]?.transaction_data?.[0]?.type;
        if (type === 'add') adds.push(name);
        if (type === 'drop') drops.push(name);
      });
      return { type: tx.find((x: any) => x.type)?.type || 'unknown', adds, drops, trader: tx.find((x: any) => x.trader_team_name)?.trader_team_name || 'Unknown', time: new Date(tx.find((x: any) => x.timestamp)?.timestamp * 1000).getTime() };
    });
  } catch { return []; }
}

export async function getYahooAllRosters(leagueKey: string, accessToken: string): Promise<any[]> {
  try {
    const data = await yahooFetch(`/league/${leagueKey}/teams/roster`, accessToken);
    const teams = data.fantasy_content?.league?.[1]?.teams;
    if (!teams) return [];
    return Object.values(teams).filter((v: any) => typeof v === 'object' && v.team).map((v: any) => {
      const teamInfo = v.team[0];
      const rosterEntries = v.team[1]?.roster?.['0']?.players || {};
      const players = Object.values(rosterEntries).filter((p: any) => typeof p === 'object' && p.player).map((p: any) => {
        const pArr = p.player[0];
        const selectedPos = p.player[1]?.selected_position?.[1]?.position;
        return { id: pArr.find((x: any) => x.player_key)?.player_key, name: pArr.find((x: any) => x.name)?.name?.full || 'Unknown', position: pArr.find((x: any) => x.display_position)?.display_position || '?', team: pArr.find((x: any) => x.editorial_team_abbr)?.editorial_team_abbr || 'FA', isStarter: selectedPos !== 'BN' && selectedPos !== 'IR' };
      });
      return { rosterId: teamInfo.find((x: any) => x.team_key)?.team_key, username: teamInfo.find((x: any) => x.name)?.name || 'Unknown', players };
    });
  } catch { return []; }
}

// ─── Context Formatter ─────────────────────────────────────────────────────────

export function formatYahooLeagueContext(
  league: YahooLeague,
  team: YahooTeam,
  starters: YahooPlayer[]
): string {
  const record = team.team_standings?.outcome_totals;
  const starterNames = starters.map(p => `${p.name?.full} (${p.display_position})`).join(', ');
  return [
    `Platform: Yahoo`,
    `League: ${league.name}`,
    `Scoring: ${league.scoring_type}`,
    `Teams: ${league.num_teams}`,
    `Week: ${league.current_week}`,
    `My Team: ${team.name}`,
    `Record: ${record?.wins ?? 0}-${record?.losses ?? 0}`,
    `Starters: ${starterNames}`,
  ].join('\n');
}