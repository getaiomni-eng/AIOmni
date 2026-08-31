// services/yahoo.ts
// Yahoo Fantasy Football — OAuth 2.0 with PKCE (Public Client)

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { setSecure, getSecure, deleteSecure, migrateAsyncToSecure } from './util/secureStore';
import { logCaught } from './util/logCaught';

const YAHOO_CLIENT_ID   = 'dj0yJmk9R3ptbUJaU3FFUFloJmQ9WVdrOWJEZENkRkZVZG5rbWNHbzlNQT09JnM9Y29uc3VtZXJzZWNyZXQmc3Y9MCZ4PTZk';

export const YAHOO_API_BASE     = 'https://fantasysports.yahooapis.com/fantasy/v2';
export const YAHOO_AUTH_URL     = 'https://api.login.yahoo.com/oauth2/request_auth';
export const YAHOO_TOKEN_URL    = 'https://api.login.yahoo.com/oauth2/get_token';
export const YAHOO_REDIRECT_URI = 'aiomnifantasy://oauth/yahoo';
export const YAHOO_NFL_GAME_KEY = '449';

export interface YahooTokens {
  accessToken: string; refreshToken: string; expiresAt: number;
}

export interface YahooLeague {
  league_key: string; league_id: string; name: string;
  num_teams: number; scoring_type: string; current_week: number; season: string; url: string;
}

export interface YahooTeam {
  team_key: string; team_id: string; name: string;
  managers: Array<{ manager: { guid: string; nickname: string } }>;
  team_standings: { outcome_totals: { wins: string; losses: string; ties: string }; points_for: string; rank: number; };
}

export interface YahooPlayer {
  player_key: string; player_id: string;
  name: { full: string; first: string; last: string };
  editorial_team_abbr: string; display_position: string;
  eligible_positions: Array<{ position: string }>;
  status?: string; injury_note?: string;
  selected_position?: { position: string };
}

export interface YahooRoster {
  players: YahooPlayer[]; starters: YahooPlayer[]; bench: YahooPlayer[];
}

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
    Crypto.CryptoDigestAlgorithm.SHA256, verifier,
    { encoding: Crypto.CryptoEncoding.BASE64 }
  );
  return digest.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// Yahoo OAuth access + refresh tokens. Keychain instead of AsyncStorage
// because possession of the refresh token = persistent access to the
// user's Yahoo fantasy account.
export async function saveYahooTokens(tokens: YahooTokens): Promise<void> {
  await setSecure('yahoo_tokens', JSON.stringify(tokens));
}

export async function loadYahooTokens(): Promise<YahooTokens | null> {
  const raw = await migrateAsyncToSecure('yahoo_tokens');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function clearYahooTokens(): Promise<void> {
  await deleteSecure('yahoo_tokens');
  await AsyncStorage.removeItem('yahoo_tokens');         // legacy cleanup
  await AsyncStorage.removeItem('yahoo_code_verifier');  // not sensitive but tied to flow
}

function isExpired(tokens: YahooTokens): boolean {
  return Date.now() >= tokens.expiresAt - 60_000;
}

export async function getYahooAuthURL(state = 'aiomniyahoo'): Promise<string> {
  const verifier  = await generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  await AsyncStorage.setItem('yahoo_code_verifier', verifier);

  const params = new URLSearchParams({
    client_id:             YAHOO_CLIENT_ID,
    redirect_uri:          YAHOO_REDIRECT_URI,
    response_type:         'code',
    scope:                 'fspt-r',   // ← fixed: removed openid which caused invalid_scope
    state,
    code_challenge:        challenge,
    code_challenge_method: 'S256',
  });
  return `${YAHOO_AUTH_URL}?${params}`;
}

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
    const errText = await res.text();
    let errMsg = 'Yahoo sign-in failed. Please try again.';
    try {
      const errJson = JSON.parse(errText);
      if (errJson.error === 'SHERPA_WRITE_FAIL') errMsg = 'Yahoo timed out. Wait a moment and try again.';
      else if (errJson.error_description) errMsg = errJson.error_description;
    } catch {}
    throw new Error(errMsg);
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

  if (!res.ok) { await clearYahooTokens(); throw new Error('Yahoo refresh token expired'); }

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
    try { tokens = await refreshYahooToken(tokens.refreshToken); }
    catch (e) {
      // The single most user-visible silent failure in the app: an expired
      // refresh token means Settings still says "Connected" while every
      // Yahoo league quietly vanishes from Home.
      logCaught('yahoo:refresh-failed', e);
      return null;
    }
  }
  return tokens.accessToken;
}

