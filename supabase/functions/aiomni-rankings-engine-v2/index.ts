// supabase/functions/aiomni-rankings-engine/index.ts
// ──────────────────────────────────────────────────────────────────────
// AIOMNI PROPRIETARY RANKINGS ENGINE v2
//
// Changes from v1:
//   - Multi-year weighted baseline for players <= 27 yrs old:
//       60% * 2025_ppg + 30% * 2024_ppg + 10% * 2023_ppg
//     Players 28+ keep single-year (2025) baseline because
//     trajectory matters less for late-career players.
//   - Aged-vet decline strengthened: TE 33+ 0.55x, RB 30+ 0.50x,
//     WR 33+ 0.60x. Stops Kelce-style false positives.
//   - Floor protection no longer applies to players age >= 30.
//
// Synthesis pipeline:
//   Score = 0.25 * baseline  +  0.75 * forward_layer
//
// where baseline = weighted multi-year ppg
//       forward_layer = baseline * age_curve_mult * team_change_mult
//                       * (1 + rookie_boost) * (1 + opportunity_adj)
//                       * format_position_adj

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// v2026-05-09: Path 3 — depth-chart multiplier. Penalizes WR/RB/TE/QB
// players whose Sleeper depth_chart_order indicates rotation/bench role.
// Only fires in production (depth chart isn't historical for backtest).
// Set to false to instantly disable without removing the code path.
const DEPTH_CHART_MULTIPLIER_ENABLED = true;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Format keys (locked 2026-05-07):
//   Redraft: PPR, HALF, STD, SF
//   Dynasty: DYN (PPR-scored, kept for backward compat with client),
//            DYN_HALF, DYN_STD, DYN_SF (added 2026-05-07 — same dynasty
//            age curves, different scoring + optional SF QB premium).
type Format = 'PPR' | 'HALF' | 'STD' | 'SF' | 'DYN' | 'DYN_HALF' | 'DYN_STD' | 'DYN_SF';

// ─── AGE CURVES (v2: steeper late-career declines) ────────────────────
function ageCurve(position: string, age: number | null): number {
  if (!age || age <= 0) return 1.0;
  const a = age;
  if (position === 'RB') {
    // v4.3 (2026-05-17, second pass): further softened. Saquon at 29 (post
    // 2,000-yd 2024) and CMC at 30 (19g elite 2024) are not in decline yet.
    // Modern RB aging is non-linear; the curve below assumes elite RBs
    // maintain through age 29 with only mild slip, real decline at 30+.
    // Proven-vet 3+ qualifying seasons compounds with this to keep top-5
    // workhorses near their peak projection.
    if (a <= 23) return 1.20;
    if (a <= 26) return 1.10;
    if (a === 27) return 1.00;
    if (a === 28) return 0.98;       // tightened — late prime
    if (a === 29) return 0.92;       // was 0.85
    if (a === 30) return 0.78;       // was 0.72
    if (a === 31) return 0.62;
    return 0.42;
  }
  if (position === 'WR') {
    if (a <= 23) return 1.15;
    if (a <= 27) return 1.10;
    if (a <= 30) return 1.00;
    if (a === 31) return 0.96;       // v4 2026-05-17: softened. Modern WRs age much
    if (a === 32) return 0.92;       // better than the curve assumed. Evans 32, 17 ppg
    if (a === 33) return 0.86;       // in 2024; Adams 33, 15.2 ppg full season 2025;
    if (a === 34) return 0.75;       // Hill, Hopkins, etc all maintained into 32-34.
    return 0.55;                     // Steep drop only at 35+.
  }
  if (position === 'TE') {
    // v5.1 (2026-05-17): tighter peak window. Andrews 30 was at 1.00 — TEs
    // 30+ are past peak. Modern TEs peak 26-29.
    if (a <= 24) return 1.05;
    if (a <= 28) return 1.10;
    if (a === 29) return 1.05;
    if (a === 30) return 0.96;       // was 1.00 — moves Andrews from peak to early decline
    if (a === 31) return 0.90;
    if (a === 32) return 0.84;
    if (a === 33) return 0.78;
    if (a === 34) return 0.68;
    return 0.55;
  }
  if (position === 'QB') {
    if (a <= 24) return 1.05;
    if (a <= 33) return 1.00;
    if (a <= 36) return 0.95;        // v2026-05-08: softer
    if (a <= 38) return 0.88;        // softened from 0.78 — Stafford backtest
    return 0.75;                     // softened from 0.60
  }
  return 1.0;
}

// ─── TEAM-CHANGE DELTA ────────────────────────────────────────────────
const OFFENSE_TIER_2024: Record<string, number> = {
  BAL: 1, BUF: 1, DET: 1, KC: 1, MIA: 1, SF: 1,
  CIN: 2, DAL: 2, GB: 2, HOU: 2, LAR: 2, PHI: 2, TB: 2, WAS: 2,
  ARI: 3, ATL: 3, IND: 3, JAX: 3, LAC: 3, MIN: 3, PIT: 3, SEA: 3,
  CAR: 4, CHI: 4, CLE: 4, DEN: 4, LV: 4, NO: 4, NYJ: 4, TEN: 4,
  NE: 5, NYG: 5,
  // nflverse uses 'LA' for Rams sometimes
  LA: 2,
};

function teamChangeAdj(prevTeam: string | null, currTeam: string | null): number {
  if (!prevTeam || !currTeam || prevTeam === currTeam) return 1.0;
  const prev = OFFENSE_TIER_2024[prevTeam] ?? 3;
  const curr = OFFENSE_TIER_2024[currTeam] ?? 3;
  const tierDelta = prev - curr;
  if (tierDelta >= 2) return 1.08;
  if (tierDelta === 1) return 1.04;
  if (tierDelta === -1) return 0.96;
  if (tierDelta <= -2) return 0.90;
  return 1.0;
}

// ═══════════════════════════════════════════════════════════════════════
// v3 (2026-05-16): FRESH ARCHITECTURE — full rebuild per user spec
// ═══════════════════════════════════════════════════════════════════════

// ─── Offensive line ranks (2026 projected, source: user-provided photos) ──
// PB rank affects QB (sack avoidance) + WR/TE (more time = more open plays)
// RB rank affects RB (run blocking quality directly)
const OL_PB_RANK_2026: Record<string, number> = {
  PIT: 1,  LAR: 2,  CHI: 3,  SF:  4,  SEA: 5,  DEN: 6,  JAX: 7,  IND: 8,
  DET: 9,  CIN: 10, MIA: 11, ATL: 12, BUF: 13, TB:  14, TEN: 15, DAL: 16,
  PHI: 17, HOU: 18, ARI: 19, WAS: 20, NO:  21, MIN: 22, LV:  23, KC:  24,
  CAR: 25, GB:  26, NE:  27, NYG: 28, BAL: 29, NYJ: 30, CLE: 31, LAC: 32,
};
const OL_RB_RANK_2026: Record<string, number> = {
  LAR: 1,  BAL: 2,  BUF: 3,  CHI: 4,  DEN: 5,  IND: 6,  DET: 7,  SF:  8,
  CAR: 9,  MIN: 10, DAL: 11, PHI: 12, JAX: 13, NE:  14, NYJ: 15, ATL: 16,
  SEA: 17, PIT: 18, MIA: 19, ARI: 20, TEN: 21, NYG: 22, GB:  23, WAS: 24,
  CIN: 25, TB:  26, KC:  27, NO:  28, HOU: 29, LAC: 30, CLE: 31, LV:  32,
};

// ═══════════════════════════════════════════════════════════════════════
// v4 (2026-05-17): NEW DATA — travel burden + per-week positional SOS
// ═══════════════════════════════════════════════════════════════════════

// 2026 team travel burden multipliers (0.95 heaviest → 1.05 lightest).
// Computed from nfl_schedule + stadium coords + timezone offsets.
// Captures: total round-trip miles, 2+ tz crossings, cross-country trips,
// short-rest after long travel. West-coast + Florida teams penalized.
const TEAM_TRAVEL_MULT_2026: Record<string, number> = {
  ARI: 1.0113, ATL: 1.0478, BAL: 1.0431, BUF: 0.9695, CAR: 1.0481,
  CHI: 1.0251, CIN: 1.0500, CLE: 1.0467, DAL: 0.9959, DEN: 0.9829,
  DET: 1.0259, GB:  1.0193, HOU: 0.9999, IND: 1.0467, JAX: 1.0128,
  KC:  0.9839, LAC: 0.9500, LAR: 0.9742, LV:  0.9611, MIA: 0.9618,
  MIN: 1.0136, NE:  0.9780, NO:  1.0371, NYG: 0.9805, NYJ: 0.9879,
  PHI: 0.9898, PIT: 1.0476, SF:  0.9758, SEA: 0.9629, TB:  1.0383,
  TEN: 1.0233, WAS: 0.9896,
};

// 2026 per-week positional SOS. Uses v4 weekly weights (W1-6 ×1.5,
// W7-13 ×1, W14-17 ×2) so playoff-stretch matchups count more. z-score
// vs league mean. Replaces POSITIONAL_SOS_2026 (which was season-average).
// 2025 league mean fpts/g allowed: QB 16.59, RB 22.04, WR 30.61, TE 12.88.
type PerWeekSos = { QB: number; RB: number; WR: number; TE: number };
const TEAM_PER_WEEK_SOS_2026: Record<string, PerWeekSos> = {
  ARI: { QB:  0.029, RB:  0.024, WR:  0.001, TE: -0.235 },
  ATL: { QB:  0.050, RB:  0.011, WR: -0.015, TE:  0.083 },
  BAL: { QB:  0.109, RB:  0.072, WR: -0.082, TE:  0.374 },
  BUF: { QB: -0.159, RB: -0.320, WR: -0.101, TE: -0.069 },
  CAR: { QB: -0.052, RB: -0.248, WR: -0.172, TE:  0.102 },
  CHI: { QB: -0.196, RB: -0.048, WR: -0.250, TE: -0.320 },
  CIN: { QB:  0.120, RB: -0.203, WR:  0.217, TE:  0.169 },
  CLE: { QB:  0.388, RB:  0.124, WR:  0.442, TE:  0.113 },
  DAL: { QB:  0.137, RB:  0.184, WR:  0.226, TE: -0.090 },
  DEN: { QB: -0.227, RB:  0.005, WR: -0.256, TE: -0.183 },
  DET: { QB: -0.021, RB:  0.264, WR: -0.092, TE: -0.256 },
  GB:  { QB:  0.056, RB:  0.096, WR: -0.090, TE: -0.320 },
  HOU: { QB:  0.161, RB:  0.038, WR:  0.329, TE:  0.159 },
  IND: { QB:  0.150, RB:  0.122, WR:  0.005, TE:  0.240 },
  JAX: { QB:  0.257, RB: -0.031, WR:  0.233, TE:  0.295 },
  KC:  { QB: -0.251, RB: -0.068, WR: -0.321, TE:  0.220 },
  LAC: { QB: -0.134, RB:  0.059, WR: -0.270, TE: -0.192 },
  LAR: { QB:  0.074, RB:  0.245, WR: -0.030, TE: -0.168 },
  LV:  { QB: -0.410, RB: -0.283, WR: -0.479, TE: -0.051 },
  MIA: { QB: -0.260, RB:  0.014, WR: -0.207, TE: -0.250 },
  MIN: { QB:  0.281, RB:  0.120, WR:  0.260, TE:  0.033 },
  NE:  { QB: -0.194, RB: -0.191, WR: -0.283, TE: -0.208 },
  NO:  { QB:  0.081, RB:  0.272, WR:  0.062, TE: -0.118 },
  NYG: { QB:  0.340, RB:  0.097, WR:  0.369, TE:  0.218 },
  NYJ: { QB: -0.320, RB: -0.293, WR: -0.249, TE: -0.035 },
  PHI: { QB:  0.294, RB:  0.066, WR:  0.469, TE:  0.400 },
  PIT: { QB: -0.088, RB: -0.026, WR: -0.195, TE:  0.268 },
  SEA: { QB: -0.042, RB:  0.291, WR: -0.045, TE: -0.112 },
  SF:  { QB: -0.220, RB: -0.099, WR: -0.315, TE: -0.253 },
  TB:  { QB: -0.019, RB: -0.005, WR:  0.069, TE: -0.085 },
  TEN: { QB:  0.352, RB:  0.035, WR:  0.524, TE:  0.221 },
  WAS: { QB: -0.087, RB:  0.049, WR: -0.056, TE: -0.105 },
};

// v4 positional SOS multiplier (replaces v3 season-avg sosMult).
// 5% per std-dev z-score, clamped ±10% (looser cap than v3 ±5% because
// per-week-weighted scores have more meaningful spread).
function sosMultV4(team: string | null | undefined, position: string): { mult: number; note: string } {
  if (!team || !['QB','RB','WR','TE'].includes(position)) return { mult: 1.0, note: '' };
  const sos = TEAM_PER_WEEK_SOS_2026[team];
  if (!sos) return { mult: 1.0, note: '' };
  const z = sos[position as keyof PerWeekSos];
  let mult = 1.0 + 0.05 * z;
  if (mult > 1.10) mult = 1.10;
  if (mult < 0.90) mult = 0.90;
  let note = '';
  if (Math.abs(z) >= 0.20) {
    const tag = z > 0 ? 'soft' : 'hard';
    note = `${team} ${position} ${tag} per-wk-SOS z=${z >= 0 ? '+' : ''}${z.toFixed(2)} (${mult.toFixed(3)}x)`;
  }
  return { mult, note };
}

// v4 travel burden multiplier
function travelMultV4(team: string | null | undefined): { mult: number; note: string } {
  if (!team) return { mult: 1.0, note: '' };
  const mult = TEAM_TRAVEL_MULT_2026[team] ?? 1.0;
  let note = '';
  if (mult <= 0.97) note = `${team} heavy travel (${mult.toFixed(3)}x)`;
  else if (mult >= 1.04) note = `${team} light travel (${mult.toFixed(3)}x)`;
  return { mult, note };
}

// Position-specific season replacement fpts (PPR full-season totals).
// Used in v4 to compute "fpts over replacement season-total" rankings.
// Rough estimates from 2024 final fantasy data; refine over time.
const POS_REPLACEMENT_SEASON_FPTS: Record<string, number> = {
  QB: 240,   // QB14ish
  RB: 140,   // RB30ish
  WR: 136,   // WR36ish
  TE: 85,    // TE14ish
};

// v4 EXPECTED GAMES — converts per-game to season total.
// Inputs: per-season games-played array (most-recent first), age, position,
// optional injury override.
// Output: clamp [3, 17] expected games for 2026.
function expectedGamesV4(
  avgGames: number,
  age: number,
  position: string,
  injuryMult: number = 1.0,
  perSeasonGames?: number[],   // v4.1: e.g., [7, 17, 17] for Wilson means 2025=7, 2024=17, 2023=17
): { games: number; note: string } {
  // v4.1 (2026-05-17): smarter base — if most-recent year was injury-shortened
  // (<10g) AND prior years were healthy (16+g), give more weight to the
  // prior healthy seasons. Wilson/Nabers case: one ACL/concussion year
  // shouldn't define expected availability when career is otherwise full.
  let base = avgGames > 0 ? avgGames : 14;
  if (perSeasonGames && perSeasonGames.length >= 2) {
    const recent = perSeasonGames[0];
    const priors = perSeasonGames.slice(1);
    const priorMin = Math.min(...priors);
    const priorAvg = priors.reduce((a, b) => a + b, 0) / priors.length;

    if (recent < 10 && priorMin >= 15) {
      // Case A: Recent year was injury-shortened but priors were healthy.
      // Weight priors more heavily (Wilson/Nabers case).
      base = 0.70 * priorAvg + 0.30 * recent;
    } else if (recent >= 15 && priorMin < 15) {
      // Case B (v5.9 2026-05-19): Recent year was HEALTHY but priors were
      // partial. Trust the recent healthy year more aggressively (was
      // 0.65/0.35, now 0.80/0.20). Saquon case: recent 16g + a 14g 2023
      // year was anchoring him at 15.0g expected; now anchors at 15.8g.
      base = 0.80 * recent + 0.20 * priorAvg;
    }
  } else if (perSeasonGames && perSeasonGames.length === 1 && perSeasonGames[0] >= 16) {
    // v5.9 (2026-05-19): sophomore healthy-rookie case. Default base of 14
    // crushed Jeanty (17g rookie → engine projected 14g). One healthy season
    // is the best signal we have; anchor on it, cap at 16 (slight IR risk
    // premium).
    base = Math.min(perSeasonGames[0], 16);
  }

  // Age durability adjust (the only place age affects season length)
  let ageAdj = 1.0;
  if (position === 'RB') {
    if (age >= 30) ageAdj = 0.92;
    else if (age >= 29) ageAdj = 0.96;
  } else if (position === 'WR' || position === 'TE') {
    if (age >= 33) ageAdj = 0.92;
    else if (age >= 31) ageAdj = 0.96;
  } else if (position === 'QB') {
    if (age >= 37) ageAdj = 0.94;
  }

  let games = base * ageAdj * injuryMult;
  if (games < 3) games = 3;
  if (games > 17) games = 17;

  let note = '';
  if (games < 15) note = `${games.toFixed(1)}g expected (${avgGames.toFixed(1)}g 3yr avg)`;
  return { games, note };
}

// OL multiplier: rank 1 → +5%, rank 32 → -5%, linear. PB applied to
// QB/WR/TE (pass-game protection time), RB used for RB (run-game).
function olMultV3(team: string | null | undefined, position: string): { mult: number; note: string } {
  if (!team) return { mult: 1.0, note: '' };
  const useRb = position === 'RB';
  const rankMap = useRb ? OL_RB_RANK_2026 : OL_PB_RANK_2026;
  const rank = rankMap[team];
  if (!rank) return { mult: 1.0, note: '' };
  const mult = 1.05 - (rank - 1) * (0.10 / 31);  // 1.05 → 0.95 linear
  const label = useRb ? 'OL-run' : 'OL-pass';
  let note = '';
  if (rank <= 5) note = `${label} elite rank ${rank} (${mult.toFixed(3)}x)`;
  else if (rank >= 28) note = `${label} weak rank ${rank} (${mult.toFixed(3)}x)`;
  return { mult, note };
}

// Draft pick tier boost for 2026 rookies (current year only).
// Higher pick = bigger boost. Maps draft capital to year-1 expectation lift.
function draftPickBoostV3(draftRound: number | null, draftPick: number | null, position?: string): number {
  // v4.3 (2026-05-17): position-aware draft tier. R1 RBs have a much
  // higher year-1 hit rate than R1 QBs/WRs/TEs (positions take longer to
  // develop). Bijan, Gibbs, Saquon, McCaffrey all produced as rookies.
  // R1 WRs and QBs often need a year. So RB top-10 picks get a stronger
  // baseline boost. Position-agnostic boost remains for non-RBs.
  if (!draftRound || draftRound > 7) return 0;
  const pick = draftPick ?? (draftRound === 1 ? 16 : draftRound * 32 - 16);
  if (position === 'RB') {
    if (pick <= 5)       return 0.45;  // RB top-5 (Bijan/Gibbs-tier impact)
    if (pick <= 10)      return 0.35;
    if (pick <= 15)      return 0.25;
    if (pick <= 32)      return 0.18;
    if (draftRound === 2) return 0.08;
    if (draftRound === 3) return 0.04;
    return 0;
  }
  // Non-RB positions
  if (pick <= 5)       return 0.25;
  if (pick <= 10)      return 0.18;
  if (pick <= 15)      return 0.13;
  if (pick <= 32)      return 0.10;
  if (draftRound === 2) return 0.05;
  if (draftRound === 3) return 0.02;
  return 0;
}

// Weekly recency PPG per v3 spec: W1-6 1.5x (fast starter), W7-13 1.0x,
// W14-17 2.0x (fantasy playoff). Replaces the prior "wks 10-13 ×2 / 14-17 ×3"
// curve. Operates on the per-week array stored in agg.weeks.
function weeklyRecencyPpgV3(weeks: Array<{ week: number; targets: number; carries: number; pts: number }>): number {
  if (!weeks || weeks.length === 0) return 0;
  let weighted = 0;
  let totalWeight = 0;
  for (const w of weeks) {
    let wt = 1.0;
    if (w.week <= 6)      wt = 1.5;
    else if (w.week >= 14) wt = 2.0;
    weighted += w.pts * wt;
    totalWeight += wt;
  }
  return totalWeight > 0 ? weighted / totalWeight : 0;
}

// ─── ROOKIE BASELINE ──────────────────────────────────────────────────
function rookieBaselineByPos(
  position: string,
  draftRound: number | null,
  format: Format,
): number {
  if (!draftRound || draftRound > 7) return 0;
  let base = 0;
  if (position === 'RB') {
    if (draftRound === 1) base = 12.0;
    else if (draftRound === 2) base = 8.0;
    else if (draftRound === 3) base = 5.5;
    else base = 3.0;
  } else if (position === 'WR') {
    if (draftRound === 1) base = 10.0;
    else if (draftRound === 2) base = 6.5;
    else if (draftRound === 3) base = 4.5;
    else base = 2.5;
  } else if (position === 'TE') {
    if (draftRound === 1) base = 7.0;
    else if (draftRound === 2) base = 4.5;
    else base = 2.5;
  } else if (position === 'QB') {
    // v2.5.3: lowered from 14.0 to 11.0. Year-1 QB rookies historically
    // average 12-15 PPG; 14.0 was midpoint of established mid-tier vets.
    if (draftRound === 1) base = 11.0;
    else return 0;
  } else {
    return 0;
  }

  // v2026-05-07: scoring-format scaling. The baselines above are PPR-
  // tuned. HALF and STD scoring strip reception points, but the rookie
  // default was format-agnostic -- so STD rookies leaked into the top 5
  // (Tate WR2 in DYN_STD even with 25% boost cut + VBD applied).
  // WR/TE depend heavily on receptions, RB moderately, QB not at all.
  const isHalf = format === 'HALF' || format === 'DYN_HALF';
  const isStd  = format === 'STD'  || format === 'DYN_STD';
  if (position === 'QB') return base;
  if (position === 'RB') {
    if (isHalf) return base * 0.92;
    if (isStd)  return base * 0.85;
    return base;
  }
  // WR / TE
  if (isHalf) return base * 0.85;
  if (isStd)  return base * 0.70;
  return base;
}

// ─── OPPORTUNITY ADJUSTMENT ───────────────────────────────────────────
function opportunityAdj(
  weeks: { week: number; targets?: number; carries?: number; pts?: number; }[],
): number {
  if (weeks.length < 4) return 0;
  const sorted = [...weeks].sort((a, b) => a.week - b.week);
  const opportunity = (w: any) => (w.targets ?? 0) + (w.carries ?? 0);
  const half = Math.floor(sorted.length / 2);
  const earlyOpp = sorted.slice(0, half).reduce((s, w) => s + opportunity(w), 0) / Math.max(half, 1);
  const lateOpp  = sorted.slice(half).reduce((s, w) => s + opportunity(w), 0) / Math.max(sorted.length - half, 1);
  const earlyPpg = sorted.slice(0, half).reduce((s, w) => s + (w.pts ?? 0), 0) / Math.max(half, 1);
  const latePpg  = sorted.slice(half).reduce((s, w) => s + (w.pts ?? 0), 0) / Math.max(sorted.length - half, 1);
  if (earlyOpp <= 0) return 0;
  const oppDelta = (lateOpp - earlyOpp) / earlyOpp;
  const ppgDelta = earlyPpg > 0 ? (latePpg - earlyPpg) / earlyPpg : 0;
  // v2026-05-08: usage and PPG must agree in direction to earn the full
  // boost. Baker case: carries trended up late-2025 but his last-6 PPG
  // was BELOW his season avg — usage without production is half-credit.
  // Within ±5% the signal is noise, so treat as agreeing (don't punish
  // a clear usage trend just because PPG happened to be flat).
  const signsAgree =
    Math.sign(oppDelta) === Math.sign(ppgDelta) ||
    Math.abs(oppDelta) < 0.05 ||
    Math.abs(ppgDelta) < 0.05;
  const factor = signsAgree ? 0.5 : 0.25;
  return Math.max(-0.15, Math.min(0.15, oppDelta * factor));
}

function pointsCol(format: Format): 'fantasy_pts_ppr' | 'fantasy_pts_half' | 'fantasy_pts_std' {
  if (format === 'HALF' || format === 'DYN_HALF') return 'fantasy_pts_half';
  if (format === 'STD'  || format === 'DYN_STD')  return 'fantasy_pts_std';
  // PPR / DYN / SF / DYN_SF all use full-PPR scoring (SF doesn't change
  // scoring math; it composes a QB multiplier in formatPositionAdj).
  return 'fantasy_pts_ppr';
}

// ─── POSITION SCARCITY (v2026-05-07) ────────────────────────────────
// Elite players at scarce positions get a multiplier on top of VOR.
// Calibration: RB has the steepest curve (true workhorse RB1-5 are
// rare). TE has the steepest top-3 (elite difference-maker TEs are
// even scarcer). QB-SF only kicks in when superflex roster
// construction makes top QBs structurally scarce.
// Tiers must be sorted ascending by rank.
const POSITION_SCARCITY: Record<string, Array<{ rank: number; mult: number }>> = {
  RB: [{ rank: 5, mult: 1.15 }, { rank: 10, mult: 1.10 }, { rank: 15, mult: 1.05 }],
  WR: [{ rank: 5, mult: 1.08 }, { rank: 10, mult: 1.05 }, { rank: 15, mult: 1.02 }],
  TE: [{ rank: 3, mult: 1.20 }, { rank: 5,  mult: 1.10 }, { rank: 10, mult: 1.05 }],
};
const QB_SF_SCARCITY: Array<{ rank: number; mult: number }> = [
  { rank: 5, mult: 1.15 },
  { rank: 10, mult: 1.10 },
];
function scarcityMult(position: string, posRank: number, isSuperflex: boolean): number {
  if (position === 'QB') {
    if (!isSuperflex) return 1.0;
    for (const t of QB_SF_SCARCITY) if (posRank <= t.rank) return t.mult;
    return 1.0;
  }
  const tiers = POSITION_SCARCITY[position];
  if (!tiers) return 1.0;
  for (const t of tiers) if (posRank <= t.rank) return t.mult;
  return 1.0;
}

