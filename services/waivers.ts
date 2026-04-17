// services/waivers.ts
// Unified waiver wire engine — platform-aware, cached, roster-contextual.
// Pulls free agents from whichever platform the user is active on
// (Sleeper / ESPN / Yahoo), normalizes to a single shape, and builds
// league-settings-aware AI prompts for add/drop/FAAB advice.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { ESPNFreeAgent, getESPNFreeAgents, loadESPNCredentials } from './espn';
import { getValidYahooToken, getYahooFreeAgents, YahooPlayer } from './yahoo';

// ─── TYPES ──────────────────────────────────────────────────

export type WaiverPlatform = 'sleeper' | 'espn' | 'yahoo';
export type WaiverType = 'faab' | 'rolling' | 'unknown';

export interface AvailablePlayer {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  position: string;
  team: string;
  platform: WaiverPlatform;
  injuryStatus?: string | null;
  trendingAdds?: number;
  percentOwned?: number;
  age?: number;
  yearsExp?: number;
  photoId?: string; // for sleepercdn thumbnails
}

export interface WaiverContext {
  platform: WaiverPlatform;
  leagueName: string;
  leagueId: string;
  waiverType: WaiverType;
  faabBudget?: number;
  faabRemaining?: number;
  scoringFormat: 'ppr' | 'half' | 'standard';
  teamCount: number;
  currentWeek?: number;
  myRoster: { id: string; name: string; position: string; team: string }[];
  rosterSlotsNeeded: string[]; // positions that are thin (bench-heavy at one spot, etc)
}

// ─── CACHE ──────────────────────────────────────────────────

interface CacheEntry {
  data: AvailablePlayer[];
  context: WaiverContext | null;
  fetchedAt: number;
}

const TTL_MS = 15 * 60 * 1000; // 15 min
let cache: Record<string, CacheEntry> = {};
let inflight: Record<string, Promise<AvailablePlayer[]>> = {};

function cacheKey(platform: WaiverPlatform, leagueId: string): string {
  return `${platform}:${leagueId}`;
}

export function invalidateWaiverCache(platform?: WaiverPlatform, leagueId?: string): void {
  if (platform && leagueId) {
    delete cache[cacheKey(platform, leagueId)];
  } else {
    cache = {};
  }
}

// ─── SLEEPER ────────────────────────────────────────────────

async function fetchSleeperFreeAgents(leagueId: string): Promise<AvailablePlayer[]> {
  try {
    const [rostersRes, trendingRes, allPlayersRes] = await Promise.all([
      fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`).then(r => r.json()),
      fetch(`https://api.sleeper.app/v1/players/nfl/trending/add?lookback_hours=48&limit=200`).then(r => r.json()),
      fetch(`https://api.sleeper.app/v1/players/nfl`).then(r => r.json()),
    ]);

    // Build set of every player already rostered in this league
    const rostered = new Set<string>();
    for (const r of rostersRes || []) {
      if (Array.isArray(r?.players)) {
        for (const pid of r.players) rostered.add(String(pid));
      }
    }

    // Build trending lookup
    const trendMap = new Map<string, number>();
    for (const t of trendingRes || []) trendMap.set(t.player_id, t.count);

    // Pull trending first (most relevant), then fill with search_rank sorted
    const allPlayers = allPlayersRes || {};
    const results: AvailablePlayer[] = [];
    const added = new Set<string>();

    // Pass 1: trending, unrostered, active skill positions
    for (const t of trendingRes || []) {
      const p = allPlayers[t.player_id];
      if (!p || rostered.has(t.player_id) || added.has(t.player_id)) continue;
      if (!['QB','RB','WR','TE','K','DEF'].includes(p.position)) continue;
      if (!p.team && p.position !== 'DEF') continue;
      results.push(normalizeSleeperPlayer(t.player_id, p, t.count));
      added.add(t.player_id);
      if (results.length >= 150) break;
    }

    // Pass 2: fill from search_rank sorted pool
    if (results.length < 150) {
      const ranked = Object.entries(allPlayers)
        .filter(([pid, p]: any) =>
          !rostered.has(pid) &&
          !added.has(pid) &&
          ['QB','RB','WR','TE','K','DEF'].includes(p.position) &&
          (p.team || p.position === 'DEF') &&
          p.search_rank && p.search_rank < 500 &&
          p.active !== false
        )
        .sort(([, a]: any, [, b]: any) => (a.search_rank ?? 9999) - (b.search_rank ?? 9999))
        .slice(0, 150 - results.length);

      for (const [pid, p] of ranked) {
        results.push(normalizeSleeperPlayer(pid, p as any, trendMap.get(pid) ?? 0));
      }
    }

    return results;
  } catch (e) {
    console.log('fetchSleeperFreeAgents error:', e);
    return [];
  }
}

