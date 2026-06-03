// services/draft.ts
// The O — AIOmni's AI Draft Co-Pilot — Unified Draft Service
// Sleeper: live polling via public API
// ESPN / Yahoo / Fleaflicker / Offline: companion mode (manual pick tracking)

import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchBlendedConsensus, fetchSleeperADP } from './rankingsData';
import { sanitizePromptInput } from './util/promptSafe';

const SLEEPER_BASE = 'https://api.sleeper.app/v1';

// ─── TYPES ──────────────────────────────────────────────────

export type Platform = 'sleeper' | 'espn' | 'yahoo' | 'fleaflicker' | 'mfl' | 'offline';
export type DraftType = 'snake' | 'linear' | 'auction';
export type DraftStatus = 'pre_draft' | 'drafting' | 'complete';

export interface DraftSettings {
  platform: Platform;
  leagueId: string;
  leagueName: string;
  draftId?: string;              // Sleeper only — resolved from league
  draftType: DraftType;
  rounds: number;
  teamCount: number;
  myDraftSlot: number;           // 1-indexed
  pickTimer: number;             // seconds per pick, 0 = no timer
  scoringFormat: 'ppr' | 'half' | 'standard';
  rosterSlots: string[];         // e.g. ['QB','RB','RB','WR','WR','TE','FLEX','K','DEF']
  scoringSettings?: Record<string, number>;
  isDynasty?: boolean;           // keeper/dynasty league — rosters carry over
  draftMode?: DraftMode;         // 'rookie' | 'startup' | 'redraft' (resolved at pool build)
}

export interface DraftPick {
  pickNo: number;                // overall pick number, 1-indexed
  round: number;
  slot: number;                  // draft slot of the team who picked
  rosterId?: number;             // Sleeper roster_id
  playerId: string;
  playerName: string;
  position: string;
  team: string;
  isMyPick: boolean;
}

export interface SleeperDraftMeta {
  draft_id: string;
  type: DraftType;
  status: DraftStatus;
  sport: string;
  season: string;
  settings: {
    rounds: number;
    teams: number;
    pick_timer: number;
    slots_wr: number;
    slots_rb: number;
    slots_qb: number;
    slots_te: number;
    slots_flex: number;
    slots_k: number;
    slots_def: number;
    [key: string]: any;
  };
  slot_to_roster_id: Record<string, number>;
  draft_order: Record<string, number> | null;
  start_time: number;
  last_picked: number;
  last_message_time: number;
  creators: string[];
  created: number;
  league_id: string;
  metadata: Record<string, any>;
}

export interface SleeperDraftPick {
  round: number;
  draft_slot: number;
  pick_no: number;
  player_id: string;
  roster_id: number;
  draft_id: string;
  is_keeper: boolean | null;
  metadata: {
    first_name: string;
    last_name: string;
    position: string;
    team: string;
    years_exp: string;
    amount?: string;         // auction
    [key: string]: any;
  };
}

export interface PlayerInfo {
  id: string;
  name: string;
  position: string;
  team: string;
  adp: number;
  byeWeek: number;
  tier: number;
  rank: number;
  isDrafted: boolean;
  draftedBy?: number;       // pick slot
  draftedAt?: number;       // pick number
}

// ─── SLEEPER DRAFT API ──────────────────────────────────────

/** Get all drafts for a Sleeper league */
export async function getSleeperDrafts(leagueId: string): Promise<SleeperDraftMeta[]> {
  const res = await fetch(`${SLEEPER_BASE}/league/${leagueId}/drafts`);
  if (!res.ok) throw new Error('Failed to fetch Sleeper drafts');
  return res.json();
}

/** Get draft metadata */
export async function getSleeperDraft(draftId: string): Promise<SleeperDraftMeta> {
  const res = await fetch(`${SLEEPER_BASE}/draft/${draftId}`);
  if (!res.ok) throw new Error('Failed to fetch Sleeper draft');
  return res.json();
}

/** Get all picks for a draft (poll this for live updates) */
export async function getSleeperDraftPicks(draftId: string): Promise<SleeperDraftPick[]> {
  const res = await fetch(`${SLEEPER_BASE}/draft/${draftId}/picks`);
  if (!res.ok) throw new Error('Failed to fetch Sleeper draft picks');
  return res.json();
}

