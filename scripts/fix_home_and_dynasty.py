#!/usr/bin/env python3
"""
═══════════════════════════════════════════════════════════════════════════
Morning fixes #2 — Home selectedPlatforms + Dynasty toggle JSX
═══════════════════════════════════════════════════════════════════════════

Two fixes in one script:

  FIX 1 — Home tab platform filter
    selectedPlatforms defaults to ['sleeper', 'espn', 'yahoo'] which means
    MFL and Fleaflicker leagues get filtered OUT of the pill display even
    when they exist. Add the two new platforms to the default state.

  FIX 2 — Dynasty toggle JSX in Rankings
    The leagueType state was added in Piece 1 but never wired to UI.
    This adds a 2-button toggle (REDRAFT / DYNASTY) above the existing
    scoring pill row, matching the pill style for visual consistency.

NOT in this script (intentional, separate concerns):
  - Fleaflicker 404 — that's an API-side problem; the URL looks right.
    Need a separate diagnostic session to figure out why FetchLeague
    returns 404 for league 324106. Could be: invalid ID, private league,
    Fleaflicker rate-limited, or sport param mismatch.
  - Heat icon — Patrick says "no one is showing under 76" which is
    ambiguous. Need clarification before changing anything.
  - The O rename + landing page — separate scripts already written.

Idempotent. Safe to re-run.

Run from /Users/patrickmeyer/AIOmni:
    python3 scripts/fix_home_and_dynasty.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX_TSX = ROOT / "app" / "(tabs)" / "index.tsx"
RANKINGS_TSX = ROOT / "app" / "(tabs)" / "rankings.tsx"


# ─── FIX 1: Home — add MFL + Fleaflicker to selectedPlatforms default ─────

OLD_SELECTED = "const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>(['sleeper', 'espn', 'yahoo']);"
NEW_SELECTED = "const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>(['sleeper', 'espn', 'yahoo', 'mfl', 'fleaflicker']);"


def patch_home_selected():
    print("FIX 1 — Home selectedPlatforms default")
    if not INDEX_TSX.exists():
        print(f"  [SKIPPED]  {INDEX_TSX} not found")
        return False

    s = INDEX_TSX.read_text()

    if "'sleeper', 'espn', 'yahoo', 'mfl', 'fleaflicker'" in s:
        print("  [ALREADY]  selectedPlatforms already includes MFL/Fleaflicker")
        return False

    if OLD_SELECTED in s:
        s = s.replace(OLD_SELECTED, NEW_SELECTED)
        INDEX_TSX.write_text(s)
        print("  [APPLIED]  selectedPlatforms now defaults to all 5 platforms")
        print(f"  ✓ {INDEX_TSX.name} updated")
        return True
    else:
        print("  [WARN]     selectedPlatforms anchor not found — manual review")
        return False


# ─── FIX 2: Rankings — Dynasty toggle JSX above scoring pills ──────────────
#
# The existing scoring pill row is:
#   <ScrollView horizontal ... style={s.formatScroll}>
#     {FORMATS.map(fmt => (
#       <TouchableOpacity key={fmt.key} onPress={() => setFormat(fmt.key)}
#         style={[s.formatPill, format === fmt.key && s.formatPillOn]}>
#         <Text style={[s.formatText, format === fmt.key && s.formatTextOn]}>{fmt.label}</Text>
#       </TouchableOpacity>
#     ))}
#   </ScrollView>
#
# We inject a SIBLING ScrollView immediately ABOVE it with a 2-button
# REDRAFT/DYNASTY toggle. Reuses the same styles for visual consistency.

OLD_FORMATS_BLOCK = """      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.formatScroll}>
        {FORMATS.map(fmt => (
          <TouchableOpacity key={fmt.key} onPress={() => setFormat(fmt.key)} style={[s.formatPill, format === fmt.key && s.formatPillOn]}>
            <Text style={[s.formatText, format === fmt.key && s.formatTextOn]}>{fmt.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>"""

NEW_FORMATS_BLOCK = """      {/* ─── REDRAFT / DYNASTY toggle ─── */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.formatScroll}>
        {(['redraft', 'dynasty'] as const).map(lt => (
          <TouchableOpacity
            key={lt}
            onPress={() => setLeagueType(lt)}
            style={[s.formatPill, leagueType === lt && s.formatPillOn]}
          >
            <Text style={[s.formatText, leagueType === lt && s.formatTextOn]}>
              {lt.toUpperCase()}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* ─── Scoring format pills ─── */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.formatScroll}>
        {FORMATS.map(fmt => (
          <TouchableOpacity key={fmt.key} onPress={() => setFormat(fmt.key)} style={[s.formatPill, format === fmt.key && s.formatPillOn]}>
            <Text style={[s.formatText, format === fmt.key && s.formatTextOn]}>{fmt.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>"""


def patch_dynasty_toggle():
    print()
    print("FIX 2 — Dynasty toggle JSX in Rankings")
    if not RANKINGS_TSX.exists():
        print(f"  [SKIPPED]  {RANKINGS_TSX} not found")
        return False

    s = RANKINGS_TSX.read_text()

    if "REDRAFT / DYNASTY toggle" in s or "['redraft', 'dynasty'] as const" in s:
        print("  [ALREADY]  Dynasty toggle JSX already in place")
        return False

    if OLD_FORMATS_BLOCK in s:
        s = s.replace(OLD_FORMATS_BLOCK, NEW_FORMATS_BLOCK)
        RANKINGS_TSX.write_text(s)
        print("  [APPLIED]  REDRAFT/DYNASTY toggle added above scoring pills")
        print("             Both rows use the same s.formatPill style for consistency")
        print(f"  ✓ {RANKINGS_TSX.name} updated")
        return True
    else:
        print("  [WARN]     scoring pill row anchor not found — manual review")
        print("             Look for the ScrollView containing FORMATS.map(fmt => ...)")
        return False


# ─── MAIN ──────────────────────────────────────────────────────────────────

def main():
    print("=" * 72)
    print("Morning fixes — Home selectedPlatforms + Dynasty toggle JSX")
    print("=" * 72)
    print()

    a = patch_home_selected()
    b = patch_dynasty_toggle()

    print()
    print("=" * 72)
    if a or b:
        print("✓ Fixes applied")
    else:
        print("(no changes — fixes may already be applied)")
    print("=" * 72)
    print()
    print("Verify:")
    print("  npx tsc --noEmit")
    print()
    print("If clean, commit:")
    print("  git add -A")
    print("  git commit -m 'Home: show MFL/FF leagues; Rankings: add dynasty toggle'")
    print("  git push")


if __name__ == "__main__":
    main()
