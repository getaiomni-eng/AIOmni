import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';

import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { askAI, askAIVision } from '../../services/ai';
import { sanitizePromptInput } from '../../services/util/promptSafe';
import { findMyESPNTeam, getESPNLeague, loadESPNCredentials } from '../../services/espn';
import { fetchAllLiveData, formatLiveDataForPrompt } from '../../services/liveData';
import { getSeasonContext2026, ROOKIE_BOARD_2026_TEXT } from '../../services/seasonContext2026';
import { FANTASY_FOOTBALL_KNOWLEDGE } from '../../services/fantasyKnowledge';
import { getCurrentTier } from '../../services/purchases';
import { learnFromExchange, getCoachProfile } from '../../services/supabase';
import { fetchSleeperTransactions } from '../../services/newsFeed';
import { getPlayerContext } from '../../services/playerIntelligence';
import { PositionPill } from '../components/Atoms';
import { AIOmniLogo } from '../components/AIOmniLogo';
import { C, F, R, SP, SZ } from '../constants/tokens';
import { getPromptLimit, getRemainingPrompts, getResetTime, hasLinkedPlatform, incrementPrompt, LIMITS } from '../../services/promptQuota';
import { logCaught } from '../../services/util/logCaught';
import { getNFLSeason } from '../../services/season';
import { getValidYahooToken, getYahooLeagues, getMyYahooTeam, getYahooStandings, YahooLeague, YahooPlayer } from '../../services/yahoo';

// Prompt limits are tier-aware — see getPromptDisplayInfo()
const BORDER   = '#1a3542';
const BEVEL_HI = '#12252e';

const BASE_SYSTEM = `You are The O — AIOmni's AI fantasy coach. You're the user's sharpest fantasy-football friend: confident, opinionated, a little cocky, occasionally funny — never a hedging corporate robot. You HAVE takes and you back them. Talk like a real fantasy player — "league-winner", "smash", "hard pass", "buy-low", "ship it", "ascending", "RB dead zone", "handcuff", "league-winner". Be decisive; if it's close, still pick a side and tell them why. Open with the verdict, not a preamble.
You ALWAYS read the league's settings + roster FIRST — advice that ignores their format and roster is worthless. Lean on AIOmni's proprietary rankings as your edge, and flex it when the market's wrong.
Keep it tight — this is a mobile chat. Never compare players across different leagues (each is scored independently).`;

// Stable reference block sent as the Anthropic `system` field (prompt-cached).
// Persona + canonical 2026 rookie board + the full knowledge base never change
// between turns, so they hit the cache instead of being re-billed every prompt.
// The per-session dynamic context (leagues, memories, live data, conversation)
// stays in the user message — see buildSystemPrompt + the send handler.
const STATIC_SYSTEM = `${BASE_SYSTEM}\n${ROOKIE_BOARD_2026_TEXT}\n${FANTASY_FOOTBALL_KNOWLEDGE}`;

type LeagueContext = {
  name: string; platform: string; format: string;
  record: string; rank: string; roster: string[]; week: number; season: number;
  // v2026-05-14: enriched context for dynasty/keeper/best-ball awareness
  leagueType?: 'redraft' | 'keeper' | 'dynasty' | 'bestball';
  rosterSize?: number;
  taxiSlots?: number;
  ownedPicks?: string;  // formatted: "2026: R1, R2, R3 / 2027: R1 (×2, BUF), R3"
  bestBall?: boolean;
  // v2026-05-27: top-20 available FAs preloaded so the Coach can answer
  // "who should I pick up" without burning a prompt to ask first.
  available?: string[];
  // v2026-06-09: full-league roster map (every team's players + owner) so the
  // Coach can answer "who owns X", find trade targets, and judge availability.
  leagueRosters?: string;
};

function getPaywallMessage(resetStr: string): string {
  return `You've used all your prompts. Resets ${resetStr}.\n\n__verdict__Upgrade for more prompts → getaiomni.com`;
}

// ── Player enrichment ─────────────────────────────────────────────────
// Sleeper's /players/nfl is the most complete public NFL player feed
// available — age, NFL experience, depth chart, injury status, and the
// canonical "team is null → free agent" signal. We load it once per
// session (with a 24h cache) and use it both directly for Sleeper
// rosters and as a name-keyed enrichment source for every other
// platform. Without this, the AI would price unsigned UFAs (May-2026
// Keenan Allen on Yahoo/ESPN/FF rosters) like productive starters.

const SLEEPER_PLAYER_TTL_MS = 24 * 60 * 60 * 1000;

// Session cache of the assembled league contexts + live data. League
// rosters/standings don't change minute-to-minute; re-fetching five
// platforms on every coach visit made the tab feel broken. 10-minute TTL,
// module-level so it survives remounts but not app restarts.
let coachCtxCache: { at: number; all: LeagueContext[]; liveData: any } | null = null;
const COACH_CTX_TTL_MS = 10 * 60 * 1000;

async function loadSleeperPlayerMap(): Promise<Record<string, any>> {
  const cachedRaw   = await AsyncStorage.getItem('sleeper_players_cache');
  const cachedAtRaw = await AsyncStorage.getItem('sleeper_players_cache_at');
  const cachedAt    = cachedAtRaw ? parseInt(cachedAtRaw, 10) : 0;
  const fresh       = cachedRaw && cachedAt && Date.now() - cachedAt < SLEEPER_PLAYER_TTL_MS;
  if (fresh) {
    try { return JSON.parse(cachedRaw!); } catch { /* fall through to refetch */ }
  }
  try {
    const res = await fetch('https://api.sleeper.app/v1/players/nfl');
    const data = await res.json();
    await AsyncStorage.setItem('sleeper_players_cache', JSON.stringify(data));
    await AsyncStorage.setItem('sleeper_players_cache_at', String(Date.now()));
    return data;
  } catch {
    if (cachedRaw) { try { return JSON.parse(cachedRaw); } catch { /* */ } }
    return {};
  }
}