/** Get traded picks for a draft */
export async function getSleeperTradedPicks(draftId: string): Promise<any[]> {
  const res = await fetch(`${SLEEPER_BASE}/draft/${draftId}/traded_picks`);
  if (!res.ok) return [];
  return res.json();
}

/** Find the active/upcoming draft for a league */
export async function findActiveDraft(leagueId: string): Promise<SleeperDraftMeta | null> {
  const drafts = await getSleeperDrafts(leagueId);
  // Prefer drafting > pre_draft > most recent complete
  const active = drafts.find(d => d.status === 'drafting');
  if (active) return active;
  const upcoming = drafts.find(d => d.status === 'pre_draft');
  if (upcoming) return upcoming;
  // Return most recent by created timestamp
  return drafts.sort((a, b) => b.created - a.created)[0] || null;
}

// ─── DRAFT POSITION CALCULATOR ──────────────────────────────

/** Calculate which overall pick number is next for a given slot in a snake draft */
export function getNextPickForSlot(
  slot: number,
  totalPicks: number,
  teamCount: number,
  draftType: DraftType
): number {
  if (draftType === 'linear') {
    // Linear: same slot every round
    for (let pick = slot; pick <= totalPicks * teamCount; pick += teamCount) {
      if (pick > totalPicks) return pick;
    }
  }
  // Snake: odd rounds go 1→N, even rounds go N→1
  for (let pick = 1; pick <= teamCount * 30; pick++) {
    const round = Math.ceil(pick / teamCount);
    const posInRound = ((pick - 1) % teamCount) + 1;
    const isReversed = round % 2 === 0;
    const pickSlot = isReversed ? teamCount - posInRound + 1 : posInRound;
    if (pickSlot === slot && pick > totalPicks) return pick;
  }
  return totalPicks + 1;
}

/** Get all pick numbers for a slot across all rounds */
export function getAllPicksForSlot(
  slot: number,
  rounds: number,
  teamCount: number,
  draftType: DraftType
): number[] {
  const picks: number[] = [];
  for (let round = 1; round <= rounds; round++) {
    if (draftType === 'snake') {
      const isReversed = round % 2 === 0;
      const pickInRound = isReversed ? teamCount - slot + 1 : slot;
      picks.push((round - 1) * teamCount + pickInRound);
    } else {
      picks.push((round - 1) * teamCount + slot);
    }
  }
  return picks;
}

// ─── NORMALIZE SLEEPER PICKS ────────────────────────────────

/** Convert Sleeper picks to our unified DraftPick format */
export function normalizeSleeperPicks(
  picks: SleeperDraftPick[],
  myRosterId: number
): DraftPick[] {
  return picks.map(p => ({
    pickNo: p.pick_no,
    round: p.round,
    slot: p.draft_slot,
    rosterId: p.roster_id,
    playerId: p.player_id,
    playerName: `${p.metadata.first_name} ${p.metadata.last_name}`,
    position: p.metadata.position,
    team: p.metadata.team || '?',
    isMyPick: p.roster_id === myRosterId,
  }));
}

// ─── DRAFT STATE MANAGER ────────────────────────────────────

export interface DraftState {
  settings: DraftSettings;
  picks: DraftPick[];
  myRoster: DraftPick[];
  availablePlayers: PlayerInfo[];
  currentPick: number;
  currentRound: number;
  isMyTurn: boolean;
  nextMyPick: number;          // overall pick number of my next pick
  status: DraftStatus;
}

export function createInitialDraftState(settings: DraftSettings, players: PlayerInfo[]): DraftState {
  const myPicks = getAllPicksForSlot(settings.myDraftSlot, settings.rounds, settings.teamCount, settings.draftType);
  return {
    settings,
    picks: [],
    myRoster: [],
    availablePlayers: players.map(p => ({ ...p, isDrafted: false })),
    currentPick: 1,
    currentRound: 1,
    isMyTurn: myPicks[0] === 1,
    nextMyPick: myPicks[0],
    status: 'pre_draft',
  };
}

