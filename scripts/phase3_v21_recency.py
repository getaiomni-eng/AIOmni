#!/usr/bin/env python3
"""
AIOmni Phase 3 v2.1 — recency weighting + volatility penalty.

Problem: Jonathan Taylor 2025 = 21.3 PPG season-long, but breaks down as
27.1 PPG first half / 16.2 PPG second half (or 11.0 PPG last 7 games
without the wk10 outlier). The engine was using 21.3 as if it represented
who he is going into 2026. He's actually closer to 14-15 PPG real talent.

Two adjustments to the baseline calculation:

  1. RECENCY-WEIGHTED PPG within each season:
       last 6 games count 3x, prior games count 1x.
     A player who collapsed late will have a lower recency-weighted PPG
     than season-average. A player who got better late benefits.

  2. VOLATILITY PENALTY:
       compute std dev of game scores. If std dev / mean > 0.7 (high
       boom/bust), apply 0.92x multiplier. Steady producers preferred
       in fantasy projections.

Expected effects on Taylor:
  - Recency-weighted PPG drops from 21.3 to ~16
  - Volatility penalty knocks another 8% off
  - New baseline: ~14.5 ppg (close to my eyeball estimate of 14-15)
  - Should drop from RB3-ish to RB10-12 range
  - Method string will explain: "2025 recency: 16.0 ppg · volatile (0.92x)"

Other players this will affect:
  - CMC age 29: already getting age decline, recency will compound it
  - Late-season risers (Drake London, Garrett Wilson if they finished
    strong) will get a boost
  - Steady eddies like Amon-Ra, JSN unaffected (low volatility, even pace)

Run from AIOmni repo root:
    python3 scripts/phase3_v21_recency.py
"""
from pathlib import Path
import sys

ROOT = Path('.')
ENGINE = ROOT / 'supabase' / 'functions' / 'aiomni-rankings-engine' / 'index.ts'

if not ENGINE.exists():
    print(f'[ERROR]    {ENGINE} not found.')
    sys.exit(1)

s = ENGINE.read_text()
orig = s

# ─── Replace SeasonAgg type to track game-by-game scores ───
# Need individual game scores for both recency and volatility calcs.

old_seasonagg = '''interface SeasonAgg {
  ppg: number;
  games: number;
  weeks: { week: number; targets: number; carries: number; }[];
  lastTeam: string | null;
}

function aggregateSeason(rows: any[], ptsCol: string): Map<string, SeasonAgg> {
  const map = new Map<string, SeasonAgg>();
  for (const w of rows) {
    const pts = (w as any)[ptsCol] ?? 0;
    const targets = w.targets ?? 0;
    const carries = w.carries ?? 0;
    if (pts === 0 && targets === 0 && carries === 0) continue;
    const prev = map.get(w.gsis_id) ?? { ppg: 0, games: 0, weeks: [], lastTeam: null };
    prev.ppg += pts;
    prev.games += 1;
    prev.weeks.push({ week: w.week, targets, carries });
    prev.lastTeam = w.team ?? prev.lastTeam;
    map.set(w.gsis_id, prev);
  }
  // Convert running totals to PPG
  for (const [id, agg] of map) {
    if (agg.games > 0) agg.ppg = agg.ppg / agg.games;
  }
  return map;
}'''

new_seasonagg = '''interface SeasonAgg {
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

    // Recency weighted PPG: last 6 games count 3x, earlier games 1x
    const games = agg.weeks;
    const recencyCutoff = Math.max(0, games.length - 6);
    let weightedSum = 0;
    let totalWeight = 0;
    for (let i = 0; i < games.length; i++) {
      const w = i >= recencyCutoff ? 3 : 1;
      weightedSum += games[i].pts * w;
      totalWeight += w;
    }
    agg.recencyPpg = totalWeight > 0 ? weightedSum / totalWeight : agg.ppg;

    // Volatility: coefficient of variation (std dev / mean), bounded
    if (agg.ppg > 0 && agg.games >= 4) {
      const mean = agg.ppg;
      const variance = games.reduce((s, g) => s + Math.pow(g.pts - mean, 2), 0) / agg.games;
      const stdDev = Math.sqrt(variance);
      agg.volatility = stdDev / mean;
    }
  }
  return map;
}'''

if old_seasonagg in s:
    s = s.replace(old_seasonagg, new_seasonagg)
    print('[APPLIED]  SeasonAgg now tracks recency-weighted PPG + volatility per player')
else:
    print('[ERROR]    could not find SeasonAgg block')
    sys.exit(1)

# ─── Update the baseline calculation in buildFormat to use recencyPpg ───
# Replace the multi-year blend logic with one that uses recencyPpg as
# the per-season number, and applies a volatility penalty at the end.

old_baseline_block = '''    // ── Multi-year weighted baseline ──
    // Young players (<=27): blend 3 years 60/30/10 if available.
    // Older players (28+):  recent year only -- decline matters more.
    let baseline = 0;
    let baselineSource = '';
    const useMultiYear = age <= 27;
    const has25 = a25 && a25.games >= 4;
    const has24 = a24 && a24.games >= 4;
    const has23 = a23 && a23.games >= 4;

    if (useMultiYear && has25 && has24 && has23) {
      baseline = 0.6 * a25!.ppg + 0.3 * a24!.ppg + 0.1 * a23!.ppg;
      baselineSource = `3yr blend`;
    } else if (useMultiYear && has25 && has24) {
      baseline = 0.7 * a25!.ppg + 0.3 * a24!.ppg;
      baselineSource = `2yr blend`;
    } else if (has25) {
      baseline = a25!.ppg;
      baselineSource = `2025`;
    } else if (has24) {
      // injured 2025? use 2024 with discount
      baseline = a24!.ppg * 0.85;
      baselineSource = `2024 (no 2025)`;
    } else if (isRookie) {
      baseline = rookieBaselineByPos(p.position, p.draft_round);
      baselineSource = `rookie R${p.draft_round ?? '?'}`;
    } else {
      continue;
    }

    if (baseline <= 0) continue;'''