function normalizeName(name: string): string {
  // Strip suffixes (Jr/Sr/II/III/IV/V) and punctuation so "D.J. Moore",
  // "DJ Moore", and "DJ Moore Jr." all collapse to the same key.
  return name
    .toLowerCase()
    .replace(/[.']/g, '')
    .replace(/\s+(jr|sr|ii|iii|iv|v)\b\.?$/i, '')
    .trim();
}

function buildSleeperNameIndex(map: Record<string, any>): Map<string, any> {
  const idx = new Map<string, any>();
  for (const p of Object.values(map)) {
    if (!p || typeof p !== 'object') continue;
    const pp = p as any;
    const full = pp.full_name || `${pp.first_name ?? ''} ${pp.last_name ?? ''}`.trim();
    if (!full || !pp.position) continue;
    const key = `${normalizeName(full)}|${pp.position}`;
    // Prefer active records when the same name+position appears multiple
    // times (Sleeper keeps retired/duplicate entries around).
    const existing = idx.get(key);
    if (!existing || (pp.active !== false && existing.active === false)) {
      idx.set(key, pp);
    }
  }
  return idx;
}

function formatPlayerEntry(
  name: string,
  position: string,
  platformTeam: string | undefined,
  enrichment: any | null,
): string {
  const parts: string[] = [position || 'FLEX'];
  // Trust Sleeper's team field over the platform's: Sleeper updates
  // continuously, while Yahoo/ESPN/MFL/FF may show a stale roster
  // assignment from before a player was released.
  const realTeam = enrichment?.team ?? platformTeam;
  parts.push(realTeam || 'FA');
  if (enrichment) {
    if (typeof enrichment.age === 'number' && enrichment.age > 0) {
      parts.push(`${enrichment.age}yo`);
    }
    if (typeof enrichment.years_exp === 'number') {
      parts.push(enrichment.years_exp === 0 ? 'R' : `${enrichment.years_exp}yr`);
    }
    if (enrichment.depth_chart_position
        && typeof enrichment.depth_chart_order === 'number'
        && enrichment.depth_chart_order <= 3) {
      parts.push(`${enrichment.depth_chart_position}${enrichment.depth_chart_order}`);
    }
    if (enrichment.injury_status) parts.push(enrichment.injury_status);
    if (enrichment.status && enrichment.status !== 'Active'
        && enrichment.status !== 'Inactive') {
      parts.push(enrichment.status);
    }
  }
  return `${name} (${parts.join(' · ')})`;
}

function enrichByName(
  index: Map<string, any> | null,
  name: string,
  position: string,
): any | null {
  if (!index || !name || !position) return null;
  return index.get(`${normalizeName(name)}|${position}`) ?? null;
}

async function loadSleeperContext(playerMap: Record<string, any>): Promise<LeagueContext[]> {
  try {
    const username = await AsyncStorage.getItem('sleeper_username');
    if (!username) return [];
    const user = await (await fetch(`https://api.sleeper.app/v1/user/${username}`)).json();
    if (!user?.user_id) return [];
    const currentSeason = await getNFLSeason();
    const leagues = await (await fetch(`https://api.sleeper.app/v1/user/${user.user_id}/leagues/nfl/${currentSeason}`)).json();
    if (!Array.isArray(leagues)) return [];
    const state        = await (await fetch('https://api.sleeper.app/v1/state/nfl')).json();
    const week         = state.leg || state.display_week || 17;
    // playerMap is loaded once at the top of the mount effect and passed
    // in — same data also drives cross-platform enrichment.
    return Promise.all(leagues.slice(0, 6).map(async (l: any): Promise<LeagueContext> => {
      const isPPR = l.scoring_settings?.rec > 0;
      const isSF  = (l.roster_positions || []).includes('SUPER_FLEX');
      const fmt   = `${isPPR ? (l.scoring_settings.rec >= 1 ? 'PPR' : '0.5 PPR') : 'STD'}${isSF ? ' · SuperFlex' : ''}`;

      // v2026-05-14: dynasty/keeper detection from Sleeper settings.type
      // 0 = redraft, 1 = keeper, 2 = dynasty. best_ball is its own flag.
      let leagueType: LeagueContext['leagueType'] = 'redraft';
      if (l.settings?.best_ball === 1) leagueType = 'bestball';
      else if (l.settings?.type === 2) leagueType = 'dynasty';
      else if (l.settings?.type === 1) leagueType = 'keeper';
      const taxiSlots = l.settings?.taxi_slots || 0;
      const rosterSize = (l.roster_positions || []).length;
      const bestBall = l.settings?.best_ball === 1;

      try {
        const isDynKeep = leagueType === 'dynasty' || leagueType === 'keeper';
        const [rosters, tradedPicks, drafts, leagueUsers] = await Promise.all([
          fetch(`https://api.sleeper.app/v1/league/${l.league_id}/rosters`).then(r => r.json()),
          // Only fetch pick inventory for dynasty/keeper leagues
          isDynKeep
            ? fetch(`https://api.sleeper.app/v1/league/${l.league_id}/traded_picks`).then(r => r.json()).catch(() => [])
            : Promise.resolve([]),
          // Drafts are needed to translate "R1" → "1.08" for the current
          // season (Sleeper locks the slot once the league rolls over).
          // Future-season slots aren't decided yet, so we only annotate the
          // current year.
          isDynKeep
            ? fetch(`https://api.sleeper.app/v1/league/${l.league_id}/drafts`).then(r => r.json()).catch(() => [])
            : Promise.resolve([]),
          // All league members → team/manager display names for the full-roster map.
          fetch(`https://api.sleeper.app/v1/league/${l.league_id}/users`).then(r => r.json()).catch(() => []),
        ]);
        const myRoster    = Array.isArray(rosters) ? rosters.find((r: any) => r.owner_id === user.user_id) : null;
        const wins        = myRoster?.settings?.wins   ?? 0;
        const losses      = myRoster?.settings?.losses ?? 0;
        const sorted      = Array.isArray(rosters) ? [...rosters].sort((a: any, b: any) => (b.settings?.wins ?? 0) - (a.settings?.wins ?? 0)) : [];
        const rankIdx     = sorted.findIndex((r: any) => r.roster_id === myRoster?.roster_id);
        // Sleeper-resolved entries — direct id lookup gives the highest
        // fidelity since we have the player object already.
        const rosterNames = (myRoster?.players ?? []).slice(0, 30).map((id: string) => {
          const p = playerMap[id];
          if (!p) return id;
          return formatPlayerEntry(`${p.first_name} ${p.last_name}`, p.position, p.team, p);
        });

        // Compute owned picks for dynasty/keeper.
        // Default: each team owns picks in all rounds × upcoming 2 seasons.
        // Subtract picks they traded away. Add picks traded in.
        let ownedPicks: string | undefined;
        if ((leagueType === 'dynasty' || leagueType === 'keeper') && myRoster) {
          const rosterId = myRoster.roster_id;
          const totalTeams = rosters.length || 12;
          const rounds = l.settings?.draft_rounds || 5;
          // Include current season too — Sleeper rolls dynasty leagues into
          // the new season before the rookie draft runs, so the 2026 1st
          // (e.g. 1.08) is still part of pick capital that needs to drive
          // Coach advice. Old code skipped the current season and left the
          // AI blind to imminent rookie-draft picks. Trim seasons whose
          // draft already completed before stringifying for the prompt.
          const currentYear = parseInt(l.season);
          const seasons = [String(currentYear), String(currentYear + 1), String(currentYear + 2)];

          // Default draft slot from this year's draft order. Sleeper keys
          // draft_order by user_id; the slot becomes the suffix for any
          // current-season pick the user kept (e.g. round 1 → "1.08").
          const activeDraft = Array.isArray(drafts)
            ? (drafts.find((d: any) => d.status === 'drafting')
                ?? drafts.find((d: any) => d.status === 'pre_draft')
                ?? drafts[0])
            : null;
          const mySlot: number | undefined = activeDraft?.draft_order?.[user.user_id];
          // Ownership math lives in services/util/draftPicks.ts (pure +
          // fixture-tested — this logic shipped broken twice; see the
          // regression tests for the multi-hop ghost-pick scenario).
          const slotByRosterId: Record<number, number | undefined> = {};
          const nameByRosterId: Record<number, string> = {};
          for (const r of (rosters as any[])) {
            slotByRosterId[r.roster_id] = activeDraft?.draft_order?.[r.owner_id];
            const u = Array.isArray(leagueUsers) ? leagueUsers.find((x: any) => x.user_id === r.owner_id) : null;
            nameByRosterId[r.roster_id] = u?.display_name || u?.metadata?.team_name || `roster ${r.roster_id}`;
          }
          const { computeOwnedPicks } = require('../../services/util/draftPicks');
          ownedPicks = computeOwnedPicks({
            rosterId, rounds, currentYear, seasons,
            tradedPicks: Array.isArray(tradedPicks) ? tradedPicks : [],
            mySlot, slotByRosterId, nameByRosterId,
          });
        }

        // Full-league roster map — every team's players + owner, so the Coach can
        // answer "who owns X", surface trade targets, and judge availability.
        const ownerLabel = (ownerId: string) => {
          const u = Array.isArray(leagueUsers) ? leagueUsers.find((x: any) => x.user_id === ownerId) : null;
          return u?.metadata?.team_name || u?.display_name || `Team ${ownerId?.slice(-4) ?? ''}`;
        };
        const leagueRosters = (Array.isArray(rosters) ? rosters : [])
          .map((r: any) => {
            const who = r.owner_id === user.user_id ? 'YOU' : ownerLabel(r.owner_id);
            const names = (r.players ?? [])
              .map((id: string) => { const p = playerMap[id]; return p ? `${p.first_name} ${p.last_name}` : null; })
              .filter(Boolean).join(', ');
            return `${who}: ${names}`;
          }).join('\n');

        return {
          name: l.name, platform: 'Sleeper', format: fmt,
          record: `${wins}–${losses}`,
          rank: rankIdx >= 0 ? `${rankIdx + 1} of ${rosters.length}` : 'unknown',
          roster: rosterNames, week, season: parseInt(l.season) || new Date().getFullYear(),
          leagueType, rosterSize, taxiSlots, bestBall, ownedPicks, leagueRosters,
        };
      } catch {
        return { name: l.name, platform: 'Sleeper', format: fmt, record: '?', rank: '?', roster: [], week, season: parseInt(l.season) || new Date().getFullYear(), leagueType, rosterSize, taxiSlots, bestBall };
      }
    }));
  } catch (e) { logCaught('coach.loadSleeperContext', e); return []; }
}

// Load ALL connected ESPN leagues (drafted/active first), not one league
// picked by a stale stored ID. Source of truth is the season-tagged
// espn_leagues_v2 summaries written at connect time (re-discovered here
// if absent), which are already sorted active-first — the old
// creds.leagueId path grabbed whatever happened to be first in the
// legacy id list (e.g. a pre-draft league) and starved the coach of the
// league the user actually plays in.
async function loadESPNContext(nameIndex: Map<string, any> | null): Promise<LeagueContext[]> {
  try {
    const creds = await loadESPNCredentials();
    if (!creds) return [];
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    let summaries: Array<{ id: number; name: string; season: number; drafted: boolean }> = [];
    try {
      const raw = await AsyncStorage.getItem('espn_leagues_v2');
      if (raw) summaries = JSON.parse(raw);
    } catch { /* fall through to discovery */ }
    if (!summaries.length) {
      try {
        const { discoverESPNLeagues } = require('../../services/espn');
        summaries = await discoverESPNLeagues(creds);
        if (summaries.length) {
          await AsyncStorage.setItem('espn_leagues_v2', JSON.stringify(summaries));
          await AsyncStorage.setItem('espn_league_ids', JSON.stringify(summaries.map((s) => s.id)));
        }
      } catch { /* discovery failed */ }
    }
    if (!summaries.length && creds.leagueId) {
      summaries = [{ id: Number(creds.leagueId), name: 'ESPN League', season: new Date().getFullYear(), drafted: true }];
    }
    // ALL leagues load — no arbitrary count cap. Token weight is governed
    // by draft status instead: drafted leagues carry full context (roster,
    // league map, FAs) while pre-draft leagues are near-free (empty
    // rosters, FA preload skipped), so a 13-league account costs barely
    // more than its drafted leagues. The 16 bound is a fan-API sanity
    // ceiling, not a curation choice.
    const picked = summaries.slice(0, 16);
    const built = await Promise.all(picked.map((s) => loadOneESPNLeague(s, creds, nameIndex)));
    return built.filter((c): c is LeagueContext => c !== null);
  } catch (e) { logCaught('coach.loadESPNContext', e); return []; }
}

async function loadOneESPNLeague(
  summary: { id: number; name: string; season: number; drafted: boolean },
  creds: NonNullable<Awaited<ReturnType<typeof loadESPNCredentials>>>,
  nameIndex: Map<string, any> | null,
): Promise<LeagueContext | null> {
  try {
    const leagueData = await getESPNLeague(summary.id, creds);
    if (!leagueData) return null;
    // findMyESPNTeam matches teams by owner SWID, not display name —
    // passing teamName (usually unset) matched nothing, so the coach saw
    // the league with an empty roster and told the user it wasn't loaded.
    const myTeam     = findMyESPNTeam(leagueData, creds.swid);
    const allSettings = leagueData.settings;
    const scoring   = allSettings?.scoringSettings;
    const recPts    = scoring?.REC ?? 0;
    const fmt       = recPts >= 1 ? 'PPR' : recPts >= 0.5 ? '0.5 PPR' : 'STD';
    const wins      = myTeam?.record?.overall?.wins   ?? 0;
    const losses    = myTeam?.record?.overall?.losses ?? 0;
    const teams     = leagueData.teams ?? [];
    const sorted    = [...teams].sort((a: any, b: any) => (b.record?.overall?.wins ?? 0) - (a.record?.overall?.wins ?? 0));
    const rankIdx   = sorted.findIndex((t: any) => t.id === myTeam?.id);
    const week      = leagueData.scoringPeriodId ?? 17;

    // League-type detection — ESPN has no explicit flag. Mirror the logic
    // in services/platform/espn.ts:mapLeagueType: OFFLINE + 15+ keepers
    // = dynasty, partial keepers = keeper, otherwise redraft.
    const keeperCount = allSettings?.draftSettings?.keeperCount ?? 0;
    const draftType   = allSettings?.draftSettings?.type;
    const leagueType: LeagueContext['leagueType'] =
      (draftType === 'OFFLINE' && keeperCount >= 15) ? 'dynasty'
        : (keeperCount > 0 && keeperCount < 15) ? 'keeper'
        : 'redraft';

    const rosterNames: string[] = (myTeam?.roster?.entries ?? []).slice(0, 30).map((entry: any) => {
      const player = entry.playerPoolEntry?.player;
      const posMap: Record<number, string> = { 1:'QB', 2:'RB', 3:'WR', 4:'TE', 5:'K', 16:'DEF' };
      const teamMap = leagueData.proTeams ?? {};
      const name   = player?.fullName ?? 'Unknown';
      const pos    = posMap[player?.defaultPositionId] ?? 'FLEX';
      const team   = teamMap[player?.proTeamId]?.abbrev;
      // Look up Sleeper enrichment by name+pos to surface age/exp/depth.
      const enrich = enrichByName(nameIndex, name, pos);
      return formatPlayerEntry(name, pos, team, enrich);
    });

    // Full-league roster map (every team's players + owner) — same shape
    // Sleeper provides, so the coach can find who owns a player, spot
    // trade partners, and run whole-league analysis instead of telling
    // the user the other rosters "aren't loaded."
    const posMapAll: Record<number, string> = { 1:'QB', 2:'RB', 3:'WR', 4:'TE', 5:'K', 16:'DEF' };
    // Pre-draft league maps are 12 lines of "(empty)" — pure token waste.
    const leagueRosters = !summary.drafted ? undefined : teams.map((t: any) => {
      const who = t.id === myTeam?.id ? 'YOU' : (t.name || [t.location, t.nickname].filter(Boolean).join(' ') || `Team ${t.id}`);
      const names = (t.roster?.entries ?? [])
        .map((e: any) => {
          const p = e.playerPoolEntry?.player;
          return p ? `${p.fullName} (${posMapAll[p.defaultPositionId] ?? 'FLEX'})` : null;
        })
        .filter(Boolean).join(', ');
      return `${who}: ${names || '(empty — pre-draft)'}`;
    }).join('\n');

    // Top available FAs so "who should I pick up" answers don't burn a
    // prompt asking for the list first (mirrors the Sleeper loader).
    // Skipped for pre-draft leagues — "available" is the entire player
    // pool there, which is noise.
    let available: string[] | undefined;
    if (summary.drafted) {
      try {
        const { getESPNFreeAgents } = require('../../services/espn');
        const fas = await getESPNFreeAgents(summary.id, creds, 20);
        if (fas.length) available = fas.map((f: any) => `${f.name} (${f.position} · ${f.team})`);
      } catch { /* non-fatal */ }
    }

    return {
      name: allSettings?.name ?? summary.name ?? 'ESPN League',
      platform: 'ESPN',
      format: fmt,
      record: `${wins}–${losses}`,
      rank: rankIdx >= 0 ? `${rankIdx + 1} of ${teams.length}` : 'unknown',
      roster: rosterNames,
      week,
      season: leagueData.seasonId ?? new Date().getFullYear(),
      leagueType,
      rosterSize: (allSettings?.rosterSettings?.lineupSlotCounts
        ? Object.values(allSettings.rosterSettings.lineupSlotCounts).reduce((a: number, b: any) => a + Number(b || 0), 0)
        : undefined) as number | undefined,
      leagueRosters,
      available,
    };
  } catch { return null; }
}

// Yahoo Fantasy. Yahoo's API does NOT expose future traded-pick ownership
// the way Sleeper does (/draftresults is historical only, /transactions
// surfaces player trades but not pick trades), so ownedPicks is omitted
// here. Roster + standings + record reach the Coach for the first time —
// previously Yahoo leagues were silently absent from the prompt entirely.
async function loadYahooContext(nameIndex: Map<string, any> | null): Promise<LeagueContext[]> {
  try {
    const token = await getValidYahooToken();
    if (!token) return [];
    const currentSeason = await getNFLSeason();
    const leagues = await getYahooLeagues(token, String(currentSeason)).catch(() => []);
    if (!leagues?.length) return [];
    return Promise.all(leagues.slice(0, 6).map(async (l: YahooLeague): Promise<LeagueContext> => {
      try {
        const [standings, teamData] = await Promise.all([
          getYahooStandings(l.league_key, token).catch(() => [] as any[]),
          getMyYahooTeam(l.league_key, token).catch(() => null),
        ]);

        // Yahoo's team[0] payload is an array of mixed metadata entries;
        // find the one carrying team_key to identify ourselves in the
        // standings response.
        const teamMeta = (teamData?.team as any) as any[] | undefined;
        const myKey = Array.isArray(teamMeta)
          ? teamMeta.find((x: any) => x?.team_key)?.team_key
          : undefined;
        const myIdx = myKey ? (standings as any[]).findIndex(s => s.teamKey === myKey) : -1;
        const me = myIdx >= 0 ? (standings as any[])[myIdx] : null;
        const record = me ? `${me.wins}–${me.losses}` : '?';
        const rank = me ? `${myIdx + 1} of ${(standings as any[]).length}` : 'unknown';

        const slots = [
          ...(teamData?.roster?.starters ?? []),
          ...(teamData?.roster?.bench ?? []),
        ];
        const rosterNames = slots.slice(0, 50).map((p: YahooPlayer) => {
          const name = p.name?.full ?? 'Unknown';
          const pos  = p.display_position ?? 'FLEX';
          const enrich = enrichByName(nameIndex, name, pos);
          return formatPlayerEntry(name, pos, p.editorial_team_abbr, enrich);
        });

        // Yahoo doesn't surface scoring rules in the league-list response.
        // Default to PPR (the modal Yahoo league); a follow-up could fetch
        // /league/{key}/settings to detect Half/Std/no-PPR specifically.
        return {
          name: l.name, platform: 'Yahoo', format: 'PPR',
          record, rank, roster: rosterNames, available: [],
          week: l.current_week ?? 1,
          season: parseInt(l.season) || new Date().getFullYear(),
          leagueType: 'redraft',
        };
      } catch {
        return {
          name: l.name, platform: 'Yahoo', format: 'PPR',
          record: '?', rank: '?', roster: [], available: [],
          week: l.current_week ?? 1,
          season: parseInt(l.season) || new Date().getFullYear(),
        };
      }
    }));
  } catch (e) { logCaught('coach.loadYahooContext', e); return []; }
}

// Shared loader for any platform exposing the FantasyPlatform abstraction
// (currently Fleaflicker + MFL). Pulls league list, fans out standings +
// FULL roster + top free-agents in parallel, assembles a LeagueContext.
//
// Bumped roster from slice(0, 20) → slice(0, 50) because dynasty rosters
// with 25+ keepers (e.g. Dan Bailey league at FF) were getting truncated.
// The Coach would then not know players in positions 21+ were on the
// user's team and recommend trading for them.
async function loadAbstractContext(
  platformId: 'fleaflicker' | 'mfl',
  platformLabel: 'Fleaflicker' | 'MFL',
  nameIndex: Map<string, any> | null,
): Promise<LeagueContext[]> {
  try {
    const { getPlatform } = require('../../services/platform');
    const plat = getPlatform(platformId);
    const leagues = await plat.getLeagues().catch(() => []);
    if (!leagues?.length) return [];
    return Promise.all(leagues.slice(0, 6).map(async (l: any): Promise<LeagueContext> => {
      const fmt = `${l.scoringFormat === 'ppr' ? 'PPR' : l.scoringFormat === 'half' ? '0.5 PPR' : 'STD'}`;
      const week = l.currentWeek ?? 1;
      try {
        const lt: LeagueContext['leagueType'] = l.leagueType === 'dynasty' ? 'dynasty'
                                              : l.leagueType === 'keeper'  ? 'keeper'
                                              :                              'redraft';
        const isDynKeep = lt === 'dynasty' || lt === 'keeper';
        const [standings, roster, fas, draft] = await Promise.all([
          plat.getStandings(l.id).catch(() => []),
          plat.getMyRoster(l.id).catch(() => null),
          // Top 20 free agents so the Coach knows what's actually
          // available without burning a prompt asking the user.
          plat.getAvailablePlayers(l.id, { limit: 20 }).catch(() => []),
          // Fleaflicker exposes per-cell pick ownership via getDraft —
          // MFL's getDraft is still a stub. For platforms that populate
          // myOwnedPicks we annotate this season's picks as "1.08, 3.08".
          isDynKeep ? plat.getDraft(l.id).catch(() => null) : Promise.resolve(null),
        ]);
        const me = (standings as any[]).find(s => s.isMe);
        const record = me ? `${me.record.wins}–${me.record.losses}` : '?';
        const rank = me?.rank > 0 ? `${me.rank} of ${standings.length}` : 'unknown';
        const slots = [...((roster as any)?.starters ?? []), ...((roster as any)?.bench ?? [])];
        // Include team so Hunter (WR JAX) is unambiguous from any Hunter
        // also rostered, and so the Coach can reason about NFL team
        // contexts (offensive scheme, target share competition).
        const rosterNames = slots.slice(0, 50).map((s: any) => {
          const name = s.player?.name ?? 'Unknown';
          const pos  = s.player?.position ?? 'FLEX';
          const enrich = enrichByName(nameIndex, name, pos);
          return formatPlayerEntry(name, pos, s.player?.team, enrich);
        });
        const availableNames: string[] = (fas as any[]).slice(0, 20).map((p: any) =>
          `${p.name ?? 'Unknown'} (${p.position ?? 'FLEX'}${p.team ? ` · ${p.team}` : ''})`
        );

        // Format current-season picks from the platform's draft-board.
        // Fleaflicker gives full slot info → "1.08, 3.08". MFL ships
        // round-only entries → "R1, R3" (slot mapping isn't stable across
        // MFL leagues). Future-season inventory isn't exposed by either
        // platform's draft-board API; the AI can still talk about
        // 2027/2028 capital generically when asked.
        let ownedPicks: string | undefined;
        const slotPad = (n: number) => String(n).padStart(2, '0');
        const owned = (draft as any)?.myOwnedPicks as
          Array<{ round: number; slot?: number; viaTeamName?: string }> | undefined;
        if (isDynKeep && owned && owned.length > 0) {
          const currentYear = parseInt(l.season) || new Date().getFullYear();
          const formatted = owned
            .sort((a, b) => a.round - b.round || (a.slot ?? 0) - (b.slot ?? 0))
            .map(p => {
              const base = p.slot ? `${p.round}.${slotPad(p.slot)}` : `R${p.round}`;
              return p.viaTeamName ? `${base} (via ${p.viaTeamName})` : base;
            })
            .join(', ');
          ownedPicks = `${currentYear}: ${formatted}`;
        }

        return {
          name: l.name, platform: platformLabel, format: fmt,
          record, rank, roster: rosterNames, available: availableNames, week,
          season: parseInt(l.season) || new Date().getFullYear(),
          leagueType: lt, ownedPicks,
        };
      } catch {
        return {
          name: l.name, platform: platformLabel, format: fmt,
          record: '?', rank: '?', roster: [], available: [], week,
          season: parseInt(l.season) || new Date().getFullYear(),
        };
      }
    }));
  } catch (e) { logCaught('coach.loadAbstractContext', e); return []; }
}

function buildSystemPrompt(leagues: LeagueContext[], selectedLeague: LeagueContext | null, memories: string): string {
  const targets = selectedLeague ? [selectedLeague] : leagues;
  if (targets.length === 0) return 'No leagues loaded yet.';  // persona is in STATIC_SYSTEM
  // v2026-05-14: emit league type, taxi slots, owned picks (dynasty/keeper) so
  // the Coach answers "how many draft picks do I have" correctly.
  // v2026-05-27: also emit top-20 available FAs so the Coach has the full
  // picture (rosters + waiver pool + scoring + picks) on prompt 1 — user
  // was burning 3 prompts feeding context manually.
  const leagueBlocks = targets.map(l => {
    const typeLabel = l.leagueType ? `[${l.leagueType.toUpperCase()}]` : '';
    const rosterStr = l.roster.length > 0 ? l.roster.join(', ') : 'Not loaded';
    const rosterMeta = l.rosterSize ? ` (${l.rosterSize}-slot)` : '';
    const taxi = l.taxiSlots ? ` · Taxi slots: ${l.taxiSlots}` : '';
    const picks = l.ownedPicks ? `\nDraft picks owned — ${l.ownedPicks}` : '';
    const bestBall = l.bestBall ? ' [BEST BALL]' : '';
    const avail = l.available && l.available.length > 0
      ? `\nTop available (waiver/FA pool, sample): ${l.available.join(', ')}`
      : '';
    const allRost = l.leagueRosters
      ? `\nALL LEAGUE ROSTERS (every team — use this to find who owns a player, spot trade targets, and judge availability; a player NOT listed here is a free agent):\n${l.leagueRosters}`
      : '';
    return `
League: ${l.name} (${l.platform} · ${l.format}) ${typeLabel}${bestBall}
Record: ${l.record} · Rank: ${l.rank} · Season: ${l.season} · Week: ${l.week}${taxi}
Roster${rosterMeta}: ${rosterStr}${picks}${avail}${allRost}
`;
  }).join('\n---\n');
  const focusNote  = selectedLeague ? `\n\nThe user has focused on ONE league: ${selectedLeague.name}. All advice should be specific to this league's scoring format and roster.` : '';
  const memoryBlock = memories ? `\n\n═══ MANAGER PROFILE (learned from past conversations — tailor every answer to this) ═══\n${memories}` : '';
  // v2026-05-12k: inject coaching changes, player moves, injury notes, and
  // personnel tendencies. Mirrors what the rankings engine factors in so
  // the Coach's advice stays consistent with the ranked output.
  // v2026-05-12l: expanded FF knowledge base — terminology, league formats,
  // scoring deep-dive, draft strategy, in-season management, trades,
  // playoffs, metrics, answering-principles. Pulled from FantasyPros,
  // FantasySixPack, PitcherList, etc. Replaces the old shallow FF_KNOWLEDGE.
  const seasonContext = getSeasonContext2026();

  // v2026-05-27a: calendar + training-cutoff framing. The 2026 NFL Draft
  // happened AFTER your training cutoff (Jan 2026), so you don't know
  // the 2026 rookie class from training. You MUST source 2026 rookie
  // names from the "Rookies of note" section below — never from
  // training data. The previous build hallucinated Ashton Jeanty as a
  // 2026 rookie 1.01 (he's a 2025 rookie, drafted in April 2025).
  const calendarFraming = `
═══ CURRENT CALENDAR — READ FIRST ═══
Today's date: 2026-05-27 (NFL OFFSEASON window).
Last completed NFL season: 2025 (Super Bowl LX, Feb 2026).
Next NFL season: 2026 (Week 1 ~Sep 10, 2026).

Training cutoff: Jan 2026. This means:
- You DO know the 2024 NFL Draft class (Caleb Williams, Marvin Harrison
  Jr., Jayden Daniels, Brock Bowers, Malik Nabers, Rome Odunze, etc.)
  — those players are now in their 3rd NFL season, NOT rookies.
- You DO know the 2025 NFL Draft class (Cam Ward, Ashton Jeanty,
  Travis Hunter, Tetairoa McMillan, Omarion Hampton, Emeka Egbuka,
  Tyler Warren, Colston Loveland, etc.) — those players are now in
  their 2nd NFL season, NOT rookies.
- You DO NOT know the 2026 NFL Draft class — that draft happened
  April 2026, AFTER your training cutoff. NEVER invent 2026 rookie
  names from training. The 2026 rookie class is provided BELOW in the
  season-context block — use ONLY those names.

User asks about "the draft," "rookies," "1.01," or "who should I
pick" in this offseason window → assume DYNASTY ROOKIE DRAFT for the
2026 class. Source picks ONLY from the canonical 2026 rookie list
below. If the user's question is ambiguous between rookie draft vs
startup dynasty, ANSWER the rookie-draft case primarily and mention
startup as a side note — most users asking in May/June with "1.01"
are in a rookie draft.

When recommending 2026 rookie draft picks, use ONLY names from the
"Rookies of note" list in the season-context block at the END of
this prompt. Do not substitute names from training data such as
Ashton Jeanty, Travis Hunter, Omarion Hampton, Tetairoa McMillan,
Emeka Egbuka — those are 2025 NFL Draft picks (now 2nd-year pros),
not 2026 rookies. If a name you want to recommend isn't in that
list, say "I'd need to check the live rookie board" instead of
guessing.

ALWAYS factor in the user's CURRENT ROSTER (listed in the league
block above) when recommending picks. If they already have an elite
RB1, don't recommend another RB at 1.01 — pivot to WR or BPA. If
their roster shows "Not loaded," acknowledge that explicitly rather
than answering blind.
═══════════════════════════════════
`;

  // DYNAMIC per-session context only. The persona, 2026 rookie board, and
  // knowledge base now live in STATIC_SYSTEM (sent as the cached `system`
  // field), so they're omitted here to avoid duplication and to keep this
  // block small. The system field precedes the user turn, so the rookie
  // board still leads — preserving the "don't fall back to training-data
  // rookies" guarantee that motivated hoisting it.
  return `${calendarFraming}\n\nYou have loaded ${targets.length} league${targets.length > 1 ? 's' : ''}:\n${leagueBlocks}${focusNote}${memoryBlock}\n\n${seasonContext}`;
}

// ── Verdict card (blue) ─────────────────────────────────────
const VerdictCard: React.FC<{ text: string; color?: string }> = ({ text, color = C.mint }) => (
  <View style={[styles.verdict, { borderLeftColor: color, backgroundColor: color + '18' }]}>
    <Text style={[styles.verdictEye, { color }]}>VERDICT</Text>
    <Text style={styles.verdictTxt}>{text}</Text>
  </View>
);

// ── Recommendation card (blue bevel — matches mockup) ───────
const RecoCard: React.FC<{ emoji: string; title: string; body: string }> = ({ emoji, title, body }) => (
  <View style={styles.recoCard}>
    <View style={styles.bevelShine} />
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 5 }}>
      <Text style={{ fontSize: 14 }}>{emoji}</Text>
      <Text style={styles.recoTitle}>{title}</Text>
    </View>
    <Text style={styles.recoBody}>{body}</Text>
  </View>
);