function normalizeSleeperPlayer(id: string, p: any, trendCount: number): AvailablePlayer {
  return {
    id,
    name: p.full_name || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim(),
    firstName: p.first_name ?? '',
    lastName: p.last_name ?? '',
    position: p.position,
    team: p.team ?? 'FA',
    platform: 'sleeper',
    injuryStatus: p.injury_status || null,
    trendingAdds: trendCount,
    age: p.age,
    yearsExp: p.years_exp,
    photoId: id, // Sleeper CDN uses their player_id
  };
}

// ─── ESPN ───────────────────────────────────────────────────

async function fetchESPNFreeAgentsNormalized(leagueId: string): Promise<AvailablePlayer[]> {
  const creds = await loadESPNCredentials();
  if (!creds) return [];
  try {
    const fas = await getESPNFreeAgents(parseInt(leagueId, 10), creds, 150);
    return fas.map((fa: ESPNFreeAgent) => {
      const [first, ...rest] = (fa.name || '').split(' ');
      return {
        id: fa.id,
        name: fa.name,
        firstName: first ?? '',
        lastName: rest.join(' '),
        position: fa.position,
        team: fa.team,
        platform: 'espn' as const,
        injuryStatus: fa.injuryStatus ?? null,
        percentOwned: fa.percentOwned,
        photoId: undefined, // ESPN uses different photo URLs
      };
    });
  } catch (e) {
    console.log('fetchESPNFreeAgents error:', e);
    return [];
  }
}

// ─── YAHOO ──────────────────────────────────────────────────

async function fetchYahooFreeAgentsNormalized(leagueKey: string): Promise<AvailablePlayer[]> {
  const token = await getValidYahooToken();
  if (!token) return [];

  try {
    const positions = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
    const results: AvailablePlayer[] = [];

    // Yahoo limits count per request; pull each position separately, top 25 each.
    const batches = await Promise.all(
      positions.map(pos => getYahooFreeAgents(leagueKey, pos, token, 0, 25).catch(() => []))
    );

    for (const batch of batches) {
      for (const p of batch as YahooPlayer[]) {
        const full = (p.name as any)?.full || '';
        const first = (p.name as any)?.first || '';
        const last = (p.name as any)?.last || '';
        results.push({
          id: p.player_key,
          name: full,
          firstName: first,
          lastName: last,
          position: p.display_position,
          team: p.editorial_team_abbr,
          platform: 'yahoo',
          injuryStatus: p.status || null,
          photoId: undefined,
        });
      }
    }

    return results;
  } catch (e) {
    console.log('fetchYahooFreeAgents error:', e);
    return [];
  }
}

// ─── UNIFIED FETCHER ────────────────────────────────────────

/**
 * Get available players for a platform/league. Cached 15min.
 */
export async function getAvailablePlayers(
  platform: WaiverPlatform,
  leagueId: string,
  forceRefresh = false
): Promise<AvailablePlayer[]> {
  const key = cacheKey(platform, leagueId);
  const now = Date.now();

  if (!forceRefresh && cache[key] && (now - cache[key].fetchedAt) < TTL_MS) {
    return cache[key].data;
  }

  if (key in inflight) return inflight[key];

  inflight[key] = (async () => {
    try {
      let data: AvailablePlayer[] = [];
      if (platform === 'sleeper') data = await fetchSleeperFreeAgents(leagueId);
      else if (platform === 'espn') data = await fetchESPNFreeAgentsNormalized(leagueId);
      else if (platform === 'yahoo') data = await fetchYahooFreeAgentsNormalized(leagueId);

      if (data.length > 0) {
        cache[key] = { data, context: cache[key]?.context ?? null, fetchedAt: Date.now() };
      }
      return data;
    } finally {
      delete inflight[key];
    }
  })();

  return inflight[key];
}

// ─── WAIVER CONTEXT (league settings + roster) ──────────────

