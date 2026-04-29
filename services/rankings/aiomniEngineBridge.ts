// services/rankings/aiomniEngineBridge.ts
// ═══════════════════════════════════════════════════════════════════════════
// AIOMNI ENGINE BRIDGE
// ═══════════════════════════════════════════════════════════════════════════
//
// Connects the pure `rankAIOmni()` engine to the app's data layer.
//
// The engine (aiomniEngine.ts) is deliberately pure — it takes typed
// InputPlayer[] + LeagueConfig and returns RankedPlayer[]. It doesn't know
// about Sleeper, ESPN, Yahoo, Supabase, or the UI's RankedPlayer shape.
//
// This bridge handles:
//   1. Pulling blended source data via fetchBlendedConsensus()
//   2. Converting UI's RankedPlayer (string adp, string position) to
//      the engine's strict InputPlayer shape
//   3. Mapping UI ScoringFormat ('PPR'|'HALF'|'STD'|'SF'|'DYN') onto the
//      engine's LeagueConfig flags (superflex, dynasty, scoring)
//   4. Running the engine
//   5. Merging engine output back onto UI shape, preserving live-data
//      fields (trend, injury, snap%, news) from the source
//   6. Caching results by format for 5 minutes so every screen
//      navigation doesn't re-run 8 parallel API calls + the engine
//
// ─── TIER DISPLAY ───────────────────────────────────────────────────────────
// The engine produces per-position tiers (RB Tier 1, WR Tier 1, QB Tier 1
// all exist) based on natural VOR cliffs within each position. That's the
// correct algorithmic output, but when the full list is sorted by VOR and
// grouped by tier for display, per-position tiers create fragmented 1-3
// player sections as the list interleaves positions.
//
// For the UI's tier dividers, we override `tier` with a GLOBAL-RANK tier
// using fixed breakpoints. Global tiers are monotonic by rank, so a group
// divider always spans a contiguous block of players and reads cleanly.
//
// The engine's per-position tier is preserved on `positionalTier` for any
// consumer that needs it (Draft Copilot's "show me Tier 1 RBs" filter,
// Trade Analyzer's within-position value lookups).
// ═══════════════════════════════════════════════════════════════════════════

import {
  rankAIOmni,
  InputPlayer,
  Position as EnginePosition,
  LeagueConfig,
  LEAGUE_PRESETS,
  RankedPlayer as EngineRankedPlayer,
  AIOMNI_ALGORITHM_VERSION,
} from './aiomniEngine';
import {
  fetchBlendedConsensus,
  fetchBaseRankings,
  RankedPlayer as UIRankedPlayer,
  RankingsSource,
  ScoringFormat as UIFormat,
  LeagueType,
  ScoringRules,
} from '../rankingsData';

// ─── ENGINE POSITION VALIDATION ─────────────────────────────────────────────

const ENGINE_POSITIONS = new Set<EnginePosition>(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);

function isEnginePosition(pos: string): pos is EnginePosition {
  return ENGINE_POSITIONS.has(pos as EnginePosition);
}

// ─── UI FORMAT → LEAGUE CONFIG MAPPING ──────────────────────────────────────

export function uiFormatToConfig(
  format: UIFormat,
  leagueType: LeagueType = 'redraft',
): LeagueConfig {
  // Dynasty leagueType always routes through DYNASTY_PPR for now.
  // TODO: add DYNASTY_HALF / DYNASTY_STD / DYNASTY_SUPERFLEX presets to
  // aiomniEngine and select among them based on `format`.
  if (leagueType === 'dynasty') {
    return { ...LEAGUE_PRESETS.DYNASTY_PPR };
  }
  switch (format) {
    case 'PPR':  return { ...LEAGUE_PRESETS.STANDARD_REDRAFT_PPR };
    case 'HALF': return { ...LEAGUE_PRESETS.STANDARD_REDRAFT_HALF };
    case 'STD':  return { ...LEAGUE_PRESETS.STANDARD_REDRAFT_STD };
    case 'SF':   return { ...LEAGUE_PRESETS.SUPERFLEX_PPR };
    case 'DYN':  return { ...LEAGUE_PRESETS.DYNASTY_PPR };
    default:     return { ...LEAGUE_PRESETS.STANDARD_REDRAFT_PPR };
  }
}

// Map UI ScoringFormat -> rankingsData ScoringRules. (Two parallel type
// systems; this bridges them.) Legacy 'DYN' falls into 'ppr' because in
// the new model dynasty IS the leagueType, not the scoring rules.
function uiFormatToScoringRules(format: UIFormat): ScoringRules {
  switch (format) {
    case 'HALF': return 'half';
    case 'STD':  return 'std';
    case 'SF':   return 'superflex';
    case 'PPR':
    case 'DYN':
    default:     return 'ppr';
  }
}

// ─── GLOBAL-RANK TIER ASSIGNMENT ────────────────────────────────────────────
//
// Breakpoints calibrated to a standard 12-team league:
//   Tier 1  ranks 1–6      Elite — round 1 anchors
//   Tier 2  ranks 7–15     Blue chip — high-end starters
//   Tier 3  ranks 16–30    Starter — confident weekly starter
//   Tier 4  ranks 31–60    Flex play — bench/flex depth
//   Tier 5  rank 61+       Upside — dart throws

export function assignGlobalTier(rank: number): number {
  if (rank <= 6)  return 1;
  if (rank <= 15) return 2;
  if (rank <= 30) return 3;
  if (rank <= 60) return 4;
  return 5;
}

