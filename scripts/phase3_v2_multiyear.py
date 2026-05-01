#!/usr/bin/env python3
"""
AIOmni Phase 3 v2 — multi-year baseline + aged-vet correction.

Three things this script does:

  1. Triggers a backfill of 2023 + 2024 weekly stats via the existing
     nflverse-weekly-sync edge function. (No code change to that
     function -- it already accepts ?seasons=2023,2024.)

  2. Rewrites the engine with a multi-year weighted baseline:
       - Ages <= 27:  60% × 2025 + 30% × 2024 + 10% × 2023
       - Ages 28+:    100% × 2025 (recent decline matters more)
     This lets emerging young players show their trajectory without
     letting late-career outliers (Kelce 2024 vs 2025) get propped
     up by an old peak season.

  3. Strengthens age decline curves:
       - TE age 33+ now 0.55x (was 0.75x) — Kelce-killer
       - RB age 30+ now 0.50x (was 0.65x)
       - WR age 33+ now 0.60x (was 0.70x)
     Plus removes floor protection from players age >= 30. Floor
     protection was meant for "we know he\\'s still good," not "we
     know he WAS good a year ago."

What you do after this script runs:

  Step A: Trigger 2023+2024 backfill (5-10 min)
       TOKEN="<anon_key>"
       curl -X POST "https://khoruzvsprxyocisuhet.supabase.co/functions/v1/nflverse-weekly-sync?seasons=2023,2024" \\
            -H "apikey: $TOKEN" -H "Authorization: Bearer $TOKEN"

  Step B: Verify both seasons now have ~19k rows each
       curl -s "https://khoruzvsprxyocisuhet.supabase.co/rest/v1/nfl_weekly_stats?select=count&season=eq.2024" \\
            -H "apikey: $TOKEN" -H "Authorization: Bearer $TOKEN" -H "Prefer: count=exact"
       curl -s "https://khoruzvsprxyocisuhet.supabase.co/rest/v1/nfl_weekly_stats?select=count&season=eq.2023" \\
            -H "apikey: $TOKEN" -H "Authorization: Bearer $TOKEN" -H "Prefer: count=exact"

  Step C: Redeploy the engine
       supabase functions deploy aiomni-rankings-engine

  Step D: Trigger a fresh ranking computation
       curl -X POST "https://khoruzvsprxyocisuhet.supabase.co/functions/v1/aiomni-rankings-engine" \\
            -H "apikey: $TOKEN" -H "Authorization: Bearer $TOKEN"

  Step E: Check Kelce specifically and the new top 15
       curl -s "https://khoruzvsprxyocisuhet.supabase.co/rest/v1/nfl_proprietary_rankings?format=eq.PPR&select=rank,name,score,method&name=ilike.*kelce*" \\
            -H "apikey: $TOKEN" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

Run from AIOmni repo root:
    python3 scripts/phase3_v2_multiyear.py
"""
from pathlib import Path
import sys

ROOT = Path('.')
ENGINE = ROOT / 'supabase' / 'functions' / 'aiomni-rankings-engine' / 'index.ts'

if not ENGINE.exists():
    print(f'[ERROR]    {ENGINE} not found.')
    sys.exit(1)

# Rewrite the entire engine. v1 had too many small changes to patch
# surgically; cleaner to drop in v2 wholesale.

