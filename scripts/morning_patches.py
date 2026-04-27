#!/usr/bin/env python3
"""
═══════════════════════════════════════════════════════════════════════════
MORNING PATCH SCRIPT — April 27 cleanup
═══════════════════════════════════════════════════════════════════════════

Build 125 surfaced 5 issues. This script tackles what can be safely
patched without you running code in real time. Bigger items (Sleeper
player sync, prospects crash root cause, Tier B Fleaflicker, NFL.com
scraper) need diagnostic runs and stay for live sessions.

What this script ships:

  PATCH 1 — Home tab: MFL + Fleaflicker league loaders + pills
    Currently Home only loads sleeper/espn/yahoo. Adds mfl + fleaflicker
    league loaders, registers them in PLAT_LABEL, includes them in the
    Promise.all that runs on load, surfaces them in the platform pill
    filter strip.

  PATCH 2 — Rankings UI: redraft/dynasty toggle + scoring underneath
    Currently scoring pills are: PPR / HALF PPR / STANDARD / SUPERFLEX / DYNASTY.
    Patrick wants: a leagueType toggle (REDRAFT / DYNASTY) above, with the
    scoring row showing only PPR / HALF PPR / STANDARD / SUPERFLEX. The
    leagueType state is already in place from Piece 1; this wires it to UI.

  PATCH 3 — Tier breaks become format-aware
    Currently TIER_BREAKS is a hard-coded [4, 10, 18, 25] applied to all
    formats. Different formats need different break points (dynasty
    cliffs are sharper, superflex is QB-heavy, etc). Adds a format-aware
    tier break table.

What this script does NOT ship (needs live diagnostic):

  ✗ Prospects rankings crash root cause (need to run + see error)
  ✗ Heat icon score 96 not pulsing (need to verify rendering with you watching)
  ✗ Sleeper post-NFL-Draft player sync (separate workflow, not a patch)
  ✗ Tier B Fleaflicker per-user ADP (significant new code)
  ✗ NFL.com scraper (Supabase edge function)

Each PATCH has its own [APPLIED] / [ALREADY] / [SKIPPED] reporting.
If any patch's anchor isn't found, that patch is skipped and the others
continue. Idempotent — safe to re-run.

Run from /Users/patrickmeyer/AIOmni:
    python3 scripts/morning_patches.py

After running:
    npx tsc --noEmit
    git add -A
    git commit -m "Morning fixes: Home MFL/FF, rankings UI toggle, format tiers"
    git push
    eas build --platform ios --profile testflight --auto-submit
"""

import sys
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

INDEX_TSX = ROOT / "app" / "(tabs)" / "index.tsx"
RANKINGS_TSX = ROOT / "app" / "(tabs)" / "rankings.tsx"
RANKINGS_DATA = ROOT / "services" / "rankingsData.ts"


# ═══════════════════════════════════════════════════════════════════════════
# PATCH 1 — Home tab: MFL + Fleaflicker league loaders + pills
# ═══════════════════════════════════════════════════════════════════════════

# Note on approach: Home/index.tsx already imports loaders for sleeper/espn/yahoo.
# Pattern is loadXLeagues() -> league objects with `platform: 'x'` field.
# We need MFL/Fleaflicker loaders that follow the same shape.
#
# This script does NOT write the actual loadMflLeagues/loadFleaflickerLeagues
# implementations — those belong in services/platform/mfl.ts and
# services/platform/fleaflicker.ts where the auth credentials live. Instead,
# this script:
#   (a) Extends PLAT_LABEL to handle 'mfl' and 'fleaflicker'
#   (b) Adds stub loader functions IF the actual platform service exports a
#       getLeagues/getMyLeagues helper. We import what's available; if the
#       services don't export anything yet, we leave a TODO comment.
#   (c) Adds the loaders to the parallel Promise.all on initial load
#   (d) Includes mfl/fleaflicker leagues in the unified `leagues` state

PATCH1_PLAT_LABEL_OLD = """const PLAT_LABEL  = (p: Platform) => p === 'espn' ? 'ESPN' : p === 'yahoo' ? 'YAHOO' : 'SLEEPER';"""

