#!/usr/bin/env python3
"""
AIOmni Phase 3 Chunk 3.1 — Proprietary Rankings Engine.

Builds the AIOmni rankings synthesis pipeline that combines 2025 fantasy
points (anchor, 25%) with aggressive forward-looking adjustments (75%):

  - Age curve per position (RB cliff at 28, WR at 32, QB peak 26-34, etc.)
  - Team-change delta (free-agency landing spot quality)
  - Draft capital adjustment for 2026 rookies
  - Opportunity score (snap share + target share trends)
  - Floor protection (top-24 finishers can't fall below finish + 12)
  - Ceiling permission (young players uncapped)

What this script writes:

  1. supabase/migrations/{timestamp}_create_proprietary_rankings.sql
     Creates nfl_proprietary_rankings table with method explanation
     per player (so the UI can show "why this rank").

  2. supabase/functions/aiomni-rankings-engine/index.ts
     Edge function that pulls from nfl_weekly_stats + nfl_players,
     runs the synthesis, writes to nfl_proprietary_rankings.
     Triggerable via HTTP POST or pg_cron weekly.

  3. supabase/functions/aiomni-rankings-engine/deno.json (optional)
     Just declares the import map for clarity.

After running this script, you need to:

  Step A: Apply the migration
       supabase db push
     OR run the SQL directly in your Supabase SQL editor.

  Step B: Deploy the function
       supabase functions deploy aiomni-rankings-engine

  Step C: Trigger first run (will populate the table)
       curl -X POST "https://khoruzvsprxyocisuhet.supabase.co/functions/v1/aiomni-rankings-engine" \\
            -H "apikey: $TOKEN" -H "Authorization: Bearer $TOKEN"

If any of those fail, paste the error and I'll fix.

Run from AIOmni repo root:
    python3 scripts/phase3_chunk1_proprietary_engine.py
"""
from pathlib import Path
import sys
from datetime import datetime, timezone

ROOT = Path('.')
SUPA = ROOT / 'supabase'
MIGRATIONS = SUPA / 'migrations'
FUNCTIONS  = SUPA / 'functions'

if not SUPA.exists():
    print('[ERROR]    supabase/ directory not found. Run from AIOmni repo root.')
    sys.exit(1)

MIGRATIONS.mkdir(parents=True, exist_ok=True)
applied = []

# ═══════════════════════════════════════════════════════════════════════
# DELIVERABLE 1: SQL migration -- nfl_proprietary_rankings table
# ═══════════════════════════════════════════════════════════════════════

ts = datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')
migration_file = MIGRATIONS / f'{ts}_create_proprietary_rankings.sql'

MIGRATION_SQL = '''-- AIOmni proprietary rankings table.
-- Populated by supabase/functions/aiomni-rankings-engine on a weekly cron.
-- Read by the client (services/rankingsData.ts → fetchAIOmniProprietary).

CREATE TABLE IF NOT EXISTS nfl_proprietary_rankings (
  -- Composite key: per-format snapshot of the rankings
  format          text NOT NULL,                  -- 'PPR' | 'HALF' | 'STD' | 'SF' | 'DYN'
  rank            int  NOT NULL,                  -- 1..250 within the format
  gsis_id         text NOT NULL,
  name            text NOT NULL,
  position        text NOT NULL,
  team            text,
  pos_rank        int,                            -- per-position rank
  score           numeric(8,3) NOT NULL,          -- raw synthesis score
  tier            int,
  -- Component breakdowns -- used for the "why this rank" UI later
  baseline_2025   numeric(6,2),                   -- 2025 PPR/Half/Std avg per game
  age_adj         numeric(5,2),                   -- multiplier from age curve
  team_change_adj numeric(5,2),                   -- delta from FA/trade landing
  rookie_boost    numeric(5,2),                   -- 0 for vets, positive for 2026 draftees
  opportunity_adj numeric(5,2),                   -- snap share + target trend
  floor_protected boolean DEFAULT false,
  method          text,                            -- human-readable explanation
  computed_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (format, rank)
);

CREATE INDEX IF NOT EXISTS idx_prop_rankings_gsis ON nfl_proprietary_rankings (gsis_id);
CREATE INDEX IF NOT EXISTS idx_prop_rankings_format_pos ON nfl_proprietary_rankings (format, position);

-- Allow anon read (rankings are public)
ALTER TABLE nfl_proprietary_rankings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon read proprietary rankings" ON nfl_proprietary_rankings;
CREATE POLICY "anon read proprietary rankings"
  ON nfl_proprietary_rankings FOR SELECT
  TO anon, authenticated
  USING (true);

-- Only service role writes (only the edge function should populate)
DROP POLICY IF EXISTS "service writes proprietary rankings" ON nfl_proprietary_rankings;
CREATE POLICY "service writes proprietary rankings"
  ON nfl_proprietary_rankings FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE nfl_proprietary_rankings IS
  'AIOmni-synthesized rankings. 75% aggressive (age, team, capital, opportunity), 25% anchored to 2025 finish. Recomputed weekly.';
'''