function formatPositionAdj(format: Format, position: string, age: number): number {
  // Multiplier composition: SF and Dynasty are orthogonal — SF affects
  // QB scarcity, Dynasty applies position-specific age curves to lifetime
  // value. DYN_SF stacks both. Each adjustment is a multiplier; we
  // compose by multiplying.

  const isDynasty   = format === 'DYN' || format === 'DYN_HALF' || format === 'DYN_STD' || format === 'DYN_SF';
  const isSuperflex = format === 'SF'  || format === 'DYN_SF';

  let mult = 1.0;

  // SF QB premium — applies to any SF variant (redraft or dynasty).
  if (isSuperflex && position === 'QB') {
    mult *= 1.40;
  }

  // Dynasty age curves (locked v2026-05). Same curves regardless of which
  // dynasty scoring variant is active — age depreciation is independent
  // of how receptions are scored.
  if (isDynasty) {
    let ageCurve = 1.0;
    switch (position) {
      case 'RB':
        if      (age < 25) ageCurve = 1.15;   // ascending
        else if (age < 27) ageCurve = 1.05;   // peak entering
        else if (age < 29) ageCurve = 0.95;   // peak exiting
        else if (age < 31) ageCurve = 0.80;   // decline phase
        else                ageCurve = 0.65;  // cliff
        break;
      case 'WR':
        if      (age < 24) ageCurve = 1.20;   // high ascending
        else if (age < 27) ageCurve = 1.10;   // peak entering
        else if (age < 30) ageCurve = 1.00;   // peak
        else if (age < 33) ageCurve = 0.85;   // decline phase
        else                ageCurve = 0.65;  // cliff
        break;
      case 'QB':
        if      (age < 26) ageCurve = 1.10;   // ascending
        else if (age < 33) ageCurve = 1.00;   // peak
        else if (age < 38) ageCurve = 0.95;   // graceful decline
        else                ageCurve = 0.80;  // winding down
        break;
      case 'TE':
        if      (age < 25) ageCurve = 1.15;   // ascending
        else if (age < 30) ageCurve = 1.05;   // peak
        else if (age < 33) ageCurve = 0.95;   // decline phase
        else                ageCurve = 0.80;  // cliff
        break;
    }
    mult *= ageCurve;
  }

  return mult;
}

// ─── PAGINATED WEEKLY FETCH ───────────────────────────────────────────
async function fetchSeason(supabase: any, season: number, ptsCol: string): Promise<any[]> {
  const out: any[] = [];
  const CHUNK = 1000;
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('nfl_weekly_stats')
      .select(`gsis_id, week, team, ${ptsCol}, targets, carries, wopr, target_share, air_yards_share, receiving_epa`)
      .eq('season', season)
      .eq('season_type', 'REG')
      .order('gsis_id', { ascending: true })
      .order('week', { ascending: true })
      .range(offset, offset + CHUNK - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < CHUNK) break;
    offset += CHUNK;
    if (offset > 50000) break;
  }
  return out;
}

// ─── BUILD PER-PLAYER BASELINE FROM A SINGLE SEASON ───────────────────
interface SeasonAgg {
  ppg: number;             // simple season average (legacy, kept for downstream)
  recencyPpg: number;      // week-window weighted (wks 10-13 ×2, wks 14-17 ×3)
  volatility: number;      // coefficient of variation (std dev / mean)
  games: number;
  weeks: { week: number; targets: number; carries: number; pts: number; }[];
  lastTeam: string | null;
  avgWopr: number;         // mean WOPR across games-with-targets (WR/TE only meaningful)
  epaPerTarget: number;    // total receiving EPA / total targets — efficiency signal
}

function aggregateSeason(rows: any[], ptsCol: string): Map<string, SeasonAgg> {
  // First pass: collect raw game data per player
  const map = new Map<string, SeasonAgg>();
  // Track per-player accumulators for second-pass averaging.
  const woprSums = new Map<string, { sum: number; count: number }>();
  const epaSums = new Map<string, { epa: number; targets: number }>();

  for (const w of rows) {
    const pts = (w as any)[ptsCol] ?? 0;
    const targets = w.targets ?? 0;
    const carries = w.carries ?? 0;
    if (pts === 0 && targets === 0 && carries === 0) continue;
    const prev = map.get(w.gsis_id) ?? {
      ppg: 0, recencyPpg: 0, volatility: 0,
      games: 0, weeks: [], lastTeam: null,
      avgWopr: 0, epaPerTarget: 0,
    };
    prev.ppg += pts; // running sum, divided later
    prev.games += 1;
    prev.weeks.push({ week: w.week, targets, carries, pts });
    prev.lastTeam = normTeamCode(w.team) ?? prev.lastTeam;
    map.set(w.gsis_id, prev);

    const wopr = Number((w as any).wopr ?? 0);
    if (targets > 0 && wopr > 0) {
      const ws = woprSums.get(w.gsis_id) ?? { sum: 0, count: 0 };
      ws.sum += wopr;
      ws.count += 1;
      woprSums.set(w.gsis_id, ws);
    }
    // Accumulate receiving EPA only on games with targets — EPA on
    // zero-target games is meaningless. Total-EPA / total-targets gives
    // a per-opportunity efficiency measure that's stickier than PPG.
    const recvEpa = (w as any).receiving_epa;
    if (typeof recvEpa === 'number' && targets > 0) {
      const es = epaSums.get(w.gsis_id) ?? { epa: 0, targets: 0 };
      es.epa += recvEpa;
      es.targets += targets;
      epaSums.set(w.gsis_id, es);
    }
  }

  // Second pass: compute season PPG, recency-weighted PPG, volatility
  for (const [id, agg] of map) {
    if (agg.games === 0) continue;

    // Sort weeks chronologically for recency calc
    agg.weeks.sort((a, b) => a.week - b.week);

    // Avg WOPR over games-with-targets
    const ws = woprSums.get(id);
    agg.avgWopr = ws && ws.count > 0 ? ws.sum / ws.count : 0;
    // Receiving EPA per target (total EPA / total targets)
    const es = epaSums.get(id);
    agg.epaPerTarget = es && es.targets > 0 ? es.epa / es.targets : 0;

    // Plain season PPG
    agg.ppg = agg.ppg / agg.games;

    // Fantasy-playoff weighting (v2.5): when championships matter,
    // production matters more. Weights by NFL week:
    //   wks 1-9:   1x  (early season)
    //   wks 10-13: 2x  (late-season ramp)
    //   wks 14-17: 4x  (FANTASY PLAYOFFS)
    //   wk 18:     1x  (starters rested)
    // v2.5.4: Recency weighting with threshold dampener.
    // Count games in each amplified window first.
    let midWindowGames = 0;   // weeks 10-13
    let playoffGames = 0;     // weeks 14-17
    for (const wk of agg.weeks) {
      if (wk.week >= 10 && wk.week <= 13) midWindowGames++;
      else if (wk.week >= 14 && wk.week <= 17) playoffGames++;
    }
    // v2.5.4: full bonus only if player has 2+ games in window;
    // otherwise reduced 1.5x (some amplification, less outlier risk).
    // Playoff window also lowered from 4x to 3x base bonus.
    const midWeight = midWindowGames >= 2 ? 2 : 1.5;
    const playoffWeight = playoffGames >= 2 ? 3 : 1.5;
    let weightedSum = 0;
    let totalWeight = 0;
    for (const wk of agg.weeks) {
      let w: number;
      if (wk.week >= 14 && wk.week <= 17) w = playoffWeight;
      else if (wk.week >= 10 && wk.week <= 13) w = midWeight;
      else w = 1;
      weightedSum += wk.pts * w;
      totalWeight += w;
    }
    agg.recencyPpg = totalWeight > 0 ? weightedSum / totalWeight : agg.ppg;

    // Volatility: coefficient of variation (std dev / mean), bounded
    if (agg.ppg > 0 && agg.games >= 4) {
      const mean = agg.ppg;
      const variance = agg.weeks.reduce((s, g) => s + Math.pow(g.pts - mean, 2), 0) / agg.games;
      const stdDev = Math.sqrt(variance);
      agg.volatility = stdDev / mean;
    }
  }
  return map;
}

interface RankedRow {
  format: string;
  rank: number;
  gsis_id: string;
  name: string;
  position: string;
  team: string | null;
  pos_rank: number;
  score: number;
  tier: number;
  baseline_2025: number;
  age_adj: number;
  team_change_adj: number;
  rookie_boost: number;
  opportunity_adj: number;
  floor_protected: boolean;
  method: string;
  computed_at: string;
}

// ─── INJURY DATA (ESPN feed) ──────────────────────────────────────────
// Aggressive discount: serious injuries (ACL/Achilles/Lisfranc/etc) drop
// a player\'s score by 90%, effectively pushing them to bottom 50.
//
// ESPN shape (verified April 2026):
//   entry.status         -- "Out" | "Doubtful" | "Questionable" | "Day-To-Day"
//   entry.shortComment   -- one-sentence summary (search for injury keywords)
//   entry.longComment    -- full paragraph, also searched for keywords
//
// Important: ESPN sometimes lists "Questionable" for players whose injury
// is actually season-affecting (e.g. Kittle Achilles tear is listed
// Questionable because they are "hopeful for Week 1"). We override the
// status to a stricter discount when comment text indicates tear/surgery.

interface InjuryStatus {
  status: string;
  injury: string;
  multiplier: number;
}

const SERIOUS_INJURY_KEYWORDS = [
  'achilles', 'acl', 'lisfranc',
  'torn', 'tear', 'ruptured',
  'broken leg', 'broken tibia', 'broken fibula',
  'hip surgery', 'hip labrum',
  'pectoral', 'patellar', 'meniscus',
  'spinal', 'neck surgery',
  'foot surgery',
];

function detectInjuryFromText(...texts: (string | undefined)[]): string {
  // Returns a short label like "Achilles" or "ACL" if found in the text;
  // empty string if nothing matched.
  const blob = texts.filter(Boolean).join(' ').toLowerCase();
  if (!blob) return '';
  if (blob.includes('achilles')) return 'Achilles';
  if (blob.includes('acl')) return 'ACL';
  if (blob.includes('lisfranc')) return 'Lisfranc';
  if (blob.includes('pectoral')) return 'Pectoral';
  if (blob.includes('patellar')) return 'Patellar';
  if (blob.includes('meniscus')) return 'Meniscus';
  if (blob.includes('hip surgery') || blob.includes('hip labrum')) return 'Hip surgery';
  if (blob.includes('foot surgery')) return 'Foot surgery';
  if (blob.includes('broken leg') || blob.includes('broken tibia') || blob.includes('broken fibula')) return 'Broken leg';
  if (blob.includes('hamstring')) return 'Hamstring';
  if (blob.includes('shoulder')) return 'Shoulder';
  if (blob.includes('ankle')) return 'Ankle';
  if (blob.includes('knee')) return 'Knee';
  if (blob.includes('back')) return 'Back';
  if (blob.includes('concussion')) return 'Concussion';
  return '';
}

function isSeriousFromText(...texts: (string | undefined)[]): boolean {
  const blob = texts.filter(Boolean).join(' ').toLowerCase();
  return SERIOUS_INJURY_KEYWORDS.some(kw => blob.includes(kw));
}

function injuryMultiplier(status: string, isSerious: boolean): number {
  const s = (status || '').trim();
  if (s === 'Out' || s === 'Injured Reserve') {
    return isSerious ? 0.10 : 0.70;
  }
  if (s === 'Doubtful') {
    return isSerious ? 0.20 : 0.50;
  }
  if (s === 'Questionable') {
    // Override: even Questionable status gets aggressive discount when
    // comment text reveals a serious tear/surgery underneath.
    return isSerious ? 0.30 : 0.85;
  }
  if (s === 'Day-To-Day' || s === 'Day-to-Day') return 0.95;
  return 1.0;
}

// ─── INJURY OVERRIDES (v2026-05-08) ──────────────────────────────────
// v2026-05-12g: 2025 NFL personnel tendency by team (sumersports.com).
// Decimal rates (0.45 = 45%). Applied as a stable-team-identity layer for
// teams WITHOUT a coaching change. For teams WITH a coaching change, the
// 2025 rates reflect the outgoing scheme — we skip this layer and let
// the coaching multiplier alone capture the expected 2026 shift.
const TEAM_PERSONNEL_2025: Record<string, { p11: number; p12: number; p13: number; p21: number; p22: number; p10: number; p20: number; p01: number; p02: number }> = {
  ARI: { p11: 0.464, p12: 0.290, p13: 0.105, p21: 0.000, p22: 0.002, p10: 0.000, p20: 0.000, p01: 0.002, p02: 0.003 },
  ATL: { p11: 0.451, p12: 0.382, p13: 0.067, p21: 0.092, p22: 0.005, p10: 0.000, p20: 0.000, p01: 0.000, p02: 0.000 },
  BAL: { p11: 0.299, p12: 0.359, p13: 0.053, p21: 0.186, p22: 0.083, p10: 0.000, p20: 0.001, p01: 0.000, p02: 0.000 },
  BUF: { p11: 0.608, p12: 0.112, p13: 0.046, p21: 0.077, p22: 0.133, p10: 0.000, p20: 0.000, p01: 0.001, p02: 0.004 },
  CAR: { p11: 0.654, p12: 0.200, p13: 0.076, p21: 0.019, p22: 0.029, p10: 0.003, p20: 0.001, p01: 0.007, p02: 0.000 },
  CHI: { p11: 0.516, p12: 0.326, p13: 0.085, p21: 0.000, p22: 0.000, p10: 0.000, p20: 0.000, p01: 0.017, p02: 0.009 },
  CIN: { p11: 0.641, p12: 0.290, p13: 0.009, p21: 0.018, p22: 0.008, p10: 0.007, p20: 0.004, p01: 0.004, p02: 0.002 },
  CLE: { p11: 0.440, p12: 0.412, p13: 0.042, p21: 0.013, p22: 0.001, p10: 0.005, p20: 0.000, p01: 0.001, p02: 0.007 },
  DAL: { p11: 0.664, p12: 0.170, p13: 0.016, p21: 0.079, p22: 0.049, p10: 0.000, p20: 0.003, p01: 0.008, p02: 0.002 },
  DEN: { p11: 0.630, p12: 0.103, p13: 0.019, p21: 0.050, p22: 0.087, p10: 0.000, p20: 0.004, p01: 0.018, p02: 0.004 },
  DET: { p11: 0.581, p12: 0.225, p13: 0.052, p21: 0.032, p22: 0.001, p10: 0.005, p20: 0.021, p01: 0.001, p02: 0.002 },
  GB:  { p11: 0.556, p12: 0.338, p13: 0.014, p21: 0.031, p22: 0.000, p10: 0.000, p20: 0.000, p01: 0.000, p02: 0.000 },
  HOU: { p11: 0.660, p12: 0.077, p13: 0.015, p21: 0.046, p22: 0.013, p10: 0.000, p20: 0.006, p01: 0.001, p02: 0.000 },
  IND: { p11: 0.627, p12: 0.255, p13: 0.098, p21: 0.007, p22: 0.001, p10: 0.001, p20: 0.000, p01: 0.000, p02: 0.002 },
  JAX: { p11: 0.652, p12: 0.185, p13: 0.028, p21: 0.034, p22: 0.000, p10: 0.005, p20: 0.000, p01: 0.001, p02: 0.000 },
  KC:  { p11: 0.562, p12: 0.280, p13: 0.062, p21: 0.042, p22: 0.013, p10: 0.002, p20: 0.000, p01: 0.000, p02: 0.002 },
  LAR: { p11: 0.587, p12: 0.096, p13: 0.305, p21: 0.000, p22: 0.000, p10: 0.001, p20: 0.000, p01: 0.000, p02: 0.011 },
  LAC: { p11: 0.568, p12: 0.058, p13: 0.019, p21: 0.110, p22: 0.080, p10: 0.046, p20: 0.051, p01: 0.009, p02: 0.000 },
  LV:  { p11: 0.570, p12: 0.340, p13: 0.059, p21: 0.003, p22: 0.002, p10: 0.000, p20: 0.000, p01: 0.000, p02: 0.001 },
  MIA: { p11: 0.393, p12: 0.100, p13: 0.008, p21: 0.247, p22: 0.088, p10: 0.007, p20: 0.007, p01: 0.000, p02: 0.002 },
  MIN: { p11: 0.638, p12: 0.212, p13: 0.030, p21: 0.078, p22: 0.038, p10: 0.000, p20: 0.000, p01: 0.000, p02: 0.000 },
  NE:  { p11: 0.490, p12: 0.194, p13: 0.000, p21: 0.153, p22: 0.070, p10: 0.006, p20: 0.002, p01: 0.001, p02: 0.000 },
  NO:  { p11: 0.667, p12: 0.168, p13: 0.083, p21: 0.004, p22: 0.010, p10: 0.002, p20: 0.001, p01: 0.000, p02: 0.009 },
  NYG: { p11: 0.605, p12: 0.325, p13: 0.051, p21: 0.007, p22: 0.002, p10: 0.000, p20: 0.000, p01: 0.002, p02: 0.001 },
  NYJ: { p11: 0.671, p12: 0.170, p13: 0.003, p21: 0.062, p22: 0.026, p10: 0.000, p20: 0.000, p01: 0.000, p02: 0.000 },
  PHI: { p11: 0.593, p12: 0.261, p13: 0.079, p21: 0.010, p22: 0.003, p10: 0.000, p20: 0.000, p01: 0.002, p02: 0.002 },
  PIT: { p11: 0.387, p12: 0.247, p13: 0.142, p21: 0.023, p22: 0.009, p10: 0.000, p20: 0.000, p01: 0.000, p02: 0.000 },
  SEA: { p11: 0.414, p12: 0.298, p13: 0.054, p21: 0.114, p22: 0.068, p10: 0.002, p20: 0.001, p01: 0.008, p02: 0.022 },
  SF:  { p11: 0.426, p12: 0.115, p13: 0.005, p21: 0.363, p22: 0.082, p10: 0.000, p20: 0.000, p01: 0.000, p02: 0.000 },
  TB:  { p11: 0.687, p12: 0.186, p13: 0.022, p21: 0.059, p22: 0.015, p10: 0.012, p20: 0.001, p01: 0.000, p02: 0.000 },
  TEN: { p11: 0.698, p12: 0.165, p13: 0.013, p21: 0.023, p22: 0.000, p10: 0.000, p20: 0.000, p01: 0.000, p02: 0.000 },
  WAS: { p11: 0.568, p12: 0.232, p13: 0.052, p21: 0.019, p22: 0.005, p10: 0.008, p20: 0.003, p01: 0.009, p02: 0.004 },
};

// League average personnel rates (computed from the table). Used as the
// neutral baseline — teams above avg get a position-specific boost.
const PERS_LEAGUE_AVG = { p11: 0.561, p12: 0.222, p13: 0.052, p21: 0.060, p22: 0.027 };

/**
 * Personnel-tendency multiplier per position based on 2025 team identity.
 * Heavy 11-personnel → more WR snaps → WR boost.
 * Heavy 12 + 13-personnel → more TE snaps → TE boost (LAR's 30% 13p is the outlier).
 * Heavy 21 + 22-personnel → more RB snaps → RB boost (SF's 36% 21p is the outlier).
 * Capped to ±6% — personnel is one factor among many.
 */
function personnelMult(team: string | null | undefined, position: string): { mult: number; note: string } {
  if (!team) return { mult: 1.0, note: '' };
  const p = TEAM_PERSONNEL_2025[team];
  if (!p) return { mult: 1.0, note: '' };
  let mult = 1.0;
  let label = '';
  if (position === 'WR') {
    mult = 1.0 + 0.20 * (p.p11 - PERS_LEAGUE_AVG.p11);
    label = `${(p.p11*100).toFixed(0)}% 11-personnel`;
  } else if (position === 'TE') {
    const teLoad = (p.p12 - PERS_LEAGUE_AVG.p12) + 1.5 * (p.p13 - PERS_LEAGUE_AVG.p13);
    mult = 1.0 + 0.22 * teLoad;
    label = `${((p.p12+p.p13)*100).toFixed(0)}% 12/13-personnel`;
  } else if (position === 'RB') {
    const rbLoad = (p.p21 - PERS_LEAGUE_AVG.p21) + 1.5 * (p.p22 - PERS_LEAGUE_AVG.p22);
    mult = 1.0 + 0.22 * rbLoad;
    label = `${((p.p21+p.p22)*100).toFixed(0)}% 2-back personnel`;
  } else if (position === 'QB') {
    const spread = p.p10 + p.p20 + p.p01 + p.p02;
    mult = 1.0 + 0.30 * spread;
    label = `${(spread*100).toFixed(0)}% spread personnel`;
  }
  mult = Math.max(0.94, Math.min(1.06, mult));
  const note = Math.abs(mult - 1.0) >= 0.015
    ? `personnel ${mult > 1 ? '+' : ''}${((mult-1)*100).toFixed(1)}% (${label})`
    : '';
  return { mult, note };
}

// v2026-05-12f: 2026 NFL coaching changes — encoded from ffmastermind.com
// Multipliers are position-group level forwardLayer adjustments.
// Range: 0.92 to 1.06 (-8% to +6%). Neutral = 1.00.
// Apply on top of all other adjustments; method-string surfaces the reason.
//
// Methodology:
//   - HC change with known scheme (Stefanski TE-heavy, McDaniel wide-open, etc.): tilt explicitly
//   - New HC defensive-minded: small dampener on offense (uncertainty)
//   - OC-only change: smaller magnitude than HC change
//   - Year-1 OC penalty baked into the multipliers below; do not double-apply elsewhere
const COACHING_CHANGES_2026: Record<string, {
  desc: string;
  m: { QB: number; RB: number; WR: number; TE: number };
  // v5.14 (2026-05-21): when the departed coach defined the team's personnel
  // tendency (e.g., Stefanski's 41% 12-personnel at CLE), the personnel
  // layer should be neutralized for affected positions in 2026. Without
  // this, the engine credits a position for personnel rates that won't
  // persist. Set the array to the positions whose personnel mult should
  // be zeroed (treated as 1.00x) on this team.
  personnel_decay?: Array<'QB' | 'RB' | 'WR' | 'TE'>;
}> = {
  // v2026-05-12i: 2026 carousel from ffmastermind.com (NOT 2025 — 2025 hires
  // like Ben Johnson, Vrabel, Moore, Glenn are incumbent in 2026 and are
  // already captured by the 2025 personnel-tendency layer; don't double-count).
  ATL: { desc: 'Stefanski HC + Rees OC — TE-friendly, run-culture, play-action heavy', m: { QB: 1.00, RB: 1.04, WR: 0.97, TE: 1.06 } },
  BUF: { desc: 'Joe Brady HC + Carmichael Jr. OC — Saints-style aggressive passing',    m: { QB: 1.02, RB: 0.98, WR: 1.02, TE: 1.00 } },
  MIA: { desc: 'Hafley HC + Slowik OC — Shanahan tree, defensive HC, Willis QB downgrade', m: { QB: 0.92, RB: 1.02, WR: 0.95, TE: 1.00 } },
  // Stefanski leaving CLE is the league\'s biggest TE-scheme architect exit.
  // CLE was 41% 12-personnel under him in 2025 → expected to collapse toward avg.
  CLE: { desc: 'Monken HC + Switzer OC — aggressive deep-ball passing, Stefanski TE scheme exits with him', m: { QB: 1.02, RB: 0.98, WR: 1.05, TE: 0.88 }, personnel_decay: ['TE'] },
  BAL: { desc: 'Minter HC + Doyle OC — pass-friendlier than John Harbaugh era; Lamar read-option scheme departs', m: { QB: 1.02, RB: 0.97, WR: 1.03, TE: 1.04 }, personnel_decay: ['QB'] },
  TEN: { desc: 'Saleh HC — defensive-minded, offensive identity uncertain',             m: { QB: 0.96, RB: 0.98, WR: 0.96, TE: 0.96 } },
  PIT: { desc: 'McCarthy HC + Angelichio OC — veteran balance, slight pass tilt',       m: { QB: 1.01, RB: 1.01, WR: 1.02, TE: 1.00 } },
  LV:  { desc: 'Klint Kubiak HC + Janocko OC — zone-blocking, TE-friendly Kubiak family', m: { QB: 0.98, RB: 1.04, WR: 0.97, TE: 1.04 } },
  ARI: { desc: 'LaFleur HC + Hackett OC — Hackett mixed track record, scheme uncertainty', m: { QB: 0.96, RB: 0.99, WR: 0.97, TE: 0.98 } },
  NYG: { desc: 'Harbaugh HC + Nagy OC — big change, Nagy pass-spread offense',          m: { QB: 1.03, RB: 0.98, WR: 1.03, TE: 1.00 } },
  NYJ: { desc: 'Reich OC + Geno Smith QB — accuracy-based vet under proven OC',         m: { QB: 1.02, RB: 1.00, WR: 1.03, TE: 1.01 } },
  LAC: { desc: 'McDaniel as OC under Jim Harbaugh — wide-open passing (Shanahan tree, mild TE boost)', m: { QB: 1.05, RB: 0.95, WR: 1.05, TE: 1.02 } },
  PHI: { desc: 'Mannion OC — limited track record, scheme uncertainty',                 m: { QB: 0.98, RB: 1.00, WR: 0.99, TE: 0.99 } },
  // Ben Johnson cascade — left DET (top-3 OC architect) for CHI HC role in
  // the 2025 carousel. By 2026 he\'s incumbent at CHI (handled via personnel
  // layer). DET\'s loss is the 2026 carryover effect that hadn\'t fully
  // priced in: Petzing as OC isn\'t a 1:1 replacement.
  // v2026-05-12j: DET's Johnson departure already played out in 2025 (Morton
  // was OC then). The 2026 change is Morton → Petzing — mid-tier OC swap,
  // near-neutral. Previous -7% WR penalty was double-counting a transition
  // already absorbed in 2025 personnel rates.
  DET: { desc: 'Morton OC → Petzing OC — mid-tier OC swap, near-neutral (Johnson loss already absorbed in 2025)', m: { QB: 1.00, RB: 1.00, WR: 0.99, TE: 1.00 } },
  TB:  { desc: 'Zac Robinson OC — McVay tree, pass concepts',                           m: { QB: 1.02, RB: 0.98, WR: 1.02, TE: 1.00 } },
};

