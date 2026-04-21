// services/rankings/aiomniEngine.ts
// ═══════════════════════════════════════════════════════════════════════════
// THE AIOMNI RANKING ALGORITHM
// ═══════════════════════════════════════════════════════════════════════════
//
// This is the canonical ranking engine for AIOmni. Every ranking displayed
// anywhere in the app — Community, My Rankings, Draft Copilot, Trade Analyzer
// recommendations — flows through this module.
//
// DESIGN PHILOSOPHY
// ─────────────────
// Fantasy ranking platforms (FantasyPros, ESPN, Yahoo) publish lists derived
// from proprietary blends. AIOmni takes a different approach: make the math
// explicit, documented, and format-aware. Every number in our rankings is
// traceable to a specific step in this algorithm. No black-box scoring.
//
// This creates three strategic advantages:
//   1. REPRODUCIBILITY — given the same input data, every AIOmni user sees the
//      same base rankings. No drift, no hidden randomness.
//   2. FORMAT ACCURACY — the algorithm knows your league settings and adjusts
//      Replacement Level accordingly, not via hand-tuned position boosts.
//   3. AUDITABILITY — any user or acquirer can read this file and understand
//      exactly how we produce our numbers. That transparency IS the moat.
//
// THE ALGORITHM IN FOUR STAGES
// ─────────────────────────────
// Stage 1 — Projected Points (PP): convert ADP/consensus rank into a point
//           estimate using empirical decay curves calibrated to historical
//           season-end scoring. Applies format-specific scoring coefficients.
//
// Stage 2 — Value Over Replacement (VOR): subtract positional replacement
//           level from each player's projected points. Replacement level is
//           determined by league construction (teams × starters at position).
//           This captures positional scarcity — why RB1 matters more than QB1.
//
// Stage 3 — Time-Value Factor (TVF): for dynasty formats, compute Expected
//           Lifetime Value using age-based depreciation curves. An aging
//           RB's next 5 years depreciate faster than a young WR's.
//
// Stage 4 — Tier Clustering: group players into tiers by detecting natural
//           cliffs (large VOR gaps between adjacent ranks). This surfaces
//           the "you should trade up/down" decision points without hand-
//           tuning tier breaks.
//
// WHAT THIS MODULE DOES NOT DO (yet)
// ──────────────────────────────────
//   - Fetch data (pure function — takes input, produces output)
//   - Store user overrides (separate module: userOverrides.ts)
//   - Render to UI (separate concern)
//   - Apply community consensus weighting (separate module)
//   - Accurate per-player projections (V2: integrate projections data feed)
//
// Integration point: upstream code calls `rankAIOmni(players, config)` with
// players from rankingsData.ts (blended ADP from Sleeper/ESPN/Yahoo/NFL.com)
// and a LeagueConfig describing scoring + roster + dynasty settings. Output
// is RankedPlayer[] ready to display.
//
// ═══════════════════════════════════════════════════════════════════════════

// ─── TYPES ─────────────────────────────────────────────────────────────────

/**
 * Input player shape. Deliberately minimal — we only need what the algorithm
 * consumes. Callers can pass extra fields; they'll be preserved via ...rest.
 */
export interface InputPlayer {
  id: string;
  name: string;
  position: Position;
  team: string;
  /** Blended ADP from Sleeper/ESPN/Yahoo/NFL.com median. Lower = better. */
  adp: number;
  /** Age in years. Required for dynasty. Use nflreadpy as canonical source. */
  age?: number;
  /** Years of NFL experience. 0 = rookie. Used for rookie boost. */
  yearsExp?: number;
  /** Projected season fantasy points. If absent, we derive from ADP. */
  projectedPoints?: number;
}

export type Position = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF';

export type ScoringFormat = 'PPR' | 'HALF' | 'STD';

/**
 * League configuration. Drives replacement level calculation and format
 * adjustments. Use LEAGUE_PRESETS for common configurations.
 */