PATCH1_PLAT_LABEL_NEW = """const PLAT_LABEL  = (p: Platform) =>
  p === 'espn'        ? 'ESPN'        :
  p === 'yahoo'       ? 'YAHOO'       :
  p === 'mfl'         ? 'MFL'         :
  p === 'fleaflicker' ? 'FLEAFLICKER' :
                        'SLEEPER';"""

# Imports to add for MFL/Fleaflicker league fetching. The actual functions
# may not exist yet in services — if they don't, the TS compiler will error
# clearly and we know to write them. We check before patching.
PATCH1_IMPORT_ANCHOR = "import { getValidYahooToken } from '../../services/yahoo';"

PATCH1_IMPORT_NEW = """import { getValidYahooToken } from '../../services/yahoo';
import { loadMflCredentials } from '../../services/platform/mfl';
import { loadFleaflickerCredentials } from '../../services/platform/fleaflicker';"""

# Loader functions injected after loadYahooLeagues. We model them after
# the Yahoo pattern: read credentials, hit platform API, normalize to League[]
PATCH1_YAHOO_LOADER_END_ANCHOR = """  const loadYahooLeagues = async (year: string = String(new Date().getFullYear())): Promise<League[]> => {"""

# Try to find where loadYahooLeagues function ends. We need to find a
# closing }; followed by the next const decl. We'll inject via a different
# anchor — the line before Promise.all that runs all loaders.

PATCH1_PROMISE_ALL_OLD = """        loadSleeperLeagues(selectedSeason),
        loadESPNLeagues(selectedSeason),
        loadYahooLeagues(selectedSeason),"""

PATCH1_PROMISE_ALL_NEW = """        loadSleeperLeagues(selectedSeason),
        loadESPNLeagues(selectedSeason),
        loadYahooLeagues(selectedSeason),
        loadMflLeagues(selectedSeason),
        loadFleaflickerLeagues(selectedSeason),"""

# Stub loader functions injected just before the Promise.all. We anchor on
# the line just before loadSleeperLeagues call inside Promise.all.
PATCH1_LOADER_INSERTION = """  // ─── MFL leagues (stub — wire to real fetch in Piece 2A) ────
  const loadMflLeagues = async (_year: string = String(new Date().getFullYear())): Promise<League[]> => {
    try {
      const creds = await loadMflCredentials();
      if (!creds) return [];
      // TODO Piece 2A: hit MFL API to enumerate user's leagues for the season
      // and map to League[]. For now return one placeholder using stored creds
      // so the platform pill shows up.
      return [{
        id: String(creds.leagueId),
        name: 'MFL League',
        platform: 'mfl' as any,
        format: 'PPR',
        rec: '0-0', rank: '-', pts: 0, opp: 0, week: 1,
      }];
    } catch { return []; }
  };

  // ─── Fleaflicker leagues (stub — wire to real fetch in Piece 2A) ────
  const loadFleaflickerLeagues = async (_year: string = String(new Date().getFullYear())): Promise<League[]> => {
    try {
      const creds = await loadFleaflickerCredentials();
      if (!creds) return [];
      return [{
        id: String(creds.leagueId),
        name: 'Fleaflicker League',
        platform: 'fleaflicker' as any,
        format: 'PPR',
        rec: '0-0', rank: '-', pts: 0, opp: 0, week: 1,
      }];
    } catch { return []; }
  };

  const loadSleeperLeagues"""

# We'll find existing `const loadSleeperLeagues = async` and insert our two
# stubs ABOVE it (so they appear in the function-definition order).
# Existing pattern is `const loadSleeperLeagues = async (year:...`
PATCH1_SLEEPER_LOADER_ANCHOR = "  const loadSleeperLeagues = async (year:"

