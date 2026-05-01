#!/usr/bin/env python3
"""
AIOmni Phase 3 v2.5 — full calibration patch.

Five tweaks to the rankings engine:

  1. FANTASY-PLAYOFF WEIGHTING (replaces flat last-6 x3 weighting):
       Weeks 1-9:    1x
       Weeks 10-13:  2x  (late-season ramp)
       Weeks 14-17:  4x  (FANTASY PLAYOFFS - wins championships)
       Week 18:      1x  (starters rested, garbage time)

     Punishes mid-season collapses (Taylor wks 14-17: 14.7 PPG vs season
     18.2). Rewards late surges (Chase Brown wks 14-17: 24.1 PPG vs
     season 16.6 — both 2024 and 2025).

  2. INJURY-YEAR REBOUND:
       If player\\'s prior 2 yrs averaged >= 14 PPG AND most recent year
       was < 12 PPG, AND has any documented injury history,
       blend 60% prior 2yr / 40% most recent year (instead of recency).

     Surfaces Jefferson (3yr blend 14.1 ppg shows up as 16+ post-rebound)
     and Burrow.

  3. ROOKIE LADDER (replaces flat 1.15x):
       Top-10 pick:   1.30x boost
       Round 1:       1.20x
       Round 2:       1.10x
       Round 3:       1.05x
       Round 4-7:     1.00x (no boost)

     Drops RJ Harvey, Tyrone Tracy, fliers out of top 50. Lifts Jeremiyah
     Love (R1 P3) and Jadarian Price (R1 P32).

  4. WEAK-TEAM PENALTY:
       Skill-position players on offense tier 5 teams (NE, NYG): 0.95x
       Mild dampener for "great talent on bad team" overranking.
       Will be replaced with Vegas implied team total when populated.

  5. WIDER OPPORTUNITY CAP:
       Was capped at \xb110%. Now \xb115%, AND fantasy-playoff weeks count
       2x in the opportunity calculation. Lets late-season role
       expansion (Brown, Hampton) carry more signal.

Run from AIOmni repo root:
    python3 scripts/phase3_v25_calibration.py
"""
from pathlib import Path
import sys

ROOT = Path('.')
ENGINE = ROOT / 'supabase' / 'functions' / 'aiomni-rankings-engine' / 'index.ts'

if not ENGINE.exists():
    print('[ERROR]    engine not found.')
    sys.exit(1)

s = ENGINE.read_text()
orig = s

# ═══════════════════════════════════════════════════════════════════════
# TWEAK 1: Fantasy-playoff weighting in aggregateSeason
# ═══════════════════════════════════════════════════════════════════════

old_recency = """    // Recency weighted PPG: last 6 games count 3x, earlier games 1x
    const games = agg.weeks;
    const recencyCutoff = Math.max(0, games.length - 6);
    let weightedSum = 0;
    let totalWeight = 0;
    for (let i = 0; i < games.length; i++) {
      const w = i >= recencyCutoff ? 3 : 1;
      weightedSum += games[i].pts * w;
      totalWeight += w;
    }
    agg.recencyPpg = totalWeight > 0 ? weightedSum / totalWeight : agg.ppg;"""

new_recency = """    // Fantasy-playoff weighting (v2.5): when championships matter,
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
    agg.recencyPpg = totalWeight > 0 ? weightedSum / totalWeight : agg.ppg;"""

if old_recency in s:
    s = s.replace(old_recency, new_recency)
    print('[APPLIED]  tweak 1: fantasy-playoff weighting (wks 14-17 = 4x)')
else:
    print('[ERROR]    tweak 1 anchor not found')
    sys.exit(1)

# ═══════════════════════════════════════════════════════════════════════
# TWEAK 2: Injury-year rebound logic
# ═══════════════════════════════════════════════════════════════════════
# Inject a check before the regular baseline calculation. If the player
# meets the injury-rebound criteria, override the baseline.

old_baseline_pre = """    if (useMultiYear && has25 && has24 && has23) {
      baseline = 0.6 * a25!.recencyPpg + 0.3 * a24!.recencyPpg + 0.1 * a23!.recencyPpg;
      baselineSource = `3yr blend`;"""

new_baseline_pre = """    // INJURY-YEAR REBOUND check (v2.5):
    // If the player\\'s prior 2 years averaged >= 14 PPG and most recent
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
      baselineSource = `3yr blend`;"""

if old_baseline_pre in s:
    s = s.replace(old_baseline_pre, new_baseline_pre)
    print('[APPLIED]  tweak 2: injury-year rebound logic')
else:
    print('[ERROR]    tweak 2 anchor not found')
    sys.exit(1)

# ─── Need to move injuryNameKey declaration BEFORE baseline calc ──────
# Currently the code has:
#   ... compute baseline ...
#   ... volatility penalty ...
#   ... injury discount (which sets injuryNameKey) ...
# We need injuryNameKey to be available DURING baseline calc.
# Easiest: hoist the declaration to the top of the per-player loop.