// Per-position tier buckets. Engine's gap-detection clustering can produce
// singleton top tiers when one position has concentrated elite talent (Allen,
// Lamar, Hurts each sit in their own VOR gap). Fixed buckets based on posRank
// give predictable tier sizes regardless of VOR distribution:
//   Tier 1  posRank 1–3     Elite at position
//   Tier 2  posRank 4–8     Blue chip
//   Tier 3  posRank 9–15    Starter
//   Tier 4  posRank 16–30   Flex / bench depth
//   Tier 5  posRank 31+     Upside / dart throws
export function assignPositionalTier(posRank: number): number {
  if (posRank <= 3)  return 1;
  if (posRank <= 8)  return 2;
  if (posRank <= 15) return 3;
  if (posRank <= 30) return 4;
  return 5;
}

// ─── UI RankedPlayer → engine InputPlayer ───────────────────────────────────

function toInputPlayer(p: UIRankedPlayer): InputPlayer | null {
  if (!isEnginePosition(p.position)) return null;
  const adpNum = parseFloat(p.adp);
  if (isNaN(adpNum) || adpNum <= 0) return null;
  return {
    id: p.id,
    name: p.name,
    position: p.position as EnginePosition,
    team: p.team,
    adp: adpNum,
  };
}

// ─── engine RankedPlayer → UI RankedPlayer ──────────────────────────────────

function toUIPlayer(
  enginePlayer: EngineRankedPlayer,
  originalMap: Map<string, UIRankedPlayer>,
): UIRankedPlayer {
  const orig = originalMap.get(enginePlayer.id);
  return {
    id: enginePlayer.id,
    name: enginePlayer.name,
    position: enginePlayer.position,
    team: enginePlayer.team,
    rank: enginePlayer.rank,
    adp: enginePlayer.adp.toFixed(1),
    // Override the engine's per-position tier with a global-rank tier for
    // clean monotonic divider display. Per-position tier is preserved on
    // positionalTier for downstream consumers.
    tier: assignGlobalTier(enginePlayer.rank),
    posRank: enginePlayer.posRank,
    // Preserve live-data fields from the blended source
    trend: orig?.trend ?? 'flat',
    trendVal: orig?.trendVal ?? 0,
    injuryStatus: orig?.injuryStatus ?? null,
    injuryDetail: orig?.injuryDetail ?? null,
    trendingAdds: orig?.trendingAdds,
    trendingDrops: orig?.trendingDrops,
    snapPct: orig?.snapPct,
    newsHeadline: orig?.newsHeadline,
    newsAge: orig?.newsAge,
    impliedTeamScore: orig?.impliedTeamScore,
    statLine: orig?.statLine,
    sourceCount: orig?.sourceCount,
    // positionalTier = bucket-based tier for UI display (predictable sizes).
    // algorithmicTier = engine's natural-cliff tier (for trade/draft analysis).
    // Neither is in the UI RankedPlayer interface yet — access via cast.
    positionalTier: assignPositionalTier(enginePlayer.posRank),
    algorithmicTier: enginePlayer.tier,
  } as any;
}

// ─── CORE TRANSFORM: source list → engine → UI list ─────────────────────────

export function applyEngineToRankings(
  source: UIRankedPlayer[],
  format: UIFormat,
  leagueType: LeagueType = 'redraft',
): UIRankedPlayer[] {
  const config = uiFormatToConfig(format, leagueType);
  const inputs: InputPlayer[] = [];
  const originalMap = new Map<string, UIRankedPlayer>();

  for (const p of source) {
    const input = toInputPlayer(p);
    if (input) {
      inputs.push(input);
      originalMap.set(p.id, p);
    }
  }

  if (inputs.length === 0) return [];

  const ranked = rankAIOmni(inputs, config);
  return ranked.map(p => toUIPlayer(p, originalMap));
}

// ─── IN-MEMORY CACHE ────────────────────────────────────────────────────────

interface CacheEntry {
  format: UIFormat;
  leagueType: LeagueType;
  data: UIRankedPlayer[];
  ts: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let engineCache: CacheEntry | null = null;

export function invalidateEngineCache(): void {
  engineCache = null;
}

// ─── PUBLIC API ─────────────────────────────────────────────────────────────

export async function getEngineRankings(
  format: UIFormat,
  leagueType: LeagueType = 'redraft',
  force = false,
): Promise<UIRankedPlayer[]> {
  if (
    !force &&
    engineCache &&
    engineCache.format === format &&
    engineCache.leagueType === leagueType &&
    Date.now() - engineCache.ts < CACHE_TTL_MS
  ) {
    return engineCache.data;
  }

  try {
    const scoringRules = uiFormatToScoringRules(format);
    const blended = await fetchBlendedConsensus(leagueType, scoringRules);
    const data = applyEngineToRankings(blended, format, leagueType);
    engineCache = { format, leagueType, data, ts: Date.now() };
    return data;
  } catch (e) {
    console.log('getEngineRankings error:', e);
    return engineCache?.format === format && engineCache?.leagueType === leagueType
      ? engineCache.data
      : [];
  }
}

export async function getEngineRankingsForSource(
  source: RankingsSource,
  format: UIFormat,
  leagueType: LeagueType = 'redraft',
): Promise<UIRankedPlayer[]> {
  try {
    const scoringRules = uiFormatToScoringRules(format);
    const raw = await fetchBaseRankings(source, leagueType, scoringRules);
    return applyEngineToRankings(raw, format, leagueType);
  } catch (e) {
    console.log('getEngineRankingsForSource error:', e);
    return [];
  }
}

export { AIOMNI_ALGORITHM_VERSION };