# Empty-state copy: the line says "Connect Sleeper, ESPN, or Yahoo in Settings."
# Update to reflect all 5 platforms.
PATCH1_EMPTY_OLD = """<Text style={styles.emptyTxt}>Connect Sleeper, ESPN, or Yahoo in Settings.</Text>"""
PATCH1_EMPTY_NEW = """<Text style={styles.emptyTxt}>Connect Sleeper, ESPN, Yahoo, MFL, or Fleaflicker in Settings.</Text>"""


def patch_home_platforms():
    print("PATCH 1 — Home tab: MFL + Fleaflicker leaguers/pills")
    if not INDEX_TSX.exists():
        print(f"  [SKIPPED]  {INDEX_TSX} not found")
        return False

    s = INDEX_TSX.read_text()
    original = s
    any_change = False

    # Idempotency check
    if "loadMflLeagues" in s and "FLEAFLICKER" in s:
        print("  [ALREADY]  Home tab already has MFL/Fleaflicker integrated")
        return False

    # Sub-patch 1A: PLAT_LABEL
    if PATCH1_PLAT_LABEL_OLD in s:
        s = s.replace(PATCH1_PLAT_LABEL_OLD, PATCH1_PLAT_LABEL_NEW)
        print("  [APPLIED]  PLAT_LABEL extended for MFL/Fleaflicker")
        any_change = True
    elif "FLEAFLICKER" in s:
        print("  [ALREADY]  PLAT_LABEL already extended")
    else:
        print("  [SKIPPED]  PLAT_LABEL anchor not found — manual fix needed")

    # Sub-patch 1B: imports
    if PATCH1_IMPORT_ANCHOR in s and "loadMflCredentials" not in s:
        s = s.replace(PATCH1_IMPORT_ANCHOR, PATCH1_IMPORT_NEW)
        print("  [APPLIED]  added loadMflCredentials/loadFleaflickerCredentials imports")
        any_change = True
    elif "loadMflCredentials" in s:
        print("  [ALREADY]  imports already added")
    else:
        print("  [SKIPPED]  import anchor not found")

    # Sub-patch 1C: stub loader functions before loadSleeperLeagues
    if PATCH1_SLEEPER_LOADER_ANCHOR in s and "loadMflLeagues" not in s:
        # Insert before the existing const loadSleeperLeagues line
        s = s.replace(PATCH1_SLEEPER_LOADER_ANCHOR,
                      PATCH1_LOADER_INSERTION + PATCH1_SLEEPER_LOADER_ANCHOR.replace("  const loadSleeperLeagues", "= async (year:"))
        # The replacement above is wrong — fix it. Simpler: just replace the literal anchor.
        # Reset and try again with simpler logic.
        s = original
        # Simpler: insert the loader text right before the existing line
        s = s.replace(
            "  const loadSleeperLeagues = async (year:",
            PATCH1_LOADER_INSERTION.rstrip() + " = async (year:"
        )
        # That's still tangled. Let's do it cleanly: find the anchor index, insert above.
        s = original
        idx = s.find("  const loadSleeperLeagues = async (year:")
        if idx >= 0:
            insertion = """  // ─── MFL leagues (stub — wire to real fetch in Piece 2A) ────
  const loadMflLeagues = async (_year: string = String(new Date().getFullYear())): Promise<League[]> => {
    try {
      const creds = await loadMflCredentials();
      if (!creds) return [];
      return [{
        id: String((creds as any).leagueId ?? 'mfl'),
        name: 'MFL League',
        platform: 'mfl' as any,
        format: 'PPR',
        rec: '0-0', rank: '-', pts: 0, opp: 0, week: 1,
      }];
    } catch { return []; }
  };

  // ─── Fleaflicker leagues (stub — wire to real fetch in Piece 2A) ────
  const loadFleaflickerLeagues = async (_year: string = String(new Date().getFullYear())): Promise<League[]> => {
    try {
      const creds = await loadFleaflickerCredentials();
      if (!creds) return [];
      return [{
        id: String((creds as any).leagueId ?? 'fleaflicker'),
        name: 'Fleaflicker League',
        platform: 'fleaflicker' as any,
        format: 'PPR',
        rec: '0-0', rank: '-', pts: 0, opp: 0, week: 1,
      }];
    } catch { return []; }
  };

"""
            s = s[:idx] + insertion + s[idx:]
            print("  [APPLIED]  inserted loadMflLeagues + loadFleaflickerLeagues stubs")
            any_change = True
        else:
            print("  [SKIPPED]  loadSleeperLeagues anchor not found")
    elif "loadMflLeagues" in s:
        print("  [ALREADY]  loaders already inserted")

    # Sub-patch 1D: include in Promise.all
    if PATCH1_PROMISE_ALL_OLD in s:
        s = s.replace(PATCH1_PROMISE_ALL_OLD, PATCH1_PROMISE_ALL_NEW)
        print("  [APPLIED]  Promise.all extended with new loaders")
        any_change = True
    elif "loadMflLeagues(selectedSeason)" in s:
        print("  [ALREADY]  Promise.all already extended")

    # Sub-patch 1E: empty state copy
    if PATCH1_EMPTY_OLD in s:
        s = s.replace(PATCH1_EMPTY_OLD, PATCH1_EMPTY_NEW)
        print("  [APPLIED]  empty state copy updated")
        any_change = True

    if any_change:
        INDEX_TSX.write_text(s)
        print(f"  ✓ {INDEX_TSX.name} updated")
    return any_change


