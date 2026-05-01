#!/usr/bin/env python3
"""
v2.5.2: two surgical fixes.

  1. Engine\\'s nfl_players SELECT was missing `draft_pick`, so the
     top-10 boost path never fired. Love getting R1 +20% instead of
     top-10 +30%. Add the column.

  2. Bump top-10 RB/WR boost to +35% (per request, Bijan reference
     point: top-10 RBs/WRs hit at very high rates).
     Keep top-10 QB/TE at +30% (rookies at those positions historically
     take longer -- Bowers was the exception, not the rule).
"""
from pathlib import Path
import sys

ENGINE = Path('supabase/functions/aiomni-rankings-engine/index.ts')
if not ENGINE.exists():
    print('[ERROR]    engine not found.')
    sys.exit(1)

s = ENGINE.read_text()
orig = s

# ── Fix 1: add draft_pick to the player select ──────────────────────
old_sel = """    supabase.from('nfl_players')
      .select('gsis_id, full_name, position, team, age, rookie_year, draft_year, draft_round')
      .in('position', ['QB', 'RB', 'WR', 'TE'])
      .eq('is_active', true),"""

new_sel = """    supabase.from('nfl_players')
      .select('gsis_id, full_name, position, team, age, rookie_year, draft_year, draft_round, draft_pick')
      .in('position', ['QB', 'RB', 'WR', 'TE'])
      .eq('is_active', true),"""

if old_sel in s:
    s = s.replace(old_sel, new_sel)
    print('[APPLIED]  added draft_pick to nfl_players select')
else:
    print('[ERROR]    could not find player select')
    sys.exit(1)

# ── Fix 2: position-specific top-10 boost ────────────────────────────
old_ladder = """    // Rookie ladder (v2.5): boost size scales with draft capital.
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

new_ladder = """    // Rookie ladder (v2.5.2): position-specific boosts based on
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
    }"""

if old_ladder in s:
    s = s.replace(old_ladder, new_ladder)
    print('[APPLIED]  top-10 RB/WR now +35%, QB/TE stays +30%')
else:
    print('[ERROR]    could not find rookie ladder block')
    sys.exit(1)

if s != orig:
    ENGINE.write_text(s)
    print()
    print('Done. Redeploy + recompute.')