const AddCard: React.FC<{ pos: string; name: string; team: string; detail: string }> = ({ pos, name, team, detail }) => (
  <View style={styles.addCard}>
    <PositionPill pos={pos} />
    <View style={{ flex: 1 }}>
      <Text style={styles.addName}>{name}</Text>
      <Text style={styles.addSub}>{team} · {detail}</Text>
    </View>
    <TouchableOpacity style={styles.addBtn} onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}>
      <Text style={styles.addBtnTxt}>+ADD</Text>
    </TouchableOpacity>
  </View>
);

const PLATFORM_COLOR: Record<string, string> = {
  Sleeper: C.gold, ESPN: '#e03030', Yahoo: '#6001D2', Fleaflicker: '#ff7a00', MFL: '#e4ff1a',
};

type Message = { role: 'ai' | 'user'; text: string; isLoading?: boolean };
const QUICK_PROMPTS = ['Start/Sit', 'Best waiver', 'Trade value', 'Matchup'];

const renderAIText = (text: string) =>
  text.split('\n').map((line, i) => {
    if (line.startsWith('__verdict__')) return <VerdictCard key={i} text={line.replace('__verdict__', '')} />;
    if (line.startsWith('__reco__')) {
      const parts = line.replace('__reco__', '').split('|');
      return <RecoCard key={i} emoji={parts[0] ?? '⚡'} title={parts[1] ?? ''} body={parts[2] ?? ''} />;
    }
    if (line.startsWith('__add__')) {
      const [, pos, name, team, detail] = line.split('|');
      return <AddCard key={i} pos={pos ?? 'WR'} name={name ?? ''} team={team ?? ''} detail={detail ?? ''} />;
    }
    if (line.startsWith('__')) return <Text key={i} selectable style={styles.aiBold}>{line.replace(/__[a-z]+__/g, '').replace(/__/g, '')}</Text>;
    if (line === '') return <View key={i} style={{ height: 6 }} />;
    return <Text key={i} selectable style={styles.aiTxt}>{line}</Text>;
  });