ENGINE_V2 = '''// supabase/functions/aiomni-rankings-engine/index.ts
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
  const half = Math.floor(sorted.length / 2);
  const earlyAvg = sorted.slice(0, half).reduce((s, w) => s + (w.targets ?? 0) + (w.carries ?? 0), 0) / Math.max(half, 1);
  const lateAvg = sorted.slice(half).reduce((s, w) => s + (w.targets ?? 0) + (w.carries ?? 0), 0) / Math.max(sorted.length - half, 1);
  if (earlyAvg <= 0) return 0;
  const delta = (lateAvg - earlyAvg) / earlyAvg;
  return Math.max(-0.10, Math.min(0.10, delta * 0.5));
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

async function buildFormat(format: Format, supabase: any): Promise<RankedRow[]> {
  const ptsCol = pointsCol(format);

  // Pull all 3 seasons in parallel
  const [w2025, w2024, w2023, playersResult] = await Promise.all([
    fetchSeason(supabase, 2025, ptsCol),
    fetchSeason(supabase, 2024, ptsCol),
    fetchSeason(supabase, 2023, ptsCol),
    supabase.from('nfl_players')
      .select('gsis_id, full_name, position, team, age, rookie_year, draft_year, draft_round')
      .in('position', ['QB', 'RB', 'WR', 'TE'])
      .eq('is_active', true),
  ]);

  if (playersResult.error) throw playersResult.error;
  const players = playersResult.data ?? [];
  if (!players.length) throw new Error('no active players');

  console.log(`[${format}] players=${players.length} w2025=${w2025.length} w2024=${w2024.length} w2023=${w2023.length}`);

  const agg2025 = aggregateSeason(w2025, ptsCol);
  const agg2024 = aggregateSeason(w2024, ptsCol);
  const agg2023 = aggregateSeason(w2023, ptsCol);

  // 2025 positional finish (for floor protection on players < 30)
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

    // ── Multi-year weighted baseline ──
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

    if (baseline <= 0) continue;

    const ageMult = ageCurve(p.position, age);
    const teamMult = teamChangeAdj(a25?.lastTeam ?? a24?.lastTeam ?? null, p.team);
    const rookieBoost = isRookie ? 0.15 : 0;
    const oppAdj = a25 ? opportunityAdj(a25.weeks) : 0;
    const formatAdj = formatPositionAdj(format, p.position, age);

    const forwardLayer = baseline * ageMult * teamMult * (1 + rookieBoost) * (1 + oppAdj) * formatAdj;
    const score = baseline * 0.25 + forwardLayer * 0.75;

    // Build readable method
    const parts: string[] = [];
    parts.push(`${baselineSource}: ${baseline.toFixed(1)} ppg`);
    if (Math.abs(ageMult - 1.0) >= 0.05) {
      const tag = ageMult > 1 ? 'peak' : ageMult < 0.7 ? 'cliff' : 'decline';
      parts.push(`age ${age} ${tag} (${ageMult.toFixed(2)}x)`);
    }
    if (Math.abs(teamMult - 1.0) >= 0.03 && a25?.lastTeam) parts.push(`${a25.lastTeam}→${p.team} (${teamMult.toFixed(2)}x)`);
    if (isRookie) parts.push(`rookie (R${p.draft_round ?? '?'})`);
    if (Math.abs(oppAdj) >= 0.03) parts.push(`opp ${oppAdj > 0 ? '+' : ''}${(oppAdj * 100).toFixed(0)}%`);

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
'''

ENGINE.write_text(ENGINE_V2)
print('[APPLIED]  engine v2 written (multi-year baseline + steeper aged-vet curves + age-aware floor protection)')

print()
print('Done.')
print()
print('Now run these in order:')
print()
print('Step A — backfill 2023+2024 (5-10 min):')
print('  TOKEN="<anon_key>"')
print('  curl -X POST "https://khoruzvsprxyocisuhet.supabase.co/functions/v1/nflverse-weekly-sync?seasons=2023,2024" \\')
print('       -H "apikey: $TOKEN" -H "Authorization: Bearer $TOKEN"')
print()
print('Step B — verify counts (each should be ~19k):')
print('  curl -s "https://khoruzvsprxyocisuhet.supabase.co/rest/v1/nfl_weekly_stats?select=count&season=eq.2024" \\')
print('       -H "apikey: $TOKEN" -H "Authorization: Bearer $TOKEN" -H "Prefer: count=exact"')
print('  curl -s "https://khoruzvsprxyocisuhet.supabase.co/rest/v1/nfl_weekly_stats?select=count&season=eq.2023" \\')
print('       -H "apikey: $TOKEN" -H "Authorization: Bearer $TOKEN" -H "Prefer: count=exact"')
print()
print('Step C — deploy v2 engine:')
print('  supabase functions deploy aiomni-rankings-engine')
print()
print('Step D — recompute rankings:')
print('  curl -X POST "https://khoruzvsprxyocisuhet.supabase.co/functions/v1/aiomni-rankings-engine" \\')
print('       -H "apikey: $TOKEN" -H "Authorization: Bearer $TOKEN"')
print()
print('Step E — sanity check Kelce + top 15:')
print('  curl -s "https://khoruzvsprxyocisuhet.supabase.co/rest/v1/nfl_proprietary_rankings?format=eq.PPR&select=rank,pos_rank,name,position,team,score,method&name=ilike.*kelce*" \\')
print('       -H "apikey: $TOKEN" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool')
print('  curl -s "https://khoruzvsprxyocisuhet.supabase.co/rest/v1/nfl_proprietary_rankings?format=eq.PPR&select=rank,pos_rank,name,position,team,score,method&order=rank&limit=15" \\')
print('       -H "apikey: $TOKEN" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool')
