// services/platform/types.ts
// Platform-agnostic fantasy football interface.
// Every platform (Sleeper, ESPN, Yahoo) must implement FantasyPlatform.
// Screens consume these types — they never touch platform-specific APIs directly.

// ─── ENUMS ──────────────────────────────────────────────────

export type PlatformId = 'sleeper' | 'espn' | 'yahoo';

export type ScoringFormat = 'ppr' | 'half' | 'standard';

export type LeagueType = 'redraft' | 'dynasty' | 'keeper';

export type WaiverType = 'faab' | 'rolling' | 'reverse_standings' | 'unknown';

export type DraftType = 'snake' | 'linear' | 'auction';

export type DraftStatus = 'pre_draft' | 'drafting' | 'complete';

export type Position = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF' | 'FLEX' | 'SUPER_FLEX' | 'BN' | 'IR';

export type ConnectionStatus = 'connected' | 'expired' | 'never_connected';

export type HeatDirection = 'up' | 'down' | 'flat';

// ─── CORE ENTITIES ──────────────────────────────────────────

/** A player — identity only. Stats/projections live on richer variants. */
export interface Player {
  id: string;
  platformId: PlatformId;
  name: string;
  firstName: string;
  lastName: string;
  position: string;
  team: string;
  age?: number;
  yearsExp?: number;
  injuryStatus?: string | null;
  photoUrl?: string;
}

/**
 * Raw momentum signals each platform can provide about a player.
 * Not every platform provides every signal — missing values are `undefined`, not 0.
 * The Heat engine (services/heat.ts) combines these into a unified 0-100 score.
 */
export interface HeatSignals {
  /** Sleeper: adds in last 48h. ESPN/Yahoo: undefined. */
  addsLast48h?: number;
  /** Sleeper: drops in last 48h. ESPN/Yahoo: undefined. */
  dropsLast48h?: number;
  /** ESPN/Yahoo: current percent of leagues rostering this player (0-100). */
  percentOwned?: number;
  /** ESPN: percent of leagues starting this player (0-100). */
  percentStarted?: number;
  /** Any platform: change in percent owned over last 7 days. */
  ownershipDelta7d?: number;
  /** AIOmni internal: change in consensus rank over last 7 days (negative = rising). */
  rankDelta7d?: number;
}

/** A player in the context of waiver wire / free agency */
export interface AvailablePlayer extends Player {
  percentOwned?: number;
  percentStarted?: number;
  trendingAdds?: number;
  trendingDrops?: number;
  /** Normalized 0-100 momentum score, computed by the Heat engine */
  heatScore?: number;
  heatDirection?: HeatDirection;
  /** Raw signals for downstream consumers / Heat recomputation */
  heatSignals?: HeatSignals;
}

/** A roster entry — player + their slot assignment */
export interface RosterSlot {
  player: Player;
  slot: string;
  isStarter: boolean;
  points?: number;
  projected?: number;
}

/** League summary */
export interface League {
  id: string;
  platformId: PlatformId;
  name: string;
  season: string;
  teamCount: number;
  scoringFormat: ScoringFormat;
  leagueType: LeagueType;
  currentWeek?: number;
  avatarUrl?: string;
}

/** Full league detail — settings, roster slots, waivers config */
export interface LeagueDetail extends League {
  rosterSlots: string[];
  waiverType: WaiverType;
  faabBudget?: number;
  faabRemaining?: number;
  scoringSettings?: Record<string, number>;
  isDynasty: boolean;
}

/** One user's roster in a league */
export interface Roster {
  userId: string;
  rosterId: string;
  teamName: string;
  record: { wins: number; losses: number; ties: number };
  pointsFor: number;
  pointsAgainst: number;
  starters: RosterSlot[];
  bench: RosterSlot[];
  ir: RosterSlot[];
  isMe: boolean;
}

/** A standings entry */
export interface Standing {
  rosterId: string;
  teamName: string;
  rank: number;
  record: { wins: number; losses: number; ties: number };
  pointsFor: number;
  pointsAgainst: number;
  streak?: string;
  isMe: boolean;
}