/**
 * Pull the full waiver context for a league: waiver type, FAAB budget,
 * user's roster, positional needs. This is what feeds the AI prompt.
 */
export async function getWaiverContext(
  platform: WaiverPlatform,
  leagueId: string
): Promise<WaiverContext | null> {
  try {
    if (platform === 'sleeper') return await getSleeperWaiverContext(leagueId);
    if (platform === 'espn') return await getESPNWaiverContext(leagueId);
    if (platform === 'yahoo') return await getYahooWaiverContext(leagueId);
    return null;
  } catch (e) {
    console.log('getWaiverContext error:', e);
    return null;
  }
}

async function getSleeperWaiverContext(leagueId: string): Promise<WaiverContext | null> {
  const username = await AsyncStorage.getItem('sleeper_username');
  if (!username) return null;

  const [userRes, leagueRes, rostersRes, allPlayersRes, stateRes] = await Promise.all([
    fetch(`https://api.sleeper.app/v1/user/${username}`).then(r => r.json()),
    fetch(`https://api.sleeper.app/v1/league/${leagueId}`).then(r => r.json()),
    fetch(`https://api.sleeper.app/v1/league/${leagueId}/rosters`).then(r => r.json()),
    fetch(`https://api.sleeper.app/v1/players/nfl`).then(r => r.json()),
    fetch(`https://api.sleeper.app/v1/state/nfl`).then(r => r.json()),
  ]);

  const myRoster = rostersRes.find((r: any) => r.owner_id === userRes.user_id);
  if (!myRoster) return null;

  // Sleeper waiver_type: 0 = rolling, 1 = reverse_standings, 2 = FAAB
  const waiverTypeCode = leagueRes?.settings?.waiver_type;
  const waiverType: WaiverType =
    waiverTypeCode === 2 ? 'faab' :
    (waiverTypeCode === 0 || waiverTypeCode === 1) ? 'rolling' : 'unknown';

  const faabBudget = leagueRes?.settings?.waiver_budget ?? (waiverType === 'faab' ? 100 : undefined);
  const faabRemaining = myRoster?.settings?.waiver_budget_used !== undefined && faabBudget !== undefined
    ? faabBudget - myRoster.settings.waiver_budget_used
    : faabBudget;

  const scoringFormat: 'ppr' | 'half' | 'standard' =
    leagueRes?.scoring_settings?.rec === 1 ? 'ppr' :
    leagueRes?.scoring_settings?.rec === 0.5 ? 'half' : 'standard';

  // Build roster player list
  const rosterPlayers = (myRoster.players || []).map((pid: string) => {
    const p = allPlayersRes[pid];
    return p ? {
      id: pid,
      name: p.full_name || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim(),
      position: p.position,
      team: p.team ?? 'FA',
    } : null;
  }).filter(Boolean);

  // Detect thin positions — any position where roster has ≤1 player counts as a need
  const rosterSlots: string[] = leagueRes?.roster_positions || [];
  const posCounts: Record<string, number> = {};
  for (const p of rosterPlayers) posCounts[p.position] = (posCounts[p.position] || 0) + 1;

  const requiredPositions = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
  const needs: string[] = [];
  for (const pos of requiredPositions) {
    const startersNeeded = rosterSlots.filter(s => s === pos).length;
    const depth = posCounts[pos] ?? 0;
    // "Need" = have the bare minimum or less
    if (depth <= startersNeeded) needs.push(pos);
  }

  return {
    platform: 'sleeper',
    leagueName: leagueRes?.name ?? 'Sleeper League',
    leagueId,
    waiverType,
    faabBudget,
    faabRemaining,
    scoringFormat,
    teamCount: leagueRes?.total_rosters ?? 12,
    currentWeek: stateRes?.week,
    myRoster: rosterPlayers,
    rosterSlotsNeeded: needs,
  };
}

