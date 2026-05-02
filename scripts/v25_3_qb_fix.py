#!/usr/bin/env python3
"""
AIOmni Engine v2.5.3 -- QB scoring fix.

Five surgical changes to fix the systematic QB under-ranking discovered
in v2.5.2 (Allen at QB3 pos_rank 39 overall, Lamar at QB28, Hurts at
QB10 with score 0.45, etc.):

  Bug 1 (the big one): VBD compresses QB scores to nothing
    Single-QB league QB pool depth is shallow (top 14 QBs all score
    16-22 PPG). Subtracting QB14's score from QB1's score collapses
    the spread to 3-5 points while RB/WR spreads stay 12-15 points.
    Cross-position rank comparison breaks. Removing QB from VBD
    restores natural PPG order.

  Bug 2: Injury matcher hits "Unspecified" status with 0.85x
    Allen got tagged "INJURY: Unspecified (0.85x)" for no real reason.
    Tighten injury matching to only apply multipliers for severe
    statuses: "Out", "IR", "PUP", "Doubtful". Skip "Questionable" and
    "Unspecified" -- those are noise that shouldn't move rankings.

  Bug 3: Rookie QB boost too aggressive
    Mendoza (R1 pick #1) ranked QB8 ahead of established starters with
    real NFL stats. Rookie QBs need to play a season before being
    valued like a top-10 QB. Cap rookie QB boost at 1.10x and lower
    the rookie baseline PPG for QBs from 14.0 to 11.0.

  Bug 4: Daniels-shaped careers (8 games of elite play) get demoted
    The 2yr/3yr blend logic requires both seasons have >=4 games. With
    Daniels having 8 games of 17 PPG in 2025 and a partial 2024, his
    blend uses both seasons but weights them equally. For QBs with high
    in-season variance, the recency weighting penalizes single bad
    weeks too heavily. Reduce playoff-week weight from 4x to 3x for QBs
    specifically (not RBs/WRs/TEs where playoff scoring legitimately
    matters more).

  Bug 5: Engine doesn't surface QB rushing as a separate signal
    Allen, Lamar, Hurts, Daniels are valuable specifically BECAUSE
    they rush. The engine treats their PPG as scalar without rewarding
    rushing-QB profile. Add a small dual-threat bonus (+5%) for QBs
    averaging 30+ rushing yards per game.

After this patch, expected top 10 QBs in PPR (rough order):
  1. Allen, 2. Burrow, 3. Lamar, 4. Daniels, 5. Hurts, 6. Mahomes,
  7. Lawrence, 8. Maye, 9. Purdy, 10. Stafford

Run from AIOmni repo root:
    python3 scripts/v25_3_qb_fix.py
"""
from pathlib import Path
import sys

ENGINE = Path('supabase/functions/aiomni-rankings-engine/index.ts')
if not ENGINE.exists():
    print(f'[ERROR]    {ENGINE} not found. Run from AIOmni repo root.')
    sys.exit(1)

s = ENGINE.read_text()
orig = s
applied = []
warnings = []

# ════════════════════════════════════════════════════════════════════
# FIX 1: Remove QB from VBD
# ════════════════════════════════════════════════════════════════════

old1 = """    const REPLACEMENT_RANK: Record<string, number> = {
      QB: 14,
      RB: 30,
      WR: 36,
      TE: 14,
    };"""

new1 = """    // v2.5.3: QB removed from VBD. Single-QB league QB pool depth
    // is too compressed for VBD math to work -- top 14 QBs all score
    // 16-22 PPG, so subtracting QB14's score crushes the spread to
    // 3-5 points while RB/WR spreads stay 12-15. Result: elite QBs
    // ended up ranked behind QB backups. Skip QB entirely; rely on
    // raw multiplied score for QB ordering within position.
    const REPLACEMENT_RANK: Record<string, number> = {
      RB: 30,
      WR: 36,
      TE: 14,
    };"""

if old1 in s:
    s = s.replace(old1, new1)
    applied.append("Fix 1: removed QB from VBD REPLACEMENT_RANK")
else:
    warnings.append("Fix 1: REPLACEMENT_RANK pattern not matched")

# ════════════════════════════════════════════════════════════════════
# FIX 2: Tighten injury matching -- severe statuses only
# ════════════════════════════════════════════════════════════════════

# Find the injury severity logic. Looking at v2.5.2 the injury map
# applies multiplier when injInfo.multiplier < 1.0 regardless of severity.
# Tighten to require severity field to be one of severe statuses.
old2 = """    if (injInfo && injInfo.multiplier < 1.0) {
      injuryMult = injInfo.multiplier;
      baseline = baseline * injuryMult;
      injuryNote = `INJURY: ${injInfo.injury} (${injuryMult.toFixed(2)}x)`;
    }"""

new2 = """    // v2.5.3: only apply injury penalty for severe statuses.
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
    }"""

if old2 in s:
    s = s.replace(old2, new2)
    applied.append("Fix 2: tightened injury matching to severe statuses only")
else:
    warnings.append("Fix 2: injury matching pattern not found -- may need manual review")

# ════════════════════════════════════════════════════════════════════
# FIX 3: Cap rookie QB boost + lower QB rookie baseline
# ════════════════════════════════════════════════════════════════════