async function yahooFetch(path: string, accessToken: string): Promise<any> {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${YAHOO_API_BASE}${path}${sep}format=json`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (res.status === 401) throw new Error('Yahoo token expired');
  if (!res.ok) throw new Error(`Yahoo API error ${res.status}`);
  return res.json();
}

export async function getYahooLeagues(accessToken: string, year: string = '2025'): Promise<YahooLeague[]> {
  const data = await yahooFetch(`/users;use_login=1/games;game_codes=nfl;seasons=${year}/leagues`, accessToken);
  try {
    const gamesData = data.fantasy_content.users[0].user[1].games;
    const game = gamesData[0]?.game;
    if (!game) return [];
    const leaguesData = game[1]?.leagues;
    if (!leaguesData) return [];
    return Object.values(leaguesData).filter((v: any) => typeof v === 'object' && v.league).map((v: any) => v.league[0] as YahooLeague);
  } catch { return []; }
}

export async function getMyYahooGuid(accessToken: string): Promise<string | null> {
  try {
    const data = await yahooFetch('/users;use_login=1', accessToken);
    const userArr = data?.fantasy_content?.users?.[0]?.user?.[0];
    const guidEntry = Array.isArray(userArr) ? userArr.find((u: any) => u.guid) : null;
    return guidEntry?.guid ?? null;
  } catch { return null; }
}

export async function getMyYahooTeam(leagueKey: string, accessToken: string): Promise<{ team: YahooTeam; roster: YahooRoster } | null> {
  try {
    const [teamsData, myGuid] = await Promise.all([yahooFetch(`/league/${leagueKey}/teams/roster`, accessToken), getMyYahooGuid(accessToken)]);
    if (!myGuid) return null;
    const allTeams = teamsData.fantasy_content?.league?.[1]?.teams;
    if (!allTeams) return null;
    const myTeamEntry = Object.values(allTeams).find((v: any) => {
      if (typeof v !== 'object' || !v.team) return false;
      // team[0] is an attribute ARRAY — `.managers` read directly off it was
      // always undefined, so no team ever matched and this returned null for
      // every league. Find the managers attribute object first.
      const managers = (Array.isArray(v.team[0]) ? v.team[0] : [])
        .find((x: any) => x && typeof x === 'object' && 'managers' in x)?.managers;
      return Array.isArray(managers) && managers.some((m: any) => m.manager?.guid === myGuid);
    }) as any;
    if (!myTeamEntry) return null;
    // Yahoo's team[0] and player[0] are ARRAYS of single-key attribute
    // objects. The old code cast team[0] straight to YahooTeam and spread
    // player[0] ({...array} → numeric keys only), so every downstream read
    // of .name/.display_position was undefined — Yahoo rosters rendered
    // empty app-wide ("Rosters: Not loaded"). Resolve attributes explicitly.
    const tAttr = (k: string) => (Array.isArray(myTeamEntry.team[0]) ? myTeamEntry.team[0] : [])
      .find((x: any) => x && typeof x === 'object' && k in x)?.[k];
    const team = {
      team_key: tAttr('team_key'),
      team_id: tAttr('team_id'),
      name: tAttr('name'),
      managers: tAttr('managers'),
      team_standings: myTeamEntry.team[2]?.team_standings,
    } as YahooTeam;
    const rosterEntries = myTeamEntry.team[1]?.roster?.['0']?.players || {};
    const players: YahooPlayer[] = Object.values(rosterEntries).filter((v: any) => typeof v === 'object' && v.player).map((v: any) => {
      const pArr: any[] = Array.isArray(v.player[0]) ? v.player[0] : [];
      const attr = (k: string) => pArr.find((x: any) => x && typeof x === 'object' && k in x)?.[k];
      const selectedPos = v.player[1]?.selected_position?.[1]?.position;
      return {
        player_key: attr('player_key'),
        player_id: attr('player_id'),
        name: attr('name'),
        display_position: attr('display_position'),
        editorial_team_abbr: attr('editorial_team_abbr'),
        status: attr('status'),
        selected_position: { position: selectedPos },
      } as YahooPlayer;
    });
    const starters = players.filter(p => p.selected_position?.position !== 'BN' && p.selected_position?.position !== 'IR');
    const bench    = players.filter(p => p.selected_position?.position === 'BN' || p.selected_position?.position === 'IR');
    return { team, roster: { players, starters, bench } };
  } catch (e) { console.error('Yahoo roster parse error:', e); return null; }
}

export async function getYahooFreeAgents(leagueKey: string, position: string, accessToken: string, start = 0, count = 25): Promise<YahooPlayer[]> {
  try {
    const data = await yahooFetch(`/league/${leagueKey}/players;status=FA;position=${position};sort=OR;start=${start};count=${count}`, accessToken);
    const playersData = data.fantasy_content?.league?.[1]?.players;
    if (!playersData) return [];
    return Object.values(playersData).filter((v: any) => typeof v === 'object' && v.player).map((v: any) => v.player[0] as YahooPlayer);
  } catch { return []; }
}

/**
 * League settings — scoring modifiers + starting lineup.
 *
 * v2026-08-07: the Coach previously hardcoded every Yahoo league to
 * 'PPR' with the comment "Yahoo doesn't surface scoring rules in the
 * league-list response". That is true of the league LIST, but
 * /league/{key}/settings carries both stat_modifiers and
 * roster_positions — so a Yahoo half-PPR or TE-premium league was
 * being described to the model as vanilla PPR.
 *
 * Yahoo wraps collections as objects keyed "0","1",…,"count", and
 * nests each entry one level deeper under its own singular key, so
 * every access here is defensive: a shape change degrades to empty
 * rather than throwing (which would drop the whole league context).
 */
export async function getYahooLeagueSettings(
  leagueKey: string,
  accessToken: string,
): Promise<{ statModifiers: Array<{ statId: number; value: number }>; rosterSlots: string[] } | null> {
  try {
    const data = await yahooFetch(`/league/${leagueKey}/settings`, accessToken);
    const settings = data?.fantasy_content?.league?.[1]?.settings?.[0];
    if (!settings) return null;

    const statModifiers: Array<{ statId: number; value: number }> = [];
    const rawStats = settings?.stat_modifiers?.stats;
    if (rawStats) {
      for (const entry of Object.values(rawStats as Record<string, any>)) {
        const stat = (entry as any)?.stat;
        if (!stat) continue;
        const statId = Number(stat.stat_id);
        const value = Number(stat.value);
        if (Number.isFinite(statId) && Number.isFinite(value)) statModifiers.push({ statId, value });
      }
    }

    // roster_positions is a plain array here (unlike most Yahoo
    // collections), but tolerate the keyed-object form too.
    const rosterSlots: string[] = [];
    const rawSlots = settings?.roster_positions;
    if (rawSlots) {
      for (const entry of Object.values(rawSlots as Record<string, any>)) {
        const rp = (entry as any)?.roster_position ?? entry;
        const position = rp?.position;
        const count = Number(rp?.count ?? 0);
        if (!position || !Number.isFinite(count) || count <= 0) continue;
        for (let i = 0; i < count; i++) rosterSlots.push(String(position));
      }
    }

    return { statModifiers, rosterSlots };
  } catch { return null; }
}

export async function getYahooStandings(leagueKey: string, accessToken: string): Promise<any[]> {
  try {
    const data = await yahooFetch(`/league/${leagueKey}/standings`, accessToken);
    const teams = data.fantasy_content?.league?.[1]?.standings?.[0]?.teams;
    if (!teams) return [];
    return Object.values(teams).filter((v: any) => typeof v === 'object' && v.team).map((v: any) => {
      const t = v.team[0]; const s = v.team[2]?.team_standings;
      return { teamKey: t.find((x: any) => x.team_key)?.team_key, name: t.find((x: any) => x.name)?.name, wins: parseInt(s?.outcome_totals?.wins || '0'), losses: parseInt(s?.outcome_totals?.losses || '0'), ties: parseInt(s?.outcome_totals?.ties || '0'), pointsFor: parseFloat(s?.points_for || '0'), pointsAgainst: parseFloat(s?.points_against || '0'), streak: s?.streak?.value ? `${s.streak.type === 'win' ? 'W' : 'L'}${s.streak.value}` : '' };
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
      const tx = v.transaction[0]; const players = v.transaction[1]?.players || {};
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
      const teamInfo = v.team[0]; const rosterEntries = v.team[1]?.roster?.['0']?.players || {};
      const players = Object.values(rosterEntries).filter((p: any) => typeof p === 'object' && p.player).map((p: any) => {
        const pArr = p.player[0]; const selectedPos = p.player[1]?.selected_position?.[1]?.position;
        return { id: pArr.find((x: any) => x.player_key)?.player_key, name: pArr.find((x: any) => x.name)?.name?.full || 'Unknown', position: pArr.find((x: any) => x.display_position)?.display_position || '?', team: pArr.find((x: any) => x.editorial_team_abbr)?.editorial_team_abbr || 'FA', isStarter: selectedPos !== 'BN' && selectedPos !== 'IR' };
      });
      return { rosterId: teamInfo.find((x: any) => x.team_key)?.team_key, username: teamInfo.find((x: any) => x.name)?.name || 'Unknown', players };
    });
  } catch { return []; }
}

export function formatYahooLeagueContext(league: YahooLeague, team: YahooTeam, starters: YahooPlayer[]): string {
  const record = team.team_standings?.outcome_totals;
  const starterNames = starters.map(p => `${p.name?.full} (${p.display_position})`).join(', ');
  return [`Platform: Yahoo`, `League: ${league.name}`, `Scoring: ${league.scoring_type}`, `Teams: ${league.num_teams}`, `Week: ${league.current_week}`, `My Team: ${team.name}`, `Record: ${record?.wins ?? 0}-${record?.losses ?? 0}`, `Starters: ${starterNames}`].join('\n');
}