old_injury_block = """    // ── Injury discount ──
    // Cross-ref ESPN injury feed by normalized name. Aggressive: serious
    // \\"Out\\" injuries (ACL/Achilles/etc) drop score by 90%.
    const injuryNameKey = (p.full_name || '').toLowerCase().replace(/[^a-z]/g, '');
    const injInfo = injuryMap.get(injuryNameKey);
    let injuryMult = 1.0;
    let injuryNote = '';
    if (injInfo && injInfo.multiplier < 1.0) {
      injuryMult = injInfo.multiplier;
      baseline = baseline * injuryMult;
      injuryNote = `INJURY: ${injInfo.injury} (${injuryMult.toFixed(2)}x)`;
    }"""

new_injury_block = """    // ── Injury discount ──
    // Cross-ref ESPN injury feed by normalized name. Aggressive: serious
    // \\"Out\\" injuries (ACL/Achilles/etc) drop score by 90%.
    // Note: injuryNameKey is hoisted to the top of the loop in v2.5 so
    // the injury-rebound logic can reference it.
    const injInfo = injuryMap.get(injuryNameKey);
    let injuryMult = 1.0;
    let injuryNote = '';
    if (injInfo && injInfo.multiplier < 1.0) {
      injuryMult = injInfo.multiplier;
      baseline = baseline * injuryMult;
      injuryNote = `INJURY: ${injInfo.injury} (${injuryMult.toFixed(2)}x)`;
    }"""

if old_injury_block in s:
    s = s.replace(old_injury_block, new_injury_block)
    print('[APPLIED]  tweak 2b: injuryNameKey reference fixed in injury block')

# Hoist injuryNameKey to top of for-player loop
old_loop_top = """  for (const p of players) {
    const age = p.age ?? 25;
    const a25 = agg2025.get(p.gsis_id);
    const a24 = agg2024.get(p.gsis_id);
    const a23 = agg2023.get(p.gsis_id);
    const isRookie = p.rookie_year === 2026 || p.draft_year === 2026;"""

new_loop_top = """  for (const p of players) {
    const age = p.age ?? 25;
    const a25 = agg2025.get(p.gsis_id);
    const a24 = agg2024.get(p.gsis_id);
    const a23 = agg2023.get(p.gsis_id);
    const isRookie = p.rookie_year === 2026 || p.draft_year === 2026;
    // Hoisted (v2.5): injuryNameKey available throughout the loop body
    const injuryNameKey = (p.full_name || '').toLowerCase().replace(/[^a-z]/g, '');"""

if old_loop_top in s:
    s = s.replace(old_loop_top, new_loop_top)
    print('[APPLIED]  tweak 2c: injuryNameKey hoisted to top of loop')

# ═══════════════════════════════════════════════════════════════════════
# TWEAK 3: Rookie ladder (replaces flat 1.15x boost)
# ═══════════════════════════════════════════════════════════════════════

# Replace rookieBaselineByPos calls aren\\'t affected -- this changes the
# rookieBoost variable which is added to the forward layer.

old_rookie_boost = """    const rookieBoost = isRookie ? 0.15 : 0;"""

new_rookie_boost = """    // Rookie ladder (v2.5): boost size scales with draft capital.
    //   Top-10 pick: +30%, R1: +20%, R2: +10%, R3: +5%, R4+: 0%.
    //   Undrafted/unknown round rookies get nothing.
    let rookieBoost = 0;
    if (isRookie) {
      const pick = p.draft_pick;
      const round = p.draft_round;
      if (typeof pick === 'number' && pick <= 10) rookieBoost = 0.30;
      else if (round === 1) rookieBoost = 0.20;
      else if (round === 2) rookieBoost = 0.10;
      else if (round === 3) rookieBoost = 0.05;
      else rookieBoost = 0; // R4+ or unknown
    }"""

if old_rookie_boost in s:
    s = s.replace(old_rookie_boost, new_rookie_boost)
    print('[APPLIED]  tweak 3: rookie ladder by draft capital')
else:
    print('[ERROR]    tweak 3 anchor not found')
    sys.exit(1)

# ═══════════════════════════════════════════════════════════════════════
# TWEAK 4: Weak-team penalty (offense tier 5 teams: NE, NYG)
# ═══════════════════════════════════════════════════════════════════════
# Inject after teamMult calculation.

old_team_calc = """    const teamMult = teamChangeAdj(a25?.lastTeam ?? a24?.lastTeam ?? null, p.team);"""

new_team_calc = """    let teamMult = teamChangeAdj(a25?.lastTeam ?? a24?.lastTeam ?? null, p.team);
    // Weak-team penalty (v2.5): skill-position players on tier-5 offenses
    // (currently NE, NYG) get a 0.95x dampener. Will be replaced with
    // Vegas implied team total when nfl_season_win_totals is populated.
    let weakTeamPenalty = false;
    if (['QB', 'RB', 'WR', 'TE'].includes(p.position) && (OFFENSE_TIER_2024[p.team ?? ''] ?? 3) >= 5) {
      teamMult = teamMult * 0.95;
      weakTeamPenalty = true;
    }"""