// Manual overrides for injuries the ESPN feed hasn't picked up or has
// outdated. Keys match ESPN's normalized form: lowercase a-z only.
// Tune these as the offseason resolves.
// v2026-05-15: Team code normalizer. Sleeper-derived data uses some
// abbreviations that don't match our canonical 32-team set: LA→LAR,
// JAC→JAX, WSH→WAS. Without this, ~4-6 core LAR players (Nacua, Kyren
// Williams, Stafford, Adams) silently miss ALL team-keyed multipliers
// (coaching, personnel, SOS).
const TEAM_CODE_ALIASES: Record<string, string> = {
  LA:  'LAR',
  JAC: 'JAX',
  WSH: 'WAS',
};
function normTeamCode(team: string | null | undefined): string | null {
  if (!team) return null;
  return TEAM_CODE_ALIASES[team] ?? team;
}

// v2026-05-15: Positional strength of schedule, 2026 season.
// Computed from: 2025 nfl_weekly_stats (fpts allowed by opponent defense) +
// 2026 nfl_schedule (17 opponents per team). Z-score vs league mean per position.
// z > 0 = SOFT schedule (opponents allowed more than avg) → small boost.
// z < 0 = HARD schedule (opponents allowed less than avg) → small penalty.
//
// Replaces the team-level overall SOS we briefly used. Same magnitude (±5%)
// but per-position: a team can have a soft schedule for RBs and a hard one
// for WRs. See /tmp/sumer-scrape/compute_positional_sos.js for the build.
//
// 2025 league mean fpts/g allowed: QB 16.59, RB 22.04, WR 30.61, TE 12.88.
type PosSos = { QB: number; RB: number; WR: number; TE: number };
const POSITIONAL_SOS_2026: Record<string, PosSos> = {
  ARI: { QB:  0.014, RB: -0.020, WR:  0.012, TE: -0.146 },
  ATL: { QB: -0.014, RB:  0.036, WR: -0.116, TE:  0.115 },
  BAL: { QB:  0.035, RB: -0.017, WR: -0.079, TE:  0.353 },
  BUF: { QB: -0.049, RB: -0.114, WR: -0.140, TE: -0.086 },
  CAR: { QB: -0.056, RB: -0.268, WR: -0.125, TE: -0.124 },
  CHI: { QB: -0.308, RB: -0.194, WR: -0.349, TE: -0.319 },
  CIN: { QB:  0.088, RB: -0.172, WR:  0.196, TE:  0.162 },
  CLE: { QB:  0.382, RB:  0.222, WR:  0.248, TE:  0.387 },
  DAL: { QB:  0.146, RB:  0.222, WR:  0.217, TE: -0.033 },
  DEN: { QB: -0.265, RB: -0.077, WR: -0.258, TE: -0.116 },
  DET: { QB: -0.056, RB:  0.188, WR: -0.109, TE: -0.255 },
  GB:  { QB:  0.033, RB: -0.037, WR: -0.046, TE: -0.260 },
  HOU: { QB:  0.209, RB: -0.004, WR:  0.421, TE:  0.187 },
  IND: { QB:  0.121, RB:  0.009, WR:  0.044, TE:  0.223 },
  JAX: { QB:  0.260, RB: -0.071, WR:  0.369, TE:  0.289 },
  KC:  { QB: -0.206, RB: -0.010, WR: -0.244, TE:  0.043 },
  LAC: { QB: -0.134, RB: -0.059, WR: -0.298, TE: -0.156 },
  LAR: { QB: -0.067, RB:  0.163, WR: -0.115, TE: -0.163 },
  LV:  { QB: -0.394, RB: -0.276, WR: -0.497, TE: -0.081 },
  MIA: { QB: -0.185, RB: -0.025, WR: -0.201, TE: -0.155 },
  MIN: { QB:  0.208, RB:  0.070, WR:  0.304, TE: -0.036 },
  NE:  { QB: -0.112, RB: -0.103, WR: -0.190, TE: -0.130 },
  NO:  { QB:  0.129, RB:  0.228, WR:  0.064, TE: -0.030 },
  NYG: { QB:  0.208, RB:  0.102, WR:  0.248, TE:  0.082 },
  NYJ: { QB: -0.328, RB: -0.169, WR: -0.265, TE: -0.211 },
  PHI: { QB:  0.496, RB:  0.267, WR:  0.591, TE:  0.325 },
  PIT: { QB: -0.123, RB: -0.008, WR: -0.254, TE:  0.213 },
  SEA: { QB:  0.039, RB:  0.247, WR:  0.051, TE: -0.051 },
  SF:  { QB: -0.091, RB:  0.073, WR: -0.190, TE: -0.129 },
  TB:  { QB: -0.093, RB: -0.044, WR: -0.005, TE: -0.092 },
  TEN: { QB:  0.260, RB:  0.077, WR:  0.333, TE:  0.261 },
  WAS: { QB:  0.188, RB:  0.256, WR:  0.104, TE: -0.012 },
};

// Convert z-score to multiplier. 0.05 per std-dev, clamped ±5%.
// Typical z-scores fall in [-0.5, 0.5] → ±2.5% effect.
// Extreme outliers (PHI WR +0.591, LV WR -0.497) hit ~±3%.
function sosMult(team: string | null | undefined, position: string): { mult: number; note: string } {
  if (!team || !['QB','RB','WR','TE'].includes(position)) return { mult: 1.0, note: '' };
  const sos = POSITIONAL_SOS_2026[team];
  if (!sos) return { mult: 1.0, note: '' };
  const z = sos[position as keyof PosSos];
  let mult = 1.0 + 0.05 * z;
  if (mult > 1.05) mult = 1.05;
  if (mult < 0.95) mult = 0.95;
  // Only emit a note when effect ≥ 1% (|z| ≥ 0.2)
  let note = '';
  if (Math.abs(z) >= 0.2) {
    const tag = z > 0 ? 'soft' : 'hard';
    note = `${team} ${position} ${tag} pos-SOS z=${z >= 0 ? '+' : ''}${z.toFixed(2)} (${mult.toFixed(3)}x)`;
  }
  return { mult, note };
}

// v5.6 (2026-05-18): QB RUSHING PROFILE — modern fantasy QBs derive a
// material % of their fpts from rushing. The engine projects total fpts
// correctly (rushing is in the data), but doesn't credit the FLOOR
// advantage rushing provides (less variance, TD upside). Add a per-QB
// premium based on 2024-2025 rushing share of total fpts.
//   very-high (≥30%): +8% — Allen, Daniels
//   high (20-30%):    +5% — Hurts, Lawrence, Mahomes, Maye, Lamar, Nix
//   medium (10-20%):  +2% — Purdy, Baker, Burrow
//   pocket (<10%):    -3% — Goff, Stafford, traditional pocket QBs
const QB_RUSHING_PROFILE_2026: Record<string, number> = {
  joshallen:        1.08,  // 39% rush share
  jaydendaniels:    1.08,  // 34%
  jalenhurts:       1.05,  // 29%
  trevorlawrence:   1.05,  // 26%
  patrickmahomes:   1.05,  // 25%
  drakemaye:        1.05,  // 22%
  bonix:            1.05,  // 21% (note: discounted via injury-context too)
  lamarjackson:     1.05,  // 21%
  calebwilliams:    1.05,  // 17% — missing from initial map; 2025 had 383 rush yd + 3 rTD
  brockpurdy:       1.02,  // 19%
  bakermayfield:    1.02,  // 16%
  joeburrow:        1.00,  // 3% — but his passing volume is elite
  cjstroud:         1.00,  // 12%
  // Pocket QBs — no penalty in v5.6 final. Goff's elite passing volume on
  // DET compensates for zero rushing floor. Rushers get a boost; pockets
  // stay neutral. Eliminates target-chasing for Goff specifically.
  jaredgoff:        1.00,
  matthewstafford:  1.00,
  dakprescott:      1.00,
};

// v5.14 (2026-05-21): TE-targeting QB chemistry premium.
// Some QBs target TEs disproportionately as safety valves or red-zone
// weapons. Map their lowercase-name keys; engine applies +TE_FRIENDLY_MULT
// to any TE on a team where the projected QB1 (depth_chart_order=1) is in
// this map. Catches the chemistry premium QB-cast layer misses.
//
// Sourced from 2024-2025 TE-target-share patterns:
// - Mahomes (KC): Kelce era + Bowers now, historically 22-26% to TE
// - Kyler (now MIN): McBride was TE1 2024-2025 with him
// - Allen (BUF): Knox/Kincaid steady TE involvement
// - Goff (DET): LaPorta breakout 2023; sustained TE feeder
// - Lamar (BAL): Andrews lifetime, even with WR room
// - Burrow (CIN): less but TE involvement notable
const TE_FRIENDLY_QBS_2026: Record<string, number> = {
  patrickmahomes:   1.04,
  kylermurray:      1.04,
  joshallen:        1.03,
  jaredgoff:        1.03,
  lamarjackson:     1.03,
  joeburrow:        1.02,
  cjstroud:         1.02,
  jaydendaniels:    1.02,
};

const INJURY_OVERRIDES_2026: Record<string, InjuryStatus> = {
  // Lingering / chronic 2026 status (multiplier on baseline, severe cases).
  georgekittle:    { status: 'Out', injury: 'Achilles tear (half-season)', multiplier: 0.45 },
  michaelpenixjr:  { status: 'Out', injury: 'Significant injury', multiplier: 0.30 },
};

// v5.3 (2026-05-18): 2025 INJURY CONTEXT for 2026 recovery projection.
// The engine's `expected_games` defaults to a 3yr rolling avg, which pulls
// down a player's projection when they missed games to a one-off injury.
// This map adds explicit 2026 expected_games + per-game recovery discount
// based on KNOWN 2025 injuries. Allows the engine to differentiate:
//   - "fully recovered, back to normal" (Burrow/Daniels/Rice — wrist, knee, MCL)
//   - "year-1 back from major injury" (Nabers/Hill — ACL, lingering)
//   - "chronic / not back yet" (Kittle Achilles handled above; Penix)
// Format: { games: expected 2026 games, mult: per-game performance retention }
type InjuryContext = { games: number; mult: number; note: string };
const INJURY_CONTEXT_2026: Record<string, InjuryContext> = {
  // FULLY recovered — expected 16-17g at full strength
  joeburrow:        { games: 16, mult: 1.00, note: 'wrist surgery — fully recovered' },
  // v5.5: Daniels mult lifted from 1.00 to 1.05 — his rookie-year 2024
  // was 428 fpts (QB3-5 territory), and injury-yr inversion blend only
  // gave that year 60% weight. Bumping mult restores some of that ceiling.
  jaydendaniels:    { games: 16, mult: 1.05, note: 'knee/hamstring — full recovery + Y3 ascent expected' },
  drakemaye:        { games: 16, mult: 1.13, note: 'healthy Y3 ascent — top-10 PPG pace on bad-OL team; 2025 was 347 fpts' },
  rasheerice:       { games: 15, mult: 1.00, note: 'MCL tear — recovered, slight games-risk premium' },
  garrettwilson:    { games: 16, mult: 1.00, note: 'knee — recovered' },
  brockpurdy:       { games: 16, mult: 1.00, note: 'turf toe — recovered' },
  drakelondon:      { games: 16, mult: 1.00, note: 'soft tissue — recovered' },
  buckyirving:      { games: 16, mult: 1.00, note: 'minor — recovered' },
  brockbowers:      { games: 16, mult: 1.00, note: 'minor — recovered' },
  tuckerkraft:      { games: 16, mult: 1.00, note: 'shoulder/knee — recovered' },
  jjmccarthy:       { games: 15, mult: 0.97, note: 'meniscus — slight games risk' },
  romeodunze:       { games: 16, mult: 1.00, note: 'minor — recovered' },
  // ACL / Achilles — year-1 back at reduced capacity
  maliknabers:      { games: 13, mult: 0.88, note: 'ACL — year-1 back, ~85% capacity + games risk' },
  tyreekhill:       { games: 13, mult: 0.92, note: 'wrist surgery + lingering — partial recovery' },
  // Chronic / multi-year struggle
  kylermurray:      { games: 13, mult: 0.92, note: 'knee — chronic concern, partial year' },
  // Rookies/Sophs returning from injury
  camskattebo:      { games: 14, mult: 0.92, note: 'ankle (rookie) — soft year-2 expectation' },
  omarionhampton:   { games: 14, mult: 0.92, note: 'collarbone — soft year-2 expectation' },
  // Veterans with mild 2025 injuries (13-14g) — engine misses these because
  // they're above the <10g hard threshold but their season-shortening hurts
  // 3yr avg games. Apply explicit recovery projection.
  lamarjackson:     { games: 16, mult: 1.00, note: 'minor 2025 missed games — back to elite' },
  // v5.5: ACL recovery softened (was 13g/0.85) — Rodgers 2024 played 17g
  // post-ACL at ~93% of his pre-injury pace. Mahomes timeline + KC offense
  // resilience supports 15g/0.92 not 13g/0.85.
  patrickmahomes:   { games: 15, mult: 0.92, note: 'ACL tear 2025 — Y1-back recovery, KC offense built around him' },
  // v5.7 REVERTED (2026-05-19): CMC name-specific override removed. The
  // "career-high workload + age 30 = regression" pattern needs to be a
  // RB-position rule, not a CMC patch. Pending RB-specific scoring algo.
  ajbrown:          { games: 16, mult: 1.00, note: 'minor 2025 — recovered' },
  amonrastbrown:    { games: 16, mult: 1.00, note: 'minor — healthy' },
  mikeevans:        { games: 14, mult: 0.95, note: 'aging 32yo — modest games risk' },
  // v5.13 (2026-05-20): Puka therapy/rehab situation — modest games + per-game
  // discount. User flagged offseason rehab/mental-health stay; uncertain
  // return timeline. Light cap pending more clarity.
  pukanacua:        { games: 15, mult: 0.97, note: 'offseason rehab — modest games + per-game risk' },
  // v5.7 (2026-05-19): Derrick Henry — defies the age-32 RB cliff (0.42x
  // in the curve is brutal). His 2025 was 280 fpts (RB8) at age 32. The
  // age curve is a population average; outlier workhorses like Henry
  // need an override. Mult 1.55 brings him from 9.9 → 15.3 ppg projection.
  // v5.7 (2026-05-19 final): softer Henry override. 1.55 was too generous
  // — projected him over healthy younger workhorses (Saquon, Jacobs, Jeanty)
  // which is indefensible at age 32 + heavy 2025 workload. 1.15 gets him
  // into RB18-22 territory (below the prime-age workhorses) while
  // acknowledging his 2025 production proves he's not in full decline.
  // v5.7 REVERTED: Henry and Etienne RB-specific patches removed. Pending
  // RB-position scoring algo that handles workload-aging and vet-defies-cliff
  // as RULES, not name-by-name overrides.
  // v5.6 (2026-05-18): Herbert McDaniel scheme upgrade lift. LAC env layer
  // has +5% coaching but it gets canceled by OL rank 32 + heavy travel.
  // Industry expects McDaniel's scheme to offset those — explicit upside.
  justinherbert:    { games: 16, mult: 1.05, note: 'McDaniel OC scheme upgrade — wide-open passing offset to OL/travel' },
  // v5.6 (2026-05-18): Bo Nix ankle surgery + tougher 2026 SOS (DEN QB
  // per-week z=-0.23). Two-year QB7 pace, but surgery year and harder
  // slate suggest mild regression. Conservative discount.
  // v5.6 (2026-05-18) final: removed surgery discount. Offseason ankle
  // surgery typically has full recovery by Y3 OTA timeline. The harder
  // 2026 schedule is ALREADY in the per-week SOS layer — double-counting
  // it via injury-context would penalize him twice. Trust the 2024-2025
  // QB7 consistency + rushing-profile floor.
  bonix:            { games: 17, mult: 1.00, note: 'ankle surgery recovered; harder SOS handled in per-week SOS layer' },
};

async function fetchInjuryMap(): Promise<Map<string, InjuryStatus>> {
  const map = new Map<string, InjuryStatus>();
  try {
    const res = await fetch(
      'https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries',
      { headers: { 'User-Agent': 'AIOmni/1.0' } }
    );
    if (!res.ok) {
      console.log('ESPN injuries HTTP', res.status);
      return map;
    }
    const data = await res.json();
    for (const team of (data?.injuries ?? [])) {
      for (const entry of (team?.injuries ?? [])) {
        const athlete = entry?.athlete;
        if (!athlete?.displayName) continue;
        const status = entry?.status ?? '';
        if (!status) continue;
        const longC = entry?.longComment ?? '';
        const shortC = entry?.shortComment ?? '';
        const injury = detectInjuryFromText(shortC, longC) || 'Unspecified';
        const isSerious = isSeriousFromText(shortC, longC);
        const mult = injuryMultiplier(status, isSerious);
        if (mult < 1.0) {
          const key = athlete.displayName.toLowerCase().replace(/[^a-z]/g, '');
          map.set(key, { status, injury, multiplier: mult });
        }
      }
    }
  } catch (e) {
    console.log('fetchInjuryMap error:', e);
  }
  // Merge in manual overrides — these win over the ESPN feed.
  for (const [key, val] of Object.entries(INJURY_OVERRIDES_2026)) {
    map.set(key, val);
  }
  console.log(`[injuries] loaded ${map.size} injured players (ESPN + ${Object.keys(INJURY_OVERRIDES_2026).length} overrides)`);
  return map;
}

