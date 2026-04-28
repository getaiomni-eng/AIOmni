#!/usr/bin/env python3
"""
═══════════════════════════════════════════════════════════════════════════
Patch C — Heat icon distribution fix
═══════════════════════════════════════════════════════════════════════════

PROBLEM
  Patrick reports only 9 waiver players show heat icons, all in 85-96 range.
  Two bugs colluding:

  Bug 1 — velocityScore returns 50 when net = 0
    Most players have addsLast48h=0 and dropsLast48h=0 (not trending).
    Current code: if (net === 0) return 50.  But "no signal" should be COOL,
    not WARM. 50 is the WARM/HOT boundary — semantically wrong baseline.

  Bug 2 — Free tier iconThreshold = 70
    Free users only see icons on score >= 70. Combined with bug 1, every
    non-trending player scores ~50 (hidden) and only the heaviest-trending
    players cross 70. Result: free users see almost no icons. Looks broken.

FIX
  Two surgical changes:

  1. services/heat.ts: velocityScore zero-net baseline 50 → 25
     - Non-trending players now sit in COOL (correct semantically)
     - Mildly-trending: WARM (26-50)
     - Real trending: HOT (51-75)
     - Heavy trending: SCORCHING (76+)

  2. app/hooks/useHeatAccess.ts: iconThreshold paid 40 → 25, free 70 → 50
     - Paid tier: shows WARM+ (50%+ of distribution) — premium experience
     - Free tier: shows HOT+SCORCHING (top trending only) — drives upgrade

EXPECTED RESULT
  Free user sees ~10-30% of waiver players have heat icons (HOT/SCORCHING)
  Paid user sees ~50%+ of waiver players have heat icons (WARM+)
  Most non-trending mid-tier players: COOL, no icon, both tiers — correct.

Idempotent. Safe to re-run.

Run from /Users/patrickmeyer/AIOmni:
    python3 scripts/heat_threshold_fix.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HEAT_TS = ROOT / "services" / "heat.ts"
HEAT_ACCESS_TS = ROOT / "app" / "hooks" / "useHeatAccess.ts"


# ─── PATCH C-1: velocityScore zero-net baseline ─────────────────────────────

OLD_VELOCITY_ZERO = """  const net = (s.addsLast48h ?? 0) - (s.dropsLast48h ?? 0);
  if (net === 0) return 50;"""

NEW_VELOCITY_ZERO = """  const net = (s.addsLast48h ?? 0) - (s.dropsLast48h ?? 0);
  // Non-trending players (zero net activity) are COOL, not WARM.
  // 25 sits in the middle of COOL (1-25), so the heat icon hides for
  // these players unless other signals (ownership, ranking) pull them up.
  if (net === 0) return 25;"""


def patch_velocity():
    print("PATCH C-1 — velocityScore zero-net baseline")
    if not HEAT_TS.exists():
        print(f"  [SKIPPED]  {HEAT_TS} not found")
        return False

    s = HEAT_TS.read_text()

    if "Non-trending players (zero net activity) are COOL" in s:
        print("  [ALREADY]  velocityScore zero baseline already updated")
        return False

    if OLD_VELOCITY_ZERO in s:
        s = s.replace(OLD_VELOCITY_ZERO, NEW_VELOCITY_ZERO)
        HEAT_TS.write_text(s)
        print("  [APPLIED]  zero-net baseline 50 → 25 (COOL, hides icon by default)")
        print(f"  ✓ {HEAT_TS.name} updated")
        return True
    else:
        print("  [WARN]     velocityScore anchor not found — manual review")
        return False


# ─── PATCH C-2: iconThreshold per tier ──────────────────────────────────────

OLD_THRESHOLD_LINE = "    iconThreshold: isPaid ? 40 : 70,      // free = HOT+SCORCHING only; paid = WARM+"

NEW_THRESHOLD_LINE = """    // Free: HOT+SCORCHING only (score >= 50 catches HOT 51+ but excludes WARM)
    // Paid: WARM+ (score >= 25 catches mild trending and up — premium reveal)
    iconThreshold: isPaid ? 25 : 50,"""


def patch_threshold():
    print()
    print("PATCH C-2 — iconThreshold per tier")
    if not HEAT_ACCESS_TS.exists():
        print(f"  [SKIPPED]  {HEAT_ACCESS_TS} not found")
        return False

    s = HEAT_ACCESS_TS.read_text()

    if "iconThreshold: isPaid ? 25 : 50" in s:
        print("  [ALREADY]  iconThreshold already updated")
        return False

    if OLD_THRESHOLD_LINE in s:
        s = s.replace(OLD_THRESHOLD_LINE, NEW_THRESHOLD_LINE)
        HEAT_ACCESS_TS.write_text(s)
        print("  [APPLIED]  thresholds: free 70→50 (HOT+SCORCHING)")
        print("                         paid 40→25 (WARM+)")
        print(f"  ✓ {HEAT_ACCESS_TS.name} updated")
        return True
    else:
        print("  [WARN]     threshold anchor not found — manual review")
        return False


# ─── MAIN ──────────────────────────────────────────────────────────────────

def main():
    print("=" * 72)
    print("Heat icon distribution fix — Patch C")
    print("=" * 72)
    print()

    a = patch_velocity()
    b = patch_threshold()

    print()
    print("=" * 72)
    if a or b:
        print("✓ Patches applied")
    else:
        print("(no changes — patches may already be applied)")
    print("=" * 72)
    print()
    print("Verify:")
    print("  npx tsc --noEmit")
    print()
    print("Then commit ALL morning work and push:")
    print("  git add -A")
    print("  git commit -m 'Build 127: prospects + Fleaflicker + heat distribution'")
    print("  git push")
    print()
    print("Then build:")
    print("  eas build --platform ios --profile testflight --auto-submit")


if __name__ == "__main__":
    main()