new_baseline_block = '''    // ── Multi-year weighted baseline using RECENCY-WEIGHTED ppg ──
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

    if (useMultiYear && has25 && has24 && has23) {
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
    }'''

if old_baseline_block in s:
    s = s.replace(old_baseline_block, new_baseline_block)
    print('[APPLIED]  baseline now uses recencyPpg + volatility penalty')
else:
    print('[ERROR]    could not find baseline calculation block')
    sys.exit(1)

# ─── Update the method-string builder to surface the new info ───

old_method = '''    // Build readable method
    const parts: string[] = [];
    parts.push(`${baselineSource}: ${baseline.toFixed(1)} ppg`);
    if (Math.abs(ageMult - 1.0) >= 0.05) {
      const tag = ageMult > 1 ? 'peak' : ageMult < 0.7 ? 'cliff' : 'decline';
      parts.push(`age ${age} ${tag} (${ageMult.toFixed(2)}x)`);
    }
    if (Math.abs(teamMult - 1.0) >= 0.03 && a25?.lastTeam) parts.push(`${a25.lastTeam}→${p.team} (${teamMult.toFixed(2)}x)`);
    if (isRookie) parts.push(`rookie (R${p.draft_round ?? '?'})`);
    if (Math.abs(oppAdj) >= 0.03) parts.push(`opp ${oppAdj > 0 ? '+' : ''}${(oppAdj * 100).toFixed(0)}%`);'''

new_method = '''    // Build readable method
    const parts: string[] = [];
    parts.push(`${baselineSource}: ${baseline.toFixed(1)} ppg`);
    if (highVolatility) parts.push(`volatile (0.92x)`);
    if (Math.abs(ageMult - 1.0) >= 0.05) {
      const tag = ageMult > 1 ? 'peak' : ageMult < 0.7 ? 'cliff' : 'decline';
      parts.push(`age ${age} ${tag} (${ageMult.toFixed(2)}x)`);
    }
    if (Math.abs(teamMult - 1.0) >= 0.03 && a25?.lastTeam) parts.push(`${a25.lastTeam}→${p.team} (${teamMult.toFixed(2)}x)`);
    if (isRookie) parts.push(`rookie (R${p.draft_round ?? '?'})`);
    if (Math.abs(oppAdj) >= 0.03) parts.push(`opp ${oppAdj > 0 ? '+' : ''}${(oppAdj * 100).toFixed(0)}%`);'''

if old_method in s:
    s = s.replace(old_method, new_method)
    print('[APPLIED]  method string surfaces volatility tag')
else:
    print('[WARN]     method string block not found, skipping')

# ─── Also need to update the floor protection finishedRanks calc since
# it used a25.ppg before — change to recencyPpg for consistency ───

old_finished = '''  // 2025 positional finish (for floor protection on players < 30)
  const finishedRanks = new Map<string, number>();
  const byPos: Record<string, { gsis_id: string; ppg: number; }[]> = {};
  for (const p of players) {
    const a = agg2025.get(p.gsis_id);
    if (!a || a.games < 6) continue;
    (byPos[p.position] = byPos[p.position] ?? []).push({ gsis_id: p.gsis_id, ppg: a.ppg });
  }
  for (const pos of Object.keys(byPos)) {
    byPos[pos].sort((a, b) => b.ppg - a.ppg);
    byPos[pos].forEach((row, i) => finishedRanks.set(row.gsis_id, i + 1));
  }'''

new_finished = '''  // 2025 positional finish (for floor protection on players < 30).
  // Use recency-weighted ppg so a player who collapsed late doesn\\'t
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
  }'''

if old_finished in s:
    s = s.replace(old_finished, new_finished)
    print('[APPLIED]  floor protection uses recencyPpg (no more "hot start" rescues)')

if s != orig:
    ENGINE.write_text(s)
    print()
    print('Done.')
    print()
    print('Redeploy + recompute:')
    print('  supabase functions deploy aiomni-rankings-engine')
    print('  curl -X POST "https://khoruzvsprxyocisuhet.supabase.co/functions/v1/aiomni-rankings-engine" -H "apikey: $TOKEN" -H "Authorization: Bearer $TOKEN"')
    print()
    print('Then check Taylor specifically:')
    print('  curl -s "https://khoruzvsprxyocisuhet.supabase.co/rest/v1/nfl_proprietary_rankings?format=eq.PPR&select=rank,pos_rank,name,score,baseline_2025,method&name=ilike.*jonathan%20taylor*" -H "apikey: $TOKEN" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool')
    print()
    print('Expected: Taylor drops to RB10-15 range with method like:')
    print('  "2025 recency: 14.5 ppg · volatile (0.92x) · ..."')
else:
    print('[SKIP]     no changes')