async function buildFormat(format: Format, supabase: any, asOfSeason: number = 2026): Promise<RankedRow[]> {
  const ptsCol = pointsCol(format);

  // Pull all 3 seasons + injury feed in parallel
  // Year aliases are RELATIVE to asOfSeason. In production (asOfSeason=2026):
  // w2025 = 2025 stats, w2024 = 2024 stats, etc. In backtest (e.g.
  // asOfSeason=2025): w2025 = 2024 stats, w2024 = 2023, etc. Variable
  // names kept as-is to avoid mass renames; treat them as "1-yr-ago",
  // "2-yr-ago", etc.
  const isBacktest = asOfSeason !== 2026;
  const [w2025, w2024, w2023, w2022, w2021, playersResult, rosterResult, injuryMap] = await Promise.all([
    fetchSeason(supabase, asOfSeason - 1, ptsCol),
    fetchSeason(supabase, asOfSeason - 2, ptsCol),
    fetchSeason(supabase, asOfSeason - 3, ptsCol),
    fetchSeason(supabase, asOfSeason - 4, ptsCol),
    fetchSeason(supabase, asOfSeason - 5, ptsCol),
    // v4.1 (2026-05-17): REMOVED is_active filter. Sleeper-derived flag
    // was wrongly marking 45+ real NFL players inactive (Hill, Diggs,
    // Rodgers, Keenan, Deebo, Hunt, etc.). Engine now reads ALL skill
    // players; downstream `if (baseline <= 0) continue` filters truly
    // dead players (retirees with no recent stats).
    supabase.from('nfl_players')
      .select('gsis_id, full_name, position, team, age, rookie_year, draft_year, draft_round, draft_pick, depth_chart_position, depth_chart_order')
      .in('position', ['QB', 'RB', 'WR', 'TE']),
    // Broader roster fetch (active + inactive) for vacancy detection.
    supabase.from('nfl_players')
      .select('gsis_id, full_name, position, team, is_active, depth_chart_position, depth_chart_order')
      .in('position', ['QB', 'RB', 'WR', 'TE']),
    isBacktest ? Promise.resolve(new Map()) : fetchInjuryMap(),
  ]);

  if (playersResult.error) throw playersResult.error;
  const players = playersResult.data ?? [];
  if (!players.length) throw new Error('no active players');

  // v2026-05-12d: manual player injection for known-missing roster entries.
  // The `nfl_players` sync occasionally drops players (FA limbo, sync gaps).
  // Pitts case: missing from the table entirely, so the engine never ranks him.
  const MANUAL_PLAYER_OVERRIDES_2026 = [
    {
      gsis_id: '00-0036970', full_name: 'Kyle Pitts', position: 'TE', team: 'ATL',
      age: 25, rookie_year: 2021, draft_year: 2021, draft_round: 1, draft_pick: 4,
      depth_chart_position: 'TE', depth_chart_order: 1,
    },
  ];
  for (const inj of MANUAL_PLAYER_OVERRIDES_2026) {
    if (!players.find((p: any) => p.gsis_id === inj.gsis_id || (p.full_name || '').toLowerCase() === inj.full_name.toLowerCase())) {
      players.push(inj as any);
      console.log(`[${format}] manual-injected ${inj.full_name} (${inj.position}/${inj.team})`);
    }
  }

  // v5.13c (2026-05-20): TEAM OVERRIDES for confirmed signings Sleeper
  // hasn't synced yet. Updates an existing player's team/depth/active flags.
  // Use full_name (lowercased) match. Add entries as news breaks; remove
  // once Sleeper catches up.
  const TEAM_OVERRIDES_2026: Array<{
    nameLower: string; team: string; is_active?: boolean;
    depth_chart_position?: string; depth_chart_order?: number;
  }> = [
    { nameLower: 'jauan jennings', team: 'MIN', is_active: true, depth_chart_position: 'RWR', depth_chart_order: 2 },
    // 2026-06-02: confirmed offseason trade (PFR + ESPN + PFT + RotoWire).
    // Eagles dealt A.J. Brown to the Patriots; he's Drake Maye's new WR1.
    // nflverse roster feed still lists him on PHI; remove once it syncs.
    { nameLower: 'a.j. brown', team: 'NE', is_active: true, depth_chart_position: 'LWR', depth_chart_order: 1 },
    // DeVonta Smith stays in Philly but is now the unambiguous WR1 with Brown
    // gone. He already codes as depth_chart_order 1; pinning it here makes the
    // intent explicit. His projection lift comes from the PHI target vacancy
    // the engine recomputes once Brown is moved off the roster above.
    { nameLower: 'devonta smith', team: 'PHI', is_active: true, depth_chart_position: 'LWR', depth_chart_order: 1 },
    // NOTE: OBJ -> NYG (also confirmed) is intentionally NOT here. He has no
    // row in nfl_players, so an override can't match him, and injecting a full
    // fabricated record for a 33-yo depth signing who won't rank inside ~150
    // isn't worth the data-integrity cost. Add via MANUAL_PLAYER_OVERRIDES
    // with his real gsis_id if he becomes fantasy-relevant.
  ];
  for (const ov of TEAM_OVERRIDES_2026) {
    const p = players.find((p: any) => (p.full_name || '').toLowerCase() === ov.nameLower);
    if (p) {
      const oldTeam = p.team;
      p.team = ov.team;
      if (ov.is_active !== undefined) (p as any).is_active = ov.is_active;
      if (ov.depth_chart_position) (p as any).depth_chart_position = ov.depth_chart_position;
      if (ov.depth_chart_order !== undefined) (p as any).depth_chart_order = ov.depth_chart_order;
      console.log(`[${format}] team-override ${p.full_name}: ${oldTeam} → ${ov.team}`);
    }
  }

  console.log(`[${format}] players=${players.length} w2025=${w2025.length} w2024=${w2024.length} w2023=${w2023.length} w2022=${w2022.length} w2021=${w2021.length}`);

  const agg2025 = aggregateSeason(w2025, ptsCol);
  const agg2024 = aggregateSeason(w2024, ptsCol);
  const agg2023 = aggregateSeason(w2023, ptsCol);
  const agg2022 = aggregateSeason(w2022, ptsCol);
  const agg2021 = aggregateSeason(w2021, ptsCol);

  // ─── Elite-vet stabilization map (v2026-05-16, season-total finish) ──
  // Count ACTUAL top-10 / top-5 SEASON finishes per player across 2021-2025
  // (5-yr window matches the blend's data window).
  //
  // v2026-05-16 fix: previously sorted by PPG, which credited any 8-game
  // sample at elite PPG as a "top-10 finish" — Higgins got tagged 3× top-10
  // despite his best actual finish being WR15. PPG-rank is not season-rank;
  // missed games matter for total fantasy output. Now sorts by SEASON TOTAL
  // fpts (ppg × games), which is the real fantasy finish.
  //
  // Effect: stabilization fires only for players who actually delivered
  // full-season top-10 production, not "elite-when-on-field" guys with
  // chronic durability issues (Higgins, Kittle, Pitts pre-2025).
  type EliteCounts = { top10: number; top5: number };
  const eliteVetMap = new Map<string, EliteCounts>();
  for (const seasonAgg of [agg2025, agg2024, agg2023, agg2022, agg2021]) {
    const byPosE: Record<string, { gsis_id: string; seasonTotal: number }[]> = {};
    for (const p of players) {
      const a = seasonAgg.get(p.gsis_id);
      if (!a || a.games < 8) continue;
      (byPosE[p.position] = byPosE[p.position] ?? []).push({
        gsis_id: p.gsis_id, seasonTotal: a.ppg * a.games,
      });
    }
    for (const pos of Object.keys(byPosE)) {
      byPosE[pos].sort((a, b) => b.seasonTotal - a.seasonTotal);
      byPosE[pos].forEach((row, i) => {
        if (i < 10) {
          const ec = eliteVetMap.get(row.gsis_id) ?? { top10: 0, top5: 0 };
          ec.top10 += 1;
          if (i < 5) ec.top5 += 1;
          eliteVetMap.set(row.gsis_id, ec);
        }
      });
    }
  }

  // 2025 positional finish (for floor protection on players < 30).
  // Use recency-weighted ppg so a player who collapsed late doesn\'t
  // get floor protected based on their hot start.
  const finishedRanks = new Map<string, number>();
  const byPos: Record<string, { gsis_id: string; ppg: number; }[]> = {};
  for (const p of players) {
    const a = agg2025.get(p.gsis_id);
    if (!a || a.games < 6) continue;
    (byPos[p.position] = byPos[p.position] ?? []).push({ gsis_id: p.gsis_id, ppg: a.recencyPpg });
  }
  for (const pos of Object.keys(byPos)) {
    byPos[pos].sort((a, b) => b.ppg - a.ppg);
    byPos[pos].forEach((row, i) => finishedRanks.set(row.gsis_id, i + 1));
  }

  // ─── SYSTEM CONTEXT (target concentration / personal usage share) ───
  // v2026-05-07. Builds team-level aggregates from 2025 weekly stats so we
  // can score "is this offense system-dependent" (QB) and "is this player
  // a workhorse / alpha" (RB/WR/TE). Tier-1 system-context proxy from the
  // 2026-05-07 design discussion. ±3% multiplier on forwardLayer.
  //   QB:        team's top-3 receiver target share. >65% = -3% (concentrated,
  //              boom-bust risk). <50% = +3% (broad cast).
  //   WR/TE:     personal target share of team. >25% = +3% (alpha read).
  //              <10% = -3% (complementary).
  //   RB:        personal carry share of team. >60% = +3% (workhorse).
  //              <30% = -3% (RBBC).
  // Build positionByGsis from the BROADER roster (includes is_active=false)
  // so that workload from FA / cut / retired players still aggregates into
  // team totals (otherwise Hunt's 163 KC carries would be invisible).
  type RosterRow = { gsis_id: string; full_name: string; position: string; team: string | null; is_active: boolean };
  const rosterById = new Map<string, RosterRow>();
  for (const r of (rosterResult.data ?? []) as RosterRow[]) rosterById.set(r.gsis_id, r);

  // Backtest mode: override player team with lastTeam from prior year's
  // stats. Approximates pre-asOfSeason rosters using only data up
  // through asOfSeason-1. Trade/vacancy detection produces minimal
  // signal in backtest as a result — honest limitation.
  if (isBacktest) {
    for (const p of players) {
      const lt = agg2025.get(p.gsis_id)?.lastTeam ?? agg2024.get(p.gsis_id)?.lastTeam ?? null;
      if (lt) p.team = lt;
    }
    for (const r of rosterById.values()) {
      const lt = agg2025.get(r.gsis_id)?.lastTeam ?? agg2024.get(r.gsis_id)?.lastTeam ?? null;
      if (lt) r.team = lt;
    }
  }

  // v2026-05-15: Canonicalize team codes after backtest override (LA→LAR etc).
  for (const p of players) p.team = normTeamCode(p.team);
  for (const r of rosterById.values()) r.team = normTeamCode(r.team);

  const positionByGsis: Record<string, string> = {};
  for (const r of rosterById.values()) positionByGsis[r.gsis_id] = r.position;

  type TeamAggMap = Record<string, Record<string, number>>;
  const teamReceiverTargets: TeamAggMap = {};   // team -> gsis_id -> targets
  const teamRusherCarries:   TeamAggMap = {};
  const teamTotalReceiverTargets: Record<string, number> = {};
  const teamTotalRBCarries:       Record<string, number> = {};

  // v2 (2026-05-16): per-week team totals for "share-when-active" calc.
  // Players who miss games get their share UNDERESTIMATED if we divide
  // by season-total team targets — Garrett Wilson at 7g/59 tgts looks
  // like 10% (59/600) when his actual when-active share is ~24%
  // (59/250 over his 7 weeks). teamTargetsByWeek lets us compute share
  // normalized to weeks the player was actually on the field.
  const teamTargetsByWeek: Record<string, Record<number, number>> = {};   // team -> week -> receiver tgts
  const teamCarriesByWeek: Record<string, Record<number, number>> = {};   // team -> week -> rb carries

  // v5.13 (2026-05-20): team QB-chaos detection for 2025 + 2026 QB1 stability.
  // Identify teams where 2025 QB1 missed games OR 2+ QBs had ≥4 starts.
  // ALSO compute 2026 projected QB1 from depth_chart_order=1, and whether
  // that QB has demonstrated starter-quality stability (15+g, 17+ppg in
  // any prior 3yr year). QB-collapse-recovery rule fires only when 2025
  // had chaos AND 2026 QB1 is established — otherwise the chaos likely
  // continues (McCarthy projected QB1 on MIN in 2026 = still unresolved).
  const teamQbStarts: Record<string, Record<string, number>> = {};
  for (const w of w2025) {
    if (positionByGsis[w.gsis_id] !== 'QB') continue;
    const team = normTeamCode(w.team);
    if (!team) continue;
    const pts = Number((w as any)[ptsCol] ?? 0);
    if (pts >= 6) {
      teamQbStarts[team] = teamQbStarts[team] ?? {};
      teamQbStarts[team][w.gsis_id] = (teamQbStarts[team][w.gsis_id] ?? 0) + 1;
    }
  }
  const teamHadQbChaos: Record<string, boolean> = {};
  for (const [team, qbs] of Object.entries(teamQbStarts)) {
    const startsArr = Object.values(qbs).sort((a, b) => b - a);
    const qb1Starts = startsArr[0] ?? 0;
    const qb2Starts = startsArr[1] ?? 0;
    if (qb1Starts <= 13 || qb2Starts >= 4) {
      teamHadQbChaos[team] = true;
    }
  }
  // 2026 QB1 stability: per team, find projected QB1 (depth_chart_order=1
  // among QBs) and check their prior 3yr seasons for any 15+g 17+ppg year.
  const teamProjectedQb1: Record<string, string> = {};  // team → gsis_id
  for (const p of players) {
    if (p.position !== 'QB' || !p.team) continue;
    if (p.depth_chart_order === 1) {
      teamProjectedQb1[p.team] = p.gsis_id;
    }
  }
  const teamHas2026StableQb: Record<string, boolean> = {};
  for (const [team, qbGsis] of Object.entries(teamProjectedQb1)) {
    const q25 = agg2025.get(qbGsis);
    const q24 = agg2024.get(qbGsis);
    const q23 = agg2023.get(qbGsis);
    const hasStableYr = [q25, q24, q23].some(a => a && a.games >= 15 && a.ppg >= 17);
    // v5.13b: also exclude QBs whose INJURY_CONTEXT_2026 entry projects <15g.
    // Kyler Murray on MIN: nominal QB1, but injury-flagged with 13g/0.92 →
    // chaos likely continues, don't trigger WR recovery.
    const qbPlayer = players.find(p => p.gsis_id === qbGsis);
    const qbInjKey = (qbPlayer?.full_name || '').toLowerCase().replace(/[^a-z]/g, '');
    const qbInjGames = INJURY_CONTEXT_2026[qbInjKey]?.games ?? 17;
    const reliableInj = qbInjGames >= 15;
    if (hasStableYr && reliableInj) teamHas2026StableQb[team] = true;
  }
  // v5.14 (2026-05-21): per-team TE-friendly QB chemistry mult.
  // Lookup TE_FRIENDLY_QBS_2026 by projected QB1's name. Applied to TEs in
  // layer6 environment.
  const teamTeFriendlyQbMult: Record<string, number> = {};
  for (const [team, qbGsis] of Object.entries(teamProjectedQb1)) {
    const qbPlayer = players.find(p => p.gsis_id === qbGsis);
    const qbKey = (qbPlayer?.full_name || '').toLowerCase().replace(/[^a-z]/g, '');
    if (TE_FRIENDLY_QBS_2026[qbKey]) {
      teamTeFriendlyQbMult[team] = TE_FRIENDLY_QBS_2026[qbKey];
    }
  }

  for (const w of w2025) {
    const team = w.team;
    if (!team) continue;
    const tgts = Number(w.targets ?? 0);
    const car  = Number(w.carries ?? 0);
    const pos  = positionByGsis[w.gsis_id];
    if (pos === 'WR' || pos === 'TE' || pos === 'RB') {
      (teamReceiverTargets[team] = teamReceiverTargets[team] ?? {});
      teamReceiverTargets[team][w.gsis_id] = (teamReceiverTargets[team][w.gsis_id] ?? 0) + tgts;
      teamTotalReceiverTargets[team] = (teamTotalReceiverTargets[team] ?? 0) + tgts;
      teamTargetsByWeek[team] = teamTargetsByWeek[team] ?? {};
      teamTargetsByWeek[team][w.week] = (teamTargetsByWeek[team][w.week] ?? 0) + tgts;
    }
    if (pos === 'RB') {
      (teamRusherCarries[team] = teamRusherCarries[team] ?? {});
      teamRusherCarries[team][w.gsis_id] = (teamRusherCarries[team][w.gsis_id] ?? 0) + car;
      teamTotalRBCarries[team] = (teamTotalRBCarries[team] ?? 0) + car;
      teamCarriesByWeek[team] = teamCarriesByWeek[team] ?? {};
      teamCarriesByWeek[team][w.week] = (teamCarriesByWeek[team][w.week] ?? 0) + car;
    }
  }

  // ─── v4.1 (2026-05-17): TEAMMATE-CONTEXT DECOMPOSITION ───────────────
  // Identify each team's 2025 positional alpha by TARGETS/GAME (not season
  // total). Lamb missed 4 games but had higher per-game target rate than
  // Pickens — true alpha. Without per-game rate, Pickens (who played all
  // 17g) would be falsely flagged as DAL's alpha because his season-total
  // targets exceeded Lamb's reduced 13-game total.
  //
  // Then decompose each player's 2025 by whether the alpha was active.
  // Pickens case: 15.0 ppg w/ Lamb / 24.2 ppg w/o Lamb → project 2026
  // (Lamb healthy) off the with-Lamb rate.

  // Player-week activity: set of weeks where player had any meaningful stat.
  // Built BEFORE alpha ID since alpha calc needs game counts.
  const playerActiveWeeks: Map<string, Set<number>> = new Map();
  for (const w of w2025) {
    const tgts = Number(w.targets ?? 0);
    const car  = Number(w.carries ?? 0);
    const pts  = Number((w as any).fantasy_pts_ppr ?? 0);
    if (tgts > 0 || car > 0 || pts > 0) {
      if (!playerActiveWeeks.has(w.gsis_id)) playerActiveWeeks.set(w.gsis_id, new Set());
      playerActiveWeeks.get(w.gsis_id)!.add(w.week);
    }
  }

  const teamWRTEAlpha2025: Record<string, string | null> = {};
  const teamRBAlpha2025: Record<string, string | null> = {};
  for (const team of Object.keys(teamReceiverTargets)) {
    let bestWRTE: string | null = null;
    let maxRate = 0;
    for (const [gid, tgts] of Object.entries(teamReceiverTargets[team])) {
      const tp = positionByGsis[gid];
      if (tp === 'WR' || tp === 'TE') {
        const games = (playerActiveWeeks.get(gid) ?? new Set()).size;
        if (games < 4) continue;  // require 4+ game sample
        const rate = tgts / games;
        if (rate > maxRate) { maxRate = rate; bestWRTE = gid; }
      }
    }
    teamWRTEAlpha2025[team] = bestWRTE;
  }
  for (const team of Object.keys(teamRusherCarries)) {
    let bestRB: string | null = null;
    let maxRate = 0;
    for (const [gid, c] of Object.entries(teamRusherCarries[team])) {
      const games = (playerActiveWeeks.get(gid) ?? new Set()).size;
      if (games < 4) continue;
      const rate = c / games;
      if (rate > maxRate) { maxRate = rate; bestRB = gid; }
    }
    teamRBAlpha2025[team] = bestRB;
  }

  // Helper: team's receiver targets DURING the weeks the player was active.
  function teamTgtsActive(team: string, playerWeeks: number[]): number {
    const byWk = teamTargetsByWeek[team] ?? {};
    let sum = 0;
    for (const wk of playerWeeks) sum += (byWk[wk] ?? 0);
    return sum;
  }
  function teamCarActive(team: string, playerWeeks: number[]): number {
    const byWk = teamCarriesByWeek[team] ?? {};
    let sum = 0;
    for (const wk of playerWeeks) sum += (byWk[wk] ?? 0);
    return sum;
  }

  // ─── Target-share trend signal (v2026-05-08) ───────────────────────
  // For each WR/TE/RB, compare their share of team workload in weeks
  // 1-8 (h1) vs weeks 10-17 (h2). Captures within-season role expansion
  // or fade going into next year. Wan'Dale Robinson 2024 H2 share spike
  // → boost. Caps at ±5% to avoid double-counting opp adj (which works
  // on absolute volume; this works on team-relative share).
  type LoadHalves = { h1: number; h2: number };
  const teamWRTELoadHalves: Record<string, LoadHalves> = {};
  const teamRBLoadHalves: Record<string, LoadHalves> = {};
  const playerLoadHalves: Record<string, LoadHalves> = {};
  for (const w of w2025) {
    // v5.10 (2026-05-19): normalize team code (LA→LAR, JAC→JAX, WSH→WAS)
    // so lookups against a25.lastTeam (already normalized) hit. Without
    // this, teamRBLoadHalves['LA'] would silently no-op for the share-
    // trend/decay rules on Rams/Chargers/Jags/Commanders players.
    const team = normTeamCode(w.team);
    if (!team) continue;
    const half = w.week <= 8 ? 'h1' : (w.week >= 10 ? 'h2' : null);
    if (!half) continue;
    const pos = positionByGsis[w.gsis_id];
    const tgts = Number(w.targets ?? 0);
    const car  = Number(w.carries ?? 0);
    if (pos === 'WR' || pos === 'TE') {
      teamWRTELoadHalves[team] = teamWRTELoadHalves[team] ?? { h1: 0, h2: 0 };
      teamWRTELoadHalves[team][half] += tgts;
    }
    if (pos === 'RB') {
      teamRBLoadHalves[team] = teamRBLoadHalves[team] ?? { h1: 0, h2: 0 };
      teamRBLoadHalves[team][half] += car;
    }
    playerLoadHalves[w.gsis_id] = playerLoadHalves[w.gsis_id] ?? { h1: 0, h2: 0 };
    playerLoadHalves[w.gsis_id][half] += (pos === 'RB' ? car : tgts);
  }

  function targetShareTrend(p: typeof players[number]): { mult: number; note: string } {
    if (p.position !== 'WR' && p.position !== 'TE' && p.position !== 'RB') return { mult: 1.0, note: '' };
    // v2026-05-16: use the player's 2025 team for the team-load denominator,
    // not their 2026 team. Wan'Dale case: his NYG targets were being divided
    // by TEN's team total, producing a nonsense 26%→36% "trend" that wasn't
    // real. For non-team-change players, lastTeam2025 === p.team so this is
    // a no-op. For team-change players, the trend reflects their role
    // expansion on the OLD team (still has predictive value, but accurate).
    const team2025 = agg2025.get(p.gsis_id)?.lastTeam ?? p.team;
    if (!team2025) return { mult: 1.0, note: '' };
    const player = playerLoadHalves[p.gsis_id];
    if (!player) return { mult: 1.0, note: '' };
    const teamLoad = (p.position === 'RB') ? teamRBLoadHalves[team2025] : teamWRTELoadHalves[team2025];
    if (!teamLoad || teamLoad.h1 <= 0 || teamLoad.h2 <= 0) return { mult: 1.0, note: '' };
    const h1Share = player.h1 / teamLoad.h1;
    const h2Share = player.h2 / teamLoad.h2;
    // Need meaningful sample in either half (>=3% share is rotational+).
    // Skips fully-injured-out-of-half players to avoid double-counting durability.
    if (h1Share < 0.03 && h2Share < 0.03) return { mult: 1.0, note: '' };
    if (h1Share <= 0 || h2Share <= 0) return { mult: 1.0, note: '' };
    const delta = h2Share - h1Share;
    const adj = Math.max(-0.05, Math.min(0.05, delta * 1.0));
    if (Math.abs(adj) < 0.01) return { mult: 1.0, note: '' };
    return {
      mult: 1.0 + adj,
      note: `share trend ${adj > 0 ? '+' : ''}${(adj * 100).toFixed(0)}% (${(h1Share*100).toFixed(0)}%→${(h2Share*100).toFixed(0)}%)`,
    };
  }

  // ─── Auto-detected vacated workload (v2026-05-08) ──────────────────
  // For each team-position, find the 2025 workload leader (carries for
  // RB, targets for WR/TE). If their current team in nfl_players differs
  // from where they played in 2025, the team has a vacancy. Find the
  // most-likely heir (highest-recent-PPG joiner at that position on the
  // new team) and boost their baseline.
  // Walker-to-KC case: KC's 2025 RB1 left, Walker is the inheriting
  // joiner, gets baseline mult tied to vacated carry volume.
  const playersById = new Map<string, typeof players[number]>();
  for (const p of players) playersById.set(p.gsis_id, p);

  type Vacancy = { departedName: string; departedVol: number; mult: number; position: string };
  const vacancies: Record<string, Vacancy> = {};

  // Helper: aggregate vacated volume across ALL departed contributors
  // (top-1 + RB2 + RB3 etc). Threshold per contributor to filter out
  // garbage-time backups, but accumulate to capture full vacancy.
  function buildVacancy(
    team: string,
    pos: 'RB' | 'WR' | 'TE',
    workloadMap: Record<string, number>,
    contribMin: number,
    teamMin: number,
    multTiers: Array<[number, number]>,  // [threshold, mult] sorted desc
  ): Vacancy | null {
    const departed: { name: string; vol: number }[] = [];
    let totalVol = 0;
    for (const [gid, vol] of Object.entries(workloadMap)) {
      if (vol < contribMin) continue;
      if (pos !== 'RB' && positionByGsis[gid] !== pos) continue;
      // Look up in broader roster (includes is_active=false / FA / retired).
      // Player is "still on team" only if active AND team matches; cut /
      // retired / free-agent counts as departed even if team field is stale.
      const player = rosterById.get(gid);
      const stillOnTeam = !!(player && player.is_active && player.team === team);
      if (stillOnTeam) continue;
      const name = player?.full_name ?? `<${gid}>`;
      departed.push({ name, vol });
      totalVol += vol;
    }
    if (totalVol < teamMin || !departed.length) return null;
    let mult = 1.05;
    for (const [thr, m] of multTiers) {
      if (totalVol >= thr) { mult = m; break; }
    }
    departed.sort((a, b) => b.vol - a.vol);
    const note = departed.map(d => `${d.name} (${Math.round(d.vol)})`).join(' + ');
    return { departedName: note, departedVol: totalVol, mult, position: pos };
  }

  // RB vacancies — aggregate across all departed contributors with >=40 carries.
  // Captures KC losing RB1 + RB2 jointly, JAX losing Etienne, etc.
  for (const team of Object.keys(teamRusherCarries)) {
    const v = buildVacancy(team, 'RB', teamRusherCarries[team], 40, 100, [
      [250, 1.18], [180, 1.13], [130, 1.08],
    ]);
    if (v) vacancies[`${team}:RB`] = v;
  }

  // WR/TE vacancies — aggregate across departed contributors with >=30 targets.
  for (const team of Object.keys(teamReceiverTargets)) {
    for (const checkPos of ['WR', 'TE'] as const) {
      const minPerPlayer = checkPos === 'WR' ? 30 : 25;
      const teamMin = checkPos === 'WR' ? 80 : 60;
      const tiers: Array<[number, number]> = checkPos === 'WR'
        ? [[180, 1.15], [130, 1.10], [90, 1.06]]
        : [[140, 1.15], [100, 1.10], [70, 1.06]];
      const v = buildVacancy(team, checkPos, teamReceiverTargets[team], minPerPlayer, teamMin, tiers);
      if (v) vacancies[`${team}:${checkPos}`] = v;
    }
  }

  // Identify heir per vacancy. Priority:
  //   1. R1 rookie joining at this position (highest draft capital)
  //   2. R2 rookie joining at this position
  //   3. Highest-recent-PPG vet joiner
  // 2026 rookies have no stat history (lastTeam is null) so we explicitly
  // include them; otherwise the vet-joiner filter would exclude them.
  const heirs = new Map<string, Vacancy>();
  for (const key of Object.keys(vacancies)) {
    const [team, pos] = key.split(':');
    const vacancy = vacancies[key];
    const candidates = players.filter(p => {
      if (p.position !== pos || p.team !== team) return false;
      const last = agg2025.get(p.gsis_id)?.lastTeam ?? agg2024.get(p.gsis_id)?.lastTeam ?? null;
      const isRookieJoiner = p.rookie_year === asOfSeason || p.draft_year === asOfSeason;
      return (last && last !== team) || isRookieJoiner;
    });
    if (!candidates.length) continue;
    const isRookie = (p: typeof candidates[number]) =>
      p.rookie_year === asOfSeason || p.draft_year === asOfSeason;
    const r1 = candidates.find(c => isRookie(c) && c.draft_round === 1);
    const r2 = candidates.find(c => isRookie(c) && c.draft_round === 2);
    if (r1)      { heirs.set(r1.gsis_id, vacancy); continue; }
    if (r2)      { heirs.set(r2.gsis_id, vacancy); continue; }
    const vets = candidates.filter(c => !isRookie(c));
    vets.sort((a, b) => {
      const ap = (agg2025.get(a.gsis_id)?.recencyPpg ?? 0) + (agg2024.get(a.gsis_id)?.recencyPpg ?? 0);
      const bp = (agg2025.get(b.gsis_id)?.recencyPpg ?? 0) + (agg2024.get(b.gsis_id)?.recencyPpg ?? 0);
      return bp - ap;
    });
    if (vets.length) heirs.set(vets[0].gsis_id, vacancy);
  }
  console.log(`[${format}] vacancies=${Object.keys(vacancies).length} heirs=${heirs.size}`);

  // ─── Surrounding cast delta (v2026-05-08) ──────────────────────────
  // Captures FA adds/losses, trades, and rookie infusions that change a
  // player's surrounding-cast quality vs 2025. DJ Moore CHI→BUF should
  // boost Allen (BUF gained alpha WR) and hurt Caleb Williams (CHI lost
  // alpha WR). Walker-style cases handled separately by vacated workload.
  //
  // Skill players (RB/WR/TE): care about their team's QB quality
  // QBs: care about their team's alpha receiver quality
  //
  // Compare 2025 starter PPG (top passing-attempts QB / top-targets WR/TE)
  // to 2026 starter PPG (highest-2025-PPG active player at that position
  // on the team). Apply capped multiplier on forwardLayer.

  // 2025 starter PPG per team — QB and alpha receiver. The fetched
  // weekly stats don't include `attempts` (only targets/carries), so we
  // identify each team's starting QB by weeks played for them.
  const team2025QbPpg: Record<string, number> = {};
  const team2025AlphaPpg: Record<string, number> = {};
  {
    const teamQbWeeks: Record<string, Record<string, number>> = {};
    const teamRecvTargets: Record<string, Record<string, number>> = {};
    for (const w of w2025) {
      const team = w.team;
      if (!team) continue;
      const pos = positionByGsis[w.gsis_id];
      if (pos === 'QB') {
        (teamQbWeeks[team] = teamQbWeeks[team] ?? {});
        teamQbWeeks[team][w.gsis_id] = (teamQbWeeks[team][w.gsis_id] ?? 0) + 1;
      }
      if (pos === 'WR' || pos === 'TE') {
        const tgts = Number(w.targets ?? 0);
        if (tgts > 0) {
          (teamRecvTargets[team] = teamRecvTargets[team] ?? {});
          teamRecvTargets[team][w.gsis_id] = (teamRecvTargets[team][w.gsis_id] ?? 0) + tgts;
        }
      }
    }
    for (const team of Object.keys(teamQbWeeks)) {
      const sorted = Object.entries(teamQbWeeks[team]).sort((a, b) => b[1] - a[1]);
      const topId = sorted[0]?.[0];
      if (topId) team2025QbPpg[team] = agg2025.get(topId)?.ppg ?? 0;
    }
    for (const team of Object.keys(teamRecvTargets)) {
      const sorted = Object.entries(teamRecvTargets[team]).sort((a, b) => b[1] - a[1]);
      const topId = sorted[0]?.[0];
      if (topId) team2025AlphaPpg[team] = agg2025.get(topId)?.ppg ?? 0;
    }
  }

  // 2026 projected starter PPG per team. Two-pass selection (production
  // mode only — backtest can't use current depth charts):
  //  Pass 1: prefer player with depth_chart_order=1 at relevant slot
  //          (QB1 for QBs, any of LWR1/RWR1/SWR1/TE1 for alpha receivers).
  //  Pass 2: if no depth-chart starter, fall back to highest 2025 PPG.
  // Skip injured players in both passes.
  const team2026QbPpg: Record<string, number> = {};
  const team2026AlphaPpg: Record<string, number> = {};
  const isOut = (gid: string): boolean => {
    const player = rosterById.get(gid);
    if (!player) return false;
    const key = (player.full_name ?? '').toLowerCase().replace(/[^a-z]/g, '');
    const inj = injuryMap.get(key);
    if (!inj) return false;
    const sev = (inj.status ?? '').toLowerCase();
    return sev.includes('out') || sev.includes('ir') ||
           sev.includes('pup') || sev.includes('doubtful');
  };

  // Pass 1: depth-chart-driven (production only)
  if (!isBacktest) {
    for (const p of players) {
      if (!p.team || isOut(p.gsis_id)) continue;
      const dco = (p as any).depth_chart_order;
      const dcp = (p as any).depth_chart_position;
      if (dco !== 1) continue;
      const ppg = (agg2025.get(p.gsis_id)?.ppg ?? 0) ||
                  (agg2024.get(p.gsis_id)?.ppg ?? 0) || 1; // 1 = sentinel "is the starter even with no history"
      if (p.position === 'QB' && dcp === 'QB') {
        if (!(team2026QbPpg[p.team])) team2026QbPpg[p.team] = ppg;
      } else if ((p.position === 'WR' || p.position === 'TE') &&
                 (dcp === 'LWR' || dcp === 'RWR' || dcp === 'SWR' || dcp === 'TE')) {
        // Multiple receivers can be order=1 (LWR1, RWR1, SWR1). Take highest PPG among them.
        if (ppg > (team2026AlphaPpg[p.team] ?? 0)) team2026AlphaPpg[p.team] = ppg;
      }
    }
  }
  // Pass 2: PPG fallback for teams not yet assigned
  for (const p of players) {
    if (!p.team || isOut(p.gsis_id)) continue;
    const ppg = (agg2025.get(p.gsis_id)?.ppg ?? 0) ||
                (agg2024.get(p.gsis_id)?.ppg ?? 0);
    if (p.position === 'QB') {
      if (!team2026QbPpg[p.team] && ppg > 0) team2026QbPpg[p.team] = ppg;
      else if (team2026QbPpg[p.team] && ppg > team2026QbPpg[p.team] && isBacktest) team2026QbPpg[p.team] = ppg;
    } else if (p.position === 'WR' || p.position === 'TE') {
      if (!team2026AlphaPpg[p.team] && ppg > 0) team2026AlphaPpg[p.team] = ppg;
      else if (team2026AlphaPpg[p.team] && ppg > team2026AlphaPpg[p.team] && isBacktest) team2026AlphaPpg[p.team] = ppg;
    }
  }

  function castMultFor(
    team: string | null,
    position: string,
    lastTeam: string | null,
  ): { mult: number; note: string } {
    if (!team) return { mult: 1.0, note: '' };
    // Traded / FA-signed players: compare OLD team's starter (their 2025
    // surrounding cast) to NEW team's projected starter. Otherwise
    // compare team's 2025 starter to its 2026 starter (captures FA
    // adds/losses on the same roster).
    const refTeam = (lastTeam && lastTeam !== team) ? lastTeam : team;
    const moved = refTeam !== team;
    if (position === 'WR' || position === 'TE' || position === 'RB') {
      const a = team2025QbPpg[refTeam] ?? 0;
      const b = team2026QbPpg[team] ?? 0;
      if (a <= 0 || b <= 0) return { mult: 1.0, note: '' };
      const delta = (b - a) / a;
      const adj = Math.max(-0.05, Math.min(0.05, delta * 0.25));
      if (Math.abs(adj) < 0.01) return { mult: 1.0, note: '' };
      const ctx = moved ? `${refTeam} ${a.toFixed(1)}→${team} ${b.toFixed(1)}` : `${a.toFixed(1)}→${b.toFixed(1)}`;
      return { mult: 1.0 + adj, note: `QB cast ${adj > 0 ? '+' : ''}${(adj*100).toFixed(0)}% (${ctx} ppg)` };
    }
    if (position === 'QB') {
      const a = team2025AlphaPpg[refTeam] ?? 0;
      const b = team2026AlphaPpg[team] ?? 0;
      if (a <= 0 || b <= 0) return { mult: 1.0, note: '' };
      const delta = (b - a) / a;
      const adj = Math.max(-0.03, Math.min(0.03, delta * 0.20));
      if (Math.abs(adj) < 0.01) return { mult: 1.0, note: '' };
      const ctx = moved ? `${refTeam} ${a.toFixed(1)}→${team} ${b.toFixed(1)}` : `${a.toFixed(1)}→${b.toFixed(1)}`;
      return { mult: 1.0 + adj, note: `alpha cast ${adj > 0 ? '+' : ''}${(adj*100).toFixed(0)}% (${ctx} ppg)` };
    }
    return { mult: 1.0, note: '' };
  }

  const teamTop3Concentration: Record<string, number> = {};
  // v2026-05-16: teamAlphaShare = top WR's share, used to detect target-hogs.
  // When alpha ≥ 28%, the WR2/WR3 on that team gets a deeper penalty because
  // they're competing for scraps (e.g., Higgins behind Chase, Pickens behind
  // Lamb). A flat -5% for any "WR2 zone" is too soft for these specific cases.
  const teamAlphaShare: Record<string, number> = {};
  for (const team of Object.keys(teamReceiverTargets)) {
    const sortedTgts = Object.values(teamReceiverTargets[team]).sort((a, b) => b - a);
    const top3 = sortedTgts.slice(0, 3).reduce((s, t) => s + t, 0);
    const total = teamTotalReceiverTargets[team] ?? 0;
    teamTop3Concentration[team] = total > 0 ? top3 / total : 0.55; // neutral default
    teamAlphaShare[team] = total > 0 ? (sortedTgts[0] ?? 0) / total : 0.0;
  }

  // ── v2026-05-12: Target dilution from offseason additions ──
  // The engine uses 2025 team target share to band incumbents (alpha read,
  // WR2 zone, etc.). But target share is forward-looking: if a team drafted
  // a top-10 WR or signed a pass-catching RB, the incumbent's projected
  // 2026 share is materially lower than their 2025 share.
  //
  // Per-team dilution = sum of expected target consumption by offseason
  // additions: R1 top-10 rookie WR/TE (0.15), R1 picks 11-32 (0.10),
  // R2 WR/TE (0.06), inbound WR/TE (0.07), pass-catching RB acquisition (0.05).
  // Capped at 0.22 (v2026-05-12b: tightened from 0.35) to avoid over-penalizing heavily-loaded teams like NO.
  //
  // Saints case (Tyson R1 pick 8 + Etienne FA): NO dilution ≈ 0.20, which
  // moves Olave's 29% share → adjusted 23.2% → falls out of alpha band.
  // v5.13c (2026-05-20): production-weighted dilution. Was treating every
  // team-change WR/TE as 0.07 regardless of whether they're a real threat.
  // DET case: Conklin (backup TE, ~20 tgts) + Dortch (backup WR, ~30 tgts)
  // + Law (R4 rookie) all triggering full dilution → 0.20 cap → wrongly
  // crushed ARSB's alpha share by -19%. Now: only count arrivals with
  // material prior production.
  const teamShareDilution: Record<string, number> = {};
  for (const p of players) {
    if (!p.team) continue;
    const aTeam25 = agg2025.get(p.gsis_id);
    const aTeam24 = agg2024.get(p.gsis_id);
    const lastTeam = aTeam25?.lastTeam ?? aTeam24?.lastTeam ?? null;
    const teamChanged = !!(lastTeam && lastTeam !== p.team);
    const isFreshRookie = (p.rookie_year === asOfSeason || p.draft_year === asOfSeason);
    let consumed = 0;
    if (isFreshRookie && (p.position === 'WR' || p.position === 'TE')) {
      const pick = p.draft_pick ?? 99;
      const round = p.draft_round ?? 99;
      if (round === 1 && pick <= 10)      consumed = 0.15;
      else if (round === 1)               consumed = 0.10;
      else if (round === 2)               consumed = 0.06;
      else if (round === 3)               consumed = 0.03;
    } else if (teamChanged && (p.position === 'WR' || p.position === 'TE')) {
      // Production-gated: only count if arrival had material prior role.
      // Use targets/game from 2025 if available, else 2024.
      const refAgg = aTeam25 ?? aTeam24;
      const totTgts = refAgg ? (refAgg.weeks || []).reduce((s, w) => s + (w.targets || 0), 0) : 0;
      const g = refAgg?.games ?? 0;
      const tgPerG = g > 0 ? totTgts / g : 0;
      if (tgPerG >= 6.5)      consumed = 0.10;  // alpha-tier (Adams-class, 110+ tgts/16g)
      else if (tgPerG >= 4.5) consumed = 0.07;  // WR2 / starting TE
      else if (tgPerG >= 2.5) consumed = 0.03;  // WR3 / TE2
      else                    consumed = 0;     // depth (Conklin/Dortch-class)
    } else if (teamChanged && p.position === 'RB') {
      const refAgg = aTeam25 ?? aTeam24;
      const totTgts = refAgg ? (refAgg.weeks || []).reduce((s, w) => s + (w.targets || 0), 0) : 0;
      const g = refAgg?.games ?? 0;
      const tgPerG = g > 0 ? totTgts / g : 0;
      if (tgPerG >= 3.0)      consumed = 0.05;  // pass-catching RB
      else                    consumed = 0;
    }
    if (consumed > 0) {
      teamShareDilution[p.team] = (teamShareDilution[p.team] ?? 0) + consumed;
    }
  }

  // Score each player
  const scored: RankedRow[] = [];
  const computedAt = new Date().toISOString();

  for (const p of players) {
    const age = p.age ?? 25;
    const a25 = agg2025.get(p.gsis_id);
    const a24 = agg2024.get(p.gsis_id);
    const a23 = agg2023.get(p.gsis_id);
    const a22 = agg2022.get(p.gsis_id);
    const a21 = agg2021.get(p.gsis_id);
    const isRookie = p.rookie_year === asOfSeason || p.draft_year === asOfSeason;
    // Hoisted (v2.5): injuryNameKey available throughout the loop body
    const injuryNameKey = (p.full_name || '').toLowerCase().replace(/[^a-z]/g, '');

    // ═══ v3 (2026-05-16): NEW BASELINE per user spec ═══════════════════
    // - 3yr default blend with NEW weekly weights (W1-6 ×1.5, W7-13 ×1, W14-17 ×2)
    // - Expand to 5yr ONLY if player has top-10 finish but 3yr doesn't reflect it
    // - Rookies: flat 7.5 ppg × (1 + draft pick tier boost)
    // - Sample-size discount preserved (partial seasons get less weight)
    // - Old paths (injury rebound, twice-proven, eliteVetStabilize) REMOVED.
    //   Elite history is now handled via the top-10 expansion trigger only.
    let baseline = 0;
    let baselineSource = '';
    let highVolatility = false; // retained for downstream method-string compat
    const eliteVetStabilize = false; // v3: replaced by top-10 expansion trigger; stubbed for downstream refs
    const has25 = a25 && a25.games >= 4;
    const has24 = a24 && a24.games >= 4;
    const has23 = a23 && a23.games >= 4;
    const has22 = a22 && a22.games >= 4;
    const has21 = a21 && a21.games >= 4;

    // Compute per-year recencyPpg using NEW v3 weekly weights
    const r25 = a25 ? weeklyRecencyPpgV3(a25.weeks) : 0;
    const r24 = a24 ? weeklyRecencyPpgV3(a24.weeks) : 0;
    const r23 = a23 ? weeklyRecencyPpgV3(a23.weeks) : 0;
    const r22 = a22 ? weeklyRecencyPpgV3(a22.weeks) : 0;
    const r21 = a21 ? weeklyRecencyPpgV3(a21.weeks) : 0;

    // Sample-size confidence (preserved from prior).
    const gameCountWeight = (games: number): number => {
      if (games >= 16) return 1.0;
      if (games <= 8)  return 0.7;
      return 0.7 + (games - 8) * (0.3 / 8);
    };
    const blend = (parts: Array<{ baseW: number; ppg: number; games: number }>): number => {
      const totalW = parts.reduce((s, c) => s + c.baseW * gameCountWeight(c.games), 0);
      if (totalW <= 0) return 0;
      return parts.reduce((s, c) => s + c.baseW * gameCountWeight(c.games) * c.ppg, 0) / totalW;
    };

    const eliteCounts = eliteVetMap.get(p.gsis_id) ?? { top10: 0, top5: 0 };
    let eliteVetTag = '';

    // Fix #2 (v3 2026-05-17): injury-year baseline inversion.
    // ONLY fires when player has actual career top-10 history. Without this
    // gate, chronic-injury players (Rice: 0 career top-10) get falsely
    // anchored to small healthy samples. We're not "rescuing" players who
    // never were elite — we're correcting under-projection for players
    // whose proven peak got buried by an injury year.
    const eliteCountsForGate = eliteVetMap.get(p.gsis_id) ?? { top10: 0, top5: 0 };
    const hasTop10History = eliteCountsForGate.top10 >= 1;
    const injury2025 = !!(a25 && a25.games < 10);
    const has24Healthy = !!(a24 && a24.games >= 8 && r24 >= 14);  // tightened back to 8g

    if (isRookie) {
      // Flat 7.5 ppg × draft pick tier boost.
      const pickBoost = draftPickBoostV3(p.draft_round, p.draft_pick, p.position);
      baseline = 7.5 * (1 + pickBoost);
      const pickTag = p.draft_pick ? `#${p.draft_pick}` : (p.draft_round ? `R${p.draft_round}` : 'undrafted');
      baselineSource = `rookie 7.5 base × pick ${pickTag} +${(pickBoost*100).toFixed(0)}%`;
    } else if (injury2025 && has24Healthy && hasTop10History) {
      // Inverted blend: 2024 as anchor (60%), 2025 partial (25%), 2023 (15%)
      const parts: Array<{ baseW: number; ppg: number; games: number }> = [
        { baseW: 0.60, ppg: r24, games: a24!.games },
      ];
      if (has25) parts.push({ baseW: 0.25, ppg: r25, games: a25!.games });
      if (has23) parts.push({ baseW: 0.15, ppg: r23, games: a23!.games });
      baseline = blend(parts);
      baselineSource = `injury-yr inverted (2024 anchor + 2025 ${a25!.games}g + 2023)`;
    } else if (has25 && has24 && has23) {
      // 3yr default (60/30/10) using v3 weekly recency
      baseline = blend([
        // v5.9 (2026-05-19): further softened from 0.50/0.30/0.20.
        // 50% weight on 2025 over-punished vets like Saquon whose 2024
        // monster (355 fpts) was being undercounted vs their down 2025.
        { baseW: 0.45, ppg: r25, games: a25!.games },
        { baseW: 0.32, ppg: r24, games: a24!.games },
        { baseW: 0.23, ppg: r23, games: a23!.games },
      ]);
      baselineSource = `3yr v3 blend`;
    } else if (has25 && has24) {
      baseline = blend([
        { baseW: 0.7, ppg: r25, games: a25!.games },
        { baseW: 0.3, ppg: r24, games: a24!.games },
      ]);
      baselineSource = `2yr v3 blend`;
    } else if (has25) {
      baseline = r25 * gameCountWeight(a25!.games);
      baselineSource = `2025 v3 recency (${a25!.games}g)`;
    } else if (has24) {
      baseline = r24 * 0.85 * gameCountWeight(a24!.games);
      baselineSource = `2024 v3 recency (no 2025)`;
    } else {
      continue;
    }

    if (baseline <= 0) continue;

    // Fix #4 (v3 2026-05-17): sophomore jump for R1 WR/TE.
    // R1 rookie WR/TEs typically jump +10-20% in PPG in year 2 (better
    // route concepts, target share growth, QB/coach familiarity). The
    // engine treats them as 1yr-data players and stalls them at rookie
    // PPG. McMillan case: 11 ppg rookie year → industry projects ~14 ppg
    // year 2 → engine projects 10 ppg.
    // v3 fix: sophomore jump for WR/TE who was an ACTUAL rookie in 2025.
    // Strict check via rookie_year / draft_year (was failing on Rice who
    // played 3g in 2024, fell below the !has24 threshold, and got falsely
    // tagged as sophomore in year 4). McMillan = true sophomore.
    // v5.13 (2026-05-20): QB-collapse-recovery rule.
    // Detect WR/TE with elite history who collapsed in 2025 because team had
    // QB chaos. Lift baseline by replacing 2025 ppg with prior 3yr "what-if"
    // avg. JJ case considered: 19.4/21.7/20.4/18.7/11.9 trajectory + MIN
    // had McCarthy meniscus chaos in 2025.
    // v5.13b GATE (2026-05-20): only fire if the player's 2026 team has an
    // ESTABLISHED QB1 (15+g 17+ppg in prior 3yr). If 2026 QB1 is the same
    // unproven QB who caused 2025's chaos, the chaos likely continues —
    // don't lift. JJ on MIN-with-McCarthy-still-QB1 = chaos persists.
    if (!isRookie && (p.position === 'WR' || p.position === 'TE')
        && has25 && (has24 || has23)) {
      const team2025 = a25!.lastTeam;
      const team2026 = p.team;
      const teamChaos = team2025 ? teamHadQbChaos[team2025] : false;
      const stable2026Qb = team2026 ? teamHas2026StableQb[team2026] : false;
      if (teamChaos && stable2026Qb) {
        // Career-best ppg in 5yr window
        const careerBestPpg = Math.max(
          a25?.ppg ?? 0, a24?.ppg ?? 0, a23?.ppg ?? 0, a22?.ppg ?? 0, a21?.ppg ?? 0
        );
        // Prior 3yr avg (2024 + 2023 + 2022 where available, ≥10g)
        const priors: number[] = [];
        if (a24 && a24.games >= 10) priors.push(a24.ppg);
        if (a23 && a23.games >= 10) priors.push(a23.ppg);
        if (a22 && a22.games >= 10) priors.push(a22.ppg);
        const priorAvg = priors.length > 0 ? priors.reduce((s, v) => s + v, 0) / priors.length : 0;
        const drop = priorAvg > 0 ? 1 - (a25!.ppg / priorAvg) : 0;
        // Trigger: elite history (≥18 ppg career best) AND 30%+ drop AND chaos
        if (careerBestPpg >= 18 && drop >= 0.30 && priorAvg > 0) {
          // Recompute baseline replacing 2025 with priorAvg in the blend
          // Use same 3yr weights (0.45/0.32/0.23) but substitute priorAvg for r25
          const adjBlend = blend([
            { baseW: 0.45, ppg: priorAvg, games: 16 },
            { baseW: 0.32, ppg: r24, games: a24?.games ?? 0 },
            { baseW: 0.23, ppg: r23, games: a23?.games ?? 0 },
          ]);
          if (adjBlend > baseline) {
            const oldBaseline = baseline;
            baseline = adjBlend;
            baselineSource += ` × QB-chaos recovery ${oldBaseline.toFixed(1)}→${baseline.toFixed(1)} (team chaos ${team2025}; 2025 ${a25!.ppg.toFixed(1)} vs prior ${priorAvg.toFixed(1)})`;
          }
        }
      }
    }

    const wasRookieIn2025 = p.rookie_year === asOfSeason - 1 || p.draft_year === asOfSeason - 1;
    const isSophomore = wasRookieIn2025 && has25 && (p.position === 'WR' || p.position === 'TE' || p.position === 'RB');
    if (isSophomore && r25 >= 9.0) {
      // v4.2 (2026-05-17): bumped down from 1.12 to 1.06. Sophomore Y2
      // improvement is real but smaller than the 12% bump implied.
      baseline = baseline * 1.06;
      baselineSource += ` + sophomore jump ${p.position} (+6% on ${r25.toFixed(1)} rookie ppg)`;
    }

    // v5.12 (2026-05-20): sustained-breakout bonus.
    // Y2/Y3 WR/TE whose 2025 was alpha-tier (18+ ppg) gets +5% on baseline.
    // JSN-class: real WR2 finisher whose age-curve + base blend still
    // under-shoots. Distinct from sophomore jump (which is rookie→Y2);
    // this catches Y3 ascenders too (e.g., Nico Collins-class trajectory).
    // Gated to: ≤3 years experience AND 2025 alpha-ppg.
    const rookieAnchor = p.rookie_year ?? p.draft_year ?? null;
    const yearsExp = rookieAnchor ? (asOfSeason - rookieAnchor) : 99;
    const breakoutEligible = (p.position === 'WR' || p.position === 'TE')
      && !isRookie && yearsExp >= 1 && yearsExp <= 3 && a25 && a25.ppg >= 18 && a25.games >= 12;
    if (breakoutEligible) {
      baseline = baseline * 1.05;
      baselineSource += ` + sustained-breakout +5% (Y${yearsExp} alpha ${a25!.ppg.toFixed(1)} ppg)`;
    }

    // ─── v5 (2026-05-17): ONE-YEAR-WONDER REGRESSION ──────────────────
    // Single outlier season ≥1.40× of the player's other-years average.
    // Baker 2024 was 22 ppg vs his 14-16 ppg prior career → regression
    // expected toward career mean. Apply 0.92x baseline. Doesn't fire
    // for proven-vets (their elite years are recurring, not aberrations).
    const yearsForOYW = (has25 ? 1 : 0) + (has24 ? 1 : 0) + (has23 ? 1 : 0);
    // v5.2 (2026-05-18) PERMANENT: detect Baker-class one-year-wonder QBs
    // even when 5yr-expansion fires. Engine was missing them because the
    // proven-vet check uses ppg >= 17 strict threshold (Baker's 2024 was
    // 22ppg but other yrs 10-16, so qualCount=1, but eliteCounts.top10
    // was 2 from his 2024 top-3 finish + a 2021 top-10. So 5yr-expansion
    // anchored him on his elite year — but engine never applied OYW
    // because... let's force it. Position-aware aggressive OYW for QBs.
    let oywFired = false;  // v5.11: track to prevent double-firing post-5yr
    if (!isRookie && yearsForOYW >= 3) {
      const allPpgs: number[] = [];
      if (a25 && a25.games >= 10) allPpgs.push(a25.ppg);
      if (a24 && a24.games >= 10) allPpgs.push(a24.ppg);
      if (a23 && a23.games >= 10) allPpgs.push(a23.ppg);
      if (a22 && a22.games >= 10) allPpgs.push(a22.ppg);
      if (a21 && a21.games >= 10) allPpgs.push(a21.ppg);
      if (allPpgs.length >= 3) {
        const maxYr = Math.max(...allPpgs);
        const otherAvg = (allPpgs.reduce((s, v) => s + v, 0) - maxYr) / (allPpgs.length - 1);
        // Check: does proven-vet already cover this? If 3+ qualifying seasons, skip.
        const ppgThreshOYW = p.position === 'QB' ? 17 : p.position === 'TE' ? 9 : 12;
        const qualCount = [a25, a24, a23, a22, a21].filter(
          a => a && a.games >= 15 && a.ppg >= ppgThreshOYW
        ).length;
        // v5.2 (2026-05-18): QBs get a tighter OYW threshold + stronger
        // penalty. Baker case: his 2024 22 ppg was a 1.47× outlier vs his
        // 14-16 ppg prior career. The general 1.40/0.92 wasn't enough.
        const oywRatioThresh = p.position === 'QB' ? 1.30 : 1.40;
        const oywPenalty     = p.position === 'QB' ? 0.88 : 0.92;
        // v5.11 (2026-05-20): ascent exemption for non-QB. If the peak year
        // is the MOST RECENT year (a25), it's a breakout ascending trajectory,
        // not a fluke. JSN sophomore 21 ppg vs Y1 11 ppg = ascent, not OYW.
        // v5.12 (2026-05-20): also exempt sustained breakouts — peak in a24
        // AND a25 within 20% of peak. Nico Collins 17.6/15.1/12.0 trajectory
        // is sustained ascender, not fluke.
        const ascendingPeak = (p.position !== 'QB') && (a25 && a25.ppg >= 10) && (a25.ppg === maxYr);
        const sustainedBreakout = (p.position !== 'QB') && (a25 && a24)
          && (a24.ppg === maxYr) && (a25.ppg >= maxYr * 0.80);
        if (otherAvg > 0 && maxYr / otherAvg >= oywRatioThresh && qualCount < 3
            && !ascendingPeak && !sustainedBreakout) {
          baseline = baseline * oywPenalty;
          baselineSource += ` × OYW regression (peak ${maxYr.toFixed(1)} vs ${otherAvg.toFixed(1)} avg)`;
          oywFired = true;
        }
      }
    }

    // ─── v4.2 (2026-05-17): YOUNG-ELITE-FLOOR (rookie-year-was-elite) ───
    // Catches McConkey-type players: 2nd or 3rd-year pro whose rookie or
    // sophomore year cracked top-15 at position. The talent is established
    // even though the career sample is small. Boost +10% baseline.
    //
    // Position thresholds for "top-15 finish":
    //   QB top-15: ~270 fpts season total
    //   RB top-15: ~190 fpts
    //   WR top-15: ~210 fpts
    //   TE top-10: ~110 fpts (TE pool is smaller)
    const yearsOfDataInline = (has25 ? 1 : 0) + (has24 ? 1 : 0) + (has23 ? 1 : 0);
    if (!isRookie && yearsOfDataInline <= 2 && (p.position === 'WR' || p.position === 'TE' || p.position === 'RB' || p.position === 'QB')) {
      // v5.1 (2026-05-17): QB-specific tighter threshold + smaller boost.
      // Old QB threshold (270 fpts) was too low — Bo Nix/Caleb's decent
      // rookie years qualified, lifting them to top-3 QBs. New QB bar 320+
      // only includes truly elite rookie seasons (Daniels-tier).
      const thresholds: Record<string, number> = { QB: 320, RB: 190, WR: 210, TE: 110 };
      const boosts:     Record<string, number> = { QB: 1.05, RB: 1.10, WR: 1.10, TE: 1.10 };
      const threshold = thresholds[p.position] ?? 180;
      const boost = boosts[p.position] ?? 1.10;
      const careerSeasons: number[] = [];
      if (a25 && a25.games >= 12) careerSeasons.push(a25.ppg * a25.games);
      if (a24 && a24.games >= 12) careerSeasons.push(a24.ppg * a24.games);
      const careerBest = careerSeasons.length ? Math.max(...careerSeasons) : 0;
      if (careerBest >= threshold) {
        baseline = baseline * boost;
        baselineSource += ` + young-elite-floor (${careerBest.toFixed(0)} fpts best, ≥${threshold})`;
      }
    }

    // Fix #1 (v3 2026-05-17): team-change baseline discount for WR/TE.
    // Player's historical baseline reflects their OLD role/team. A WR1 on
    // PIT becomes a WR2 on DAL — their PIT production overstates DAL
    // projection. Discount 15% for WR/TE team-change cases (RB less so
    // because RB workload is more team-dependent and is already captured
    // in role/share). Pickens, Wan'Dale, DJ Moore, Davante Adams cases.
    if (!isRookie && a25?.lastTeam && p.team && a25.lastTeam !== p.team
        && (p.position === 'WR' || p.position === 'TE')) {
      baseline = baseline * 0.85;
      baselineSource += ` × 0.85 team-change (${a25.lastTeam}→${p.team})`;
    }

    // ─── v4.1 (2026-05-17): TEAMMATE-CONTEXT DECOMPOSITION ────────────
    // Decompose 2025 production by whether team's positional alpha was
    // active. If player benefited from alpha's absence (WITHOUT-rate
    // materially higher than WITH-rate), discount baseline assuming alpha
    // is healthy in 2026. Pickens case: 15.0 ppg with Lamb / 24.2 ppg
    // without — projected 2026 (Lamb healthy) ≈ 15.6 ppg, not 17.2.
    //
    // Default assumption: 2026 alpha plays 16/17 games (92% weight).
    // Inverse case (player MISSED games while alpha played) is already
    // handled by expectedGamesV4 → no double-count.
    if (!isRookie && a25 && p.team && (p.position === 'WR' || p.position === 'TE' || p.position === 'RB')) {
      const alpha = p.position === 'RB' ? teamRBAlpha2025[p.team] : teamWRTEAlpha2025[p.team];
      if (alpha && alpha !== p.gsis_id) {
        const alphaWks = playerActiveWeeks.get(alpha) ?? new Set<number>();
        let withPts = 0, withG = 0, withoutPts = 0, withoutG = 0;
        for (const w of a25.weeks) {
          if (alphaWks.has(w.week)) { withPts += w.pts; withG += 1; }
          else { withoutPts += w.pts; withoutG += 1; }
        }
        // Require meaningful split sample
        if (withG >= 3 && withoutG >= 2) {
          const withPpg = withPts / withG;
          const withoutPpg = withoutPts / withoutG;
          const gap = withoutPpg - withPpg;
          // Only adjust when alpha-absence boost is material (≥3 ppg lift)
          // AND directionally correct (player benefited from alpha being out)
          if (gap >= 3.0) {
            // Re-blend assuming 2026 alpha plays 16/17 games (0.92 weight)
            const adjustedPpg = 0.92 * withPpg + 0.08 * withoutPpg;
            const observed25Ppg = (withPts + withoutPts) / (withG + withoutG);
            if (observed25Ppg > 0) {
              const ratio = adjustedPpg / observed25Ppg;
              baseline = baseline * ratio;
              baselineSource += ` × teammate-ctx ${ratio.toFixed(2)} (w/alpha ${withPpg.toFixed(1)} / w/o ${withoutPpg.toFixed(1)})`;
            }
          }
        }
      }
    }

    // ── 5yr EXPANSION TRIGGER (per user spec) ──
    // If player has ≥1 actual top-10 season finish at their position but the
    // 3yr blend wouldn't project them top-10, expand to 5yr to capture
    // elite peak years that recent seasons buried. Position thresholds are
    // the rough top-10 PPG line at each spot.
    const POS_TOP10_PPG_THRESHOLDS: Record<string, number> = {
      QB: 19.0, RB: 15.0, WR: 14.0, TE: 11.0,
    };
    const top10Threshold = POS_TOP10_PPG_THRESHOLDS[p.position] ?? 12.0;
    let fiveYrExpanded = false;  // v5.11: gate post-expansion OYW
    if (!isRookie && eliteCounts.top10 >= 1 && baseline < top10Threshold && (has22 || has21)) {
      const parts5: Array<{ baseW: number; ppg: number; games: number }> = [];
      if (has25) parts5.push({ baseW: 0.30, ppg: r25, games: a25!.games });
      if (has24) parts5.push({ baseW: 0.25, ppg: r24, games: a24!.games });
      if (has23) parts5.push({ baseW: 0.20, ppg: r23, games: a23!.games });
      if (has22) parts5.push({ baseW: 0.15, ppg: r22, games: a22!.games });
      if (has21) parts5.push({ baseW: 0.10, ppg: r21, games: a21!.games });
      const expanded = blend(parts5);
      if (expanded > baseline) {
        baseline = expanded;
        baselineSource = `5yr v3 blend (top-10 expansion: ${eliteCounts.top10}× career top-10)`;
        eliteVetTag = `top-10 history (${eliteCounts.top10}× top-10, ${eliteCounts.top5}× top-5)`;
        fiveYrExpanded = true;
      }
    }

    // ─── v5.2 (2026-05-18): OYW regression POST-5yr-expansion ──────────
    // Has to run AFTER 5yr expansion because expansion overwrites baseline.
    // Catches Baker-class: had a top-10 finish (so 5yr expansion fires)
    // but ALSO has career outlier season (2024 22ppg vs other yrs 10-16).
    // v5.11 (2026-05-20): ONLY fire if 5yr expansion actually fired AND
    // pre-expansion OYW didn't already fire. Previously fired unconditionally
    // → double-firing the penalty on JSN/Nico-class breakouts (0.92² = 0.85).
    if (!isRookie && yearsForOYW >= 3 && fiveYrExpanded && !oywFired) {
      const allPpgsP: number[] = [];
      if (a25 && a25.games >= 10) allPpgsP.push(a25.ppg);
      if (a24 && a24.games >= 10) allPpgsP.push(a24.ppg);
      if (a23 && a23.games >= 10) allPpgsP.push(a23.ppg);
      if (a22 && a22.games >= 10) allPpgsP.push(a22.ppg);
      if (a21 && a21.games >= 10) allPpgsP.push(a21.ppg);
      if (allPpgsP.length >= 3) {
        const maxYrP = Math.max(...allPpgsP);
        const otherAvgP = (allPpgsP.reduce((s, v) => s + v, 0) - maxYrP) / (allPpgsP.length - 1);
        const ppgThreshP = p.position === 'QB' ? 17 : p.position === 'TE' ? 9 : 12;
        const qualCountP = [a25, a24, a23, a22, a21].filter(
          a => a && a.games >= 15 && a.ppg >= ppgThreshP
        ).length;
        const ratioThreshP = p.position === 'QB' ? 1.30 : 1.40;
        const penaltyP     = p.position === 'QB' ? 0.88 : 0.92;
        const ascendingPeakP = (p.position !== 'QB') && (a25 && a25.ppg >= 10) && (a25.ppg === maxYrP);
        const sustainedBreakoutP = (p.position !== 'QB') && (a25 && a24)
          && (a24.ppg === maxYrP) && (a25.ppg >= maxYrP * 0.80);
        if (otherAvgP > 0 && maxYrP / otherAvgP >= ratioThreshP && qualCountP < 3
            && !ascendingPeakP && !sustainedBreakoutP) {
          baseline = baseline * penaltyP;
          baselineSource += ` × OYW regression (peak ${maxYrP.toFixed(1)} vs ${otherAvgP.toFixed(1)} avg)`;
        }
      }
    }

    // ─── v2 (2026-05-16): CEILING-WEIGHTED BASELINE ──────────────────────
    // Players whose recent baseline is materially below their career ceiling
    // are usually injury/role-disruption cases (Wilson NYJ-chaos 2024;
    // McConkey lost target share to LAC offseason additions; Olave 2024
    // concussion year). The recency-weighted blend understates their true
    // talent. Blend in their career-best season at 25-30% weight when the
    // gap is significant (max prior ≥ 1.15× current baseline).
    //
    // Caps: ceiling weight capped at 0.30, only triggers when gap is real,
    // and never used for rookies (no prior data) or elite-vet 5yr blends
    // (which already smoothed multi-year peaks).
    if (!isRookie && !eliteVetStabilize) {
      // Use recencyPpg (same scale as the baseline blend uses) for the
      // ceiling comparison. Raw ppg would mix scales and never trigger
      // for late-season-faded players. Also include the player's BEST
      // raw ppg as a secondary signal — talent is real even if recency
      // suppressed it.
      const priorRecencyPpgs: number[] = [];
      const priorRawPpgs: number[] = [];
      const seasons = [a25, a24, a23, a22, a21];
      for (const s of seasons) {
        if (s && s.games >= 8) {
          priorRecencyPpgs.push(s.recencyPpg);
          priorRawPpgs.push(s.ppg);
        }
      }
      if (priorRecencyPpgs.length >= 2) {
        const ceilingRecency = Math.max(...priorRecencyPpgs);
        const ceilingRaw = Math.max(...priorRawPpgs) * 0.95;
        const ceiling = Math.max(ceilingRecency, ceilingRaw);
        if (ceiling >= baseline * 1.15) {
          const gap = ceiling / baseline;
          const ceilingWeight = Math.min(0.30, 0.15 + (gap - 1.15) * 0.5);
          const newBaseline = baseline * (1 - ceilingWeight) + ceiling * ceilingWeight;
          baseline = newBaseline;
          baselineSource += ` + ceiling ${ceiling.toFixed(1)}@${(ceilingWeight*100).toFixed(0)}%`;
        }
      }
    }

    // ── Vacated workload boost (v2026-05-08) ──
    // Auto-detected: this player is the most-likely heir to a 2025
    // starter who departed their new team. Baseline is multiplied by
    // a tier tied to the vacated volume. See heirs map computation
    // above (RB carries / WR targets / TE targets thresholds).
    const vacancy = heirs.get(p.gsis_id);
    let vacatedMult = 1.0;
    let vacatedNote = '';
    if (vacancy) {
      vacatedMult = vacancy.mult;
      baseline = baseline * vacatedMult;
      vacatedNote = `inherits ${vacancy.departedName} workload (${vacatedMult.toFixed(2)}x, ${Math.round(vacancy.departedVol)} 2025 vol)`;
    }

    // ── Volatility penalty ──
    // High boom/bust profile (CV > 0.7) hurts projections. Apply 0.92x.
    // Only applied when we have meaningful 2025 data (>= 8 games).
    // v2026-05-12e: skip when elite-vet stabilization is firing — the 5yr
    // blend is already smoothing across volatility, so double-counting would
    // unfairly punish proven players (Pitts case: 2 top-10 finishes, doesn't
    // need a separate volatility tax on the already-smoothed baseline).
    let volatilityMult = 1.0;
    if (!eliteVetStabilize && a25 && a25.games >= 8 && a25.volatility > 0.7) {
      volatilityMult = 0.92;
      highVolatility = true;
      baseline = baseline * volatilityMult;
    }

    // ── Sample-size confidence penalty ──
    // 1-year-only:  0.90x  (typically late-season flashers, no track record)
    // 2-year-only:  0.95x  (sophomores — enough to be real, not enough to
    //               project top-tier)
    // QB EXCEPTION (v2026-05-08): a QB whose recent year showed starter-
    // quality production (12+ games, 16+ ppg) gets a milder penalty.
    // Drake Maye and Caleb Williams were systematically undercosted by the
    // standard penalty because their rookie/Y2 seasons were genuinely good
    // — sophomore breakouts at QB are a real pattern.
    let sampleSizePenalty = false;
    const yearsOfData = (has25 ? 1 : 0) + (has24 ? 1 : 0) + (has23 ? 1 : 0);
    const hadStarterRecentYear =
      p.position === 'QB' && a25 && a25.games >= 12 && a25.ppg >= 16;
    // v5.9 (2026-05-19): proven-sophomore exemption. A sophomore whose
    // rookie year was ≥10 ppg already has strong NFL evidence; the 0.80
    // penalty was treating Jeanty (14.3 ppg as R) like an unproven flier.
    const provenSophomore = isSophomore && r25 >= 10.0;
    if (yearsOfData === 1 && !isRookie && !provenSophomore) {
      // v4.2 (2026-05-17): tightened from 0.90 to 0.80. Single-year samples
      // are unreliable; engine was over-projecting 1yr-data players (esp.
      // sophomores whose rookie year became their only baseline anchor).
      baseline = baseline * (hadStarterRecentYear ? 0.92 : 0.80);
      sampleSizePenalty = true;
    } else if (yearsOfData === 2 && !isRookie) {
      baseline = baseline * (hadStarterRecentYear ? 0.97 : 0.92);
      sampleSizePenalty = true;
    }

    // ─── v4.2 (2026-05-17): PROVEN-CONSISTENCY VET BOOST ───────────────
    // Rewards multi-year established producers. Engine was systematically
    // under-valuing track-record vets (Wilson, Hill, Adams, etc.) vs
    // unproven sophomores.
    //
    // Logic: look at the player's full 5-yr window. Count seasons that
    // qualify as "meaningful production" (15+g AND ppg ≥ position threshold).
    // - 3+ qualifying seasons: +6% (proven vet)
    // - 2 qualifying + 1+ recent year of data: +3% (established but recent gap)
    //
    // Catches Hill (3+ elite seasons 2021-2023, even though 2024-2025 dropped)
    // and Wilson (3+ consistent 2022-2024 even though 2025 was injury-shortened).
    // v5 (2026-05-17): scaled proven-vet boost. 3 qual = +6%, 4 = +9%, 5 = +12%.
    // Hill (5 career elite seasons) deserves more weight than a 3-yr vet.
    // Closes the gap on chronic-injury elites where industry bets on bounce-back.
    if (!isRookie && (p.position === 'WR' || p.position === 'TE' || p.position === 'RB' || p.position === 'QB')) {
      const ppgThresh = p.position === 'QB' ? 17 : p.position === 'TE' ? 9 : 12;
      const consistentSeasons = [a25, a24, a23, a22, a21].filter(
        a => a && a.games >= 15 && a.ppg >= ppgThresh
      ).length;
      let vetMult = 1.0;
      let vetLabel = '';
      if      (consistentSeasons >= 5) { vetMult = 1.12; vetLabel = `5-qual-vet (+12%)`; }
      else if (consistentSeasons === 4) { vetMult = 1.09; vetLabel = `4-qual-vet (+9%)`; }
      else if (consistentSeasons === 3) { vetMult = 1.06; vetLabel = `3-qual-vet (+6%)`; }
      else if (consistentSeasons === 2 && (has25 || has24)) { vetMult = 1.03; vetLabel = `emerging-vet (+3%)`; }
      if (vetMult > 1.0) {
        baseline = baseline * vetMult;
        baselineSource += ` + ${vetLabel}`;
      }
    }

    // ── Breakout-year regression (v2026-05-08) ──
    // Single hot recent year on a non-elite track record → don't trust
    // it fully. Lawrence case: 2025 was a career year (20.1 ppg, last-6
    // 26.8) but prior 4 years were 12-18 ppg; recency-3x weighting was
    // projecting him QB3.
    let breakoutRegression = false;
    if (has25 && (has24 || has23)) {
      const priorPpgAvg = ((has24 ? a24!.ppg : 0) + (has23 ? a23!.ppg : 0)) /
                          ((has24 ? 1 : 0) + (has23 ? 1 : 0) || 1);
      const eliteCount = (eliteVetMap.get(p.gsis_id)?.top10 ?? 0);
      // v2026-05-08: tightened threshold 1.20 → 1.15. The 1.20 bar was
      // too loose — Jerry Jeudy's 2024 was 1.4× his prior avg with 1×
      // top-10 finish (eliteCount=1, satisfied <2), but he STILL ranked
      // WR13 because the 0.93x penalty was barely enough. Tightening
      // catches more single-elite-year profiles.
      // v2026-05-16: return-to-form exemption. If ANY prior year (within
      // the 5yr window) was ≥80% of 2025 ppg, this isn't a breakout — it's
      // a return to peak after an off/injury year. Olave case: 2024 concussion
      // year (9 ppg) dragged priorPpgAvg down, making his healthy 2025 (14)
      // look like a breakout vs his real 2023 baseline (13.2). Without this,
      // every injury-year-then-healthy WR gets falsely flagged.
      const priorPpgs = [a24?.ppg, a23?.ppg, a22?.ppg, a21?.ppg].filter((p): p is number => typeof p === 'number');
      const maxPriorPpg = priorPpgs.length > 0 ? Math.max(...priorPpgs) : 0;
      const isReturnToForm = maxPriorPpg > 0 && a25!.ppg <= 1.20 * maxPriorPpg;
      if (priorPpgAvg > 0 && a25!.ppg > 1.15 * priorPpgAvg && eliteCount < 2 && !isReturnToForm) {
        // v2026-05-11: smarter gate — exempt true alphas. The flat 0.85×
        // penalty was hitting legit ascensions (JSN at 36% team tgts,
        // Drake London at 29%, Chase Brown workhorse) the same as
        // one-hit-wonder noise. Exempt if WR/TE has ≥25% team target
        // share, RB has ≥60% team carries, or QB has top-3 draft
        // capital in Y1/Y2.
        let isExemptAlpha = false;
        if (p.position === 'WR' || p.position === 'TE') {
          const myT = teamReceiverTargets[p.team ?? '']?.[p.gsis_id] ?? 0;
          const totT = teamTotalReceiverTargets[p.team ?? ''] ?? 0;
          const rawShare = totT > 0 ? myT / totT : 0;
          // v2026-05-12: use dilution-adjusted share so offseason competition
          // (Tyson + Etienne arriving on NO) doesn't grandfather Olave's
          // 2025 alpha status into 2026 immunity from breakout regression.
          const dil = Math.min(0.20, teamShareDilution[p.team ?? ''] ?? 0);
          const share = rawShare * (1 - dil);
          if (share >= 0.25) isExemptAlpha = true;
        } else if (p.position === 'RB') {
          const myC = teamRusherCarries[p.team ?? '']?.[p.gsis_id] ?? 0;
          const totC = teamTotalRBCarries[p.team ?? ''] ?? 0;
          const share = totC > 0 ? myC / totC : 0;
          if (share >= 0.60) isExemptAlpha = true;
        } else if (p.position === 'QB' && p.draft_round === 1 && (p.draft_pick ?? 100) <= 3) {
          const careerGames = (a25?.games ?? 0) + (a24?.games ?? 0) + (a23?.games ?? 0);
          if (careerGames <= 17) isExemptAlpha = true; // Year-1/Year-2 top-3 QB
        }
        if (!isExemptAlpha) breakoutRegression = true;
      }
    }

    // ── Career inconsistency penalty (v2026-05-08) ──
    // Players with 5 years of data and ≥2 years where PPG was <70% of
    // their best year are roller-coaster profiles, not sustained tier-1.
    // Baker case: 2024 21.3, 2023 17.4, but 2021/2022 were 13.3/10.3 —
    // 3yr blend ignores those weak years entirely, projecting him QB2.
    // Catches volatile QBs (Baker, Tannehill-type, Geno Smith profile).
    let inconsistencyPenalty = false;
    const yearsForVar: number[] = [];
    if (has25 && a25!.games >= 8) yearsForVar.push(a25!.ppg);
    if (has24 && a24!.games >= 8) yearsForVar.push(a24!.ppg);
    if (has23 && a23!.games >= 8) yearsForVar.push(a23!.ppg);
    if (has22 && a22!.games >= 8) yearsForVar.push(a22!.ppg);
    if (has21 && a21!.games >= 8) yearsForVar.push(a21!.ppg);
    if (yearsForVar.length === 5) {
      const bestPpg = Math.max(...yearsForVar);
      const lowYears = yearsForVar.filter(p => p < 0.70 * bestPpg).length;
      // v2026-05-08: inconsistency penalty only fires when the durability
      // mult ISN'T already heavy. If recent-3yr games avg is <14, the
      // player's volatility is driven by injury absence, which the
      // durability mult is already penalizing. Olave case: chronic 12-13
      // game seasons + low PPG in those years was triggering both
      // inconsistency AND durability — double-counting the same problem.
      const recentGamesSum = (a25?.games ?? 0) + (a24?.games ?? 0) + (a23?.games ?? 0);
      const recentGamesCount = (has25?1:0) + (has24?1:0) + (has23?1:0);
      const recentGamesAvg = recentGamesCount > 0 ? recentGamesSum / recentGamesCount : 0;
      if (lowYears >= 2 && recentGamesAvg >= 14) inconsistencyPenalty = true;
    }
    // v2026-05-12e: skip inconsistency penalty when elite-vet stabilization
    // is firing — the 5yr blend is already smoothing across the same
    // up-and-down years that the inconsistency rule is flagging.
    if (eliteVetStabilize) inconsistencyPenalty = false;

    // Apply at most ONE of {breakout regression, inconsistency} —
    // both reflect "don't trust the recency signal." WR breakout gets
    // a stronger penalty (0.85×) because WRs have the highest year-to-
    // year volatility — single-elite-year over-projections like Jeudy
    // need a steeper correction. Other positions stay at 0.93×.
    // v2 (2026-05-16): breakout regression DISABLED. Was over-firing on
    // return-to-form cases (Olave 2025 after 2024 concussion). The recency-
    // weighted baseline + sample-size logic already deweight one-year spikes.
    // Inconsistency penalty kept — captures volatile profiles distinctly.
    if (inconsistencyPenalty) {
      baseline = baseline * 0.93;
    }

    // v2026-05-12c: late-season tear bonus.
    // recencyPpg already weights wks 10-13 ×2 and wks 14-17 ×3 — if it's
    // materially above full-season PPG, the player closed the year ascending.
    // Threshold loosened from 1.25× to 1.15× to catch real risers like
    // Olave whose fantasy-playoff stretch is captured but not extreme over
    // the full recency window. Caps at +6%.
    let lateSeasonBonus = 1.0;
    let lateSeasonNote = '';
    if (a25 && a25.games >= 10 && a25.ppg > 0 && a25.recencyPpg > a25.ppg * 1.15) {
      const delta = a25.recencyPpg / a25.ppg - 1;
      const adj = Math.min(0.06, delta * 0.25);
      if (adj >= 0.02) {
        lateSeasonBonus = 1.0 + adj;
        lateSeasonNote = `late-season tear +${(adj * 100).toFixed(0)}% (recency ${a25.recencyPpg.toFixed(1)} vs season ${a25.ppg.toFixed(1)})`;
        baseline = baseline * lateSeasonBonus;
      }
    }

    // ── Injury discount ──
    // Cross-ref ESPN injury feed by normalized name. Aggressive: serious
    // \"Out\" injuries (ACL/Achilles/etc) drop score by 90%.
    // Note: injuryNameKey is hoisted to the top of the loop in v2.5 so
    // the injury-rebound logic can reference it.
    const injInfo = injuryMap.get(injuryNameKey);
    let injuryMult = 1.0;
    let injuryNote = '';
    // v2.5.3: only apply injury penalty for severe statuses.
    // Skip "Unspecified", "Questionable", "Probable" -- those are noise.
    if (injInfo && injInfo.multiplier < 1.0) {
      const severity = (injInfo.severity ?? injInfo.status ?? '').toLowerCase();
      const isSerious = severity.includes('out') ||
                        severity.includes('ir') ||
                        severity.includes('pup') ||
                        severity.includes('doubtful');
      if (isSerious) {
        injuryMult = injInfo.multiplier;
        baseline = baseline * injuryMult;
        injuryNote = `INJURY: ${injInfo.injury} (${injuryMult.toFixed(2)}x)`;
      }
    }

    // ── Durability multiplier (v2026-05-07, Tier 1 injury layer) ──
    // The current-injury feed only reflects acute status. Players with
    // chronic games-missed history (Higgins ~12g/yr, Aiyuk, Olave) get
    // full per-game credit otherwise -- which overrates them because
    // total fantasy points scale with games played, not just PPG.
    //
    // Compute mean games over seasons where the player has a meaningful
    // sample (>=4 games), require 2+ years for signal. Skip rookies.
    // Tiered multiplier: 16+ → 1.00, 14-15 → 0.95, 12-13 → 0.88,
    // 10-11 → 0.80, <10 → 0.70.
    let durabilityMult = 1.0;
    let avgGames = 0;
    if (!isRookie) {
      const gameCounts: number[] = [];
      if (has25) gameCounts.push(a25!.games);
      if (has24) gameCounts.push(a24!.games);
      if (has23) gameCounts.push(a23!.games);
      if (gameCounts.length >= 2) {
        avgGames = gameCounts.reduce((s, g) => s + g, 0) / gameCounts.length;
        // v2026-05-16: tightened to better match actual availability cost.
        // Old curve docked chronic missers only 12% (0.88x at 13g) despite
        // them missing ~24% of games. PPG-over-replacement framing means
        // missed games already cost season total — but the penalty must be
        // strong enough to push them out of top-10 PPG rankings when their
        // actual season finishes are WR15-25.
        if (avgGames >= 16)      durabilityMult = 1.00;
        else if (avgGames >= 15) durabilityMult = 0.92;
        else if (avgGames >= 14) durabilityMult = 0.87;
        else if (avgGames >= 13) durabilityMult = 0.82;
        else if (avgGames >= 12) durabilityMult = 0.78;
        else if (avgGames >= 11) durabilityMult = 0.73;
        else if (avgGames >= 10) durabilityMult = 0.68;
        else                     durabilityMult = 0.60;
        // v4 (2026-05-17): DO NOT apply durability to baseline. Season-total
        // framing handles availability via expectedGamesV4 — multiplying
        // baseline by durability would double-count missed games.
        // baseline = baseline * durabilityMult;  // disabled for v4
      }
    }

    let ageMult = ageCurve(p.position, age);

    // ─── v5.8 (2026-05-19): RB-SPECIFIC POSITION ALGORITHM ─────────────
    // RBs need their own scoring rules. Workload accumulates damage,
    // year-after-RB1 finishers regress, and late-career elites who hit
    // top-10 recently defy the age cliff. All applied as RULES, not patches.
    if (p.position === 'RB' && !isRookie) {
      // Compute 3yr rolling workload (carries + targets ≈ touches/opportunities)
      const workloads: number[] = [];
      for (const agg of [a25, a24, a23]) {
        if (agg && agg.games >= 8) {
          const tc = (agg.weeks || []).reduce((s, w) => s + (w.carries || 0), 0);
          const tt = (agg.weeks || []).reduce((s, w) => s + (w.targets || 0), 0);
          workloads.push(tc + tt);
        }
      }
      const avgWorkload = workloads.length > 0
        ? workloads.reduce((s, w) => s + w, 0) / workloads.length
        : 0;

      // RB Rule 1: workload modifier on age curve, but ONLY for RBs at/past peak.
      // Young RBs (≤26) with heavy workload aren't accumulating damage yet —
      // they're built for it. Damage compounds when workload meets aging.
      // Jeanty fix: age 21 + 320 touches = no penalty. CMC age 30 + 320 = penalty.
      let workloadMod = 1.00;
      let wlNote = '';
      if (age >= 27) {
        if (avgWorkload >= 320) { workloadMod = 0.93; wlNote = `elite-workhorse workload ${avgWorkload.toFixed(0)} at age ${age} (×0.93)`; }
        else if (avgWorkload >= 260) { workloadMod = 0.97; wlNote = `heavy workload ${avgWorkload.toFixed(0)} at age ${age} (×0.97)`; }
        else if (avgWorkload < 150 && avgWorkload > 0) { workloadMod = 1.03; wlNote = `light-touch workload ${avgWorkload.toFixed(0)} (×1.03 preservation)`; }
      }

      // RB Rule 2: late-career age-defiance — vets 29+ with recent top-10 finish
      // pull their age multiplier halfway back toward 1.0. Henry 32 with RB8
      // 2025 (280 fpts) → 0.42 → 0.65. Honors actual production over population avg.
      let defyNote = '';
      if (age >= 29) {
        const recentTop10 = [
          (a25 && a25.games >= 12 && a25.ppg * a25.games >= 240),
          (a24 && a24.games >= 12 && a24.ppg * a24.games >= 240),
        ].filter(Boolean).length;
        if (recentTop10 >= 1 && ageMult < 1.0) {
          // v5.8: 30% pull toward 1.0 (was 40%). Softens cliff without
          // promoting vets over prime-age workhorses with similar profiles.
          const softened = ageMult + (1 - ageMult) * 0.30;
          defyNote = `age-defiance softens ${ageMult.toFixed(2)}→${softened.toFixed(2)} (recent top-10 finish)`;
          ageMult = softened;
        }
      }
      // Apply workload mod to (potentially defiance-softened) ageMult
      if (workloadMod !== 1.00) ageMult = ageMult * workloadMod;
      if (wlNote || defyNote) {
        baselineSource += ` | RB: ${[wlNote, defyNote].filter(Boolean).join(' + ')}`;
      }

      // RB Rule 3: year-after-RB1-finish regression
      // RB1-tier finishers (350+ fpts) typically regress ~12% YoY
      // due to career-high workload + bad-luck-mean-reversion + age progression.
      // Fires on CMC 2025 (417 fpts).
      if (a25 && a25.games >= 15) {
        const a25Total = a25.ppg * a25.games;
        if (a25Total >= 350) {
          baseline = baseline * 0.88;
          baselineSource += ` × RB1-finish regression (was ${a25Total.toFixed(0)} fpts; -12%)`;
        }
      }
    }
    let teamMult = teamChangeAdj(a25?.lastTeam ?? a24?.lastTeam ?? null, p.team);
    // Weak-team penalty (v2.5): skill-position players on tier-5 offenses
    // (currently NE, NYG) get a 0.95x dampener. Will be replaced with
    // Vegas implied team total when nfl_season_win_totals is populated.
    let weakTeamPenalty = false;
    if (['QB', 'RB', 'WR', 'TE'].includes(p.position) && (OFFENSE_TIER_2024[p.team ?? ''] ?? 3) >= 5) {
      teamMult = teamMult * 0.95;
      weakTeamPenalty = true;
    }
    // Rookie ladder (v2.5.2): position-specific boosts based on
    // historical hit rates of high draft capital rookies.
    //   Top-10 RB/WR:  +35% (Bijan, Saquon, Chase template)
    //   Top-10 QB/TE:  +30% (slower curves at those positions)
    //   R1 picks 11-32: +20% (still elite capital)
    //   R2: +10%, R3: +5%, R4+: 0%.
    let rookieBoost = 0;
    if (isRookie) {
      const pick = p.draft_pick;
      const round = p.draft_round;
      // v2.5.3: QB rookies capped at 0.10 max regardless of capital.
      // R1 QBs need a season of NFL data before getting top-10 QB
      // valuation -- Mendoza at QB8 was unrealistic for a Year-1.
      if (p.position === 'QB') {
        if (round === 1) rookieBoost = 0.10;
        else rookieBoost = 0;
      } else if (typeof pick === 'number' && pick <= 10) {
        // v2026-05-07: WR rookies dropped from 0.35 → 0.25. Top-10 rookie
        // WRs were leapfrogging established alphas in Standard (Tate at
        // WR2 ahead of Chase/Amon-Ra) because the 35% boost compounded
        // with the rookie default baseline + scarcity multiplier. RB stays
        // at 35% (Bijan/Saquon historical-hit-rate template).
        if (p.position === 'RB')      rookieBoost = 0.35;
        else if (p.position === 'WR') rookieBoost = 0.25;
        else                           rookieBoost = 0.30; // TE
      } else if (round === 1) rookieBoost = 0.20;
      else if (round === 2) rookieBoost = 0.10;
      else if (round === 3) rookieBoost = 0.05;
      else rookieBoost = 0;
    }
    // v2026-05-08: opp adj asymmetric handling under elite-vet
    // stabilization. Negative opp adj = late-season collapse, which the
    // 5yr blend already deweights -> double-count, neutralize.
    // Positive opp adj = late-season rebound (Burrow post-injury) ->
    // real forward-looking signal, keep as is.
    const rawOppAdj = a25 ? opportunityAdj(a25.weeks) : 0;
    // v3: zero out opp-trend for (a) injury-shortened seasons (<10 of 17g)
    // and (b) sophomores — a rookie's within-season H1/H2 pattern reflects
    // role-finding noise more than predictive 2026 signal. McMillan case:
    // CAR was a bad team, his late-season weeks were partly trash time;
    // -8% penalty on his 2026 projection makes no sense.
    const injuryShortened = !!(a25 && a25.games < 10);
    // v5.2 (2026-05-18): also skip opp-signals for team-change WR/TEs.
    // Wan'Dale case: his NYG late-2025 trend doesn't predict his TEN role.
    // His old-team H1/H2 share spike is irrelevant for the new context.
    const teamChangedWR = (p.position === 'WR' || p.position === 'TE')
                       && a25?.lastTeam && p.team && a25.lastTeam !== p.team;
    const skipOppSignals = injuryShortened || isSophomore || teamChangedWR;
    const oppAdj = skipOppSignals ? 0 : ((eliteVetStabilize && rawOppAdj < 0) ? 0 : rawOppAdj);
    const formatAdj = formatPositionAdj(format, p.position, age);

    // ── System context multiplier (Tier 1, v2026-05-07) ──
    // Captures team-level dependency / usage concentration, orthogonal to
    // opportunityAdj (which is within-season trend). Applied as a final
    // forwardLayer factor, ±3% range.
    let sysCtxMult = 1.0;
    let sysCtxNote = '';
    const playerTeam = p.team ?? '';
    if (p.position === 'QB') {
      const conc = teamTop3Concentration[playerTeam];
      if (conc !== undefined) {
        if (conc > 0.65)      { sysCtxMult = 0.97; sysCtxNote = `concentrated offense -3% (top3 ${(conc*100).toFixed(0)}%)`; }
        else if (conc < 0.50) { sysCtxMult = 1.03; sysCtxNote = `broad cast +3% (top3 ${(conc*100).toFixed(0)}%)`; }
      }
    } else if (p.position === 'WR' || p.position === 'TE') {
      const teamChanged = !!(a25?.lastTeam && a25.lastTeam !== p.team);
      const myT = teamReceiverTargets[playerTeam]?.[p.gsis_id] ?? 0;
      // v2 (2026-05-16): SHARE-WHEN-ACTIVE. Use team targets ONLY from the
      // weeks the player was active. Otherwise Garrett Wilson (7g/59 tgts)
      // shows up as 10% share (59/600 season-total) instead of his real
      // ~24% (59/250 over his weeks). Same bug torched Olave/Rice/McConkey.
      const playerWeeks = (agg2025.get(p.gsis_id)?.weeks ?? []).map(w => w.week);
      const totTActive = teamTgtsActive(playerTeam, playerWeeks);
      const totT = totTActive > 0 ? totTActive : (teamTotalReceiverTargets[playerTeam] ?? 0);
      const rawShare = totT > 0 ? myT / totT : 0;
      const dil = Math.min(0.20, teamShareDilution[playerTeam] ?? 0);
      const share = rawShare * (1 - dil);
      if (teamChanged) {
        // v5.2 (2026-05-18): smarter team-change share treatment. Instead
        // of flat reset to neutral, check if the destination team drafted
        // a top-15 WR THIS year (Tate to TEN). If so, the incoming WR is
        // likely WR2 → apply -5% band. If the team drafted a top-5 WR,
        // even harsher (-8%). Otherwise neutral (Pickens to DAL case).
        let teamGotEliteRookieWR = false;
        let teamGotTop5WR = false;
        for (const otherP of players) {
          if (otherP.team !== p.team) continue;
          if (otherP.position !== 'WR') continue;
          if (otherP.draft_year !== asOfSeason) continue;  // 2026 rookie
          if (otherP.draft_round === 1) {
            teamGotEliteRookieWR = true;
            if ((otherP.draft_pick ?? 99) <= 5) teamGotTop5WR = true;
          }
        }
        if (teamGotTop5WR) {
          sysCtxMult = 0.92;
          sysCtxNote = `team change behind top-5 rookie WR ${a25!.lastTeam}→${p.team} (-8%)`;
        } else if (teamGotEliteRookieWR) {
          sysCtxMult = 0.95;
          sysCtxNote = `team change behind R1 rookie WR ${a25!.lastTeam}→${p.team} (-5%)`;
        } else {
          sysCtxMult = 1.0;
          sysCtxNote = `team change — share reset (${a25!.lastTeam}→${p.team})`;
        }
      } else if (myT > 0) {
        // v2026-05-11: graduated target-share bands. The previous neutral
        // 0.10-0.25 zone over-rewarded WR2s in elite offenses (Higgins 18%,
        // Williams 22-28%) — their score was driven by per-target efficiency,
        // QB cast, and TD history compounding on top of pedestrian volume.
        const dilTag = dil > 0.05 ? `, diluted -${(dil*100).toFixed(0)}% by new arrivals` : '';
        // v2026-05-16: when teammate alpha share ≥ 28%, the non-alpha WRs
        // take a stiffer penalty. Higgins/Pickens case: a "WR2 zone" share
        // isn't equivalent across teams — behind Chase (30% share) it's
        // much worse than behind a 23% top-WR.
        //
        // Guard against false-positives: if I AM the team's historical alpha,
        // I'm not "behind" anyone — my share got diluted by new arrivals but
        // I'm still the primary. Olave case: 2025 NO alpha at 30%, projected
        // 2026 share 22% (Tyson drafted). Without this guard he'd be tagged
        // as "behind himself."
        const myRawTgts = teamReceiverTargets[playerTeam]?.[p.gsis_id] ?? 0;
        const teamSortedTgts = Object.values(teamReceiverTargets[playerTeam] ?? {}).sort((a, b) => b - a);
        const iAmTeamAlpha = myRawTgts > 0 && myRawTgts === (teamSortedTgts[0] ?? 0);
        const stuckBehindAlpha = !iAmTeamAlpha && (teamAlphaShare[playerTeam] ?? 0) >= 0.28;
        // v5.14 (2026-05-20): TE-specific share bands. TEs typically earn
        // 14-22% of team targets as their alpha role — penalizing them as
        // "WR2 zone" because they're not above 25% wrongly crushed every
        // legit TE1 in the league. Kelce, Ferguson, Hunter Henry, Goedert
        // all fell to TE17-19 from this bug. TE thresholds reflect actual
        // TE1 usage patterns.
        if (p.position === 'TE') {
          if (share >= 0.22) {
            // McBride/Bowers-tier — premium TE1 alpha
            sysCtxMult = 1.05;
            sysCtxNote = `TE1 alpha +5% (${(share*100).toFixed(0)}% team tgts${dilTag})`;
          } else if (share >= 0.14) {
            // Standard TE1 — neutral (this is just doing your job as TE1)
            sysCtxMult = 1.00;
            sysCtxNote = `TE1 standard (${(share*100).toFixed(0)}% team tgts${dilTag})`;
          } else if (share >= 0.10) {
            sysCtxMult = 0.95;
            sysCtxNote = `TE2 zone -5% (${(share*100).toFixed(0)}% team tgts${dilTag})`;
          } else {
            sysCtxMult = 0.90;
            sysCtxNote = `TE depth -10% (${(share*100).toFixed(0)}% team tgts${dilTag})`;
          }
        } else if (share >= 0.25)      {
          // WR bands below (unchanged for WRs)
          // v5.13c (2026-05-20): alpha-dilution made real. When new arrivals
          // (team-change WR or top-10 rookie WR) consumed >5% of share,
          // reduce alpha read proportionally. JJ + Jennings case: dil=0.07
          // → 1.03 × 0.93 = 0.96. Adams-stayed-LAR doesn't trigger (no
          // consumed share). Only new mouths matter.
          if (dil > 0.05) {
            sysCtxMult = 1.03 * (1 - dil);
            sysCtxNote = `alpha read diluted to ${sysCtxMult.toFixed(2)}x (${(share*100).toFixed(0)}% team tgts${dilTag})`;
          } else {
            sysCtxMult = 1.03;
            sysCtxNote = `alpha read +3% (${(share*100).toFixed(0)}% team tgts${dilTag})`;
          }
        }
        else if (share >= 0.20) {
          if (stuckBehindAlpha) { sysCtxMult = 0.94; sysCtxNote = `mid-share behind ${(teamAlphaShare[playerTeam]*100).toFixed(0)}% alpha -6% (${(share*100).toFixed(0)}% team tgts${dilTag})`; }
          else                  { sysCtxMult = 1.00; sysCtxNote = `mid-share (${(share*100).toFixed(0)}% team tgts${dilTag})`; }
        }
        else if (share >= 0.15) {
          if (stuckBehindAlpha) { sysCtxMult = 0.91; sysCtxNote = `WR2 behind ${(teamAlphaShare[playerTeam]*100).toFixed(0)}% alpha -9% (${(share*100).toFixed(0)}% team tgts${dilTag})`; }
          else                  { sysCtxMult = 0.95; sysCtxNote = `WR2 zone -5% (${(share*100).toFixed(0)}% team tgts${dilTag})`; }
        }
        else if (share >= 0.10) { sysCtxMult = 0.93; sysCtxNote = `depth -7% (${(share*100).toFixed(0)}% team tgts${dilTag})`; }
        else                    { sysCtxMult = 0.90; sysCtxNote = `complementary -10% (${(share*100).toFixed(0)}% team tgts${dilTag})`; }
      }
    } else if (p.position === 'RB') {
      const myC = teamRusherCarries[playerTeam]?.[p.gsis_id] ?? 0;
      // v2 (2026-05-16): share-when-active for RBs too
      const playerWeeksRb = (agg2025.get(p.gsis_id)?.weeks ?? []).map(w => w.week);
      const totCActive = teamCarActive(playerTeam, playerWeeksRb);
      const totC = totCActive > 0 ? totCActive : (teamTotalRBCarries[playerTeam] ?? 0);
      const share = totC > 0 ? myC / totC : 0;
      if (myC > 0) {
        if (share > 0.60)      { sysCtxMult = 1.03; sysCtxNote = `workhorse +3% (${(share*100).toFixed(0)}% team carries)`; }
        else if (share < 0.30) { sysCtxMult = 0.97; sysCtxNote = `RBBC -3% (${(share*100).toFixed(0)}% team carries)`; }
      }
    }

    const playerLastTeam = a25?.lastTeam ?? a24?.lastTeam ?? null;
    const cast = castMultFor(p.team ?? null, p.position, playerLastTeam);
    // v3: same gate for share trend — zero for injury-shortened OR sophomore
    const rawTrend = targetShareTrend(p);
    const trend = skipOppSignals ? { mult: 1.0, note: '' } : rawTrend;

    // v2026-05-11: cap QB-cast boost for low-share receivers. Prevents
    // "elite QB + WR2 with 18% target share" from stacking into top-10.
    // Higgins case: was getting +5% on Burrow despite 18% team tgt share.
    let effectiveCastMult = cast.mult;
    let effectiveCastNote = cast.note;
    if ((p.position === 'WR' || p.position === 'TE') && cast.mult > 1.02) {
      const myT_qc = teamReceiverTargets[p.team ?? '']?.[p.gsis_id] ?? 0;
      // v2 (2026-05-16): share-when-active here too
      const wks_qc = (agg2025.get(p.gsis_id)?.weeks ?? []).map(w => w.week);
      const totTAct_qc = teamTgtsActive(p.team ?? '', wks_qc);
      const totT_qc = totTAct_qc > 0 ? totTAct_qc : (teamTotalReceiverTargets[p.team ?? ''] ?? 0);
      const rawShare_qc = totT_qc > 0 ? myT_qc / totT_qc : 0;
      const dil_qc = Math.min(0.20, teamShareDilution[p.team ?? ''] ?? 0);
      const share_qc = rawShare_qc * (1 - dil_qc);
      // v2026-05-12: cap +2% if low diluted share (Higgins/Williams case).
      if (share_qc > 0 && share_qc < 0.22) {
        effectiveCastMult = 1.02;
        effectiveCastNote = `QB cast +2% (capped, low share ${(share_qc*100).toFixed(0)}%)`;
      }
      // v2026-05-12d: cap +3% for team-change players — Okonkwo case where
      // TEN→WAS handed him max QB cast benefit despite role uncertainty.
      const teamChanged_qc = !!(a25?.lastTeam && a25.lastTeam !== p.team);
      if (teamChanged_qc && effectiveCastMult > 1.03) {
        effectiveCastMult = 1.03;
        effectiveCastNote = `QB cast +3% (capped, new team)`;
      }
    }

    // ── Depth chart multiplier (v2026-05-09, production only) ──
    // Sleeper depth_chart_order indicates current playing role. Softer
    // for WR/TE (multiple slot starters per team) than RB/QB (one
    // starter usually). Disabled in backtest (depth chart not historical).
    let depthMult = 1.0;
    let depthNote = '';
    if (DEPTH_CHART_MULTIPLIER_ENABLED && !isBacktest) {
      const dco = (p as any).depth_chart_order;
      if (typeof dco === 'number' && dco > 0) {
        if (p.position === 'QB') {
          if (dco === 2)      depthMult = 0.40;
          else if (dco >= 3)  depthMult = 0.20;
        } else if (p.position === 'RB') {
          if (dco === 2)      depthMult = 0.92;
          else if (dco === 3) depthMult = 0.80;
          else if (dco >= 4)  depthMult = 0.65;
        } else if (p.position === 'WR' || p.position === 'TE') {
          if (dco === 2)      depthMult = 0.98;
          else if (dco === 3) depthMult = 0.93;
          else if (dco >= 4)  depthMult = 0.85;
        }
        if (depthMult < 1.0) {
          depthNote = `depth ${(p as any).depth_chart_position ?? p.position}${dco} (${depthMult.toFixed(2)}x)`;
        }
      }
    }

    // ── Receiving efficiency (EPA per target) (v2026-05-08) ──
    // Sticky talent measure for WR/TE: average expected points added
    // per target across the most recent year. High EPA/T → efficient
    // receiver who converts opportunity → boost. Low → inefficient → fade.
    let epaMult = 1.0;
    let epaNote = '';
    if ((p.position === 'WR' || p.position === 'TE') && a25 && a25.games >= 8 && Math.abs(a25.epaPerTarget) > 0) {
      const ept = a25.epaPerTarget;
      // Calibration: avg EPA/target across NFL is ~0. Top-tier receivers
      // at +0.30, busts at -0.20. Cap at ±4%.
      let adj = 0;
      if (ept >= 0.40)      adj = 0.04;
      else if (ept >= 0.20) adj = 0.025;
      else if (ept >= 0.10) adj = 0.01;
      else if (ept <= -0.30) adj = -0.04;
      else if (ept <= -0.15) adj = -0.025;
      else if (ept <= -0.05) adj = -0.01;
      if (Math.abs(adj) > 0) {
        epaMult = 1.0 + adj;
        epaNote = `EPA/T ${adj > 0 ? '+' : ''}${(adj * 100).toFixed(1)}% (${ept.toFixed(2)})`;
      }
    }

    // ── WOPR luck regression (v2026-05-08, WR/TE only) ──
    // WOPR (1.5*target_share + 0.7*air_yards_share) is a sticky measure
    // of opportunity quality. Compare expected PPG from WOPR to actual
    // recent PPG. Players who underperformed their opportunity (high
    // WOPR, low PPG) are due for upside. Over-performers (low WOPR,
    // high PPG via TD luck) are regression candidates.
    let woprMult = 1.0;
    let woprNote = '';
    // WR-only — TE WOPR distribution is shifted lower (TEs run fewer
    // routes), so the WR-calibrated formula misfires on them.
    if (p.position === 'WR' && a25 && a25.games >= 8 && a25.avgWopr > 0) {
      // Linear calibration: PPG ≈ 5 + 22*WOPR (approximation).
      // WOPR 0.30 → ~12 PPG, 0.50 → ~16, 0.70 → ~20.
      const expectedPpg = 5 + 22 * a25.avgWopr;
      const actualPpg = a25.ppg;
      if (expectedPpg > 0) {
        const delta = (actualPpg - expectedPpg) / expectedPpg;
        if (delta < -0.15) {
          woprMult = 1.05;  // underperformed opportunity → upside regression
          woprNote = `WOPR upside +5% (${a25.avgWopr.toFixed(2)} WOPR, ${actualPpg.toFixed(1)} vs ${expectedPpg.toFixed(1)} exp)`;
        } else if (delta > 0.15) {
          woprMult = 0.95;  // overperformed opportunity → regression candidate
          woprNote = `WOPR regress -5% (${a25.avgWopr.toFixed(2)} WOPR, ${actualPpg.toFixed(1)} vs ${expectedPpg.toFixed(1)} exp)`;
        }
      }
    }

    // v2026-05-12f: coaching/scheme adjustment per team.
    // Applied at forwardLayer (forward-looking layer) — affects 2026 projection,
    // not 2025 baseline. Method string includes the team-specific reason.
    let coachMult = 1.0;
    let coachNote = '';
    const coaching = p.team ? COACHING_CHANGES_2026[p.team] : undefined;
    if (coaching && (p.position === 'QB' || p.position === 'RB' || p.position === 'WR' || p.position === 'TE')) {
      coachMult = coaching.m[p.position];
      if (Math.abs(coachMult - 1.0) >= 0.01) {
        const pct = Math.round((coachMult - 1.0) * 100);
        const sign = pct > 0 ? '+' : '';
        coachNote = `coaching ${sign}${pct}% — ${coaching.desc}`;
      }
    }

    // v2026-05-12g (v2): personnel-tendency layer ALWAYS applies — represents
    // the team's 2025 identity (offensive line, RB usage patterns, formation
    // preference). For coaching-change teams, the coaching multiplier layers
    // on top to capture the 2026 shift. Combined effect capped at ±12% to
    // avoid runaway compounding.
    //
    // Example readouts:
    //   LAR (no change): personnel +5% TE, coaching 1.00x → +5% net
    //   ATL (Stefanski): personnel +4% TE, coaching +6% TE → ~+10% net
    //   CLE (Monken):    personnel +4% TE, coaching -7% TE → ~-3% net
    let persMult = 1.0;
    let persNote = '';
    if (p.team && (p.position === 'QB' || p.position === 'RB' || p.position === 'WR' || p.position === 'TE')) {
      // v5.14 (2026-05-21): scheme-decay flag. If COACHING_CHANGES_2026 marks
      // this position's personnel tendency as decayed (departed coach defined
      // it), neutralize the personnel mult. CLE case: Stefanski's 41% 12-personnel
      // boost shouldn't persist into 2026 under Monken.
      const ccDecay = (p.team && COACHING_CHANGES_2026[p.team]?.personnel_decay) || [];
      if (ccDecay.includes(p.position as any)) {
        persMult = 1.0;
        persNote = 'personnel decayed (scheme-architect exit)';
      } else {
        const pm = personnelMult(p.team, p.position);
        persMult = pm.mult;
        persNote = pm.note;
      }
    }

    // Combined scheme adjustment, capped ±12%
    let combinedSchemeMult = coachMult * persMult;
    if (combinedSchemeMult > 1.12) combinedSchemeMult = 1.12;
    if (combinedSchemeMult < 0.88) combinedSchemeMult = 0.88;

    // v4 (2026-05-17): per-week positional SOS (replaces season-average).
    // Weights playoff weeks (14-17) ×2 so the WR who faces brutal late D's
    // gets dinged for it. ±10% capped, typical ±2-4%.
    const sos = sosMultV4(p.team, p.position);

    // v4: travel burden (±5% by team). LAC/MIA/SEA/LV get penalized for
    // brutal 2026 travel schedules; east-coast teams (CIN/PIT/ATL/CAR)
    // benefit slightly.
    const travel = travelMultV4(p.team);

    // ─── v2 (2026-05-16): 6-layer consolidated multiplier chain ─────────
    // Old chain compounded 14 multipliers, producing absurd swings
    // (Wan'Dale: opp +15% × team +4% × trend +5% all said "more
    // opportunity"). New chain groups by signal type and takes the
    // strongest signal per group instead of compounding overlapping ones.
    //
    // Layer 1: AGE/EXPERIENCE — ageMult × rookieBoost (already separate)
    let layer1_ageExp = ageMult * (1 + rookieBoost);
    //
    // Layer 2: ROLE & SHARE — sysCtxMult (depth+share-band) × depthMult
    //   (sysCtxMult already includes the dilution-aware band selection
    //   from v2026-05-16; depthMult adds WR slot adjustment)
    const layer2_roleShare = sysCtxMult * depthMult;
    //
    // Layer 3: OPPORTUNITY CHANGE — take MAX of these "new opportunity"
    //   signals instead of compounding: oppAdj, teamMult, trend.mult.
    //   Wan'Dale case: all three said +5-15%, compounded to +27%. Now
    //   takes only the strongest single signal, capped ±15%.
    const oppSignals = [oppAdj, teamMult - 1, trend.mult - 1];
    const oppPos = Math.max(0, ...oppSignals.filter(v => v > 0));
    const oppNeg = Math.min(0, ...oppSignals.filter(v => v < 0));
    let oppNet = oppPos + oppNeg;
    if (oppNet > 0.15) oppNet = 0.15;
    // Fix #3 (v3 2026-05-17): cap opportunity downside at -10% (was -15%).
    // McConkey case: 2025 decline from alpha → WR2 fired -15% but the player
    // is still a starter. -15% on top of -5% role-share band was crushing
    // legitimate WR2s into WR40+ territory.
    if (oppNet < -0.10) oppNet = -0.10;
    // v5.10 (2026-05-19): RB share-decay rule (Kyren-Corum case).
    // The existing share-trend signal is capped at ±5% and MAX-of'd against
    // opp-trend, so big committee shifts (Kyren: 71% H1 → 58% H2 carries)
    // get swallowed. Apply an ADDITIONAL share-decay/gain adjustment
    // OUTSIDE the MAX-of, additively. Only RB. Only triggers on >8pp move.
    let shareDecayAdj = 0;
    let shareDecayNote = '';
    if (p.position === 'RB' && !skipOppSignals) {
      const t2025 = a25?.lastTeam ?? p.team;
      const pl = playerLoadHalves[p.gsis_id];
      const tl = t2025 ? teamRBLoadHalves[t2025] : null;
      if (pl && tl && tl.h1 > 0 && tl.h2 > 0) {
        const h1s = pl.h1 / tl.h1;
        const h2s = pl.h2 / tl.h2;
        if (h1s >= 0.10 || h2s >= 0.10) {  // meaningful sample
          const delta = h2s - h1s;
          // Decay (lost ≥8pp): additional -3% per 5pp beyond 5pp lost. Cap -7%.
          if (delta <= -0.08) {
            shareDecayAdj = Math.max(-0.07, (delta + 0.05) * 1.5);
            shareDecayNote = `RB share decay ${(h1s*100).toFixed(0)}%→${(h2s*100).toFixed(0)}% (${(shareDecayAdj*100).toFixed(0)}%)`;
          } else if (delta >= 0.08) {
            // Mirror boost for back gaining share. Cap +7%.
            shareDecayAdj = Math.min(0.07, (delta - 0.05) * 1.5);
            shareDecayNote = `RB share gain ${(h1s*100).toFixed(0)}%→${(h2s*100).toFixed(0)}% (+${(shareDecayAdj*100).toFixed(0)}%)`;
          }
        }
      }
    }
    let layer3_opportunity = (1.0 + oppNet) * (1.0 + shareDecayAdj);
    //
    // Layer 4: EFFICIENCY — EPA × WOPR × QB cast × format (mostly
    //   orthogonal signals about per-target/per-format quality)
    const layer4_efficiency = epaMult * woprMult * effectiveCastMult * formatAdj;
    //
    // Layer 5: AVAILABILITY — durability already applied to baseline
    //   above; no additional layer-5 mult needed here. Captured.
    const layer5_availability = 1.0;
    //
    // Layer 6: SCHEME + SOS — already consolidated by the personnelMult
    //   × coachMult cap (±12%) + sos.mult (±5%)
    // v3: OL rank multiplier (PB for QB/WR/TE, RB for RB)
    const ol = olMultV3(p.team, p.position);
    // Layer 6: scheme × SOS × OL × travel (all environment factors)
    let layer6_environment = combinedSchemeMult * sos.mult * ol.mult * travel.mult;
    // v5.14 (2026-05-21): TE-friendly QB chemistry. Adds small boost when
    // the team's projected QB1 is a known TE-targeting passer (Mahomes,
    // Kyler, Allen, Goff, Lamar, etc.). Per TE_FRIENDLY_QBS_2026 map.
    let teQbChemNote = '';
    if (p.position === 'TE' && p.team) {
      const teMult = teamTeFriendlyQbMult[p.team];
      if (teMult && teMult > 1.0) {
        layer6_environment = layer6_environment * teMult;
        teQbChemNote = `TE-QB chem +${((teMult - 1) * 100).toFixed(0)}%`;
      }
    }
    // Cap combined ±15%
    if (layer6_environment > 1.15) layer6_environment = 1.15;
    if (layer6_environment < 0.85) layer6_environment = 0.85;

    // v4 (2026-05-17): SEASON-TOTAL FRAMING.
    // v5.12 (2026-05-20): vet WR/TE 32+ compound floor.
    // Adams case: age 33 (0.86) × team-change opp (0.90) × eff (1.08) × env...
    // compounded too hard for a still-producing vet (15.9 ppg in 14g 2025).
    // Floor the age × opp product at 0.80 for WR/TE 32+ who played 12+ games
    // most recent year (still active, not retired/IR). Still penalized.
    if ((p.position === 'WR' || p.position === 'TE') && age >= 32 && a25 && a25.games >= 12) {
      const ageOpp = layer1_ageExp * layer3_opportunity;
      if (ageOpp < 0.80) {
        // Distribute the lift back into the two factors proportionally
        const lift = 0.80 / ageOpp;
        layer1_ageExp = layer1_ageExp * Math.sqrt(lift);
        layer3_opportunity = layer3_opportunity * Math.sqrt(lift);
        baselineSource += ` | vet 32+ compound floor ${ageOpp.toFixed(2)}→0.80`;
      }
    }
    const projectedPpg = baseline
                       * layer1_ageExp
                       * layer2_roleShare
                       * layer3_opportunity
                       * layer4_efficiency
                       * layer6_environment;

    // Pull avgGames already computed above for durability bucketing
    const injuryMultForGames = injuryMult; // already incorporated 0.45 for Kittle etc.
    // v4.1: pass per-season games array so injury-yr cases get smarter expected games
    const perSeasonGames: number[] = [];
    if (a25) perSeasonGames.push(a25.games);
    if (a24) perSeasonGames.push(a24.games);
    if (a23) perSeasonGames.push(a23.games);
    let gamesEst = expectedGamesV4(avgGames, age, p.position, injuryMultForGames, perSeasonGames);

    // v5.2 (2026-05-18): when injury-yr inversion fires AND player has a
    // healthy elite year to anchor on, expected_games should reflect that
    // healthy year's availability (with risk premium), not the chronic
    // 3yr avg pulled down by the injury sample.
    // Daniels: 2024 healthy 20g elite → expected 2026 ≈ 15.3g, not 14g.
    // Burrow: 2024 healthy 17g → expected ≈ 15.3g, not 11.7g.
    const wasInversion = baselineSource.startsWith('injury-yr inverted');
    if (wasInversion) {
      // Find the healthiest qualifying prior year
      const healthyPriorGames = Math.max(
        (a24?.games ?? 0) >= 15 ? Math.min(a24!.games, 17) : 0,
        (a23?.games ?? 0) >= 15 ? Math.min(a23!.games, 17) : 0,
        (a22?.games ?? 0) >= 15 ? Math.min(a22!.games, 17) : 0,
      );
      if (healthyPriorGames >= 15) {
        // Anchor at healthy-year × 0.90 (10% recurrence risk premium)
        const anchored = healthyPriorGames * 0.90;
        if (anchored > gamesEst.games) {
          gamesEst = {
            games: anchored,
            note: `${anchored.toFixed(1)}g (injury-rebound anchor on healthy ${healthyPriorGames}g)`,
          };
        }
      }
    }

    // v5.3 (2026-05-18): apply explicit 2025-injury recovery context.
    // Overrides derived expected_games with player-specific recovery
    // projection. Also applies a recovery-mult to per-game pace for
    // year-1-back ACL/Achilles cases (Nabers ~88%, Hill ~92%).
    const injuryKey = (p.full_name || '').toLowerCase().replace(/[^a-z]/g, '');
    let recoveredProjectedPpg = projectedPpg;
    if (INJURY_CONTEXT_2026[injuryKey]) {
      const ctx = INJURY_CONTEXT_2026[injuryKey];
      gamesEst = { games: ctx.games, note: ctx.note };
      // v5.5: apply mult either direction. <1.0 = recovery discount,
      // >1.0 = upside boost for ascending young QBs (Daniels/Maye Y3).
      if (ctx.mult !== 1.0) {
        recoveredProjectedPpg = projectedPpg * ctx.mult;
      }
    }

    // v5.6 (2026-05-18): QB rushing premium. Rushers have higher floor
    // (rushing fpts come even on bad passing days) which the per-game
    // projection misses. Apply per-player adjustment from profile map.
    let rushingPremiumNote = '';
    if (p.position === 'QB' && QB_RUSHING_PROFILE_2026[injuryKey]) {
      const rushMult = QB_RUSHING_PROFILE_2026[injuryKey];
      if (rushMult !== 1.0) {
        recoveredProjectedPpg = recoveredProjectedPpg * rushMult;
        const dir = rushMult > 1.0 ? '+' : '';
        rushingPremiumNote = `rushing-profile ${dir}${((rushMult - 1) * 100).toFixed(0)}%`;
      }
    }
    const projectedSeasonTotal = recoveredProjectedPpg * gamesEst.games;

    // v4: career-best sanity guardrail. Prevent wild over-projection.
    // Skip for rookies/sophomores (no prior baseline) and elite-vet stabilize.
    // v5.9 (2026-05-19): tightened cap for non-elite-ceiling players. 1.40×
    // is generous and was letting Walker (career-best 203, never top-15)
    // ride opp+eff+age compounding to RB9. Players who've never broken into
    // their position's top-15 get 1.25× cap instead.
    let guardrailNote = '';
    let finalSeasonTotal = projectedSeasonTotal;
    if (!isRookie && !isSophomore) {
      // Career best season total = max of (recencyPpg × games) across years
      const careerSeasons: number[] = [];
      if (a25) careerSeasons.push(a25.ppg * a25.games);
      if (a24) careerSeasons.push(a24.ppg * a24.games);
      if (a23) careerSeasons.push(a23.ppg * a23.games);
      if (a22) careerSeasons.push(a22.ppg * a22.games);
      if (a21) careerSeasons.push(a21.ppg * a21.games);
      const careerBest = careerSeasons.length ? Math.max(...careerSeasons) : 0;
      // Position-aware top-15 thresholds for elite-ceiling gating
      const top15Threshold: Record<string, number> = {
        RB: 220, WR: 190, TE: 140, QB: 280,
      };
      const elite = careerBest >= (top15Threshold[p.position] ?? 999);
      const capMult = elite ? 1.40 : 1.25;
      if (careerBest > 0 && finalSeasonTotal > careerBest * capMult) {
        finalSeasonTotal = careerBest * capMult;
        guardrailNote = `guardrail @ ${capMult.toFixed(2)}× career-best ${careerBest.toFixed(0)}`;
      }
    }

    // v4 score = projected season total (raw fpts). The legacy VBD pass
    // below will subtract rank-based replacement to get final values.
    // This keeps cross-position scaling working with the existing logic.
    const score = finalSeasonTotal;

    // ─── v2: method string by LAYER (one summary per layer, not per signal) ───
    const parts: string[] = [];
    parts.push(`${baselineSource}: ${baseline.toFixed(1)} ppg`);
    if (eliteVetTag) parts.push(eliteVetTag);
    if (injuryNote) parts.push(injuryNote);
    // Layer 1: age/exp
    {
      const bits: string[] = [];
      if (Math.abs(ageMult - 1.0) >= 0.04) {
        const tag = ageMult > 1 ? 'peak' : ageMult < 0.7 ? 'cliff' : 'decline';
        bits.push(`age ${age} ${tag}`);
      }
      if (isRookie) bits.push(`R${p.draft_round ?? '?'}${rookieBoost ? ` +${(rookieBoost*100).toFixed(0)}%` : ''}`);
      if (sampleSizePenalty) bits.push(yearsOfData === 1 ? '1yr-only' : '2yr-only');
      if (highVolatility) bits.push('volatile');
      if (Math.abs(layer1_ageExp - 1.0) >= 0.04 || bits.length) {
        parts.push(`[age/exp ${layer1_ageExp.toFixed(2)}x]${bits.length ? ` ${bits.join(', ')}` : ''}`);
      }
    }
    // Layer 2: role/share
    if (sysCtxNote || Math.abs(layer2_roleShare - 1.0) >= 0.04) {
      const tag = sysCtxNote ? sysCtxNote.split('(')[0].trim() : 'role';
      parts.push(`[role/share ${layer2_roleShare.toFixed(2)}x] ${tag}`);
    }
    // Layer 3: opportunity (the one that USED to compound)
    if (Math.abs(oppNet) >= 0.03 || Math.abs(shareDecayAdj) >= 0.01) {
      const drivers: string[] = [];
      if (Math.abs(oppAdj) >= 0.03) drivers.push(`opp-trend ${oppAdj > 0 ? '+' : ''}${(oppAdj*100).toFixed(0)}%`);
      if (Math.abs(teamMult - 1.0) >= 0.03 && a25?.lastTeam) drivers.push(`${a25.lastTeam}→${p.team}`);
      if (trend.note) drivers.push(trend.note.split('(')[0].trim());
      if (vacatedNote) drivers.push('vacancy');
      const oppStr = `MAX of: ${drivers.join(' | ') || 'n/a'}`;
      const decayStr = shareDecayNote ? ` × ${shareDecayNote}` : '';
      parts.push(`[opportunity ${(oppNet >= 0 ? '+' : '')}${(oppNet*100).toFixed(0)}% ${oppStr}${decayStr}] (${layer3_opportunity.toFixed(2)}x)`);
    }
    // Layer 4: efficiency
    if (Math.abs(layer4_efficiency - 1.0) >= 0.03) {
      const bits: string[] = [];
      if (epaNote) bits.push('EPA');
      if (woprNote) bits.push('WOPR');
      if (effectiveCastNote) bits.push('QBcast');
      parts.push(`[efficiency ${layer4_efficiency.toFixed(2)}x] ${bits.join('+')}`);
    }
    // Layer 5: availability (now applied as expected games multiplier, not baseline)
    if (durabilityMult < 0.95) parts.push(`[availability ${durabilityMult.toFixed(2)}x] ${avgGames.toFixed(1)}g avg`);
    // Layer 6: environment (scheme + SOS + OL + travel)
    if (Math.abs(layer6_environment - 1.0) >= 0.03) {
      const bits: string[] = [];
      if (coachNote) bits.push(coachNote.split('—')[0].trim());
      if (persNote) bits.push(persNote.split('(')[0].trim());
      if (sos.note) bits.push(sos.note.split('(')[0].trim());
      if (ol.note) bits.push(ol.note.split('(')[0].trim());
      if (travel.note) bits.push(travel.note.split('(')[0].trim());
      if (teQbChemNote) bits.push(teQbChemNote);
      parts.push(`[env ${layer6_environment.toFixed(2)}x] ${bits.join(' / ')}`);
    }
    // v4: expected games + season-total framing
    parts.push(`[v4 ${recoveredProjectedPpg.toFixed(1)} ppg × ${gamesEst.games.toFixed(1)}g = ${finalSeasonTotal.toFixed(0)} fpts]`);
    if (INJURY_CONTEXT_2026[injuryKey]) {
      parts.push(`injury-2026: ${INJURY_CONTEXT_2026[injuryKey].note}`);
    }
    if (rushingPremiumNote) {
      parts.push(rushingPremiumNote);
    }
    if (guardrailNote) parts.push(guardrailNote);
    if (weakTeamPenalty) parts.push(`weak offense`);
    if (lateSeasonNote) parts.push(lateSeasonNote.split('(')[0].trim());

    scored.push({
      format,
      rank: 0,
      gsis_id: p.gsis_id,
      name: p.full_name,
      position: p.position,
      team: p.team,
      pos_rank: 0,
      score,
      tier: 0,
      baseline_2025: baseline,
      age_adj: ageMult,
      team_change_adj: teamMult,
      rookie_boost: rookieBoost,
      opportunity_adj: oppAdj,
      floor_protected: false,
      method: parts.join(' · '),
      computed_at: computedAt,
    });
  }

  // ─── VBD (Value Based Drafting) adjustment ─────────────────────────
  // Subtract replacement-level score per position. Reflects that fantasy
  // value is points-above-streamer, not raw points.
  // v2026-05-07: previously skipped for SF and DYN; that broke cross-
  // position scaling in dynasty (Tate WR2, Chase WR8). Now applied to
  // all formats. Dynasty uses deeper replacement ranks because dynasty
  // rosters are 30+ deep -- replacement level lives further down the
  // pool. SF still skipped (QB scarcity already encoded in formatAdj).
  if (format !== 'SF' && format !== 'DYN_SF') {
    // v2.5.3: QB removed from VBD. Single-QB league QB pool depth
    // is too compressed for VBD math to work -- top 14 QBs all score
    // 16-22 PPG, so subtracting QB14's score crushes the spread to
    // 3-5 points while RB/WR spreads stay 12-15. Result: elite QBs
    // ended up ranked behind QB backups. Skip QB entirely; rely on
    // raw multiplied score for QB ordering within position.
    const isDynasty = format === 'DYN' || format === 'DYN_HALF' ||
                      format === 'DYN_STD' || format === 'DYN_SF';
    const REPLACEMENT_RANK: Record<string, number> = isDynasty
      ? { RB: 45, WR: 60, TE: 24 }
      : { RB: 30, WR: 36, TE: 14 };
    const byPos: Record<string, typeof scored> = {};
    for (const r of scored) {
      (byPos[r.position] = byPos[r.position] ?? []).push(r);
    }
    const replacementScore: Record<string, number> = {};
    for (const pos of Object.keys(byPos)) {
      const sortedPos = [...byPos[pos]].sort((a, b) => b.score - a.score);
      const idx = (REPLACEMENT_RANK[pos] ?? 24) - 1;
      replacementScore[pos] = sortedPos[idx]?.score ?? 0;
    }
    for (const r of scored) {
      const repl = replacementScore[r.position] ?? 0;
      r.score = r.score - repl;
    }
  }

  scored.sort((a, b) => b.score - a.score);

  // ─── Position scarcity pass (v2026-05-07) ──────────────────────────
  // Compute initial pos_rank by score, then multiply each player's score
  // by the scarcity tier for their position-rank. Re-sort after.
  // Elite RB/TE/WR/SF-QB get a tier-reinforcer boost; everyone outside
  // the scarcity tiers is unaffected (multiplier = 1.0).
  {
    const isSuperflex = format === 'SF' || format === 'DYN_SF';
    const posCount: Record<string, number> = {};
    for (const r of scored) {
      posCount[r.position] = (posCount[r.position] ?? 0) + 1;
      const initialPosRank = posCount[r.position];
      const sm = scarcityMult(r.position, initialPosRank, isSuperflex);
      if (sm !== 1.0) {
        r.score *= sm;
        r.method += ` · scarcity ${sm.toFixed(2)}x (${r.position}${initialPosRank})`;
      }
    }
    // Re-sort for floor-protection + final ranking to see scarcity-adjusted order
    scored.sort((a, b) => b.score - a.score);
  }

  // ─── Floor protection (skipped for players age >= 30) ──────────────
  const violators: { gsis_id: string; targetIdx: number; }[] = [];
  for (const r of scored) {
    const finish = finishedRanks.get(r.gsis_id);
    const player = players.find((p: any) => p.gsis_id === r.gsis_id);
    const playerAge = player?.age ?? 99;
    if (finish && finish <= 24 && playerAge < 30) {
      let posRankNow = 0;
      let countAtPos = 0;
      for (const x of scored) {
        if (x.position === r.position) {
          countAtPos++;
          if (x.gsis_id === r.gsis_id) { posRankNow = countAtPos; break; }
        }
      }
      const maxAllowed = finish + 12;
      if (posRankNow > maxAllowed) {
        let seen = 0;
        let targetIdx = scored.length - 1;
        for (let i = 0; i < scored.length; i++) {
          if (scored[i].position === r.position) {
            seen++;
            if (seen === maxAllowed) { targetIdx = i; break; }
          }
        }
        violators.push({ gsis_id: r.gsis_id, targetIdx });
      }
    }
  }

  for (const v of violators) {
    const fromIdx = scored.findIndex(r => r.gsis_id === v.gsis_id);
    if (fromIdx <= v.targetIdx) continue;
    const [moved] = scored.splice(fromIdx, 1);
    moved.floor_protected = true;
    moved.method += ` · floor protected`;
    scored.splice(v.targetIdx, 0, moved);
  }

  // Final ranking + tier assignment
  const finalRows: RankedRow[] = [];
  const posCounter: Record<string, number> = {};
  scored.slice(0, 250).forEach((r, i) => {
    posCounter[r.position] = (posCounter[r.position] ?? 0) + 1;
    finalRows.push({
      ...r,
      rank: i + 1,
      pos_rank: posCounter[r.position],
      tier: i < 6 ? 1 : i < 15 ? 2 : i < 30 ? 3 : i < 60 ? 4 : 5,
    });
  });

  return finalRows;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const startedAt = Date.now();

    // Optional body params for backtest mode
    let asOfSeason = 2026;
    try {
      const body = await req.json().catch(() => ({}));
      asOfSeason = Number(body?.asOfSeason ?? 2026);
    } catch { /* ignore */ }
    const isBacktest = asOfSeason !== 2026;
    const dbFormatPrefix = isBacktest ? `BT${asOfSeason}_` : '';

    const formats: Format[] = ['PPR', 'HALF', 'STD', 'SF', 'DYN', 'DYN_HALF', 'DYN_STD', 'DYN_SF'];
    const stats: any = { formats: {}, errors: [], asOfSeason, isBacktest };

    for (const fmt of formats) {
      try {
        const rows = await buildFormat(fmt, supabase, asOfSeason);
        // In backtest mode, format is stored prefixed (e.g. BT2025_PPR)
        // so production rankings stay untouched.
        const dbFormat = dbFormatPrefix + fmt;
        if (dbFormatPrefix) {
          for (const r of rows) (r as any).format = dbFormat;
        }
        const { error: delErr } = await supabase
          .from('nfl_proprietary_rankings_v2')
          .delete()
          .eq('format', dbFormat);
        if (delErr) throw delErr;

        const CHUNK = 100;
        for (let i = 0; i < rows.length; i += CHUNK) {
          const batch = rows.slice(i, i + CHUNK);
          const { error: insErr } = await supabase
            .from('nfl_proprietary_rankings_v2')
            .insert(batch);
          if (insErr) throw insErr;
        }
        stats.formats[dbFormat] = rows.length;
      } catch (e: any) {
        stats.errors.push(`${fmt}: ${e.message ?? String(e)}`);
      }
    }

    const duration = Math.round((Date.now() - startedAt) / 1000);
    return new Response(JSON.stringify({
      ok: true,
      duration_seconds: duration,
      stats,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });

  } catch (err: any) {
    console.error('engine error:', err);
    return new Response(JSON.stringify({ ok: false, error: err.message ?? String(err) }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