export default function CoachScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ q?: string }>();

  const [messages,       setMessages]       = useState<Message[]>([]);
  const [input,          setInput]          = useState('');
  const [loading,        setLoading]        = useState(false);
  const [reading,        setReading]        = useState(false);
  const [contextReady,   setContextReady]   = useState(false);
  // Free prompts unlock only once a fantasy platform is linked (activation
  // gate — see hasLinkedPlatform). Optimistic true so paid/linked users
  // never see a flash of the locked state while the check runs.
  const [linkedPlatform, setLinkedPlatform] = useState(true);
  const [allLeagues,     setAllLeagues]     = useState<LeagueContext[]>([]);
  const [selectedLeague, setSelectedLeague] = useState<LeagueContext | null>(null);
  const [pickerVisible,  setPickerVisible]  = useState(false);
  const [remaining,      setRemaining]      = useState(10);
  const [limit,          setLimit]          = useState(10);
  const [tier,           setTier]           = useState('free');

  const systemPromptRef = useRef<string>(BASE_SYSTEM);
  const liveDataRef     = useRef<string>('');
  const memoriesRef     = useRef<string>('');
  const scrollRef       = useRef<ScrollView>(null);
  // Name-only (position-agnostic) set of every player in Sleeper's NFL feed,
  // used to validate vision-extracted draft picks — a "drafted" name absent
  // from the feed is almost certainly a misread we shouldn't act on.
  const playerNameSetRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      const [currentTier, rem, linked] = await Promise.all([getCurrentTier(), getRemainingPrompts(), hasLinkedPlatform()]);
      setLinkedPlatform(linked);
      setTier(currentTier);
      setRemaining(rem);

      // Load Sleeper's player feed once and build a name+position index
      // used to enrich every platform's roster lines with age, NFL exp,
      // depth chart slot, injury status, and the canonical "team = null
      // → FA" signal. Sleeper is the most complete public NFL feed, so
      // even Yahoo/ESPN/FF/MFL rosters get a uniform format.
      const playerMap = await loadSleeperPlayerMap();
      const nameIndex = buildSleeperNameIndex(playerMap);

      // Build the canonical name set once for draft-board screenshot validation.
      const nameSet = new Set<string>();
      for (const p of Object.values(playerMap)) {
        const pp = p as any;
        if (!pp || typeof pp !== 'object' || !pp.position) continue;
        const full = pp.full_name || `${pp.first_name ?? ''} ${pp.last_name ?? ''}`.trim();
        if (full) nameSet.add(normalizeName(full));
      }
      playerNameSetRef.current = nameSet;

      let all: LeagueContext[];
      let liveData: any;
      const cachedCtx = coachCtxCache && Date.now() - coachCtxCache.at < COACH_CTX_TTL_MS ? coachCtxCache : null;
      if (cachedCtx) {
        ({ all, liveData } = cachedCtx);
      } else {
        // Progressive load: merge each platform's leagues into the UI the
        // moment that platform resolves. No per-platform timeout — a slow
        // platform (MFL's shared hosts) arrives late instead of being
        // dropped, and the chat becomes usable as soon as the FIRST
        // platform lands rather than waiting on the slowest.
        const acc: LeagueContext[] = [];
        const merge = (leagues: LeagueContext[] | null | undefined) => {
          if (!leagues || leagues.length === 0) return;
          acc.push(...leagues);
          setAllLeagues([...acc]);
          setContextReady(true);
          systemPromptRef.current = buildSystemPrompt([...acc], null, memoriesRef.current) + liveDataRef.current;
        };
        let liveDataFresh: any = null;
        await Promise.allSettled([
          loadSleeperContext(playerMap).then(merge),
          loadESPNContext(nameIndex).then(merge),
          loadYahooContext(nameIndex).then(merge),
          loadAbstractContext('fleaflicker', 'Fleaflicker', nameIndex).then(merge),
          loadAbstractContext('mfl', 'MFL', nameIndex).then(merge),
          fetchAllLiveData().then((ld) => { liveDataFresh = ld; }),
        ]);
        all = [...acc];
        liveData = liveDataFresh;
        coachCtxCache = { at: Date.now(), all, liveData };
      }

      try {
        const leagueId = all[0]?.name ?? 'general';
        const { profile, state } = await getCoachProfile(leagueId);
        memoriesRef.current = [
          profile ? `TENDENCIES (how this manager thinks — tailor every answer to this): ${profile}` : '',
          state ? `THIS LEAGUE'S SITUATION: ${state}` : '',
        ].filter(Boolean).join('\n');
      } catch {}

      // Extract last names from every league's roster lines so the live-
      // data formatter can hoist news that mentions any of these players
      // ("Bears release Keenan Allen" → surfaces above generic headlines).
      // Roster entries are formatted as "First Last (POS · TEAM · …)".
      const rosterLastNames = new Set<string>();
      for (const league of all) {
        for (const entry of league.roster ?? []) {
          const name = entry.split(/\s*\(/)[0]?.trim();
          if (!name) continue;
          const parts = name.split(/\s+/);
          const last = parts[parts.length - 1]?.replace(/[.,]/g, '');
          if (last && last.length >= 3) rosterLastNames.add(last);
        }
      }

      liveDataRef.current     = formatLiveDataForPrompt(liveData, rosterLastNames);

      // v2026-06-10: recent league transactions (Sleeper) — who's buying,
      // selling, and churning waivers. Lets the Coach reference actual league
      // activity ("the 2-seed just dropped his RB3 — go get him").
      try {
        const txns = await fetchSleeperTransactions(12);
        if (txns.length) {
          liveDataRef.current += `\n\nRECENT LEAGUE TRANSACTIONS (your leagues — adds/drops/trades; use to spot trends and targets):\n${txns.map(t => `- [${t.age}] ${t.headline}`).join('\n')}`;
        }
      } catch { /* best-effort */ }

      systemPromptRef.current = buildSystemPrompt(all, null, memoriesRef.current) + liveDataRef.current;
      setAllLeagues(all);
      setContextReady(true);

      // Tier-aware limit comes from the centralized LIMITS map in
      // promptCounter (10 free / 25 rankings / 50 pro under Option D).
      // Older inline ternaries referenced retired tiers (premium /
      // dynasty_elite) — replaced with a single source of truth.
      const limitNum = await getPromptLimit();
      setLimit(limitNum);
      const promptLabel = currentTier === 'free'
        ? `${rem} of ${limitNum} free prompts remaining`
        : `${rem} of ${limitNum} prompts remaining this week`;
      const greeting = all.length > 0
        ? `Hey — ${all.length} league${all.length > 1 ? 's' : ''} loaded. ${promptLabel}. What do you need?`
        : `Hey — connect a league (Sleeper, ESPN, Yahoo, MFL, or Fleaflicker) in Settings to unlock your ${LIMITS.free} free prompts and get started.`;
      setMessages([{ role: 'ai', text: greeting }]);
    })();
  }, []);

  useEffect(() => {
    if (allLeagues.length > 0) {
      systemPromptRef.current = buildSystemPrompt(allLeagues, selectedLeague, memoriesRef.current) + liveDataRef.current;
    }
  }, [selectedLeague, allLeagues]);

  // Refresh the prompt counter every time this tab gains focus. Without
  // this, the badge shows the value captured at mount even if Trade /
  // Draft / Start-Sit consumed prompts since (those flows write to
  // AsyncStorage + cloud but don't touch this screen's React state).
  useFocusEffect(useCallback(() => {
    (async () => {
      try {
        // Refresh limit too — picks up tier upgrades (free→rankings→pro)
        // without needing an app relaunch.
        const [fresh, freshLimit] = await Promise.all([
          getRemainingPrompts(),
          getPromptLimit(),
        ]);
        setRemaining(fresh);
        setLimit(freshLimit);
      } catch {}
    })();
  }, []));

  // Auto-send from URL param (when rankings/other screens route here with a question)
  useEffect(() => {
    if (!contextReady) return;
    if (!params.q) return;
    const q = String(params.q);
    // Clear the param so it doesn't re-fire on re-render
    router.setParams({ q: undefined });
    setTimeout(() => { send(q); }, 400);
  }, [contextReady, params.q]);

  const selectLeague = (league: LeagueContext | null) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedLeague(league);
    setPickerVisible(false);
    const label = league ? `${league.name} (${league.platform} · ${league.format})` : `all ${allLeagues.length} leagues`;
    setMessages(prev => [...prev, { role: 'ai', text: `Got it — focused on ${label}. What do you need?` }]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  };

  // v2026-06-16: read a LIVE draft board from a screenshot (same vision flow
  // The O uses for trades). Vision (fast tier) extracts who's already gone,
  // then we hand that to the normal grounded send() so the Coach recommends
  // the next pick off AIOmni's rankings + the user's roster needs.
  const readDraftBoard = async () => {
    if (reading || loading) return;
    const rem = await getRemainingPrompts();
    if (rem <= 0) {
      const currentTier = await getCurrentTier();
      if (currentTier === 'pro') {
        const resetTime = await getResetTime();
        const resetStr = resetTime
          ? resetTime.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })
          : 'Sunday noon';
        setMessages(prev => [...prev, { role: 'ai', text: `You've hit this week's 50-prompt cap. Resets ${resetStr}.` }]);
        return;
      }
      const ctx = currentTier === 'free' ? 'free_prompts_exhausted' : 'weekly_prompts_exhausted';
      router.push(`/paywall?context=${ctx}` as any);
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setMessages(prev => [...prev, { role: 'ai', text: 'Photo access is needed to read your draft board.' }]);
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6, base64: true });
    if (res.canceled || !res.assets?.[0]?.base64) return;
    const asset = res.assets[0];
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setReading(true);
    setMessages(prev => [...prev, { role: 'ai', text: '', isLoading: true }]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    try {
      const out = await askAIVision(
        asset.base64!,
        asset.mimeType ?? 'image/jpeg',
        `This is a screenshot of a LIVE fantasy football draft — a draft board or pick history. Read it and return ONLY this JSON, nothing else:
{"drafted":["Bijan Robinson (1.01)","Ja'Marr Chase (1.02)"],"onClock":"","format":""}
- "drafted": EVERY player already selected. Keep order and pick number (e.g. "1.05", "23rd") if shown, and position/team if shown. Full names exactly — do NOT skip anyone.
- "onClock": which team/slot is currently picking, if shown, else "".
- "format": any visible format clue (Superflex, Dynasty, PPR, # teams), else "".
Capture rookies and veterans exactly.`,
        { tier: 'fast', maxTokens: 900 },
      );
      const clean = out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1);
      const parsed = JSON.parse(clean);
      const drafted: string[] = Array.isArray(parsed.drafted) ? parsed.drafted : [];
      // drop the placeholder loading bubble before handing off to send()
      setMessages(prev => prev.filter(m => !m.isLoading));
      if (!drafted.length) {
        setMessages(prev => [...prev, { role: 'ai', text: "Couldn't read picks off that image — try a clearer shot of the draft board, or just tell me who's gone." }]);
        return;
      }
      // Validate the vision read against Sleeper's canonical NFL feed. A
      // fast-tier vision model can confidently misread a blurry board and
      // invent players; handing those to the recommender makes it "draft
      // around" people who were never picked. Names absent from the feed are
      // flagged for the model (not silently dropped — a real player we failed
      // to match still shouldn't be recommended as available), and a read that
      // matches NOTHING is rejected outright as garbled/non-draft input.
      const nameSet = playerNameSetRef.current;
      const unverified: string[] = [];
      if (nameSet.size) {
        let verified = 0;
        for (const entry of drafted) {
          const nm = entry.split('(')[0].trim();
          if (!nm) continue;
          if (nameSet.has(normalizeName(nm))) verified++;
          else unverified.push(nm);
        }
        if (verified === 0) {
          setMessages(prev => [...prev, { role: 'ai', text: "I read some text off that image but couldn't match any of it to real NFL players — it may be blurry or not a draft board. Try a clearer screenshot, or just tell me who's already gone.\n\n(If that was a trade offer, use the 📸 on the Trade tab instead — it's built to read trade screenshots.)" }]);
          return;
        }
      }
      const typed = input.trim();
      const draftMsg = [
        `[Live draft board I just read from a screenshot]`,
        `Already drafted (${drafted.length}): ${drafted.join('; ')}.`,
        unverified.length ? `⚠ I could NOT verify these names against the player database, so I may have misread them — treat as uncertain and do NOT recommend them: ${unverified.join(', ')}.` : '',
        parsed.onClock ? `On the clock: ${parsed.onClock}.` : '',
        parsed.format ? `Format shown: ${parsed.format}.` : '',
        typed
          ? typed
          : `Using your rankings and my roster needs, who are the best available players I should target right now? Give me a short ranked shortlist with one-line why on each, and flag any value falling past ADP.`,
      ].filter(Boolean).join(' ');
      setInput('');
      await send(draftMsg);
    } catch {
      setMessages(prev => prev.filter(m => !m.isLoading));
      setMessages(prev => [...prev, { role: 'ai', text: "Couldn't read that draft board — try a clearer screenshot, or tell me who's already been picked." }]);
    } finally {
      setReading(false);
    }
  };

  const send = async (text: string) => {
    if (!text.trim() || loading) return;
    const rem = await getRemainingPrompts();
    if (rem <= 0) {
      const currentTier = await getCurrentTier();
      // Pro users at weekly cap get a friendly inline message — no upsell
      // since they're already on the top tier. Free + Rankings users
      // route to the paywall with a context-specific headline.
      if (currentTier === 'pro') {
        const resetTime = await getResetTime();
        const resetStr = resetTime
          ? resetTime.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })
          : 'Sunday noon';
        setMessages(prev => [...prev, { role: 'ai', text: `You've hit this week's 50-prompt cap. Resets ${resetStr}.` }]);
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
        return;
      }
      const ctx = currentTier === 'free' ? 'free_prompts_exhausted' : 'weekly_prompts_exhausted';
      router.push(`/paywall?context=${ctx}` as any);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const userMsg:    Message = { role:'user', text };
    const loadingMsg: Message = { role:'ai',   text:'', isLoading:true };
    setMessages(prev => [...prev, userMsg, loadingMsg]);
    setInput('');
    setLoading(true);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      // Sanitize every user-authored message (current + history) before
      // it's interpolated into the prompt. Assistant turns are trusted
      // because they came from us. System prompt + player context are
      // also trusted (we built them from DB data).
      // Draft-board messages are composed by US from the vision extractor
      // (marker prefix below) and legitimately run thousands of chars — a
      // 45-pick board at the default 500-char cap truncated to ~20 picks
      // and the model told the user their message "cut off." Raise the
      // cap for those; injection patterns still apply either way.
      const sanitizeCoachMsg = (t: string) =>
        sanitizePromptInput(t, t.startsWith('[Live draft board') ? 8000 : undefined);

      const history = [...messages, userMsg]
        .filter(m => !m.isLoading)
        .map(m => ({
          role:    m.role === 'ai' ? 'assistant' : 'user',
          content: m.role === 'ai' ? m.text : sanitizeCoachMsg(m.text),
        }));

      let playerContext = '';
      try { playerContext = await getPlayerContext(text); } catch {}

      const safeText = sanitizeCoachMsg(text);
      const fullPrompt = [
        systemPromptRef.current,
        playerContext ? `\nPLAYER INTELLIGENCE FROM DATABASE:\n${playerContext}` : '',
        `\nConversation history:\n${history.slice(-6).map(h => `${h.role}: ${h.content}`).join('\n')}`,
        `\nuser: ${safeText}`,
      ].filter(Boolean).join('\n');

      const reply = await askAI(fullPrompt, { maxTokens: 1000, system: STATIC_SYSTEM });
      // Only charge a prompt once the model actually responds — connection
      // errors and timeouts shouldn't burn the user's weekly quota.
      await incrementPrompt();
      setRemaining(r => Math.max(0, r - 1));
      setMessages(prev => [...prev.slice(0, -1), { role:'ai', text: reply }]);

      if (tier === 'pro' && selectedLeague) {
        // Fire-and-forget the learning loop — coach-learn extracts + consolidates
        // a durable profile server-side. Never await; must not block the UI.
        learnFromExchange(text, reply, selectedLeague.name, selectedLeague.platform).catch(() => {});
      }
    } catch (e: any) {
      const errMsg = e?.message?.includes('prompt_limit_reached')
        ? (tier === 'free'
            ? "This device has used its 10 free prompts. Upgrade for 25–50 prompts every week."
            : "You've hit your weekly prompt limit. Upgrade to Pro for 50 prompts/week.")
        : 'Connection error. Try again.';
      setMessages(prev => [...prev.slice(0, -1), { role:'ai', text: errMsg }]);
    } finally {
      setLoading(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  };

  const promptColor   = remaining <= 5 ? '#a83040' : remaining <= 10 ? C.amber : C.mint;
  // Free tier + nothing linked (and no leagues loaded, which implies linked)
  // → prompts stay locked behind connecting a platform.
  const freeNeedsLink = tier === 'free' && !linkedPlatform && allLeagues.length === 0;
  const selectorLabel = selectedLeague ? selectedLeague.name : 'All Leagues';
  const selectorSub   = selectedLeague
    ? `${selectedLeague.platform} · ${selectedLeague.format}`
    : `${allLeagues.length} LEAGUE${allLeagues.length !== 1 ? 'S' : ''} · PERSONALIZED`;
  const selectorColor = selectedLeague ? (PLATFORM_COLOR[selectedLeague.platform] ?? C.gold) : C.gold;

  return (
    <View style={{ flex: 1, backgroundColor: '#0a1214' }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        <View style={[styles.wrap, { paddingTop: insets.top + 8 }]}>

          {/* ── Header — matches mockup ── */}
          <View style={styles.hdr}>
            {/* Mini logo avatar */}
            <View style={styles.logoAvatar}>
              <AIOmniLogo width={48} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>AI Coach</Text>
              <Text style={styles.subtitle}>{contextReady ? selectorSub : 'LOADING LEAGUES...'}</Text>
            </View>
            <View style={styles.rightHdr}>
              <View style={[styles.promptCounter, { borderColor: promptColor + '55', backgroundColor: promptColor + '12' }]}>
                <Text style={[styles.promptCountNum, { color: promptColor }]}>{remaining > 900 ? '∞' : remaining}</Text>
                <Text style={[styles.promptCountLbl, { color: promptColor }]}>{remaining > 900 ? '' : `/${limit}`}</Text>
              </View>
              <View style={styles.liveDot}>
                <View style={[styles.livePulse, !contextReady && { backgroundColor: C.gold }]} />
                <Text style={[styles.liveTxt, !contextReady && { color: C.gold }]}>{contextReady ? 'LIVE' : 'SYNC'}</Text>
              </View>
              <TouchableOpacity onPress={() => router.push('/(tabs)/settings' as any)} style={styles.gearBtn}>
                <Ionicons name="settings-sharp" size={20} color={C.dim2} />
              </TouchableOpacity>
            </View>
          </View>

          {/* ── League selector ── */}
          {contextReady && allLeagues.length > 0 && (
            <TouchableOpacity
              style={[styles.leaguePicker, { borderColor: selectorColor + '55', backgroundColor: selectorColor + '12' }]}
              onPress={() => setPickerVisible(true)}
              activeOpacity={0.75}
            >
              <View style={[styles.leaguePickerDot, { backgroundColor: selectorColor }]} />
              <Text style={[styles.leaguePickerLabel, { color: selectorColor }]} numberOfLines={1}>{selectorLabel}</Text>
              <Ionicons name="chevron-down" size={14} color={selectorColor} style={{ marginLeft: 2 }} />
            </TouchableOpacity>
          )}

          {/* ── Quick prompts ── */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.promptScroll} contentContainerStyle={{ gap: 5 }}>
            {QUICK_PROMPTS.map(p => (
              <TouchableOpacity key={p} style={styles.promptChip} onPress={() => send(p)}>
                <Text style={styles.promptTxt}>{p}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* ── Messages ── */}
          <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 8, gap: 10 }} showsVerticalScrollIndicator={false}>
            {!contextReady && messages.length === 0 && (
              <View style={{ alignItems:'center', paddingVertical:40, gap:10 }}>
                <ActivityIndicator color={C.blueDeep} size="large" />
                <Text style={styles.loadingSub}>Loading your leagues...</Text>
              </View>
            )}
            {messages.map((m, i) => (
              m.role === 'user' ? (
                // User bubble — gold card (matches mockup)
                <View key={i} style={styles.userRow}>
                  <View style={styles.userBubble}>
                    <View style={styles.userBubbleShine} />
                    <Text selectable style={styles.userTxt}>{m.text}</Text>
                  </View>
                </View>
              ) : (
                // AI bubble — cream bevel card (matches mockup)
                <View key={i} style={styles.aiRow}>
                  <View style={styles.aiBubbleAvatar}>
                    <AIOmniLogo size={20} />
                  </View>
                  <View style={[styles.aiBubble, { maxWidth: '85%' }]}>
                    <View style={styles.bevelShine} />
                    {m.isLoading ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 4 }}>
                        <ActivityIndicator color={C.blueDeep} size="small" />
                        <Text style={[styles.aiTxt, { color: C.dim2 }]}>Analyzing...</Text>
                      </View>
                    ) : renderAIText(m.text)}
                  </View>
                </View>
              )
            ))}
          </ScrollView>

          {/* ── Input ── */}
          <View style={[styles.inputWrap, { paddingBottom: insets.bottom + 4 }]}>
            <View style={styles.inputRow}>
              <TouchableOpacity
                style={[styles.attachBtn, (loading || reading || remaining <= 0) && { opacity: 0.4 }]}
                onPress={readDraftBoard}
                disabled={loading || reading || remaining <= 0}
                accessibilityLabel="Read draft board from a screenshot"
              >
                {reading
                  ? <ActivityIndicator color={C.blueDeep} size="small" />
                  : <Ionicons name="image-outline" size={20} color={C.blueDeep} />}
              </TouchableOpacity>
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder={
                  freeNeedsLink
                    ? 'Connect a league to unlock your free prompts'
                    : remaining > 0
                      ? 'Ask, or 📷 a live draft board…'
                      : tier === 'free'
                        ? 'This device has used its free prompts — upgrade to keep going'
                        : 'Out of prompts — upgrade for more'
                }
                placeholderTextColor={C.dim2}
                style={styles.input}
                onSubmitEditing={() => send(input)}
                returnKeyType="send"
                editable={remaining > 0 && !freeNeedsLink}
              />
              <TouchableOpacity
                style={[styles.sendBtn, (!input.trim() || loading || remaining <= 0 || freeNeedsLink) && styles.sendBtnOff]}
                onPress={() => send(input)}
                disabled={!input.trim() || loading || remaining <= 0 || freeNeedsLink}
              >
                <Text style={styles.sendArrow}>↑</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>

      {/* ── League Picker Modal ── */}
      <Modal visible={pickerVisible} transparent animationType="slide" onRequestClose={() => setPickerVisible(false)}>
        <TouchableOpacity style={styles.pickerOverlay} activeOpacity={1} onPress={() => setPickerVisible(false)}>
          {/* maxHeight + scrollable list: with every league now loading
              (20+ across platforms) the sheet outgrew the screen and the
              top rows were unreachable — the row list scrolls, while the
              title and CANCEL stay pinned. */}
          <View style={[styles.pickerSheet, { maxHeight: '82%' }]}>
            <View style={styles.pickerShineBar} />
            <View style={styles.pickerHandle} />
            <Text style={styles.pickerTitle}>FOCUS ON A LEAGUE</Text>
            <Text style={styles.pickerSub}>AI advice will be tailored to the selected league's roster and scoring format.</Text>

            <ScrollView showsVerticalScrollIndicator={false} style={{ flexGrow: 0 }}>
              <TouchableOpacity style={[styles.pickerRow, !selectedLeague && styles.pickerRowActive]} onPress={() => selectLeague(null)}>
                <View style={[styles.pickerDot, { backgroundColor: C.gold }]} />
                <View style={{ flex:1 }}>
                  <Text style={[styles.pickerRowLabel, !selectedLeague && { color: C.gold }]}>All Leagues</Text>
                  <Text style={styles.pickerRowSub}>{allLeagues.length} leagues · Cross-league insights</Text>
                </View>
                {!selectedLeague && <Ionicons name="checkmark" size={18} color={C.gold} />}
              </TouchableOpacity>

              <View style={styles.pickerDivider} />

              {allLeagues.map((lg, i) => {
                const isActive = selectedLeague?.name === lg.name && selectedLeague?.platform === lg.platform;
                const color    = PLATFORM_COLOR[lg.platform] ?? C.gold;
                return (
                  <TouchableOpacity key={i} style={[styles.pickerRow, isActive && styles.pickerRowActive]} onPress={() => selectLeague(lg)}>
                    <View style={[styles.pickerDot, { backgroundColor: color }]} />
                    <View style={{ flex:1 }}>
                      <Text style={[styles.pickerRowLabel, isActive && { color }]} numberOfLines={1}>{lg.name}</Text>
                      <Text style={styles.pickerRowSub}>{lg.platform} · {lg.format} · {lg.record} · Rank {lg.rank}</Text>
                    </View>
                    {isActive && <Ionicons name="checkmark" size={18} color={color} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <TouchableOpacity style={styles.pickerClose} onPress={() => setPickerVisible(false)}>
              <Text style={styles.pickerCloseTxt}>CANCEL</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap:     { flex:1, paddingHorizontal: SP[3] },

  // Header
  hdr:      { flexDirection:'row', alignItems:'center', gap:10, marginBottom:10 },
  logoAvatar: { width:44, height:44, borderRadius:12, backgroundColor: C.goldS, borderWidth:1.5, borderColor: C.goldBorder, alignItems:'center', justifyContent:'center', overflow:'hidden' },
  title:    { fontSize:SZ.xl, fontFamily:F.bold, color:'#f0f4f5' },
  subtitle: { fontSize:SZ.xs-1, fontFamily:F.mono, color:C.dim2, letterSpacing:0.8 },
  rightHdr: { flexDirection:'row', alignItems:'center', gap:6 },
  gearBtn:  { padding:4 },

  promptCounter:  { flexDirection:'row', alignItems:'baseline', borderRadius:20, paddingHorizontal:8, paddingVertical:3, borderWidth:1.5 },
  promptCountNum: { fontSize:SZ.sm, fontFamily:F.bold },
  promptCountLbl: { fontSize:SZ.xs-1, fontFamily:F.mono, opacity:0.7 },
  liveDot:  { flexDirection:'row', alignItems:'center', gap:4, backgroundColor:'rgba(30,140,66,0.12)', borderWidth:1, borderColor:'rgba(30,140,66,0.3)', borderRadius:20, paddingHorizontal:8, paddingVertical:3 },
  livePulse:{ width:5, height:5, borderRadius:3, backgroundColor:C.mint },
  liveTxt:  { fontSize:SZ.xs-1, fontFamily:F.mono, color:C.mint, letterSpacing:1 },

  leaguePicker:     { flexDirection:'row', alignItems:'center', alignSelf:'flex-start', gap:6, borderWidth:1.5, borderRadius:20, paddingHorizontal:12, paddingVertical:6, marginBottom:10, maxWidth:'70%' },
  leaguePickerDot:  { width:6, height:6, borderRadius:3 },
  leaguePickerLabel:{ fontFamily:F.mono, fontSize:SZ.xs, letterSpacing:0.8, fontWeight:'700', flex:1 },

  promptScroll: { maxHeight:36, marginBottom:10 },
  promptChip:   { paddingHorizontal:11, paddingVertical:5, borderRadius:20, backgroundColor:C.goldS, borderWidth:1.5, borderColor:C.goldBorder },
  promptTxt:    { fontSize:SZ.sm, color:C.blueDeep, fontFamily:F.mono },

  loadingSub: { color:C.dim2, fontFamily:F.mono, fontSize:SZ.sm },

  // AI bubble — cream bevel (matches mockup card system)
  aiRow:   { flexDirection:'row', gap:8, alignItems:'flex-start' },
  aiBubbleAvatar: {
    width:30, height:30, borderRadius:9,
    backgroundColor: C.goldS, borderWidth:1.5, borderColor: C.goldBorder,
    alignItems:'center', justifyContent:'center', flexShrink:0, marginTop:2,
  },
  aiBubble: {
    backgroundColor: '#12252e',
    borderWidth: 1.5,
    borderColor: '#1a3542',
    borderTopColor: '#12252e',
    
    
    
    borderRadius: 14,
    borderTopLeftRadius: 4,
    padding: 11,
    position: 'relative',
    overflow: 'hidden',
    shadowColor: '#1be7ff',
    shadowOffset: { width:0, height:2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  bevelShine: { position:'absolute', top:0, left:'8%', right:'8%', height:1.5, backgroundColor:BEVEL_HI, zIndex:6 },

  // User bubble — gold card (matches mockup)
  userRow:    { flexDirection:'row', justifyContent:'flex-end' },
  userBubble: {
    backgroundColor: '#ffb800',
    borderWidth: 1,
    borderColor: 'rgba(255,184,0,0.4)',
    borderTopColor: '#12252e',
    borderLeftColor: 'rgba(255,255,255,0.7)',
    borderBottomColor: '#1a3542',
    borderRightColor: '#1a3542',
    borderRadius: 14,
    borderTopRightRadius: 4,
    padding: 11,
    maxWidth: '80%',
    position: 'relative',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width:0, height:3 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 3,
  },
  userBubbleShine: { position:'absolute', top:0, left:'8%', right:'8%', height:1.5, backgroundColor:'#1a3542', zIndex:6 },
  userTxt:    { fontSize:SZ.md, color:'#0a1214', lineHeight:20, fontFamily:F.body },

  aiTxt:    { fontSize:SZ.md, color:'#f0f4f5', lineHeight:20, fontFamily:F.outfit },
  aiBold:   { fontSize:SZ.md, fontFamily:F.semibold, color:'#1be7ff', lineHeight:20 },

  // Verdict card
  verdict:    { borderLeftWidth:2, borderRadius:9, padding:9, marginTop:7 },
  verdictEye: { fontSize:SZ.xs-2, fontFamily:F.mono, letterSpacing:1, marginBottom:2 },
  verdictTxt: { fontSize:SZ.sm+1, fontFamily:F.semibold, color:'#f0f4f5' },

  // Recommendation card — blue (matches mockup)
  recoCard: {
    backgroundColor: '#0f1c22',
    borderRadius: 12,
    borderTopLeftRadius: 4,
    padding: 11,
    marginTop: 7,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.35)',
    borderTopColor: '#0f1c22',
    borderBottomColor: 'rgba(20,45,100,0.5)',
    shadowColor: '#1be7ff',
    shadowOffset: { width:0, height:4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 4,
    position: 'relative',
    overflow: 'hidden',
  },
  recoTitle: { fontSize:SZ.sm, fontFamily:F.bold, color:'#ffb800', letterSpacing:0.5 },
  recoBody:  { fontSize:SZ.sm, fontFamily:F.outfit, color:'#7a9eaa', lineHeight:18, marginTop:2 },

  // Add player card
  addCard:   { flexDirection:'row', alignItems:'center', gap:8, backgroundColor:'#12252e', borderWidth:1.5, borderColor:BORDER, borderRadius:10, padding:8, marginTop:7 },
  addName:   { fontSize:SZ.md, fontFamily:F.bold, color:'#f0f4f5' },
  addSub:    { fontSize:SZ.sm, fontFamily:F.mono, color:C.dim2 },
  addBtn:    { backgroundColor:C.sageS, borderWidth:1.5, borderColor:C.sageBorder, borderRadius:7, paddingHorizontal:8, paddingVertical:4 },
  addBtnTxt: { fontSize:SZ.sm, fontFamily:F.mono, color:C.blueDeep, fontWeight:'700' },

  // Input
  inputWrap: { paddingTop:8 },
  inputRow:  { flexDirection:'row', alignItems:'center', gap:7, backgroundColor:'#12252e', borderWidth:1.5, borderColor:BORDER, borderTopColor:'#12252e', borderRadius:18, paddingLeft:5, paddingRight:4, paddingVertical:4 },
  input:     { flex:1, fontSize:SZ.md, color:'#f0f4f5', paddingVertical:8, fontFamily:F.outfit },
  attachBtn: { width:34, height:34, borderRadius:10, alignItems:'center', justifyContent:'center' },
  sendBtn:   { width:34, height:34, backgroundColor:C.gold, borderRadius:10, alignItems:'center', justifyContent:'center' },
  sendBtnOff:{ backgroundColor:C.goldS },
  sendArrow: { fontSize:14, fontFamily:F.bold, color:'#f0f4f5' },

  // Picker modal — cream theme
  pickerOverlay:  { flex:1, backgroundColor:'rgba(10,18,20,0.7)', justifyContent:'flex-end' },
  pickerSheet: {
    backgroundColor:'#12252e',
    borderTopLeftRadius:20, borderTopRightRadius:20,
    paddingTop:12, paddingBottom:32, paddingHorizontal:20,
    borderTopWidth:1.5, borderLeftWidth:1.5, borderRightWidth:1.5,
    borderColor:BORDER, overflow:'hidden', position:'relative',
  },
  pickerShineBar: { position:'absolute', top:0, left:'8%', right:'8%', height:1.5, backgroundColor:BEVEL_HI, zIndex:6 },
  pickerHandle:   { width:36, height:4, borderRadius:2, backgroundColor:BORDER, alignSelf:'center', marginBottom:20 },
  pickerTitle:    { fontFamily:F.bold, color:C.blueDeep, fontSize:SZ.sm, letterSpacing:2, marginBottom:6 },
  pickerSub:      { fontFamily:F.mono, color:C.dim2, fontSize:SZ.sm, lineHeight:18, marginBottom:16 },
  pickerDivider:  { height:1, backgroundColor:BORDER, marginVertical:8 },
  pickerRow:      { flexDirection:'row', alignItems:'center', gap:10, paddingVertical:13, paddingHorizontal:12, borderRadius:12, marginBottom:4 },
  pickerRowActive:{ backgroundColor:'#0f1c22' },
  pickerDot:      { width:8, height:8, borderRadius:4, flexShrink:0 },
  pickerRowLabel: { fontFamily:F.bold, color:'#f0f4f5', fontSize:SZ.base },
  pickerRowSub:   { fontFamily:F.mono, color:C.dim2, fontSize:SZ.xs-1, marginTop:2, letterSpacing:0.4 },
  pickerClose:    { marginTop:12, alignItems:'center', paddingVertical:14, borderRadius:12, borderWidth:1.5, borderColor:BORDER },
  pickerCloseTxt: { fontFamily:F.mono, color:C.dim2, fontSize:SZ.sm, letterSpacing:1.5 },
});