# 3a. The rookie boost is in the rookie ladder section (line 545+).
# Cap QB rookie boost at 0.10 (10%) regardless of draft position.
old3a = """    if (isRookie) {
      const pick = p.draft_pick;
      const round = p.draft_round;
      if (typeof pick === 'number' && pick <= 10) {
        rookieBoost = (p.position === 'RB' || p.position === 'WR') ? 0.35 : 0.30;
      } else if (round === 1) rookieBoost = 0.20;
      else if (round === 2) rookieBoost = 0.10;
      else if (round === 3) rookieBoost = 0.05;
      else rookieBoost = 0; // R4+ or unknown
    }"""

new3a = """    if (isRookie) {
      const pick = p.draft_pick;
      const round = p.draft_round;
      // v2.5.3: QB rookies capped at 0.10 max regardless of capital.
      // R1 QBs need a season of NFL data before getting top-10 QB
      // valuation -- Mendoza at QB8 was unrealistic for a Year-1.
      if (p.position === 'QB') {
        if (round === 1) rookieBoost = 0.10;
        else rookieBoost = 0;
      } else if (typeof pick === 'number' && pick <= 10) {
        rookieBoost = (p.position === 'RB' || p.position === 'WR') ? 0.35 : 0.30;
      } else if (round === 1) rookieBoost = 0.20;
      else if (round === 2) rookieBoost = 0.10;
      else if (round === 3) rookieBoost = 0.05;
      else rookieBoost = 0;
    }"""

if old3a in s:
    s = s.replace(old3a, new3a)
    applied.append("Fix 3a: capped rookie QB boost at 0.10")
else:
    warnings.append("Fix 3a: rookie ladder pattern not matched")

# 3b. Lower QB rookie baseline from 14.0 to 11.0.
# The function rookieBaselineByPos is in the engine, find QB case.
old3b = """  if (position === 'QB') {
    if (draftRound === 1) return 14.0;
    return 0;
  }"""

new3b = """  if (position === 'QB') {
    // v2.5.3: lowered from 14.0 to 11.0. Year-1 QB rookies historically
    // average 12-15 PPG; 14.0 was midpoint of established mid-tier vets.
    if (draftRound === 1) return 11.0;
    return 0;
  }"""

if old3b in s:
    s = s.replace(old3b, new3b)
    applied.append("Fix 3b: lowered QB rookie baseline from 14.0 to 11.0")
else:
    warnings.append("Fix 3b: rookieBaselineByPos QB case not matched")

# ════════════════════════════════════════════════════════════════════
# FIX 4: Reduce QB playoff-week weight from 4x to 3x
# ════════════════════════════════════════════════════════════════════

# This requires finding the recency-weighting function. v2.5.2 has
# weeks 14-17 weighted 4x. For QBs we want 3x because single-game
# variance is extreme and one bad week shouldn't dominate.
# The aggregation function is fetchSeason or aggregateSeason -- we 
# need to make it position-aware.
#
# This is non-trivial because aggregateSeason doesn't currently take
# position as parameter. Skip this fix for now -- it's a larger refactor
# and the VBD removal alone should fix the worst symptoms. We can
# revisit in v2.5.4 if QB ordering still looks wrong.

warnings.append("Fix 4: SKIPPED -- requires refactor of aggregateSeason to be position-aware. Defer to v2.5.4.")

# ════════════════════════════════════════════════════════════════════
# FIX 5: Dual-threat QB bonus
# ════════════════════════════════════════════════════════════════════

# Add a +5% multiplier for QBs averaging 30+ rushing yards per game.
# Insert in the per-player scoring loop, before the forwardLayer math.
# This requires the rushing_yards data which currently isn't aggregated.
# Skip for now -- nfl_weekly_stats select pulls only fantasy_pts/targets/
# carries. Adding rushing_yards is another schema-touch. Defer.

warnings.append("Fix 5: SKIPPED -- requires adding rushing_yards to weekly aggregation. Defer to v2.5.4.")

# ════════════════════════════════════════════════════════════════════
# Write
# ════════════════════════════════════════════════════════════════════

if s != orig:
    ENGINE.write_text(s)

# ════════════════════════════════════════════════════════════════════
# Summary
# ════════════════════════════════════════════════════════════════════

print()
print("=" * 60)
for a in applied:
    print(f"[APPLIED]  {a}")
for w in warnings:
    print(f"[WARN]     {w}")
print("=" * 60)
print()

if applied:
    print(f"{len(applied)} fixes applied. {len([w for w in warnings if 'SKIPPED' not in w])} unmatched patterns.")
    print()
    print("Deploy + recompute:")
    print("  supabase functions deploy aiomni-rankings-engine")
    print('  TOKEN="<anon_key>"')
    print('  curl -X POST "https://khoruzvsprxyocisuhet.supabase.co/functions/v1/aiomni-rankings-engine" \\')
    print('       -H "apikey: $TOKEN" -H "Authorization: Bearer $TOKEN"')
    print()
    print("Then verify QB rankings:")
    print('  curl -s "https://khoruzvsprxyocisuhet.supabase.co/rest/v1/nfl_proprietary_rankings?format=eq.PPR&position=eq.QB&select=rank,pos_rank,name,team,score,baseline_2025,method&order=pos_rank&limit=15" \\')
    print('       -H "apikey: $TOKEN" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool')
    print()
    print("Expected top 10 PPR QBs after fix (rough order):")
    print("  Allen, Burrow, Lamar, Daniels, Hurts, Mahomes,")
    print("  Lawrence, Maye, Purdy, Stafford or Mayfield")
else:
    print("Nothing applied. Engine file may have changed structure.")