export function applyPick(state: DraftState, pick: DraftPick): DraftState {
  const newPicks = [...state.picks, pick];
  const newAvailable = state.availablePlayers.map(p =>
    p.id === pick.playerId
      ? { ...p, isDrafted: true, draftedBy: pick.slot, draftedAt: pick.pickNo }
      : p
  );
  const newRoster = pick.isMyPick ? [...state.myRoster, pick] : state.myRoster;
  const nextPickNo = pick.pickNo + 1;
  const nextRound = Math.ceil(nextPickNo / state.settings.teamCount);

  const myPicks = getAllPicksForSlot(
    state.settings.myDraftSlot,
    state.settings.rounds,
    state.settings.teamCount,
    state.settings.draftType
  );
  const nextMyPick = myPicks.find(p => p >= nextPickNo) || -1;

  return {
    ...state,
    picks: newPicks,
    myRoster: newRoster,
    availablePlayers: newAvailable,
    currentPick: nextPickNo,
    currentRound: nextRound,
    isMyTurn: nextMyPick === nextPickNo,
    nextMyPick,
    status: nextPickNo > state.settings.rounds * state.settings.teamCount ? 'complete' : 'drafting',
  };
}

/** Undo the last pick (for companion mode mistakes) */
export function undoLastPick(state: DraftState): DraftState {
  if (state.picks.length === 0) return state;
  const removed = state.picks[state.picks.length - 1];
  const newPicks = state.picks.slice(0, -1);
  const newAvailable = state.availablePlayers.map(p =>
    p.id === removed.playerId
      ? { ...p, isDrafted: false, draftedBy: undefined, draftedAt: undefined }
      : p
  );
  const newRoster = removed.isMyPick
    ? state.myRoster.filter(p => p.playerId !== removed.playerId)
    : state.myRoster;

  const prevPickNo = removed.pickNo;
  const prevRound = Math.ceil(prevPickNo / state.settings.teamCount);
  const myPicks = getAllPicksForSlot(
    state.settings.myDraftSlot,
    state.settings.rounds,
    state.settings.teamCount,
    state.settings.draftType
  );
  const nextMyPick = myPicks.find(p => p >= prevPickNo) || -1;

  return {
    ...state,
    picks: newPicks,
    myRoster: newRoster,
    availablePlayers: newAvailable,
    currentPick: prevPickNo,
    currentRound: prevRound,
    isMyTurn: nextMyPick === prevPickNo,
    nextMyPick,
    status: 'drafting',
  };
}

// ─── AI PROMPT BUILDER ──────────────────────────────────────

export function buildDraftPrompt(state: DraftState, question?: string): string {
  const { settings, myRoster, availablePlayers, currentPick, currentRound } = state;
  const available = availablePlayers.filter(p => !p.isDrafted);
  const topAvailableByPos: Record<string, PlayerInfo[]> = {};
  for (const p of available) {
    if (!topAvailableByPos[p.position]) topAvailableByPos[p.position] = [];
    if (topAvailableByPos[p.position].length < 5) {
      topAvailableByPos[p.position].push(p);
    }
  }

  const myRosterByPos: Record<string, string[]> = {};
  for (const pick of myRoster) {
    if (!myRosterByPos[pick.position]) myRosterByPos[pick.position] = [];
    myRosterByPos[pick.position].push(`${pick.playerName} (${pick.team})`);
  }

  const rosterStr = Object.entries(myRosterByPos)
    .map(([pos, names]) => `  ${pos}: ${names.join(', ')}`)
    .join('\n');

  const availStr = Object.entries(topAvailableByPos)
    .map(([pos, players]) =>
      `  ${pos}: ${players.map(p => `${p.name} (${p.team}, ADP ${p.adp})`).join(', ')}`
    )
    .join('\n');

  const filledSlots = myRoster.map(p => p.position);
  const neededSlots = [...settings.rosterSlots];
  for (const filled of filledSlots) {
    const idx = neededSlots.indexOf(filled);
    if (idx >= 0) neededSlots.splice(idx, 1);
    else {
      const flexIdx = neededSlots.indexOf('FLEX');
      if (flexIdx >= 0) neededSlots.splice(flexIdx, 1);
      else {
        const sfIdx = neededSlots.indexOf('SUPER_FLEX');
        if (sfIdx >= 0) neededSlots.splice(sfIdx, 1);
      }
    }
  }

  const myPicks = getAllPicksForSlot(
    settings.myDraftSlot,
    settings.rounds,
    settings.teamCount,
    settings.draftType
  );
  const remaining = myPicks.filter(p => p >= currentPick);

  return `You are The O, AIOmni's AI draft co-pilot. You are advising a fantasy football manager during a live ${settings.draftType} draft.

LEAGUE SETTINGS:
- Platform: ${settings.platform.toUpperCase()}
- League: ${settings.leagueName}
- Format: ${settings.scoringFormat.toUpperCase()}
- Teams: ${settings.teamCount}
- Rounds: ${settings.rounds}
- Roster Slots: ${settings.rosterSlots.join(', ')}
${settings.scoringSettings ? `- Scoring: ${JSON.stringify(settings.scoringSettings)}` : ''}
${settings.draftMode === 'rookie'
  ? `\nDRAFT TYPE: This is a KEEPER/DYNASTY rookie (supplemental) draft. Established veterans are ALREADY on keeper rosters and are NOT draftable — the "TOP AVAILABLE" list below is the real, complete pool of incoming 2026 rookies + leftover free agents. Do NOT recommend or reference players who aren't in that list (e.g. don't suggest established stars — they're already kept). A short available pool is EXPECTED here; treat the list as authoritative, not as an error.`
  : settings.isDynasty
  ? `\nDRAFT TYPE: Keeper/dynasty league — some players are already on keeper rosters and are not draftable. Recommend only from the TOP AVAILABLE list below.`
  : ''}