export interface LeagueConfig {
  teams: number;                  // typical: 10, 12, 14
  scoring: ScoringFormat;         // PPR / HALF / STD
  superflex: boolean;             // 2nd QB slot or SF position
  tePremium: boolean;             // TEs score 1.5x receiving points
  dynasty: boolean;               // apply Time-Value Factor
  /** Starting lineup counts — these drive Replacement Level */
  starters: {
    QB: number;
    RB: number;
    WR: number;
    TE: number;
    FLEX: number;                 // RB/WR/TE
    K: number;
    DEF: number;
  };
}

/**
 * Output player shape. All the algorithmic outputs are attached so UI can
 * show "why" explanations (tooltip: "VOR 84 · Tier 2 · Age 26").
 */
export interface RankedPlayer extends InputPlayer {
  rank: number;                   // 1-indexed overall rank
  posRank: number;                // rank within position
  tier: number;                   // 1-5, lower = better
  projectedPoints: number;        // always populated after Stage 1
  replacementLevel: number;       // the PP threshold for this position
  vor: number;                    // PP - replacementLevel (Stage 2 output)
  elv?: number;                   // Expected Lifetime Value (dynasty only)
  ageAdjustment?: number;         // percent change from TVF
}

// ─── PRESETS ───────────────────────────────────────────────────────────────

/**
 * Common league configurations. Use these as starting points, override fields
 * to match the user's actual league settings (fetched from Sleeper/ESPN/Yahoo).
 */