# ═══════════════════════════════════════════════════════════════════════════
# PATCH 2 — Rankings UI: redraft/dynasty toggle + scoring underneath
# ═══════════════════════════════════════════════════════════════════════════

# Goal: split the single "format" pill row into TWO rows:
#   - Top: a 2-button toggle: REDRAFT / DYNASTY (drives leagueType state)
#   - Bottom: scoring pills: PPR / HALF PPR / STANDARD / SUPERFLEX
#     (DYN removed from this row — it's now the toggle above)
#
# Approach: surgical patch on the FORMATS array constant to remove DYN,
# then locate the format pill row JSX and inject a leagueType toggle above it.
# The leagueType state already exists from Piece 1. We just need the UI
# to control it.

# Remove DYNASTY from the FORMATS constant
PATCH2_FORMATS_OLD = """  { key: 'PPR', label: 'PPR' },"""

# We need to see the full FORMATS array. We'll search for it and rebuild.
# The current shape (from earlier diagnostic) is roughly:
#   const FORMATS = [
#     { key: 'PPR', label: 'PPR' },
#     { key: 'HALF', label: 'HALF PPR' },
#     { key: 'STD', label: 'STANDARD' },
#     { key: 'SF', label: 'SUPERFLEX' },
#     { key: 'DYN', label: 'DYNASTY' },
#   ];

# Find anything that looks like that array and replace
PATCH2_FORMATS_REGEX = re.compile(
    r"const\s+FORMATS\s*=\s*\[\s*"
    r"(\{[^}]*?key:\s*'PPR'[^}]*?\}\s*,\s*)?"
    r"(\{[^}]*?key:\s*'HALF'[^}]*?\}\s*,\s*)?"
    r"(\{[^}]*?key:\s*'STD'[^}]*?\}\s*,\s*)?"
    r"(\{[^}]*?key:\s*'SF'[^}]*?\}\s*,\s*)?"
    r"(\{[^}]*?key:\s*'DYN'[^}]*?\}\s*,?\s*)?"
    r"\];",
    re.DOTALL,
)

PATCH2_FORMATS_NEW = """const FORMATS = [
  { key: 'PPR', label: 'PPR' },
  { key: 'HALF', label: 'HALF PPR' },
  { key: 'STD', label: 'STANDARD' },
  { key: 'SF', label: 'SUPERFLEX' },
];"""

# The Format type — drop 'DYN'
PATCH2_FORMAT_TYPE_OLD = "type Format   = 'PPR' | 'HALF' | 'STD' | 'SF' | 'DYN';"
PATCH2_FORMAT_TYPE_NEW = "type Format   = 'PPR' | 'HALF' | 'STD' | 'SF';"


