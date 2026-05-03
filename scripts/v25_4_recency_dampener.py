#!/usr/bin/env python3
"""
AIOmni Engine v2.5.4 -- Recency-weighted PPG threshold dampener.

Two changes to aggregateSeason() recency weighting:

  Change 1: Playoff window weight lowered from 4x to 3x globally.
    The 4x weighting of weeks 14-17 was overly aggressive. Reducing
    to 3x still preserves the design intent that fantasy playoffs
    matter more, but with less amplification of single-game outliers
    in that window.

  Change 2: Threshold-based weighting for BOTH amplified windows.
    For weeks 10-13 (mid-late): 2x weight if player has 2+ games in
    window, otherwise 1.5x (still amplified, but less).
    For weeks 14-17 (playoffs): 3x weight if player has 2+ games in
    window, otherwise 1.5x.

  Logic: amplified weighting is meant to reward sustained late-season
  production. A player with only 1 game in a window doesn't have a
  sustained sample -- that single game gets disproportionate influence
  on their season average. The 1.5x threshold preserves SOME bonus for
  the games they did play, without letting one disaster (e.g. Daniels'
  2.7 PPR in week 14) dominate their recency-weighted PPG.

What this fixes:
  - Daniels: only 1 playoff game in 2025, that 2.7 PPR dragged his
    2yr blend baseline to 15.7 (real average ~17). With this patch
    that game gets 1.5x weight instead of 4x. Baseline rises notably.
  - MHJ: gets modest boost from 4->3 change on his 2 playoff games
    (weeks 16-17 averaged ~1.2 PPR -- those still get 3x now, not 4x).
  - Other partial-season players whose limited late-season samples
    got disproportionately amplified.

What this does NOT fix:
  - Lamar's mid-season slump (weeks 11-13 cold streak): he had 3
    games in that window so still gets full 2x. Different bug,
    deferred.
  - Players with consistently low late-season production who really
    are declining (correctly preserved -- not noise).

Run from AIOmni repo root:
    python3 scripts/v25_4_recency_dampener.py
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

# We need to find the recency-weighted PPG calculation in aggregateSeason.
# It computes weightedSum and totalWeight by iterating over weeks and
# applying weights based on week number.
#
# The function is around line 201, with the weight assignment around
# line 240ish. Let me find the exact pattern.

# Print first to verify what the current weighting looks like
import re

# Try to find the recency weighting block
recency_pattern = re.compile(
    r'(\s+)(let weightedSum = 0;.*?agg\.recencyPpg = totalWeight > 0 \? weightedSum / totalWeight : agg\.ppg;)',
    re.DOTALL
)

match = recency_pattern.search(s)

if not match:
    # Fall back to looking at aggregateSeason structure to find the
    # weight assignment manually
    print("[INFO] Could not locate recency weighting block via regex.")
    print("[INFO] Showing aggregateSeason function for manual inspection:")
    func_start = s.find('function aggregateSeason')
    if func_start >= 0:
        # Find the closing brace at function level
        end_marker = s.find('\nfunction ', func_start + 10)
        if end_marker == -1:
            end_marker = func_start + 3000
        snippet = s[func_start:end_marker]
        print(snippet)
        print()
    warnings.append("Could not auto-locate recency weighting -- needs manual patch")
    sys.exit(1)

indent = match.group(1)
old_block = match.group(2)

# Build the new weighting block. We need to:
# 1. Count games in window 10-13 and window 14-17 first
# 2. Apply graduated weights based on count
new_block = '''// v2.5.4: Recency weighting with threshold dampener.
    // Count games in each amplified window first, then apply weights.
    let midWindowGames = 0;   // weeks 10-13
    let playoffGames = 0;     // weeks 14-17
    for (const wk of agg.weeks) {
      if (wk.week >= 10 && wk.week <= 13) midWindowGames++;
      else if (wk.week >= 14 && wk.week <= 17) playoffGames++;
    }
    // Weights: full bonus only if player has 2+ games in window.
    // Otherwise reduced 1.5x (still some amplification, less risk
    // of single-game outliers dominating).
    const midWeight = midWindowGames >= 2 ? 2 : 1.5;
    const playoffWeight = playoffGames >= 2 ? 3 : 1.5;
    
    let weightedSum = 0;
    let totalWeight = 0;
    for (const wk of agg.weeks) {
      let w: number;
      if (wk.week >= 14 && wk.week <= 17) w = playoffWeight;
      else if (wk.week >= 10 && wk.week <= 13) w = midWeight;
      else w = 1; // weeks 1-9 and week 18
      weightedSum += wk.pts * w;
      totalWeight += w;
    }
    agg.recencyPpg = totalWeight > 0 ? weightedSum / totalWeight : agg.ppg;'''

# But we don't know the exact existing block structure, so let me try
# a simpler approach: match the specific assignment line and replace
# the surrounding logic.

# Look for the actual weighting code that exists
# Pattern: `agg.recencyPpg = totalWeight > 0 ? weightedSum / totalWeight : agg.ppg;`
target_line = "agg.recencyPpg = totalWeight > 0 ? weightedSum / totalWeight : agg.ppg;"
target_idx = s.find(target_line)

if target_idx == -1:
    warnings.append("Could not find recency PPG assignment")
    print("[ERROR] Could not find target line in engine")
    sys.exit(1)

# Walk backward to find where this weighting block starts. Look for
# `let weightedSum = 0;` declaration.
block_start_str = "let weightedSum = 0;"
block_start = s.rfind(block_start_str, 0, target_idx)

if block_start == -1:
    warnings.append("Could not find weightedSum declaration")
    print("[ERROR] Could not find weightedSum start")
    sys.exit(1)

# Get the original block (from `let weightedSum` through the recencyPpg assignment + semicolon)
end_idx = target_idx + len(target_line)
old_actual = s[block_start:end_idx]

print("=" * 60)
print("[FOUND OLD BLOCK]")
print(old_actual)
print("=" * 60)
print()

# Determine the indent of the existing block for matching
line_start = s.rfind('\n', 0, block_start) + 1
existing_indent = s[line_start:block_start]

# Build new block with correct indent
new_actual = f'''// v2.5.4: Recency weighting with threshold dampener.
{existing_indent}// Count games in each amplified window first.
{existing_indent}let midWindowGames = 0;   // weeks 10-13
{existing_indent}let playoffGames = 0;     // weeks 14-17
{existing_indent}for (const wk of agg.weeks) {{
{existing_indent}  if (wk.week >= 10 && wk.week <= 13) midWindowGames++;
{existing_indent}  else if (wk.week >= 14 && wk.week <= 17) playoffGames++;
{existing_indent}}}
{existing_indent}// v2.5.4: full bonus only if player has 2+ games in window;
{existing_indent}// otherwise reduced 1.5x (some amplification, less outlier risk).
{existing_indent}// Playoff window also lowered from 4x to 3x base bonus.
{existing_indent}const midWeight = midWindowGames >= 2 ? 2 : 1.5;
{existing_indent}const playoffWeight = playoffGames >= 2 ? 3 : 1.5;
{existing_indent}let weightedSum = 0;
{existing_indent}let totalWeight = 0;
{existing_indent}for (const wk of agg.weeks) {{
{existing_indent}  let w: number;
{existing_indent}  if (wk.week >= 14 && wk.week <= 17) w = playoffWeight;
{existing_indent}  else if (wk.week >= 10 && wk.week <= 13) w = midWeight;
{existing_indent}  else w = 1;
{existing_indent}  weightedSum += wk.pts * w;
{existing_indent}  totalWeight += w;
{existing_indent}}}
{existing_indent}agg.recencyPpg = totalWeight > 0 ? weightedSum / totalWeight : agg.ppg;'''

s_new = s[:block_start] + new_actual + s[end_idx:]

if s_new != s:
    ENGINE.write_text(s_new)
    applied.append("Replaced recency weighting block with v2.5.4 threshold-dampener logic")
else:
    warnings.append("No change made")

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
    print("Patch applied. Deploy + recompute:")
    print()
    print('  supabase functions deploy aiomni-rankings-engine')
    print('  TOKEN="<anon_key>"')
    print('  curl -X POST "https://khoruzvsprxyocisuhet.supabase.co/functions/v1/aiomni-rankings-engine" \\')
    print('       -H "apikey: $TOKEN" -H "Authorization: Bearer $TOKEN"')
    print()
    print("Then verify expected changes:")
    print('  echo "=== Daniels (expected to rise significantly) ==="')
    print('  curl -s "https://khoruzvsprxyocisuhet.supabase.co/rest/v1/nfl_proprietary_rankings?gsis_id=eq.00-0039910&select=format,rank,pos_rank,baseline_2025,method" -H "apikey: $TOKEN" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool')
    print('  echo "=== Brown (verify NOT regressed) ==="')
    print('  curl -s "https://khoruzvsprxyocisuhet.supabase.co/rest/v1/nfl_proprietary_rankings?format=eq.PPR&name=ilike.*chase*brown*&select=rank,pos_rank,baseline_2025,method" -H "apikey: $TOKEN" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool')
    print()
    print("Then commit:")
    print('  git add -A && git commit -m "v2.5.4: recency dampener -- 4x to 3x playoff cap + 2-game threshold for amplified weighting"')
    print('  git push origin main')
else:
    print("Nothing applied.")