if old_team_calc in s:
    s = s.replace(old_team_calc, new_team_calc)
    print('[APPLIED]  tweak 4: weak-team penalty for tier-5 offenses')
else:
    print('[ERROR]    tweak 4 anchor not found')
    sys.exit(1)

# ═══════════════════════════════════════════════════════════════════════
# TWEAK 5: Wider opportunity cap + playoff weighting
# ═══════════════════════════════════════════════════════════════════════

old_opp = """function opportunityAdj(
  weeks: { week: number; targets?: number; carries?: number; }[],
): number {
  if (weeks.length < 4) return 0;
  const sorted = [...weeks].sort((a, b) => a.week - b.week);
  const half = Math.floor(sorted.length / 2);
  const earlyAvg = sorted.slice(0, half).reduce((s, w) => s + (w.targets ?? 0) + (w.carries ?? 0), 0) / Math.max(half, 1);
  const lateAvg = sorted.slice(half).reduce((s, w) => s + (w.targets ?? 0) + (w.carries ?? 0), 0) / Math.max(sorted.length - half, 1);
  if (earlyAvg <= 0) return 0;
  const delta = (lateAvg - earlyAvg) / earlyAvg;
  return Math.max(-0.10, Math.min(0.10, delta * 0.5));
}"""

new_opp = """function opportunityAdj(
  weeks: { week: number; targets?: number; carries?: number; }[],
): number {
  if (weeks.length < 4) return 0;
  const sorted = [...weeks].sort((a, b) => a.week - b.week);
  // v2.5: weight playoff weeks (14-17) 2x in the opportunity calc.
  // Total opportunity = targets + carries, weighted by playoff-week multiplier.
  const opportunity = (w: any) => {
    const base = (w.targets ?? 0) + (w.carries ?? 0);
    return (w.week >= 14 && w.week <= 17) ? base * 2 : base;
  };
  const half = Math.floor(sorted.length / 2);
  const earlyAvg = sorted.slice(0, half).reduce((s, w) => s + opportunity(w), 0) / Math.max(half, 1);
  const lateAvg = sorted.slice(half).reduce((s, w) => s + opportunity(w), 0) / Math.max(sorted.length - half, 1);
  if (earlyAvg <= 0) return 0;
  const delta = (lateAvg - earlyAvg) / earlyAvg;
  return Math.max(-0.15, Math.min(0.15, delta * 0.5));  // v2.5: cap widened from \xb110% to \xb115%
}"""

if old_opp in s:
    s = s.replace(old_opp, new_opp)
    print('[APPLIED]  tweak 5: opportunity cap widened to \xb115%, playoff weighted 2x')
else:
    print('[ERROR]    tweak 5 anchor not found')
    sys.exit(1)

# ═══════════════════════════════════════════════════════════════════════
# Surface tweaks in method string
# ═══════════════════════════════════════════════════════════════════════

old_method = """    if (Math.abs(oppAdj) >= 0.03) parts.push(`opp ${oppAdj > 0 ? '+' : ''}${(oppAdj * 100).toFixed(0)}%`);
    if (sampleSizePenalty) parts.push('1yr sample (0.90x)');
    if (injuryNote) parts.push(injuryNote);"""

new_method = """    if (Math.abs(oppAdj) >= 0.03) parts.push(`opp ${oppAdj > 0 ? '+' : ''}${(oppAdj * 100).toFixed(0)}%`);
    if (sampleSizePenalty) parts.push('1yr sample (0.90x)');
    if (weakTeamPenalty) parts.push(`${p.team} weak offense (0.95x)`);
    if (injuryNote) parts.push(injuryNote);
    if (rookieBoost > 0) parts.push(`rookie boost +${(rookieBoost*100).toFixed(0)}%`);"""

if old_method in s:
    s = s.replace(old_method, new_method)
    print('[APPLIED]  method string surfaces v2.5 tweaks')
else:
    print('[WARN]     method string anchor not found')

if s != orig:
    ENGINE.write_text(s)
    print()
    print('Done. Redeploy + recompute:')
    print('  supabase functions deploy aiomni-rankings-engine')
    print('  curl -X POST "https://khoruzvsprxyocisuhet.supabase.co/functions/v1/aiomni-rankings-engine" -H "apikey: $TOKEN" -H "Authorization: Bearer $TOKEN"')
    print()
    print('Then verify the predictions:')
    print('  - Taylor: rank ~RB8-10, baseline ~16.5-17 PPG (was 18.2 at RB5)')
    print('  - Chase Brown: rank ~RB3, baseline ~19+ PPG (was RB4 at 17.3)')
    print('  - Jefferson: rank ~WR8-12 with rebound tag (was WR17)')
    print('  - Burrow: SF QB rank ~5-6 with rebound tag')
    print('  - Jeremiyah Love (R1 P3 RB ARI): top 30 with rookie boost +30%')
    print('  - RJ Harvey/Tyrone Tracy: drop out of top 50')
    print('  - NYG/NE skill players: weak-team tag')
else:
    print('[SKIP]     no changes')