def patch_rankings_ui():
    print()
    print("PATCH 2 — Rankings UI: redraft/dynasty toggle + scoring row")
    if not RANKINGS_TSX.exists():
        print(f"  [SKIPPED]  {RANKINGS_TSX} not found")
        return False

    s = RANKINGS_TSX.read_text()
    original = s

    # Idempotency check
    if PATCH2_FORMAT_TYPE_NEW in s and "'DYN'" not in s:
        print("  [ALREADY]  Format type already cleaned of DYN")
    elif PATCH2_FORMAT_TYPE_OLD in s:
        s = s.replace(PATCH2_FORMAT_TYPE_OLD, PATCH2_FORMAT_TYPE_NEW)
        print("  [APPLIED]  Format type no longer includes 'DYN'")
    else:
        print("  [SKIPPED]  Format type anchor not found")

    # Replace FORMATS array
    match = PATCH2_FORMATS_REGEX.search(s)
    if match:
        # Only replace if DYN is still in the array
        if "'DYN'" in match.group(0):
            s = s[:match.start()] + PATCH2_FORMATS_NEW + s[match.end():]
            print("  [APPLIED]  FORMATS array no longer includes DYNASTY entry")
        else:
            print("  [ALREADY]  FORMATS array already cleaned")
    else:
        print("  [SKIPPED]  FORMATS array regex did not match — manual review")

    # NOTE: We do NOT add the new toggle UI JSX in this script. Reasoning:
    # injecting JSX into a complex JSX tree without seeing the surrounding
    # styles, layout container, etc., is high-risk and likely produces
    # broken rendering. Removing DYN from the FORMATS array is safe and
    # reversible. Adding the toggle UI itself needs Patrick to design where
    # it visually goes — likely a manual JSX addition in a follow-up session.
    print()
    print("  NOTE: leagueType TOGGLE UI not added by this script.")
    print("        State variable exists; rendering needs manual JSX placement")
    print("        in rankings.tsx near the FORMATS pill row. See follow-up.")

    if s != original:
        RANKINGS_TSX.write_text(s)
        print(f"  ✓ {RANKINGS_TSX.name} updated")
        return True
    return False


# ═══════════════════════════════════════════════════════════════════════════
# PATCH 3 — Format-aware tier breaks
# ═══════════════════════════════════════════════════════════════════════════

# Currently: const TIER_BREAKS = [4, 10, 18, 25];
# That single constant decides where Tier 1 ends, Tier 2 ends, etc.
#
# Different formats have different value cliffs. Adds:
#   redraft PPR/HALF/STD: existing breaks (RB/WR-driven)
#   redraft SF: tighter (QBs cluster early)
#   dynasty: looser (longer relevant tier of young assets)

PATCH3_TIER_BREAKS_OLD = """const TIER_BREAKS = [4, 10, 18, 25];
function assignTier(rank: number): number {
  if (rank <= TIER_BREAKS[0]) return 1;
  if (rank <= TIER_BREAKS[1]) return 2;
  if (rank <= TIER_BREAKS[2]) return 3;
  if (rank <= TIER_BREAKS[3]) return 4;
  return 5;
}"""

PATCH3_TIER_BREAKS_NEW = """// ─── Tier breaks (format-aware) ───────────────────────────────
// Tier 1 ends at idx 0, Tier 2 at idx 1, etc. Anything past idx 3
// becomes Tier 5 (deep depth / dart throws).
//
// Calibration rationale:
//   - Standard redraft cliff is RB-driven; top 4 form an RB1/elite tier
//   - Superflex tightens because elite QBs clump
//   - Dynasty extends because young assets have multi-year relevance
//     (a Tier 3 dynasty player is still a long-term piece)
const TIER_BREAKS_DEFAULT  = [4, 10, 18, 25];
const TIER_BREAKS_SUPERFLEX = [3, 8, 16, 24];
const TIER_BREAKS_DYNASTY  = [5, 14, 26, 40];

function getTierBreaks(format?: string): number[] {
  if (format === 'SF' || format === 'superflex') return TIER_BREAKS_SUPERFLEX;
  if (format === 'DYN' || format === 'dynasty')  return TIER_BREAKS_DYNASTY;
  return TIER_BREAKS_DEFAULT;
}

// Backwards-compatible alias for any existing callers
const TIER_BREAKS = TIER_BREAKS_DEFAULT;

function assignTier(rank: number, format?: string): number {
  const breaks = getTierBreaks(format);
  if (rank <= breaks[0]) return 1;
  if (rank <= breaks[1]) return 2;
  if (rank <= breaks[2]) return 3;
  if (rank <= breaks[3]) return 4;
  return 5;
}"""


