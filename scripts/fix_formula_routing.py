#!/usr/bin/env python3
"""
Bug fix: Duplicate players in My Rankings when AIOmni Formula is the base.

Root cause: handleSelectBase routes ALL sources through getEngineRankingsForSource,
which calls applyEngineToRankings(), which feeds the source through rankAIOmni()
-- the consensus-blend engine. That engine has its own player universe and
synthesizes player records for any name it doesn't find in the source's
originalMap. Result: same human appears twice (once from the clean Formula
data, once from rankAIOmni's synthesis with slightly different name format).

Visible symptom: "James Cook" with photo + "James Cook III" with "?" placeholder
both appearing in the same list. Same for "Kenneth Walker" / "Kenneth Walker III".

Fix: When source is 'aiomni_formula', call getFormulaRankings() instead -- the
clean bypass that reads directly from nfl_proprietary_rankings without going
through rankAIOmni(). Phase A added this function exactly for this case;
handleSelectBase just wasn't routing to it.

Run from AIOmni repo root:
    python3 scripts/fix_formula_routing.py
"""
from pathlib import Path
import sys

TARGET = Path('app/(tabs)/rankings.tsx')
if not TARGET.exists():
    print(f'[ERROR] {TARGET} not found.')
    sys.exit(1)

s = TARGET.read_text()
orig = s
applied = []
warnings = []

# ====================================================================
# CHANGE 1: Update import to include getFormulaRankings
# ====================================================================
# Find the existing import for getEngineRankingsForSource
import re

# Look for the import line
import_pattern = re.compile(
    r"(import\s*\{([^}]+)\}\s*from\s*['\"][^'\"]*aiomniEngineBridge['\"];)",
    re.DOTALL
)

match = import_pattern.search(s)
if match:
    full_import = match.group(1)
    imports_list = match.group(2)
    if 'getFormulaRankings' in imports_list:
        applied.append("Import already includes getFormulaRankings")
    else:
        # Insert getFormulaRankings into the import list
        new_imports = imports_list.rstrip() + ', getFormulaRankings'
        new_full = full_import.replace(imports_list, new_imports)
        s = s.replace(full_import, new_full)
        applied.append("Added getFormulaRankings to aiomniEngineBridge import")
else:
    warnings.append("Could not locate aiomniEngineBridge import block")

# ====================================================================
# CHANGE 2: Update handleSelectBase to route aiomni_formula correctly
# ====================================================================
old_dispatch = """      const rankings = await getEngineRankingsForSource(source, format, leagueType);"""

new_dispatch = """      // Route AIOmni Formula through its clean bypass (reads nfl_proprietary_rankings
      // directly, skips rankAIOmni() in-process consensus engine). All other sources
      // continue to flow through getEngineRankingsForSource for consensus blending.
      const rankings = source === 'aiomni_formula'
        ? await getFormulaRankings(format, leagueType)
        : await getEngineRankingsForSource(source, format, leagueType);"""

if old_dispatch in s:
    s = s.replace(old_dispatch, new_dispatch)
    applied.append("handleSelectBase now routes aiomni_formula -> getFormulaRankings")
else:
    warnings.append("handleSelectBase dispatch line not found -- format may have changed")

# Write
if s != orig:
    TARGET.write_text(s)

# ====================================================================
# Summary
# ====================================================================
print()
print("=" * 60)
for a in applied:
    print(f"[APPLIED]  {a}")
for w in warnings:
    print(f"[WARN]     {w}")
print("=" * 60)
print()

if applied and not warnings:
    print("All changes applied. Verify in simulator:")
    print()
    print("  npx expo start --clear")
    print()
    print("Open app -> Rankings -> tap CHANGE on base, re-pick AIOmni Formula.")
    print()
    print("Expected outcome:")
    print("  - No duplicate James Cook / Kenneth Walker entries")
    print("  - All headshots load (no '?' placeholders)")
    print("  - Tier 1 should be Bijan/Gibbs/Taylor (RB filter)")
    print()
    print("If verified clean, commit:")
    print('  git add -A')
    print('  git commit -m "fix: route AIOmni Formula source through clean bypass to avoid consensus-blend duplicates"')
    print('  git push origin main')
elif applied:
    print(f"{len(applied)} applied, {len(warnings)} warnings. Manual review.")
else:
    print("Nothing applied -- file structure may have changed.")