export interface MatchupSide {
  rosterId: string;
  teamName: string;
  points: number;
  projected?: number;
  isMe: boolean;
}

export interface Matchup {
  week: number;
  matchupId: string;
  home: MatchupSide;
  away: MatchupSide;
}

export interface DraftInfo {
  id: string;
  platformId: PlatformId;
  leagueId: string;
  type: DraftType;
  status: DraftStatus;
  rounds: number;
  teamCount: number;
  myDraftSlot?: number;
  slotToRosterId?: Record<number, string>;
  pickTimer?: number;
  startTime?: number;
}

export interface DraftPick {
  pickNo: number;
  round: number;
  slot: number;
  rosterId: string;
  playerId: string;
  playerName: string;
  position: string;
  team: string;
  isMyPick: boolean;
}

export interface Transaction {
  id: string;
  type: 'add' | 'drop' | 'trade' | 'waiver' | 'commish';
  timestamp: number;
  adds: { player: Player; toRosterId: string }[];
  drops: { player: Player; fromRosterId: string }[];
  faabBid?: number;
  status: 'complete' | 'pending' | 'failed';
}

// ─── THE CONTRACT ───────────────────────────────────────────

/**
 * Every platform implementation must satisfy this interface.
 * Screens consume FantasyPlatform — they never know or care which platform.
 *
 * SCOPE NOTE: This interface intentionally excludes write operations (submitting
 * adds/drops/trades on the user's behalf). AIOmni advises; the user acts in their
 * native platform app. Keeps us out of account management entirely.
 */
export interface FantasyPlatform {
  readonly platformId: PlatformId;

  // ─── AUTH / SESSION ───

  isAuthenticated(): Promise<boolean>;

  /**
   * Distinguishes never-connected from session-expired. Settings uses this
   * to show "Connect Yahoo" vs "Yahoo session expired — reconnect".
   */
  getConnectionStatus(): Promise<ConnectionStatus>;

  getMyUserId(): Promise<string | null>;

  // ─── LEAGUES ───

  getLeagues(season?: string): Promise<League[]>;
  getLeague(leagueId: string): Promise<LeagueDetail>;

  // ─── ROSTERS ───

  getMyRoster(leagueId: string): Promise<Roster | null>;
  getAllRosters(leagueId: string): Promise<Roster[]>;

  // ─── WAIVERS / FREE AGENCY ───

  getAvailablePlayers(leagueId: string, opts?: { limit?: number }): Promise<AvailablePlayer[]>;

  /**
   * Raw Heat signals for a specific player. Returns undefined for signals
   * this platform doesn't provide.
   */
  getHeatSignals(leagueId: string, playerId: string): Promise<HeatSignals>;

  // ─── SEARCH ───

  searchPlayers(query: string, opts?: { limit?: number }): Promise<Player[]>;

  // ─── STANDINGS / MATCHUPS ───

  getStandings(leagueId: string): Promise<Standing[]>;
  getMatchups(leagueId: string, week?: number): Promise<Matchup[]>;

  // ─── DRAFTS ───

  getDraft(leagueId: string): Promise<DraftInfo | null>;
  getDraftPicks(draftId: string): Promise<DraftPick[]>;

  // ─── TRANSACTIONS ───

  getTransactions(leagueId: string, limit?: number): Promise<Transaction[]>;
}

// ─── ERRORS ─────────────────────────────────────────────────

export class PlatformError extends Error {
  constructor(
    message: string,
    public readonly platformId: PlatformId,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'PlatformError';
  }
}

export class PlatformAuthError extends PlatformError {
  constructor(platformId: PlatformId, message = 'Not authenticated') {
    super(message, platformId);
    this.name = 'PlatformAuthError';
  }
}

export class PlatformNotSupportedError extends PlatformError {
  constructor(platformId: PlatformId, feature: string) {
    super(`${feature} not supported on ${platformId}`, platformId);
    this.name = 'PlatformNotSupportedError';
  }
}