DRAFT STATE:
- Current Overall Pick: #${currentPick} (Round ${currentRound})
- My Draft Slot: ${settings.myDraftSlot}
- My Remaining Picks: ${remaining.join(', ')}
- Draft Type: ${settings.draftType}

MY ROSTER SO FAR (${myRoster.length} picks):
${rosterStr || '  (empty)'}

POSITIONS STILL NEEDED:
${neededSlots.length > 0 ? neededSlots.join(', ') : 'Roster complete'}

TOP AVAILABLE BY POSITION:
${availStr}

${question ? `USER QUESTION: ${sanitizePromptInput(question)}` : 'Who should I draft with my next pick? Consider roster needs, positional scarcity, ADP value, and format-specific player values. Give me your top 3 recommendations with brief reasoning for each. Be direct and decisive.'}`;
}

// ─── PLAYER DATABASE (2025 ADP) ─────────────────────────────
// This is a starter set. In production, pull from nfl_data_py or Sleeper ADP.

// ─── LIVE PLAYER DB (replaces static data with real ADP) ────
const BYE_WEEKS_2026: Record<string, number> = {
  ARI: 11, ATL: 12, BAL: 14, BUF: 12, CAR: 7, CHI: 7, CIN: 12,
  CLE: 9, DAL: 7, DEN: 14, DET: 5, GB: 10, HOU: 14, IND: 14,
  JAX: 12, KC: 6, LAC: 5, LAR: 6, LV: 10, MIA: 6, MIN: 9,
  NE: 14, NO: 12, NYG: 11, NYJ: 12, PHI: 5, PIT: 9, SEA: 10,
  SF: 9, TB: 11, TEN: 5, WAS: 14,
};

export type DraftMode = 'startup' | 'rookie' | 'redraft';

/** Loads player DB based on draft mode.
 *  - 'rookie'  -> prospects only (dynasty rookie drafts)
 *  - 'startup' -> NFL players + prospects merged (dynasty startup)
 *  - 'redraft' -> NFL players only (default)
 */
export async function loadLivePlayerDB(mode: DraftMode = 'redraft'): Promise<PlayerInfo[]> {
  try {
    if (mode === 'rookie') {
      // Rookie/short-round dynasty drafts: merge prospects with NFL free agents,
      // since these drafts may include incoming rookies AND cut veterans the league
      // chooses to draft from. Prospects first (usually top picks), then NFL pool.
      const [prospects, ranked] = await Promise.all([
        fetchProspectDB(),
        fetchBlendedConsensus(),
      ]);

      const nflAsPlayerInfo: PlayerInfo[] = ranked.map((p, i) => ({
        id: p.id,
        name: p.name,
        position: p.position,
        team: p.team,
        adp: parseFloat(p.adp) || (i + 1),
        byeWeek: BYE_WEEKS_2026[p.team] ?? 0,
        tier: p.tier,
        rank: p.rank,
        isDrafted: false,
      }));

      if (prospects.length === 0 && nflAsPlayerInfo.length === 0) return [...DEFAULT_PLAYER_DB];
      if (prospects.length === 0) return nflAsPlayerInfo;

      // Merge: prospects 1-N, then NFL starting at N+1
      const pLen = prospects.length;
      return [
        ...prospects,
        ...nflAsPlayerInfo.map((p, i) => ({ ...p, adp: pLen + i + 1, rank: pLen + i + 1 })),
      ];
    }

    const ranked = await fetchBlendedConsensus();
    const nflPlayers: PlayerInfo[] = ranked.length === 0
      ? [...DEFAULT_PLAYER_DB]
      : ranked.map((p, i) => ({
          id: p.id,
          name: p.name,
          position: p.position,
          team: p.team,
          adp: parseFloat(p.adp) || (i + 1),
          byeWeek: BYE_WEEKS_2026[p.team] ?? 0,
          tier: p.tier,
          rank: p.rank,
          isDrafted: false,
        }));

    if (mode === 'startup') {
      const prospects = await fetchProspectDB();
      const startIdx = nflPlayers.length;
      return [
        ...nflPlayers,
        ...prospects.map((p, i) => ({ ...p, adp: startIdx + i + 1, rank: startIdx + i + 1 }))
      ];
    }

    return nflPlayers;
  } catch (e) {
    console.log('loadLivePlayerDB fallback to static:', e);
    return [...DEFAULT_PLAYER_DB];
  }
}

async function fetchProspectDB(): Promise<PlayerInfo[]> {
  try {
    const { fetchDedupedProspects, fetchNFLRookieClass } = await import('./rankingsData');
    let list = await fetchDedupedProspects();
    // The curated college seed is emptied once a class enters the NFL (it's
    // post-draft and those players are now rookies in nfl_players). Without
    // this fallback a dynasty ROOKIE draft loads zero rookies, drops to the
    // veteran pool, and gets gutted to a handful of un-rostered FAs. Pull the
    // real rookie class from nfl_players instead.
    if (!list || list.length === 0) {
      list = await fetchNFLRookieClass();
    }
    if (!list || list.length === 0) return [];
    return list.slice(0, 150).map((p: any, i: number) => ({
      id: 'prospect-' + (p.id || i),
      name: p.name,
      position: p.position || 'WR',
      team: p.school || p.team || 'CFB',
      adp: i + 1,
      byeWeek: 0,
      tier: Math.floor(i / 12) + 1,
      rank: i + 1,
      isDrafted: false,
    }));
  } catch (e) {
    console.log('fetchProspectDB error:', e);
    return [];
  }
}

// Tier 1 = elite, Tier 2 = strong starter, Tier 3 = solid, Tier 4 = depth

export const DEFAULT_PLAYER_DB: PlayerInfo[] = [
  // QB
  { id: 'qb01', name: 'Josh Allen', position: 'QB', team: 'BUF', adp: 15, byeWeek: 12, tier: 1, rank: 1, isDrafted: false },
  { id: 'qb02', name: 'Lamar Jackson', position: 'QB', team: 'BAL', adp: 18, byeWeek: 14, tier: 1, rank: 2, isDrafted: false },
  { id: 'qb03', name: 'Jalen Hurts', position: 'QB', team: 'PHI', adp: 22, byeWeek: 5, tier: 1, rank: 3, isDrafted: false },
  { id: 'qb04', name: 'Patrick Mahomes', position: 'QB', team: 'KC', adp: 35, byeWeek: 6, tier: 2, rank: 4, isDrafted: false },
  { id: 'qb05', name: 'Joe Burrow', position: 'QB', team: 'CIN', adp: 55, byeWeek: 12, tier: 2, rank: 5, isDrafted: false },
  { id: 'qb06', name: 'Jayden Daniels', position: 'QB', team: 'WAS', adp: 60, byeWeek: 14, tier: 2, rank: 6, isDrafted: false },
  { id: 'qb07', name: 'Anthony Richardson', position: 'QB', team: 'IND', adp: 72, byeWeek: 14, tier: 3, rank: 7, isDrafted: false },
  { id: 'qb08', name: 'Caleb Williams', position: 'QB', team: 'CHI', adp: 80, byeWeek: 7, tier: 3, rank: 8, isDrafted: false },
  { id: 'qb09', name: 'Dak Prescott', position: 'QB', team: 'DAL', adp: 90, byeWeek: 7, tier: 3, rank: 9, isDrafted: false },
  { id: 'qb10', name: 'Kyler Murray', position: 'QB', team: 'ARI', adp: 100, byeWeek: 11, tier: 3, rank: 10, isDrafted: false },
  { id: 'qb11', name: 'Baker Mayfield', position: 'QB', team: 'TB', adp: 115, byeWeek: 11, tier: 4, rank: 11, isDrafted: false },
  { id: 'qb12', name: 'Justin Herbert', position: 'QB', team: 'LAC', adp: 120, byeWeek: 5, tier: 4, rank: 12, isDrafted: false },

  // RB
  { id: 'rb01', name: 'Saquon Barkley', position: 'RB', team: 'PHI', adp: 1, byeWeek: 5, tier: 1, rank: 1, isDrafted: false },
  { id: 'rb02', name: 'Jahmyr Gibbs', position: 'RB', team: 'DET', adp: 2, byeWeek: 5, tier: 1, rank: 2, isDrafted: false },
  { id: 'rb03', name: 'Bijan Robinson', position: 'RB', team: 'ATL', adp: 3, byeWeek: 12, tier: 1, rank: 3, isDrafted: false },
  { id: 'rb04', name: 'Breece Hall', position: 'RB', team: 'NYJ', adp: 5, byeWeek: 12, tier: 1, rank: 4, isDrafted: false },
  { id: 'rb05', name: 'De\'Von Achane', position: 'RB', team: 'MIA', adp: 6, byeWeek: 6, tier: 1, rank: 5, isDrafted: false },
  { id: 'rb06', name: 'Jonathan Taylor', position: 'RB', team: 'IND', adp: 8, byeWeek: 14, tier: 1, rank: 6, isDrafted: false },
  { id: 'rb07', name: 'Derrick Henry', position: 'RB', team: 'BAL', adp: 12, byeWeek: 14, tier: 2, rank: 7, isDrafted: false },
  { id: 'rb08', name: 'Josh Jacobs', position: 'RB', team: 'GB', adp: 14, byeWeek: 10, tier: 2, rank: 8, isDrafted: false },
  { id: 'rb09', name: 'Isiah Pacheco', position: 'RB', team: 'KC', adp: 20, byeWeek: 6, tier: 2, rank: 9, isDrafted: false },
  { id: 'rb10', name: 'David Montgomery', position: 'RB', team: 'DET', adp: 30, byeWeek: 5, tier: 2, rank: 10, isDrafted: false },
  { id: 'rb11', name: 'James Cook', position: 'RB', team: 'BUF', adp: 25, byeWeek: 12, tier: 2, rank: 11, isDrafted: false },
  { id: 'rb12', name: 'Kenneth Walker III', position: 'RB', team: 'SEA', adp: 28, byeWeek: 10, tier: 2, rank: 12, isDrafted: false },
  { id: 'rb13', name: 'Aaron Jones', position: 'RB', team: 'MIN', adp: 38, byeWeek: 9, tier: 3, rank: 13, isDrafted: false },
  { id: 'rb14', name: 'Kyren Williams', position: 'RB', team: 'LAR', adp: 32, byeWeek: 6, tier: 3, rank: 14, isDrafted: false },
  { id: 'rb15', name: 'Travis Etienne Jr.', position: 'RB', team: 'JAX', adp: 42, byeWeek: 12, tier: 3, rank: 15, isDrafted: false },
  { id: 'rb16', name: 'Rhamondre Stevenson', position: 'RB', team: 'NE', adp: 50, byeWeek: 14, tier: 3, rank: 16, isDrafted: false },
  { id: 'rb17', name: 'Najee Harris', position: 'RB', team: 'PIT', adp: 58, byeWeek: 9, tier: 3, rank: 17, isDrafted: false },
  { id: 'rb18', name: 'Chuba Hubbard', position: 'RB', team: 'CAR', adp: 65, byeWeek: 7, tier: 3, rank: 18, isDrafted: false },
  { id: 'rb19', name: 'Zamir White', position: 'RB', team: 'LV', adp: 78, byeWeek: 10, tier: 4, rank: 19, isDrafted: false },
  { id: 'rb20', name: 'Zack Moss', position: 'RB', team: 'CIN', adp: 82, byeWeek: 12, tier: 4, rank: 20, isDrafted: false },

  // WR
  { id: 'wr01', name: 'Ja\'Marr Chase', position: 'WR', team: 'CIN', adp: 4, byeWeek: 12, tier: 1, rank: 1, isDrafted: false },
  { id: 'wr02', name: 'CeeDee Lamb', position: 'WR', team: 'DAL', adp: 7, byeWeek: 7, tier: 1, rank: 2, isDrafted: false },
  { id: 'wr03', name: 'Amon-Ra St. Brown', position: 'WR', team: 'DET', adp: 9, byeWeek: 5, tier: 1, rank: 3, isDrafted: false },
  { id: 'wr04', name: 'Tyreek Hill', position: 'WR', team: 'MIA', adp: 10, byeWeek: 6, tier: 1, rank: 4, isDrafted: false },
  { id: 'wr05', name: 'Justin Jefferson', position: 'WR', team: 'MIN', adp: 11, byeWeek: 9, tier: 1, rank: 5, isDrafted: false },
  { id: 'wr06', name: 'Puka Nacua', position: 'WR', team: 'LAR', adp: 13, byeWeek: 6, tier: 1, rank: 6, isDrafted: false },
  { id: 'wr07', name: 'Malik Nabers', position: 'WR', team: 'NYG', adp: 16, byeWeek: 11, tier: 2, rank: 7, isDrafted: false },
  { id: 'wr08', name: 'Marvin Harrison Jr.', position: 'WR', team: 'ARI', adp: 19, byeWeek: 11, tier: 2, rank: 8, isDrafted: false },
  { id: 'wr09', name: 'Drake London', position: 'WR', team: 'ATL', adp: 21, byeWeek: 12, tier: 2, rank: 9, isDrafted: false },
  { id: 'wr10', name: 'Garrett Wilson', position: 'WR', team: 'NYJ', adp: 24, byeWeek: 12, tier: 2, rank: 10, isDrafted: false },
  { id: 'wr11', name: 'Chris Olave', position: 'WR', team: 'NO', adp: 27, byeWeek: 12, tier: 2, rank: 11, isDrafted: false },
  { id: 'wr12', name: 'Davante Adams', position: 'WR', team: 'NYJ', adp: 29, byeWeek: 12, tier: 2, rank: 12, isDrafted: false },
  { id: 'wr13', name: 'Nico Collins', position: 'WR', team: 'HOU', adp: 31, byeWeek: 14, tier: 2, rank: 13, isDrafted: false },
  { id: 'wr14', name: 'DeVonta Smith', position: 'WR', team: 'PHI', adp: 34, byeWeek: 5, tier: 2, rank: 14, isDrafted: false },
  { id: 'wr15', name: 'DK Metcalf', position: 'WR', team: 'SEA', adp: 36, byeWeek: 10, tier: 3, rank: 15, isDrafted: false },
  { id: 'wr16', name: 'Terry McLaurin', position: 'WR', team: 'WAS', adp: 39, byeWeek: 14, tier: 3, rank: 16, isDrafted: false },
  { id: 'wr17', name: 'Jaylen Waddle', position: 'WR', team: 'MIA', adp: 41, byeWeek: 6, tier: 3, rank: 17, isDrafted: false },
  { id: 'wr18', name: 'Stefon Diggs', position: 'WR', team: 'HOU', adp: 44, byeWeek: 14, tier: 3, rank: 18, isDrafted: false },
  { id: 'wr19', name: 'Tank Dell', position: 'WR', team: 'HOU', adp: 48, byeWeek: 14, tier: 3, rank: 19, isDrafted: false },
  { id: 'wr20', name: 'Zay Flowers', position: 'WR', team: 'BAL', adp: 46, byeWeek: 14, tier: 3, rank: 20, isDrafted: false },
  { id: 'wr21', name: 'Brian Thomas Jr.', position: 'WR', team: 'JAX', adp: 40, byeWeek: 12, tier: 3, rank: 21, isDrafted: false },
  { id: 'wr22', name: 'Ladd McConkey', position: 'WR', team: 'LAC', adp: 43, byeWeek: 5, tier: 3, rank: 22, isDrafted: false },
  { id: 'wr23', name: 'Rome Odunze', position: 'WR', team: 'CHI', adp: 62, byeWeek: 7, tier: 3, rank: 23, isDrafted: false },
  { id: 'wr24', name: 'Keenan Allen', position: 'WR', team: 'CHI', adp: 68, byeWeek: 7, tier: 4, rank: 24, isDrafted: false },
  { id: 'wr25', name: 'Courtland Sutton', position: 'WR', team: 'DEN', adp: 75, byeWeek: 14, tier: 4, rank: 25, isDrafted: false },

  // TE
  { id: 'te01', name: 'Sam LaPorta', position: 'TE', team: 'DET', adp: 23, byeWeek: 5, tier: 1, rank: 1, isDrafted: false },
  { id: 'te02', name: 'Travis Kelce', position: 'TE', team: 'KC', adp: 26, byeWeek: 6, tier: 1, rank: 2, isDrafted: false },
  { id: 'te03', name: 'Brock Bowers', position: 'TE', team: 'LV', adp: 33, byeWeek: 10, tier: 1, rank: 3, isDrafted: false },
  { id: 'te04', name: 'Trey McBride', position: 'TE', team: 'ARI', adp: 37, byeWeek: 11, tier: 2, rank: 4, isDrafted: false },
  { id: 'te05', name: 'George Kittle', position: 'TE', team: 'SF', adp: 52, byeWeek: 9, tier: 2, rank: 5, isDrafted: false },
  { id: 'te06', name: 'Mark Andrews', position: 'TE', team: 'BAL', adp: 57, byeWeek: 14, tier: 2, rank: 6, isDrafted: false },
  { id: 'te07', name: 'Dallas Goedert', position: 'TE', team: 'PHI', adp: 70, byeWeek: 5, tier: 3, rank: 7, isDrafted: false },
  { id: 'te08', name: 'Evan Engram', position: 'TE', team: 'JAX', adp: 85, byeWeek: 12, tier: 3, rank: 8, isDrafted: false },
  { id: 'te09', name: 'David Njoku', position: 'TE', team: 'CLE', adp: 95, byeWeek: 10, tier: 3, rank: 9, isDrafted: false },
  { id: 'te10', name: 'Jake Ferguson', position: 'TE', team: 'DAL', adp: 105, byeWeek: 7, tier: 4, rank: 10, isDrafted: false },

  // K
  { id: 'k01', name: 'Brandon Aubrey', position: 'K', team: 'DAL', adp: 130, byeWeek: 7, tier: 1, rank: 1, isDrafted: false },
  { id: 'k02', name: 'Justin Tucker', position: 'K', team: 'BAL', adp: 140, byeWeek: 14, tier: 2, rank: 2, isDrafted: false },
  { id: 'k03', name: 'Harrison Butker', position: 'K', team: 'KC', adp: 145, byeWeek: 6, tier: 2, rank: 3, isDrafted: false },
  { id: 'k04', name: 'Ka\'imi Fairbairn', position: 'K', team: 'HOU', adp: 150, byeWeek: 14, tier: 3, rank: 4, isDrafted: false },
  { id: 'k05', name: 'Jake Moody', position: 'K', team: 'SF', adp: 155, byeWeek: 9, tier: 3, rank: 5, isDrafted: false },

  // DEF
  { id: 'def01', name: 'San Francisco 49ers', position: 'DEF', team: 'SF', adp: 110, byeWeek: 9, tier: 1, rank: 1, isDrafted: false },
  { id: 'def02', name: 'Dallas Cowboys', position: 'DEF', team: 'DAL', adp: 118, byeWeek: 7, tier: 1, rank: 2, isDrafted: false },
  { id: 'def03', name: 'New York Jets', position: 'DEF', team: 'NYJ', adp: 122, byeWeek: 12, tier: 2, rank: 3, isDrafted: false },
  { id: 'def04', name: 'Baltimore Ravens', position: 'DEF', team: 'BAL', adp: 125, byeWeek: 14, tier: 2, rank: 4, isDrafted: false },
  { id: 'def05', name: 'Cleveland Browns', position: 'DEF', team: 'CLE', adp: 128, byeWeek: 10, tier: 2, rank: 5, isDrafted: false },
];

// ─── STORAGE ────────────────────────────────────────────────

const DRAFT_STATE_KEY = 'aiomni_draft_state';

export async function saveDraftState(state: DraftState): Promise<void> {
  try {
    await AsyncStorage.setItem(DRAFT_STATE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Failed to save draft state:', e);
  }
}

export async function loadDraftState(): Promise<DraftState | null> {
  try {
    const raw = await AsyncStorage.getItem(DRAFT_STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.error('Failed to load draft state:', e);
    return null;
  }
}

export async function clearDraftState(): Promise<void> {
  try {
    await AsyncStorage.removeItem(DRAFT_STATE_KEY);
  } catch (e) {
    console.error('Failed to clear draft state:', e);
  }
}