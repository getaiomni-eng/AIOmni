#!/usr/bin/env python3
"""
AIOmni Phase 3 v2.2 - VBD scoring (clean rewrite of v22 file).
Replaces broken phase3_v22_vbd.py.
"""
from pathlib import Path
import sys

ROOT = Path('.')
ENGINE = ROOT / 'supabase' / 'functions' / 'aiomni-rankings-engine' / 'index.ts'

if not ENGINE.exists():
    print('[ERROR]    engine file not found.')
    sys.exit(1)

s = ENGINE.read_text()
orig = s

old_pre_sort = """  scored.sort((a, b) => b.score - a.score);

  // ─── Floor protection (skipped for players age >= 30) ──────────────"""

new_pre_sort = """  // ─── VBD (Value Based Drafting) adjustment ─────────────────────────
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

  // ─── Floor protection (skipped for players age >= 30) ──────────────"""

if old_pre_sort in s:
    s = s.replace(old_pre_sort, new_pre_sort)
    print('[APPLIED]  VBD adjustment for PPR/HALF/STD')
else:
    if 'VBD (Value Based Drafting)' in s:
        print('[SKIP]     VBD already applied to engine')
    else:
        print('[ERROR]    could not find sort marker')
        sys.exit(1)

if s != orig:
    ENGINE.write_text(s)
    print('Done. Now redeploy the engine and recompute rankings.')
else:
    print('No changes needed.')