def patch_tier_breaks():
    print()
    print("PATCH 3 — Format-aware tier breaks")
    if not RANKINGS_DATA.exists():
        print(f"  [SKIPPED]  {RANKINGS_DATA} not found")
        return False

    s = RANKINGS_DATA.read_text()
    original = s

    if "TIER_BREAKS_DYNASTY" in s:
        print("  [ALREADY]  format-aware tier breaks already in place")
        return False

    if PATCH3_TIER_BREAKS_OLD in s:
        s = s.replace(PATCH3_TIER_BREAKS_OLD, PATCH3_TIER_BREAKS_NEW)
        print("  [APPLIED]  added TIER_BREAKS_DEFAULT/SUPERFLEX/DYNASTY + getTierBreaks()")
        print("             assignTier() now optionally accepts format parameter")
        print("             (existing callers still work — format is optional)")
        RANKINGS_DATA.write_text(s)
        print(f"  ✓ {RANKINGS_DATA.name} updated")
        return True
    else:
        print("  [SKIPPED]  TIER_BREAKS anchor not found — manual review")
        return False


# ═══════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════

def main():
    print("=" * 72)
    print("MORNING PATCHES — April 27")
    print("=" * 72)
    print()

    a = patch_home_platforms()
    b = patch_rankings_ui()
    c = patch_tier_breaks()

    print()
    print("=" * 72)
    if a or b or c:
        print(f"✓ Patches complete (Home: {a}, Rankings UI: {b}, Tier breaks: {c})")
    else:
        print("(no changes — all patches may already be applied)")
    print("=" * 72)
    print()
    print("VERIFICATION:")
    print("  npx tsc --noEmit")
    print()
    print("If clean:")
    print("  git add -A")
    print("  git commit -m 'Morning fixes: Home MFL/FF, rankings UI cleanup, format tiers'")
    print("  git push")
    print("  eas build --platform ios --profile testflight --auto-submit")
    print()
    print("STILL PENDING (need live diagnostic — separate sessions):")
    print("  - Prospects rankings crash (need stack trace)")
    print("  - Heat icon score-96-not-pulsing (need rendering verification)")
    print("  - Sleeper post-NFL-Draft player sync (data pipeline)")
    print("  - Tier B Fleaflicker per-user ADP")
    print("  - NFL.com scraper edge function")
    print("  - leagueType toggle JSX placement in rankings.tsx UI")
    print()
    print("NOTES on what was NOT autopiloted:")
    print()
    print("1. The leagueType TOGGLE UI is intentionally NOT added by this")
    print("   script. The state variable exists from Piece 1, the FORMATS array")
    print("   is now cleaned of DYNASTY, but the actual JSX (a 2-button toggle")
    print("   above the scoring pill row) needs to go somewhere specific in")
    print("   rankings.tsx that depends on the surrounding layout. Adding it")
    print("   blind via regex would likely produce broken rendering. After")
    print("   running this script, the UI will show only PPR/HALF/STD/SF in")
    print("   the scoring row — Patrick can add the toggle JSX live with eyes")
    print("   on the screen.")
    print()
    print("2. The MFL/Fleaflicker league loaders are STUBS that return one")
    print("   placeholder league each based on stored credentials. Real")
    print("   implementation (enumerate user's leagues for the season, fetch")
    print("   real records/scores) is Piece 2A work. The stubs DO surface")
    print("   the platform pills on Home, which addresses the immediate UX")
    print("   gap (connections aren't visible).")


if __name__ == "__main__":
    main()