async function getESPNWaiverContext(leagueId: string): Promise<WaiverContext | null> {
  const creds = await loadESPNCredentials();
  if (!creds) return null;

  try {
    const { getESPNLeague, findMyESPNTeam, ESPN_POSITIONS } = await import('./espn');
    const data = await getESPNLeague(parseInt(leagueId, 10), creds);
    const myTeam = findMyESPNTeam(data, creds.swid);
    if (!myTeam) return null;

    const settings = data.settings ?? {};
    // ESPN waiver mode: 0=standard rolling, 1=reverse, 7=FAAB
    const waiverMode = settings?.acquisitionSettings?.waiverProcessDays;
    const isFAAB = settings?.acquisitionSettings?.isUsingAcquisitionBudget === true;
    const waiverType: WaiverType = isFAAB ? 'faab' : waiverMode !== undefined ? 'rolling' : 'unknown';

    const faabBudget = settings?.acquisitionSettings?.acquisitionBudget;
    const faabRemaining = myTeam?.transactionCounter?.acquisitionBudgetSpent !== undefined && faabBudget
      ? faabBudget - myTeam.transactionCounter.acquisitionBudgetSpent
      : faabBudget;

    const isPPR = settings?.scoringSettings?.scoringItems?.some(
      (item: any) => item.statId === 53 && item.points === 1
    );
    const isHalf = settings?.scoringSettings?.scoringItems?.some(
      (item: any) => item.statId === 53 && item.points === 0.5
    );
    const scoringFormat: 'ppr' | 'half' | 'standard' = isPPR ? 'ppr' : isHalf ? 'half' : 'standard';

    const rosterPlayers = (myTeam.roster?.entries || []).map((e: any) => {
      const p = e.playerPoolEntry?.player;
      return p ? {
        id: String(p.id),
        name: p.fullName,
        position: ESPN_POSITIONS[p.defaultPositionId] ?? '?',
        team: '',
      } : null;
    }).filter(Boolean);

    return {
      platform: 'espn',
      leagueName: settings?.name ?? 'ESPN League',
      leagueId,
      waiverType,
      faabBudget,
      faabRemaining,
      scoringFormat,
      teamCount: data.size ?? 12,
      currentWeek: data?.status?.currentMatchupPeriod,
      myRoster: rosterPlayers,
      rosterSlotsNeeded: [], // detailed detection would need slot mapping; keep generic
    };
  } catch (e) {
    console.log('getESPNWaiverContext error:', e);
    return null;
  }
}