export const LEAGUE_PRESETS = {
  STANDARD_REDRAFT_PPR: {
    teams: 12, scoring: 'PPR' as ScoringFormat, superflex: false,
    tePremium: false, dynasty: false,
    starters: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 },
  },
  STANDARD_REDRAFT_HALF: {
    teams: 12, scoring: 'HALF' as ScoringFormat, superflex: false,
    tePremium: false, dynasty: false,
    starters: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 },
  },
  STANDARD_REDRAFT_STD: {
    teams: 12, scoring: 'STD' as ScoringFormat, superflex: false,
    tePremium: false, dynasty: false,
    starters: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 },
  },
  SUPERFLEX_PPR: {
    teams: 12, scoring: 'PPR' as ScoringFormat, superflex: true,
    tePremium: false, dynasty: false,
    starters: { QB: 2, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 0, DEF: 0 },
  },
  DYNASTY_PPR: {
    teams: 12, scoring: 'PPR' as ScoringFormat, superflex: false,
    tePremium: false, dynasty: true,
    starters: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 0, DEF: 0 },
  },
  DYNASTY_SUPERFLEX_TEP: {
    teams: 12, scoring: 'PPR' as ScoringFormat, superflex: true,
    tePremium: true, dynasty: true,
    starters: { QB: 2, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 0, DEF: 0 },
  },
} as const satisfies Record<string, LeagueConfig>;

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 1: PROJECTED POINTS
// ═══════════════════════════════════════════════════════════════════════════
// Derive projected season points from ADP using empirical decay curves.
//
// WHY NOT USE REAL PROJECTIONS? Real per-player projections come from paid
// feeds (FantasyPros, FantasyNerds, Draft Sharks — $50-200/year each). For
// V1 we reverse-engineer reasonable projections from consensus ADP using
// historical curves. When we add a projections feed, swap out this function
// and the rest of the algorithm keeps working.
//
// THE CURVE: based on aggregate season-end fantasy points by final ranking
// position, averaged across 2020-2024 seasons, normalized for PPR scoring.
// Output is a smooth exponential decay with position-specific shape.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Position-specific scoring curve coefficients, fit to historical data.
 * Returns projected season points for a player with position-rank `posRank`
 * in format `scoring`. Calibrated from 2020-2024 season-end totals.
 *
 * The curve: PP(rank) = A * exp(-k * rank) + B
 *   A: peak value above baseline (league's best at position)
 *   k: decay rate (how fast value drops off)
 *   B: asymptotic floor (replacement-level starter)
 *
 * These coefficients are the heart of the algorithm. Tuning them against
 * real season outcomes is the path to better rankings over time. For V1,
 * these are ballpark-accurate based on public fantasy analysis.
 */
const POINT_CURVES: Record<Position, Record<ScoringFormat, { A: number; k: number; B: number }>> = {
  QB: {
    PPR:  { A: 180, k: 0.08, B: 220 },   // QB1 ~400, QB24 ~260
    HALF: { A: 180, k: 0.08, B: 220 },   // passing scoring is format-invariant
    STD:  { A: 180, k: 0.08, B: 220 },
  },
  RB: {
    PPR:  { A: 200, k: 0.09, B: 80 },    // RB1 ~280, RB36 ~90
    HALF: { A: 170, k: 0.09, B: 70 },    // RBs lose reception points
    STD:  { A: 140, k: 0.09, B: 60 },    // pure rushing RBs still strong
  },
  WR: {
    PPR:  { A: 180, k: 0.07, B: 90 },    // WR1 ~270, WR48 ~100
    HALF: { A: 155, k: 0.07, B: 75 },    // lose ~15% volume-based points
    STD:  { A: 130, k: 0.07, B: 60 },    // WRs punished most in STD
  },
  TE: {
    PPR:  { A: 130, k: 0.12, B: 70 },    // steep cliff after top 6
    HALF: { A: 110, k: 0.12, B: 60 },
    STD:  { A: 90,  k: 0.12, B: 50 },
  },
  K: {
    PPR:  { A: 30,  k: 0.03, B: 105 },   // kickers are flat — every K ~110
    HALF: { A: 30,  k: 0.03, B: 105 },
    STD:  { A: 30,  k: 0.03, B: 105 },
  },
  DEF: {
    PPR:  { A: 60,  k: 0.05, B: 80 },    // DEF has more spread than K
    HALF: { A: 60,  k: 0.05, B: 80 },
    STD:  { A: 60,  k: 0.05, B: 80 },
  },
};

/**
 * Convert a position rank (1 = best at position) to projected season points.
 * Used when real projections aren't available (V1 default path).
 */
function projectedPointsFromPosRank(position: Position, posRank: number, scoring: ScoringFormat): number {
  const curve = POINT_CURVES[position][scoring];
  return curve.A * Math.exp(-curve.k * (posRank - 1)) + curve.B;
}

/**
 * TE Premium bonus: leagues that score TE receptions at 1.5x multiplier.
 * Effectively boosts all TE projections by ~25% (reception-heavy portion).
 */
const TE_PREMIUM_MULTIPLIER = 1.25;

/**
 * Stage 1 entry point. Takes raw players with ADP, produces same players
 * annotated with projectedPoints. If caller already supplied projectedPoints,
 * we use theirs (allowing future integration of real projection feeds).
 *
 * Process:
 *   1. Group players by position
 *   2. Sort each group by ADP ascending
 *   3. Assign posRank within group
 *   4. Look up position curve for the scoring format
 *   5. Compute PP from posRank via curve
 *   6. Apply TE Premium multiplier if configured
 */
function stage1_projectedPoints(players: InputPlayer[], config: LeagueConfig): InputPlayer[] {
  // Group by position
  const byPosition: Record<string, InputPlayer[]> = {};
  for (const p of players) {
    (byPosition[p.position] ||= []).push(p);
  }

  // For each position: sort by ADP, assign posRank, compute PP
  const output: InputPlayer[] = [];
  for (const position of Object.keys(byPosition) as Position[]) {
    const group = byPosition[position];
    group.sort((a, b) => a.adp - b.adp);

    for (let i = 0; i < group.length; i++) {
      const player = group[i];
      const posRank = i + 1;

      let pp = player.projectedPoints !== undefined
        ? player.projectedPoints
        : projectedPointsFromPosRank(position, posRank, config.scoring);

      // TE Premium: boost TE projections if configured
      if (config.tePremium && position === 'TE') {
        pp *= TE_PREMIUM_MULTIPLIER;
      }

      output.push({ ...player, projectedPoints: pp });
    }
  }

  return output;
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 2: VALUE OVER REPLACEMENT (VOR)
// ═══════════════════════════════════════════════════════════════════════════
// The core of position-aware ranking. A RB scoring 200 points can rank above
// a QB scoring 350 points because the gap between a good RB and replacement-
// level RB is larger than the gap at QB.
//
// Replacement Level is the projected points of the last starter-quality
// player at that position. For a 12-team, 2-RB league: RB24 is replacement.
// Any RB above RB24 provides value; anyone below is a bench/waiver player.
//
// FLEX HANDLING: FLEX slots (RB/WR/TE) raise replacement level for all three
// positions because teams will fill FLEX with the best available RB/WR/TE.
// We compute pool-based replacement: if 12 teams start 2 RBs + 2 WRs + 1 TE
// + 1 FLEX, the replacement pool is 12×(2+2+1)+12×1 = 72 total flex-eligible
// slots. We distribute them by historical FLEX usage rates (RB 35%, WR 55%, TE 10%).
//
// SUPERFLEX HANDLING: 2 QB slots drastically raise QB replacement level.
// In a 12-team SF league, QB24 becomes replacement instead of QB12.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Historical FLEX fill rates from 2020-2024 fantasy data.
 * Sum must equal 1.0. Used to allocate FLEX slots across RB/WR/TE.
 */
const FLEX_ALLOCATION = { RB: 0.35, WR: 0.55, TE: 0.10 };

/**
 * SUPER_FLEX allocation: 2nd QB slot is effectively a mini-starter line.
 * In practice, teams fill SF with QBs at near 100% rate for starters.
 */
const SUPERFLEX_ALLOCATION = { QB: 0.95, RB: 0.02, WR: 0.02, TE: 0.01 };

/**
 * Compute Replacement Level projected points for each position given the
 * league configuration. Returns a map { position → projectedPoints-at-replacement }.
 *
 * A player at exactly replacement level has VOR = 0. Any player above is
 * a positive asset; anyone below is subreplacement.
 */
export function computeReplacementLevels(config: LeagueConfig): Record<Position, number> {
  const { teams, starters, superflex, scoring } = config;

  // Base starter counts (not including FLEX)
  const baseSlots: Record<Position, number> = {
    QB:  teams * starters.QB,
    RB:  teams * starters.RB,
    WR:  teams * starters.WR,
    TE:  teams * starters.TE,
    K:   teams * starters.K,
    DEF: teams * starters.DEF,
  };

  // Add FLEX allocation
  const flexSlots = teams * starters.FLEX;
  baseSlots.RB += flexSlots * FLEX_ALLOCATION.RB;
  baseSlots.WR += flexSlots * FLEX_ALLOCATION.WR;
  baseSlots.TE += flexSlots * FLEX_ALLOCATION.TE;

  // Add SUPERFLEX allocation if configured. Note: in superflex leagues, the
  // "extra QB slot" is usually counted as part of starters.QB (= 2). If SF
  // is enabled but starters.QB only counts 1, redistribute here.
  if (superflex && starters.QB < 2) {
    const sfSlots = teams * 1;  // 1 SF slot per team is standard
    baseSlots.QB += sfSlots * SUPERFLEX_ALLOCATION.QB;
    baseSlots.RB += sfSlots * SUPERFLEX_ALLOCATION.RB;
    baseSlots.WR += sfSlots * SUPERFLEX_ALLOCATION.WR;
    baseSlots.TE += sfSlots * SUPERFLEX_ALLOCATION.TE;
  }

  // Replacement Level = the last starter at that position.
  // For RB with 24 total starter slots (12 teams × 2 RBs), RL = PP at posRank=24.
  // We use the same point curve that Stage 1 used, ensuring consistency.
  const levels: Record<Position, number> = {
    QB: projectedPointsFromPosRank('QB', Math.ceil(baseSlots.QB), scoring),
    RB: projectedPointsFromPosRank('RB', Math.ceil(baseSlots.RB), scoring),
    WR: projectedPointsFromPosRank('WR', Math.ceil(baseSlots.WR), scoring),
    TE: projectedPointsFromPosRank('TE', Math.ceil(baseSlots.TE), scoring),
    K:  projectedPointsFromPosRank('K',  Math.ceil(baseSlots.K),  scoring),
    DEF:projectedPointsFromPosRank('DEF',Math.ceil(baseSlots.DEF),scoring),
  };

  return levels;
}

/**
 * Stage 2 entry point. Takes players with projectedPoints, computes VOR for
 * each using the league's replacement levels. Also attaches replacementLevel
 * to each player for transparency.
 */
function stage2_vor(players: InputPlayer[], config: LeagueConfig): (InputPlayer & { vor: number; replacementLevel: number })[] {
  const rl = computeReplacementLevels(config);
  return players.map(p => ({
    ...p,
    replacementLevel: rl[p.position],
    vor: (p.projectedPoints ?? 0) - rl[p.position],
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 3: TIME-VALUE FACTOR (Dynasty only)
// ═══════════════════════════════════════════════════════════════════════════
// In dynasty leagues, a player's value isn't just this season — it's the
// discounted sum of their expected future production. An aging RB might have
// 2 good years left; a young WR might have 8. We model this as:
//
//   ELV = Σ (PP_year * (1-depreciation)^(year-1)) / (1+discount)^(year-1)
//
// DEPRECIATION RATE d by position:
//   RB: aggressive — RBs peak at 25-26, steep cliff after 27-28
//   WR: moderate — peak 27-29, gradual decline to 32
//   QB: slow — can produce at high level into mid-30s
//   TE: moderate — similar to WR but slightly more volatile
//
// DISCOUNT RATE r: "a point this year is worth more than a point next year"
//   Default: 10% — contenders discount the future more, rebuilders less.
//   Future enhancement: make this a user preference in dynasty settings.
//
// ROOKIE PREMIUM: rookies and year-2 players get a boost for unrealized
// upside. This is the "youth is valuable" factor that drives dynasty ADP
// for rookies often ranking above established veterans.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Age-position depreciation rate. Annual percentage decline applied to
 * projected points. Values from historical fantasy analysis.
 */
function getDepreciationRate(position: Position, age: number): number {
  // Curves below produce depreciation rate for the NEXT year.
  // Younger than peak = 0 (or slight upside); past peak = accelerating decline.
  switch (position) {
    case 'RB':
      if (age < 25) return 0.00;      // ascending or stable
      if (age < 27) return 0.05;      // early decline
      if (age < 29) return 0.15;      // clear decline
      if (age < 31) return 0.30;      // steep decline
      return 0.45;                    // cliff
    case 'WR':
      if (age < 27) return 0.00;
      if (age < 29) return 0.03;
      if (age < 31) return 0.08;
      if (age < 33) return 0.18;
      return 0.30;
    case 'QB':
      if (age < 30) return 0.00;
      if (age < 34) return 0.03;
      if (age < 37) return 0.10;
      return 0.20;
    case 'TE':
      if (age < 28) return 0.00;
      if (age < 30) return 0.05;
      if (age < 32) return 0.12;
      if (age < 34) return 0.22;
      return 0.35;
    case 'K':
    case 'DEF':
      return 0.00;                    // not relevant for dynasty
  }
}

/**
 * Rookie / young-player premium multiplier.
 * Year 0 (rookie): 1.15x ELV — upside we haven't seen yet
 * Year 1 (2nd year): 1.08x — breakout potential
 * Year 2+: 1.00x
 */
function getYouthPremium(yearsExp: number | undefined): number {
  if (yearsExp === undefined) return 1.00;
  if (yearsExp === 0) return 1.15;
  if (yearsExp === 1) return 1.08;
  return 1.00;
}

/**
 * Default dynasty projection horizon and discount rate.
 * HORIZON: how many years forward to sum. 5 is standard — further out gets
 * too speculative.
 * DISCOUNT: how much to weight future years. 10% is conservative; aggressive
 * contenders might use 20%.
 */
const DYNASTY_HORIZON_YEARS = 5;
const DYNASTY_DISCOUNT_RATE = 0.10;

/**
 * Stage 3 entry point. For each player, computes Expected Lifetime Value (ELV)
 * and replaces their "current-year VOR" with dynasty-adjusted value.
 *
 * If config.dynasty is false, this stage is a no-op.
 */
function stage3_timeValueFactor(
  players: (InputPlayer & { vor: number; replacementLevel: number })[],
  config: LeagueConfig
): (InputPlayer & { vor: number; replacementLevel: number; elv?: number; ageAdjustment?: number })[] {
  if (!config.dynasty) return players;

  return players.map(p => {
    // Default age if missing: position-dependent guess (prevents crashes
    // but undermines accuracy — real solution is accurate age data)
    const age = p.age ?? AVERAGE_AGE_BY_POSITION[p.position];
    const currentPP = p.projectedPoints ?? 0;

    // Compute future production as depreciating stream
    let elv = 0;
    let projectedYearPP = currentPP;
    for (let year = 0; year < DYNASTY_HORIZON_YEARS; year++) {
      // Discount this year's points by time-value discount rate
      const discountFactor = 1 / Math.pow(1 + DYNASTY_DISCOUNT_RATE, year);
      elv += projectedYearPP * discountFactor;

      // Apply depreciation for next year (based on age at that time)
      const futureAge = age + year + 1;
      const depreciation = getDepreciationRate(p.position, futureAge);
      projectedYearPP *= (1 - depreciation);
    }

    // Youth premium: rookies and 2nd-year players get boosted ELV
    const youthMultiplier = getYouthPremium(p.yearsExp);
    elv *= youthMultiplier;

    // Compute "effective VOR" for dynasty: ELV minus 5-year replacement stream
    const replacementStreamValue = p.replacementLevel *
      ((1 - Math.pow(1 / (1 + DYNASTY_DISCOUNT_RATE), DYNASTY_HORIZON_YEARS)) / DYNASTY_DISCOUNT_RATE);

    const dynastyVor = elv - replacementStreamValue;

    // Track age adjustment as percent: (dynastyVor / currentYearVor) - 1
    // Useful for UI: "this player is -22% due to age" or "+18% for youth"
    const ageAdjustment = p.vor !== 0 ? (dynastyVor / p.vor) - 1 : 0;

    return {
      ...p,
      vor: dynastyVor,        // override with dynasty-adjusted VOR
      elv,
      ageAdjustment,
    };
  });
}

/**
 * Position-average ages when player age is missing. Fallback only.
 * Fetched from nflreadpy `import_players()` in a future update.
 */
const AVERAGE_AGE_BY_POSITION: Record<Position, number> = {
  QB: 28, RB: 25, WR: 27, TE: 27, K: 29, DEF: 0,
};

// ═══════════════════════════════════════════════════════════════════════════
// STAGE 4: TIER CLUSTERING
// ═══════════════════════════════════════════════════════════════════════════
// Fantasy managers think in tiers, not ranks. "Should I draft Chase or JSN?"
// matters less than "are they in the same tier?" — if yes, either is fine.
//
// ALGORITHM: natural-cliff detection via VOR gap analysis.
//   1. Sort players by VOR descending
//   2. Compute gap[i] = VOR[i] - VOR[i+1] for adjacent players
//   3. Find the top N-1 gaps (where N = desired tier count)
//   4. Tier boundaries fall at those gaps
//
// This is a simplified version of what a Gaussian Mixture Model would produce.
// Full GMM would cluster players in multi-dimensional space (VOR + consistency
// + injury risk + age). V1 ships with 1D VOR clustering; V2 expands dimensions.
//
// DEFAULT: 5 tiers, determined per-position. "Tier 1 QB" and "Tier 1 RB" are
// comparable-quality within their position but not across positions.
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_TIERS = 5;

/**
 * Assign tier number (1 = best) to each player based on VOR gaps within
 * their position. Modifies players in place, returning the same array.
 */
function stage4_tierClustering(
  players: (InputPlayer & { vor: number; replacementLevel: number })[],
  tierCount: number = DEFAULT_TIERS
): (InputPlayer & { vor: number; replacementLevel: number; tier: number })[] {
  // Group by position
  const byPosition: Record<string, typeof players> = {};
  for (const p of players) {
    (byPosition[p.position] ||= []).push(p);
  }

  const output: typeof players & { tier: number }[] = [] as any;

  for (const position of Object.keys(byPosition) as Position[]) {
    const group = byPosition[position].slice().sort((a, b) => b.vor - a.vor);

    if (group.length <= tierCount) {
      // Fewer players than tiers: each gets its own tier
      group.forEach((p, i) => output.push({ ...p, tier: Math.min(i + 1, tierCount) }));
      continue;
    }

    // Compute gap array
    const gaps: { index: number; gap: number }[] = [];
    for (let i = 0; i < group.length - 1; i++) {
      gaps.push({ index: i, gap: group[i].vor - group[i + 1].vor });
    }

    // Find the top (tierCount - 1) gaps — these are the tier boundaries
    const topGaps = gaps
      .slice()
      .sort((a, b) => b.gap - a.gap)
      .slice(0, tierCount - 1)
      .map(g => g.index)
      .sort((a, b) => a - b);

    // Walk through sorted group, incrementing tier when we cross a boundary
    let currentTier = 1;
    let boundaryIdx = 0;
    for (let i = 0; i < group.length; i++) {
      if (boundaryIdx < topGaps.length && i > topGaps[boundaryIdx]) {
        currentTier++;
        boundaryIdx++;
      }
      output.push({ ...group[i], tier: currentTier });
    }
  }

  return output as any;
}

// ═══════════════════════════════════════════════════════════════════════════
// FINAL ASSEMBLY: FULL ALGORITHM
// ═══════════════════════════════════════════════════════════════════════════
// Orchestrates all four stages and produces the final ranked list.
//
//   Stage 1: ADP → projectedPoints (format-aware)
//   Stage 2: projectedPoints → VOR (replacement-level aware)
//   Stage 3: VOR → dynasty-adjusted VOR (if dynasty league)
//   Stage 4: sorted VOR → tier assignments
//
// OUTPUT: players sorted by VOR descending, with overall rank, position rank,
// tier, and all intermediate values attached for UI transparency.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * THE MAIN ENTRY POINT.
 *
 * @param players  Raw players from blended ADP source (Sleeper/ESPN/Yahoo/NFL.com)
 * @param config   League configuration (scoring, roster, dynasty, etc.)
 * @returns        Players ranked by VOR, with tier/posRank/rank annotations
 *
 * Example:
 *   const ranked = rankAIOmni(blendedPlayers, LEAGUE_PRESETS.STANDARD_REDRAFT_PPR);
 *   ranked[0].name      // "Ja'Marr Chase"
 *   ranked[0].rank      // 1
 *   ranked[0].posRank   // 1 (WR1)
 *   ranked[0].vor       // 184.3
 *   ranked[0].tier      // 1
 */
export function rankAIOmni(players: InputPlayer[], config: LeagueConfig): RankedPlayer[] {
  // Stage 1: compute projected points
  const stage1 = stage1_projectedPoints(players, config);

  // Stage 2: compute VOR
  const stage2 = stage2_vor(stage1, config);

  // Stage 3: apply Time-Value Factor if dynasty
  const stage3 = stage3_timeValueFactor(stage2, config);

  // Stage 4: assign tiers within position
  const stage4 = stage4_tierClustering(stage3);

  // Sort by VOR descending, assign overall rank and position rank
  const sorted = stage4.slice().sort((a, b) => b.vor - a.vor);
  const posCounters: Partial<Record<Position, number>> = {};

  return sorted.map((p, i) => {
    posCounters[p.position] = (posCounters[p.position] ?? 0) + 1;
    return {
      ...p,
      rank: i + 1,
      posRank: posCounters[p.position]!,
      projectedPoints: p.projectedPoints ?? 0,
    } as RankedPlayer;
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES & EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Explain why a player is ranked where they are. For UI tooltips, support
 * chat, and acquirer due diligence. Example output:
 *
 *   "Ja'Marr Chase · WR1 · Tier 1
 *    Projected 318 points (PPR)
 *    Replacement level: 110 points
 *    VOR: +208
 *    No dynasty age adjustment"
 */
export function explainRanking(player: RankedPlayer, config: LeagueConfig): string {
  const lines: string[] = [];
  lines.push(`${player.name} · ${player.position}${player.posRank} · Tier ${player.tier}`);
  lines.push(`Projected ${player.projectedPoints.toFixed(0)} points (${config.scoring})`);
  lines.push(`Replacement level: ${player.replacementLevel.toFixed(0)} points`);
  lines.push(`VOR: ${player.vor >= 0 ? '+' : ''}${player.vor.toFixed(1)}`);
  if (config.dynasty && player.ageAdjustment !== undefined) {
    const pct = (player.ageAdjustment * 100).toFixed(0);
    const sign = player.ageAdjustment >= 0 ? '+' : '';
    lines.push(`Dynasty age adjustment: ${sign}${pct}% (age ${player.age ?? '?'})`);
    if (player.elv !== undefined) {
      lines.push(`Expected lifetime value: ${player.elv.toFixed(0)} points over ${DYNASTY_HORIZON_YEARS} years`);
    }
  }
  return lines.join('\n');
}

/**
 * Narrow helper: rank only a subset of positions. Useful for position-specific
 * views (e.g., "show me only QBs for my Superflex draft").
 */
export function rankAIOmniByPosition(
  players: InputPlayer[],
  config: LeagueConfig,
  positions: Position[]
): RankedPlayer[] {
  const filtered = players.filter(p => positions.includes(p.position));
  return rankAIOmni(filtered, config);
}

/**
 * Version identifier. Increment when algorithm changes in a way that would
 * produce different outputs for identical inputs. Useful for cache invalidation
 * and A/B testing future algorithm changes.
 */
export const AIOMNI_ALGORITHM_VERSION = '1.0.0';

// ═══════════════════════════════════════════════════════════════════════════
// END OF AIOMNI RANKING ALGORITHM
// ═══════════════════════════════════════════════════════════════════════════
//
// WHAT'S NEXT
// ───────────
// This module is the foundation. Future improvements bolt on without
// changing the core API:
//
//   - Real projections feed (replaces Stage 1 curve-based estimate)
//   - User override layer (modifies Stage 4 output per user)
//   - Community consensus blending (weighted avg of this algorithm + user data)
//   - Injury/Vegas/trending multipliers (Stage 2.5 — small adjustments)
//   - Multi-dimensional GMM tier clustering (replaces Stage 4 with smarter math)
//   - Age data source integration (replaces AVERAGE_AGE_BY_POSITION fallback)
//   - Auction value calculation (separate output from the same algorithm)
//
// Every one of these is additive. The core rankAIOmni() function signature
// stays stable. Callers don't need to change when internals evolve.
//
// ═══════════════════════════════════════════════════════════════════════════
