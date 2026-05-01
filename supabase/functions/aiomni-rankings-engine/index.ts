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

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Format = 'PPR' | 'HALF' | 'STD' | 'SF' | 'DYN';

// ─── AGE CURVES (v2: steeper late-career declines) ────────────────────
function ageCurve(position: string, age: number | null): number {
  if (!age || age <= 0) return 1.0;
  const a = age;
  if (position === 'RB') {
    if (a <= 23) return 1.20;
    if (a <= 26) return 1.10;
    if (a === 27) return 1.00;
    if (a === 28) return 0.88;
    if (a === 29) return 0.72;
    if (a === 30) return 0.50;       // v1 was 0.65 -- too lenient
    return 0.35;
  }
  if (position === 'WR') {
    if (a <= 23) return 1.15;
    if (a <= 27) return 1.10;
    if (a <= 30) return 1.00;
    if (a === 31) return 0.90;
    if (a === 32) return 0.78;
    if (a === 33) return 0.60;       // v1 was 0.70
    return 0.45;
  }
  if (position === 'TE') {
    if (a <= 24) return 1.05;
    if (a <= 28) return 1.10;
    if (a <= 31) return 1.00;
    if (a === 32) return 0.85;
    if (a === 33) return 0.55;       // v1 was 0.75 -- this is the Kelce fix
    if (a === 34) return 0.40;
    return 0.30;
  }
  if (position === 'QB') {
    if (a <= 24) return 1.05;
    if (a <= 33) return 1.00;
    if (a <= 36) return 0.92;
    if (a <= 38) return 0.78;
    return 0.60;
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

// ─── ROOKIE BASELINE ──────────────────────────────────────────────────
function rookieBaselineByPos(position: string, draftRound: number | null): number {
  if (!draftRound || draftRound > 7) return 0;
  if (position === 'RB') {
    if (draftRound === 1) return 12.0;
    if (draftRound === 2) return 8.0;
    if (draftRound === 3) return 5.5;
    return 3.0;
  }
  if (position === 'WR') {
    if (draftRound === 1) return 10.0;
    if (draftRound === 2) return 6.5;
    if (draftRound === 3) return 4.5;
    return 2.5;
  }
  if (position === 'TE') {
    if (draftRound === 1) return 7.0;
    if (draftRound === 2) return 4.5;
    return 2.5;
  }
  if (position === 'QB') {
    if (draftRound === 1) return 14.0;
    return 0;
  }
  return 0;
}

// ─── OPPORTUNITY ADJUSTMENT ───────────────────────────────────────────
function opportunityAdj(
  weeks: { week: number; targets?: number; carries?: number; }[],
): number {
  if (weeks.length < 4) return 0;
  const sorted = [...weeks].sort((a, b) => a.week - b.week);
  // v2.5.1: simple half-vs-half opportunity comparison.
  // Removed playoff-week 2x weighting from v2.5 -- it caused everyone
  // to hit the +15% ceiling because most players play more late-season
  // (when those weeks count double). The fantasy-playoff weighting in
  // recencyPpg already captures "playoffs matter more" for production.
  const opportunity = (w: any) => (w.targets ?? 0) + (w.carries ?? 0);
  const half = Math.floor(sorted.length / 2);
  const earlyAvg = sorted.slice(0, half).reduce((s, w) => s + opportunity(w), 0) / Math.max(half, 1);
  const lateAvg = sorted.slice(half).reduce((s, w) => s + opportunity(w), 0) / Math.max(sorted.length - half, 1);
  if (earlyAvg <= 0) return 0;
  const delta = (lateAvg - earlyAvg) / earlyAvg;
  return Math.max(-0.15, Math.min(0.15, delta * 0.5));
}

function pointsCol(format: Format): 'fantasy_pts_ppr' | 'fantasy_pts_half' | 'fantasy_pts_std' {
  if (format === 'PPR' || format === 'DYN' || format === 'SF') return 'fantasy_pts_ppr';
  if (format === 'HALF') return 'fantasy_pts_half';
  return 'fantasy_pts_std';
}

function formatPositionAdj(format: Format, position: string, age: number): number {
  if (format === 'SF') {
    if (position === 'QB') return 1.40;
    return 1.0;
  }
  if (format === 'DYN') {
    if (age <= 24) return 1.10;
    if (age >= 30) return 0.85;
    return 1.0;
  }
  return 1.0;
}

// ─── PAGINATED WEEKLY FETCH ───────────────────────────────────────────
async function fetchSeason(supabase: any, season: number, ptsCol: string): Promise<any[]> {
  const out: any[] = [];
  const CHUNK = 1000;
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('nfl_weekly_stats')
      .select(`gsis_id, week, team, ${ptsCol}, targets, carries`)
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
  recencyPpg: number;      // last-6 games weighted 3x, earlier 1x
  volatility: number;      // coefficient of variation (std dev / mean)
  games: number;
  weeks: { week: number; targets: number; carries: number; pts: number; }[];
  lastTeam: string | null;
}

function aggregateSeason(rows: any[], ptsCol: string): Map<string, SeasonAgg> {
  // First pass: collect raw game data per player
  const map = new Map<string, SeasonAgg>();
  for (const w of rows) {
    const pts = (w as any)[ptsCol] ?? 0;
    const targets = w.targets ?? 0;
    const carries = w.carries ?? 0;
    if (pts === 0 && targets === 0 && carries === 0) continue;
    const prev = map.get(w.gsis_id) ?? {
      ppg: 0, recencyPpg: 0, volatility: 0,
      games: 0, weeks: [], lastTeam: null,
    };
    prev.ppg += pts; // running sum, divided later
    prev.games += 1;
    prev.weeks.push({ week: w.week, targets, carries, pts });
    prev.lastTeam = w.team ?? prev.lastTeam;
    map.set(w.gsis_id, prev);
  }

  // Second pass: compute season PPG, recency-weighted PPG, volatility
  for (const [id, agg] of map) {
    if (agg.games === 0) continue;

    // Sort weeks chronologically for recency calc
    agg.weeks.sort((a, b) => a.week - b.week);

    // Plain season PPG
    agg.ppg = agg.ppg / agg.games;

    // Fantasy-playoff weighting (v2.5): when championships matter,
    // production matters more. Weights by NFL week:
    //   wks 1-9:   1x  (early season)
    //   wks 10-13: 2x  (late-season ramp)
    //   wks 14-17: 4x  (FANTASY PLAYOFFS)
    //   wk 18:     1x  (starters rested)
    let weightedSum = 0;
    let totalWeight = 0;
    for (const g of agg.weeks) {
      let w = 1;
      if (g.week >= 14 && g.week <= 17) w = 4;
      else if (g.week >= 10 && g.week <= 13) w = 2;
      else if (g.week === 18) w = 1;
      weightedSum += g.pts * w;
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
  console.log(`[injuries] loaded ${map.size} injured players from ESPN`);
  return map;
}

async function buildFormat(format: Format, supabase: any): Promise<RankedRow[]> {
  const ptsCol = pointsCol(format);

  // Pull all 3 seasons + injury feed in parallel
  const [w2025, w2024, w2023, playersResult, injuryMap] = await Promise.all([
    fetchSeason(supabase, 2025, ptsCol),
    fetchSeason(supabase, 2024, ptsCol),
    fetchSeason(supabase, 2023, ptsCol),
    supabase.from('nfl_players')
      .select('gsis_id, full_name, position, team, age, rookie_year, draft_year, draft_round, draft_pick')
      .in('position', ['QB', 'RB', 'WR', 'TE'])
      .eq('is_active', true),
    fetchInjuryMap(),
  ]);

  if (playersResult.error) throw playersResult.error;
  const players = playersResult.data ?? [];
  if (!players.length) throw new Error('no active players');

  console.log(`[${format}] players=${players.length} w2025=${w2025.length} w2024=${w2024.length} w2023=${w2023.length}`);

  const agg2025 = aggregateSeason(w2025, ptsCol);
  const agg2024 = aggregateSeason(w2024, ptsCol);
  const agg2023 = aggregateSeason(w2023, ptsCol);

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

  // Score each player
  const scored: RankedRow[] = [];
  const computedAt = new Date().toISOString();

  for (const p of players) {
    const age = p.age ?? 25;
    const a25 = agg2025.get(p.gsis_id);
    const a24 = agg2024.get(p.gsis_id);
    const a23 = agg2023.get(p.gsis_id);
    const isRookie = p.rookie_year === 2026 || p.draft_year === 2026;
    // Hoisted (v2.5): injuryNameKey available throughout the loop body
    const injuryNameKey = (p.full_name || '').toLowerCase().replace(/[^a-z]/g, '');

    // ── Multi-year weighted baseline using RECENCY-WEIGHTED ppg ──
    // Within each season we use recencyPpg (last-6-games weighted 3x)
    // instead of plain season-average ppg. This catches mid-season
    // collapses (Taylor 2025) and rewards late-season risers.
    //
    // Young players (<=27): blend 3 years 60/30/10 if available.
    // Older players (28+):  recent year only.
    let baseline = 0;
    let baselineSource = '';
    let highVolatility = false;
    const useMultiYear = age <= 27;
    const has25 = a25 && a25.games >= 4;
    const has24 = a24 && a24.games >= 4;
    const has23 = a23 && a23.games >= 4;

    // INJURY-YEAR REBOUND check (v2.5):
    // If the player\'s prior 2 years averaged >= 14 PPG and most recent
    // year was < 12 PPG, and we see them in the injury feed -- they had
    // a down year due to injury, not decline. Use prior years as anchor.
    const priorAvg = ((has24 ? a24!.recencyPpg : 0) + (has23 ? a23!.recencyPpg : 0))
                   / ((has24 ? 1 : 0) + (has23 ? 1 : 0) || 1);
    const recentPpg = has25 ? a25!.recencyPpg : 0;
    const injuryRebound = (
      has24 && has23 && has25 &&
      priorAvg >= 14 &&
      recentPpg < 12 &&
      injuryMap.has(injuryNameKey)
    );
    if (injuryRebound) {
      baseline = 0.6 * priorAvg + 0.4 * recentPpg;
      baselineSource = 'rebound';
    } else if (useMultiYear && has25 && has24 && has23) {
      baseline = 0.6 * a25!.recencyPpg + 0.3 * a24!.recencyPpg + 0.1 * a23!.recencyPpg;
      baselineSource = `3yr blend`;
    } else if (useMultiYear && has25 && has24) {
      baseline = 0.7 * a25!.recencyPpg + 0.3 * a24!.recencyPpg;
      baselineSource = `2yr blend`;
    } else if (has25) {
      baseline = a25!.recencyPpg;
      baselineSource = `2025 recency`;
    } else if (has24) {
      // injured 2025? use 2024 with discount
      baseline = a24!.recencyPpg * 0.85;
      baselineSource = `2024 (no 2025)`;
    } else if (isRookie) {
      baseline = rookieBaselineByPos(p.position, p.draft_round);
      baselineSource = `rookie R${p.draft_round ?? '?'}`;
    } else {
      continue;
    }

    if (baseline <= 0) continue;

    // ── Volatility penalty ──
    // High boom/bust profile (CV > 0.7) hurts projections. Apply 0.92x.
    // Only applied when we have meaningful 2025 data (>= 8 games).
    let volatilityMult = 1.0;
    if (a25 && a25.games >= 8 && a25.volatility > 0.7) {
      volatilityMult = 0.92;
      highVolatility = true;
      baseline = baseline * volatilityMult;
    }

    // ── Sample-size confidence penalty ──
    // Players with only 1 year of meaningful data (typically rookies
    // who flashed late) get a 0.90x multiplier. Reflects that 1-season
    // samples carry less signal than 2-3 year track records.
    let sampleSizePenalty = false;
    const yearsOfData = (has25 ? 1 : 0) + (has24 ? 1 : 0) + (has23 ? 1 : 0);
    if (yearsOfData === 1 && !isRookie) {
      baseline = baseline * 0.90;
      sampleSizePenalty = true;
    }

    // ── Injury discount ──
    // Cross-ref ESPN injury feed by normalized name. Aggressive: serious
    // \"Out\" injuries (ACL/Achilles/etc) drop score by 90%.
    // Note: injuryNameKey is hoisted to the top of the loop in v2.5 so
    // the injury-rebound logic can reference it.
    const injInfo = injuryMap.get(injuryNameKey);
    let injuryMult = 1.0;
    let injuryNote = '';
    if (injInfo && injInfo.multiplier < 1.0) {
      injuryMult = injInfo.multiplier;
      baseline = baseline * injuryMult;
      injuryNote = `INJURY: ${injInfo.injury} (${injuryMult.toFixed(2)}x)`;
    }

    const ageMult = ageCurve(p.position, age);
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
      if (typeof pick === 'number' && pick <= 10) {
        rookieBoost = (p.position === 'RB' || p.position === 'WR') ? 0.35 : 0.30;
      } else if (round === 1) rookieBoost = 0.20;
      else if (round === 2) rookieBoost = 0.10;
      else if (round === 3) rookieBoost = 0.05;
      else rookieBoost = 0; // R4+ or unknown
    }
    const oppAdj = a25 ? opportunityAdj(a25.weeks) : 0;
    const formatAdj = formatPositionAdj(format, p.position, age);

    const forwardLayer = baseline * ageMult * teamMult * (1 + rookieBoost) * (1 + oppAdj) * formatAdj;
    const score = baseline * 0.25 + forwardLayer * 0.75;

    // Build readable method
    const parts: string[] = [];
    parts.push(`${baselineSource}: ${baseline.toFixed(1)} ppg`);
    if (highVolatility) parts.push(`volatile (0.92x)`);
    if (Math.abs(ageMult - 1.0) >= 0.05) {
      const tag = ageMult > 1 ? 'peak' : ageMult < 0.7 ? 'cliff' : 'decline';
      parts.push(`age ${age} ${tag} (${ageMult.toFixed(2)}x)`);
    }
    if (Math.abs(teamMult - 1.0) >= 0.03 && a25?.lastTeam) parts.push(`${a25.lastTeam}→${p.team} (${teamMult.toFixed(2)}x)`);
    if (isRookie) parts.push(`rookie (R${p.draft_round ?? '?'})`);
    if (Math.abs(oppAdj) >= 0.03) parts.push(`opp ${oppAdj > 0 ? '+' : ''}${(oppAdj * 100).toFixed(0)}%`);
    if (sampleSizePenalty) parts.push('1yr sample (0.90x)');
    if (weakTeamPenalty) parts.push(`${p.team} weak offense (0.95x)`);
    if (injuryNote) parts.push(injuryNote);
    if (rookieBoost > 0) parts.push(`rookie boost +${(rookieBoost*100).toFixed(0)}%`);

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
  // value is points-above-streamer, not raw points. Skipped for SF (QB
  // scarcity already handled) and DYN (long-term value matters more).
  if (format === 'PPR' || format === 'HALF' || format === 'STD') {
    const REPLACEMENT_RANK: Record<string, number> = {
      QB: 14,
      RB: 30,
      WR: 36,
      TE: 14,
    };
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
    const formats: Format[] = ['PPR', 'HALF', 'STD', 'SF', 'DYN'];
    const stats: any = { formats: {}, errors: [] };

    for (const fmt of formats) {
      try {
        const rows = await buildFormat(fmt, supabase);
        const { error: delErr } = await supabase
          .from('nfl_proprietary_rankings')
          .delete()
          .eq('format', fmt);
        if (delErr) throw delErr;

        const CHUNK = 100;
        for (let i = 0; i < rows.length; i += CHUNK) {
          const batch = rows.slice(i, i + CHUNK);
          const { error: insErr } = await supabase
            .from('nfl_proprietary_rankings')
            .insert(batch);
          if (insErr) throw insErr;
        }
        stats.formats[fmt] = rows.length;
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
