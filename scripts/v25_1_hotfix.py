#!/usr/bin/env python3
"""
v2.5.1 hotfix: two bugs.

  1. Opportunity adjustment collapsed to +15% ceiling for almost
     everyone in v2.5. Caused by playoff-week 2x weighting -- since
     most players play in weeks 14-17, the "late half" is universally
     inflated, killing the differentiating signal.

     Fix: remove playoff-week weighting from opportunity calc.
     Keep wider \xb115% cap (that\\'s fine).

  2. Synthetic rookie rows from the draft backfill are missing age,
     so the engine defaults them all to age 25 (past-peak for RBs).
     Jeremiyah Love showing "age 25 peak" but he\\'s actually 21.

     Fix: backfill age data on the 256 inserted synthetic rookie rows.
     Defaults: R1-2 picks = 22, R3-4 = 23, R5+ = 24. Reasonable for
     2026 college draftees.

Run from AIOmni repo root:
    python3 scripts/v25_1_hotfix.py
"""
from pathlib import Path
import sys

ROOT = Path('.')
ENGINE = ROOT / 'supabase' / 'functions' / 'aiomni-rankings-engine' / 'index.ts'
BACKFILL = ROOT / 'supabase' / 'functions' / 'backfill-2026-draft' / 'index.ts'

if not ENGINE.exists():
    print('[ERROR]    engine not found.')
    sys.exit(1)
if not BACKFILL.exists():
    print('[ERROR]    backfill function not found.')
    sys.exit(1)

# ─── FIX 1: Remove playoff weighting from opportunity calc ────────────

s = ENGINE.read_text()
orig = s

old_opp = """function opportunityAdj(
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

new_opp = """function opportunityAdj(
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
}"""

if old_opp in s:
    s = s.replace(old_opp, new_opp)
    print('[APPLIED]  opportunity calc reverted to plain half-vs-half (cap stays at \xb115%)')
else:
    print('[ERROR]    could not find opportunityAdj block')
    sys.exit(1)

if s != orig:
    ENGINE.write_text(s)

# ─── FIX 2: Update backfill function to set age on insert ─────────────

s2 = BACKFILL.read_text()
orig2 = s2

old_insert = """        const { error } = await supabase
          .from('nfl_players')
          .insert({
            gsis_id: synthId,
            full_name: pick.n,
            first_name: firstName,
            last_name: lastName,
            position: pick.pos,
            team,
            draft_year: 2026,
            draft_round: pick.r,
            draft_pick: pick.p,
            rookie_year: 2026,
            is_active: true,
            years_exp: 0,
          });"""

new_insert = """        // Estimate age based on draft round (2026 college players are
        // typically 21-23). R1-2: 22, R3-4: 23, R5+: 24.
        let estimatedAge = 22;
        if (pick.r === 3 || pick.r === 4) estimatedAge = 23;
        else if (pick.r >= 5) estimatedAge = 24;
        const { error } = await supabase
          .from('nfl_players')
          .insert({
            gsis_id: synthId,
            full_name: pick.n,
            first_name: firstName,
            last_name: lastName,
            position: pick.pos,
            team,
            age: estimatedAge,
            draft_year: 2026,
            draft_round: pick.r,
            draft_pick: pick.p,
            rookie_year: 2026,
            is_active: true,
            years_exp: 0,
          });"""

if old_insert in s2:
    s2 = s2.replace(old_insert, new_insert)
    print('[APPLIED]  backfill now sets age on insert (R1-2: 22, R3-4: 23, R5+: 24)')
else:
    print('[WARN]     could not patch insert block in backfill')

if s2 != orig2:
    BACKFILL.write_text(s2)

# ─── FIX 2b: Update existing synthetic rookies' ages directly ─────────
# We can\\'t do this from a Python script easily -- instead emit a SQL
# command for the user to run.

print()
print('Done. Next steps:')
print()
print('1. Deploy both functions:')
print('     supabase functions deploy aiomni-rankings-engine')
print('     supabase functions deploy backfill-2026-draft')
print()
print('2. Update existing synthetic rookies with correct age values')
print('   (run this SQL in Supabase Dashboard \xbb SQL Editor):')
print()
print("     UPDATE nfl_players SET age = 22 WHERE gsis_id LIKE '2026_pick_%' AND draft_round IN (1, 2);")
print("     UPDATE nfl_players SET age = 23 WHERE gsis_id LIKE '2026_pick_%' AND draft_round IN (3, 4);")
print("     UPDATE nfl_players SET age = 24 WHERE gsis_id LIKE '2026_pick_%' AND draft_round IN (5, 6, 7);")
print()
print('3. Recompute rankings:')
print('     curl -X POST .../aiomni-rankings-engine -H "apikey: $TOKEN" -H "Authorization: Bearer $TOKEN"')
print()
print('Then verify Jeremiyah Love (should now show age 22 peak with +20% rookie boost):')
print('     curl -s ".../nfl_proprietary_rankings?format=eq.PPR&select=rank,name,score,method&name=ilike.*jeremiyah*" \\\\')
print('          -H "apikey: $TOKEN" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool')