async function getYahooWaiverContext(leagueKey: string): Promise<WaiverContext | null> {
  const token = await getValidYahooToken();
  if (!token) return null;

  try {
    const { getMyYahooTeam, YAHOO_API_BASE } = await import('./yahoo');
    const result = await getMyYahooTeam(leagueKey, token);
    if (!result) return null;

    // Fetch league settings for waiver type + FAAB
    const settingsRes = await fetch(`${YAHOO_API_BASE}/league/${leagueKey}/settings?format=json`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const settingsData = await settingsRes.json().catch(() => ({}));
    const leagueSettings = settingsData?.fantasy_content?.league?.[1]?.settings?.[0] ?? {};
    const leagueMeta = settingsData?.fantasy_content?.league?.[0] ?? {};

    // uses_faab = "1" if FAAB
    const waiverType: WaiverType = leagueSettings?.uses_faab === '1' ? 'faab' : 'rolling';
    const faabBudget = leagueSettings?.faab_budget ? parseInt(leagueSettings.faab_budget, 10) : undefined;
    const teamArr: any = (result.team as any);
    const faabEntry = Array.isArray(teamArr?.[0]) ? teamArr[0].find((x: any) => x?.faab_balance) : null;
    const faabRemaining = faabEntry?.faab_balance
      ? parseInt(faabEntry.faab_balance, 10)
      : faabBudget;

    const scoringType = leagueMeta?.scoring_type;
    const scoringFormat: 'ppr' | 'half' | 'standard' =
      scoringType === 'head' ? 'ppr' : 'standard'; // Yahoo doesn't expose per-rec cleanly via this endpoint

    return {
      platform: 'yahoo',
      leagueName: leagueMeta?.name ?? 'Yahoo League',
      leagueId: leagueKey,
      waiverType,
      faabBudget,
      faabRemaining,
      scoringFormat,
      teamCount: parseInt(leagueMeta?.num_teams ?? '12', 10),
      currentWeek: parseInt(leagueMeta?.current_week ?? '1', 10),
      myRoster: result.roster.players.map(p => ({
        id: p.player_key,
        name: (p.name as any)?.full ?? '',
        position: p.display_position,
        team: p.editorial_team_abbr,
      })),
      rosterSlotsNeeded: [],
    };
  } catch (e) {
    console.log('getYahooWaiverContext error:', e);
    return null;
  }
}

// ─── AI PROMPT BUILDER ──────────────────────────────────────

/**
 * Build a league-settings-aware AI prompt for a specific player.
 * Handles FAAB vs rolling, identifies drop candidates, suggests bid ranges.
 */
export function buildWaiverAdvicePrompt(
  player: AvailablePlayer,
  ctx: WaiverContext | null
): string {
  if (!ctx) {
    // No league context — generic advice only
    return `You are AIOmni, expert fantasy football waiver wire analyst.
Player: ${player.name} | ${player.position} | ${player.team}${player.injuryStatus ? ` | Injury: ${player.injuryStatus}` : ''}
${player.age ? `Age: ${player.age} | Experience: ${player.yearsExp ?? 0} yrs` : ''}
${player.trendingAdds ? `Recent adds: ${player.trendingAdds.toLocaleString()} (48h)` : ''}

Should I add this player off waivers? What's their upside? Be sharp, direct, under 90 words.`;
  }

  // Find drop candidates — roster players at a deeper position who are lower-tier
  const playersAtSamePos = ctx.myRoster.filter(r => r.position === player.position);
  const playersAtBench = ctx.myRoster.filter(r =>
    r.position !== 'QB' && r.position !== 'DEF' && r.position !== 'K'
  );
  const dropCandidates = [
    ...playersAtSamePos.slice(-2), // worst at same position
    ...playersAtBench.slice(-3),   // worst bench bodies overall
  ].filter((v, i, arr) => arr.findIndex(x => x.id === v.id) === i).slice(0, 4);

  const isNeed = ctx.rosterSlotsNeeded.includes(player.position);

  const waiverInstruction =
    ctx.waiverType === 'faab' && ctx.faabBudget !== undefined
      ? `This is a FAAB league. Budget: $${ctx.faabBudget}, remaining: $${ctx.faabRemaining ?? '?'}. Suggest a bid range (e.g. "$${Math.round((ctx.faabRemaining ?? 100) * 0.05)}–$${Math.round((ctx.faabRemaining ?? 100) * 0.15)}") based on how valuable this player is.`
      : ctx.waiverType === 'rolling'
        ? `This is a rolling waivers league (no FAAB). Advice should focus on whether to burn the waiver claim.`
        : `Waiver type unknown — give add/drop advice without bid specifics.`;

  return `You are AIOmni, expert fantasy football waiver wire analyst. You read the user's actual league settings before advising.

═══ LEAGUE CONTEXT ═══
Platform: ${ctx.platform.toUpperCase()}
League: ${ctx.leagueName}
Scoring: ${ctx.scoringFormat.toUpperCase()}
Teams: ${ctx.teamCount}
${ctx.currentWeek ? `Current Week: ${ctx.currentWeek}` : ''}
Waiver Type: ${ctx.waiverType.toUpperCase()}${ctx.waiverType === 'faab' ? ` ($${ctx.faabRemaining ?? '?'}/$${ctx.faabBudget ?? '?'} remaining)` : ''}

═══ TARGET PLAYER ═══
${player.name} — ${player.position} — ${player.team}
${player.injuryStatus ? `Injury: ${player.injuryStatus}` : ''}
${player.age ? `Age ${player.age}, ${player.yearsExp ?? 0}yr exp` : ''}
${player.trendingAdds ? `Trending: ${player.trendingAdds.toLocaleString()} adds in last 48h` : ''}
${player.percentOwned !== undefined ? `Rostered: ${player.percentOwned.toFixed(0)}%` : ''}
Positional Need: ${isNeed ? 'YES — you are thin at this position' : 'NO — you have depth here'}

═══ MY ROSTER (${ctx.myRoster.length} players) ═══
${ctx.myRoster.map(p => `${p.position}: ${p.name} (${p.team})`).join('\n')}

═══ POTENTIAL DROPS ═══
${dropCandidates.length > 0 ? dropCandidates.map(p => `${p.position}: ${p.name}`).join('\n') : '(no obvious drops)'}

═══ ADVICE INSTRUCTIONS ═══
${waiverInstruction}

Give a verdict in this format:
1. ADD/PASS (one word)
2. If ADD: Who to drop (one name from my roster, or "open bench spot" if none needed)
3. If FAAB: Suggested bid range
4. Reasoning (2 sentences max — why this player fits my specific roster)

Be direct. No hedging. Total response under 100 words.`;
}