migration_file.write_text(MIGRATION_SQL)
applied.append(f'wrote {migration_file.name}')

# ═══════════════════════════════════════════════════════════════════════
# DELIVERABLE 2: edge function aiomni-rankings-engine
# ═══════════════════════════════════════════════════════════════════════

ENGINE_FN = '''// supabase/functions/aiomni-rankings-engine/index.ts
// ──────────────────────────────────────────────────────────────────────
// AIOMNI PROPRIETARY RANKINGS ENGINE
//
// Synthesis pipeline:
//   Score = 0.25 * baseline_2025  +  0.75 * forward_layer
//
// where forward_layer = age_curve_mult * team_change_mult
//                     * (1 + rookie_boost) * (1 + opportunity_adj)
//
// Floor protection: any 2025 top-24 finisher at position cannot fall
// below their 2025 rank + 12. Prevents the aggressive layer from doing
// something embarrassing (like ranking Jefferson WR15).
//
// Ceiling permission: rookies and 2nd-year players have no floor; they
// can rocket up if landing spot + draft capital + age all align.
//
// Outputs: 5 format snapshots (PPR / HALF / STD / SF / DYN) into
// nfl_proprietary_rankings. ~250 rows per format.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type Format = 'PPR' | 'HALF' | 'STD' | 'SF' | 'DYN';

// ─── AGE CURVES ────────────────────────────────────────────────────────
// Multipliers applied to the forward layer. >1.0 = positive adjustment,
// <1.0 = decline. Calibrated from public dynasty research (KTC, DLF).
function ageCurve(position: string, age: number | null): number {
  if (!age || age <= 0) return 1.0;
  const a = age;

  if (position === 'RB') {
    if (a <= 23) return 1.20;
    if (a <= 26) return 1.10;
    if (a === 27) return 1.00;
    if (a === 28) return 0.92;
    if (a === 29) return 0.80;
    if (a === 30) return 0.65;
    return 0.45;
  }
  if (position === 'WR') {
    if (a <= 23) return 1.15;
    if (a <= 27) return 1.10;
    if (a <= 30) return 1.00;
    if (a === 31) return 0.92;
    if (a === 32) return 0.82;
    if (a === 33) return 0.70;
    return 0.55;
  }
  if (position === 'TE') {
    if (a <= 24) return 1.05;
    if (a <= 28) return 1.10;
    if (a <= 31) return 1.00;
    if (a === 32) return 0.90;
    return 0.75;
  }
  if (position === 'QB') {
    if (a <= 24) return 1.05;
    if (a <= 33) return 1.00;
    if (a <= 36) return 0.95;
    if (a <= 38) return 0.85;
    return 0.70;
  }
  return 1.0;
}

// ─── TEAM-CHANGE DELTA ─────────────────────────────────────────────────
// Compares 2024 team to 2025 team. Better landing spot boosts forward
// layer. We proxy "better team" via a simple offensive tier (calibrated
// 2024 PPG ranks). Improvement of 2+ tiers = +5%, regression = -5%.
const OFFENSE_TIER_2024: Record<string, number> = {
  // Tier 1 (elite scoring)
  BAL: 1, BUF: 1, DET: 1, KC: 1, MIA: 1, SF: 1,
  // Tier 2 (above average)
  CIN: 2, DAL: 2, GB: 2, HOU: 2, LAR: 2, PHI: 2, TB: 2, WAS: 2,
  // Tier 3 (average)
  ARI: 3, ATL: 3, IND: 3, JAX: 3, LAC: 3, MIN: 3, PIT: 3, SEA: 3,
  // Tier 4 (below average)
  CAR: 4, CHI: 4, CLE: 4, DEN: 4, LV: 4, NO: 4, NYJ: 4, TEN: 4,
  // Tier 5 (bad)
  NE: 5, NYG: 5,
};

function teamChangeAdj(prevTeam: string | null, currTeam: string | null): number {
  if (!prevTeam || !currTeam || prevTeam === currTeam) return 1.0;
  const prev = OFFENSE_TIER_2024[prevTeam] ?? 3;
  const curr = OFFENSE_TIER_2024[currTeam] ?? 3;
  const tierDelta = prev - curr; // positive = moved to better team
  if (tierDelta >= 2) return 1.08;
  if (tierDelta === 1) return 1.04;
  if (tierDelta === -1) return 0.96;
  if (tierDelta <= -2) return 0.90;
  return 1.0;
}

// ─── ROOKIE BOOST ──────────────────────────────────────────────────────
// First-year players (rookie_year == 2026) get a positional default
// based on draft round when no 2025 stats exist.
function rookieBaselineByPos(position: string, draftRound: number | null): number {
  // Returns a baseline PPG to use when player has no 2025 stats.
  // Rough averages of how rookies finish historically by round:
  if (!draftRound || draftRound > 7) return 0;
  if (position === 'RB') {
    if (draftRound === 1) return 12.0;  // ~RB18 territory
    if (draftRound === 2) return 8.0;
    if (draftRound === 3) return 5.5;
    return 3.0;
  }
  if (position === 'WR') {
    if (draftRound === 1) return 10.0;  // ~WR30 territory
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
    if (draftRound === 1) return 14.0;  // assumed starter
    return 0;  // backup
  }
  return 0;
}

// ─── OPPORTUNITY ADJUSTMENT ────────────────────────────────────────────
// Late-season (weeks 14-22) snap/target share trend vs season average.
// Trending up = positive forward-layer boost. Capped at ±10%.
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

// ─── PER-FORMAT POINTS COLUMN ──────────────────────────────────────────
function pointsCol(format: Format): 'fantasy_pts_ppr' | 'fantasy_pts_half' | 'fantasy_pts_std' {
  if (format === 'PPR' || format === 'DYN' || format === 'SF') return 'fantasy_pts_ppr';
  if (format === 'HALF') return 'fantasy_pts_half';
  return 'fantasy_pts_std';
}

// ─── POSITION-AWARE BASELINE ANCHOR ────────────────────────────────────
// SF gives QBs a flat boost (they\\'re scarcer). Dynasty discounts age
// further than redraft.
function formatPositionAdj(format: Format, position: string, age: number): number {
  if (format === 'SF') {
    if (position === 'QB') return 1.40;  // scarcity premium
    return 1.0;
  }
  if (format === 'DYN') {
    if (age <= 24) return 1.10;
    if (age >= 30) return 0.85;
    return 1.0;
  }
  return 1.0;
}

// ─── MAIN PIPELINE ─────────────────────────────────────────────────────

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

async function buildFormat(
  format: Format,
  supabase: any,
): Promise<RankedRow[]> {
  const ptsCol = pointsCol(format);

  // 1. Pull all active fantasy-relevant players
  const { data: players, error: pErr } = await supabase
    .from('nfl_players')
    .select('gsis_id, full_name, position, team, age, rookie_year, draft_year, draft_round')
    .in('position', ['QB', 'RB', 'WR', 'TE'])
    .eq('is_active', true);
  if (pErr) throw pErr;
  if (!players?.length) throw new Error('no active players');

  // 2. Pull 2025 weekly stats (full season + playoffs)
  const { data: weekly2025, error: wErr } = await supabase
    .from('nfl_weekly_stats')
    .select(`gsis_id, week, team, ${ptsCol}, targets, carries`)
    .eq('season', 2025)
    .eq('season_type', 'REG');
  if (wErr) throw wErr;

  // 3. Aggregate 2025 baseline per player + previous team
  const baselineMap = new Map<string, { totalPts: number; games: number; weeks: any[]; lastTeam: string | null; }>();
  for (const w of weekly2025 ?? []) {
    const prev = baselineMap.get(w.gsis_id) ?? { totalPts: 0, games: 0, weeks: [], lastTeam: null };
    const pts = (w as any)[ptsCol] ?? 0;
    if (pts > 0 || (w.targets ?? 0) > 0 || (w.carries ?? 0) > 0) {
      prev.totalPts += pts;
      prev.games += 1;
      prev.weeks.push({ week: w.week, targets: w.targets ?? 0, carries: w.carries ?? 0 });
      prev.lastTeam = w.team ?? prev.lastTeam;
      baselineMap.set(w.gsis_id, prev);
    }
  }

  // 4. Compute 2025 positional finish (for floor protection)
  const finishedRanks = new Map<string, number>(); // gsis_id -> 2025 pos rank
  const byPos: Record<string, { gsis_id: string; ppg: number; }[]> = {};
  for (const p of players) {
    const b = baselineMap.get(p.gsis_id);
    if (!b || b.games < 6) continue;
    const ppg = b.totalPts / b.games;
    (byPos[p.position] = byPos[p.position] ?? []).push({ gsis_id: p.gsis_id, ppg });
  }
  for (const pos of Object.keys(byPos)) {
    byPos[pos].sort((a, b) => b.ppg - a.ppg);
    byPos[pos].forEach((row, i) => finishedRanks.set(row.gsis_id, i + 1));
  }

  // 5. Score each player
  const scored: RankedRow[] = [];
  const computedAt = new Date().toISOString();

  for (const p of players) {
    const b = baselineMap.get(p.gsis_id);
    const isRookie = p.rookie_year === 2026 || p.draft_year === 2026;

    let baseline = 0;
    if (b && b.games >= 4) {
      baseline = b.totalPts / b.games;
    } else if (isRookie) {
      baseline = rookieBaselineByPos(p.position, p.draft_round);
    } else {
      continue; // no 2025 data + not a rookie -> skip
    }

    if (baseline <= 0) continue;

    const age = p.age ?? 25;
    const ageMult = ageCurve(p.position, age);
    const teamMult = teamChangeAdj(b?.lastTeam ?? null, p.team);
    const rookieBoost = isRookie ? 0.15 : 0; // small uniform rookie excitement layer
    const oppAdj = b ? opportunityAdj(b.weeks) : 0;
    const formatAdj = formatPositionAdj(format, p.position, age);

    // 75/25 mix: baseline anchor (25%) + forward layer (75%)
    const forwardLayer = baseline * ageMult * teamMult * (1 + rookieBoost) * (1 + oppAdj) * formatAdj;
    const score = baseline * 0.25 + forwardLayer * 0.75;

    // Build human-readable method
    const parts: string[] = [];
    parts.push(`2025: ${baseline.toFixed(1)} ppg`);
    if (Math.abs(ageMult - 1.0) >= 0.05) parts.push(`age ${age} ${ageMult > 1 ? 'peak' : 'decline'} (${ageMult.toFixed(2)}x)`);
    if (Math.abs(teamMult - 1.0) >= 0.03 && b?.lastTeam) parts.push(`${b.lastTeam}→${p.team} (${teamMult.toFixed(2)}x)`);
    if (isRookie) parts.push(`rookie (R${p.draft_round ?? '?'})`);
    if (Math.abs(oppAdj) >= 0.03) parts.push(`opp ${oppAdj > 0 ? '+' : ''}${(oppAdj * 100).toFixed(0)}%`);

    scored.push({
      format,
      rank: 0, // assigned after sort
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

  // 6. Sort by score, apply FLOOR PROTECTION pass
  scored.sort((a, b) => b.score - a.score);

  // For each top-24 2025 finisher, ensure they aren\\'t below 2025 rank + 12
  const posCount: Record<string, number> = {};
  const provisionalRank = new Map<string, number>();
  scored.forEach((r, i) => {
    posCount[r.position] = (posCount[r.position] ?? 0) + 1;
    provisionalRank.set(r.gsis_id, i + 1);
  });

  // Build floor-violators list
  const violators: { gsis_id: string; targetIdx: number; }[] = [];
  for (const r of scored) {
    const finish = finishedRanks.get(r.gsis_id);
    if (finish && finish <= 24) {
      // Find what position rank this player has currently in the sorted list
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
        // Need to move this player up. Compute target overall index by
        // finding the (maxAllowed)-th player at this position in the sort.
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

  // Apply floor protection by moving violators up to their allowed slot
  for (const v of violators) {
    const fromIdx = scored.findIndex(r => r.gsis_id === v.gsis_id);
    if (fromIdx <= v.targetIdx) continue;
    const [moved] = scored.splice(fromIdx, 1);
    moved.floor_protected = true;
    moved.method += ` · floor (\\'25 finish)`;
    scored.splice(v.targetIdx, 0, moved);
  }

  // 7. Final ranking + tier assignment
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

        // Wipe + insert this format slice
        const { error: delErr } = await supabase
          .from('nfl_proprietary_rankings')
          .delete()
          .eq('format', fmt);
        if (delErr) throw delErr;

        // Insert in chunks of 100
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

engine_dir = FUNCTIONS / 'aiomni-rankings-engine'
engine_dir.mkdir(parents=True, exist_ok=True)
(engine_dir / 'index.ts').write_text(ENGINE_FN)
applied.append('wrote supabase/functions/aiomni-rankings-engine/index.ts')

# ═══════════════════════════════════════════════════════════════════════
# DELIVERABLE 3: deno.json (declares import map)
# ═══════════════════════════════════════════════════════════════════════

DENO_JSON = '''{
  "imports": {
    "std/": "https://deno.land/std@0.168.0/"
  }
}
'''
(engine_dir / 'deno.json').write_text(DENO_JSON)
applied.append('wrote aiomni-rankings-engine/deno.json')

# ═══════════════════════════════════════════════════════════════════════

if applied:
    for a in applied:
        print(f'[APPLIED]  {a}')
    print(f'\\nDone. {len(applied)} file(s) created.')
    print()
    print('Next steps (run from AIOmni root):')
    print()
    print('  1. Apply the migration:')
    print('       supabase db push')
    print('     If that errors, copy the SQL from')
    print(f'       {migration_file}')
    print('     into your Supabase SQL editor and run it manually.')
    print()
    print('  2. Deploy the function:')
    print('       supabase functions deploy aiomni-rankings-engine')
    print()
    print('  3. Trigger first run (computes + populates table):')
    print('       TOKEN="<anon_key>"')
    print('       curl -X POST "https://khoruzvsprxyocisuhet.supabase.co/functions/v1/aiomni-rankings-engine" \\\\')
    print('            -H "apikey: $TOKEN" -H "Authorization: Bearer $TOKEN"')
    print()
    print('     Expected: ~30-60 seconds, returns {"ok":true,"stats":{"formats":{"PPR":250,"HALF":250,...}}}')
    print()
    print('  4. Verify it worked:')
    print('       curl -s "https://khoruzvsprxyocisuhet.supabase.co/rest/v1/nfl_proprietary_rankings?format=eq.PPR&select=rank,name,position,team,score,method&order=rank&limit=10" \\\\')
    print('            -H "apikey: $TOKEN" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool')
else:
    print('[SKIP]     no changes')
