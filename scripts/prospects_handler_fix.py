#!/usr/bin/env python3
"""
═══════════════════════════════════════════════════════════════════════════
Prospects handler hardening — v2 (corrected anchor)
═══════════════════════════════════════════════════════════════════════════

Previous patch (build127_patches.py PATCH A) didn't match the current handler
because it expected a different shape. The current handler is:

    if (prospects.length === 0) {
      setProspectsLoading(true);
      try {
        const data = await fetchDedupedProspects(2026);
        if (data.length > 0) setProspects(data);
      } catch {}
      setProspectsLoading(false);
    }

Issues:
  - No timeout — Sleeper player sync can hang forever
  - Empty catch{} eats errors silently (user sees nothing)
  - setProspectsLoading(false) is OUTSIDE try/catch — if catch{} itself
    throws (it shouldn't, but if React state updates inside an effect cause
    issues), loading state could stick

Fix: full try/catch/finally with 15s timeout and prospectsError state.

Idempotent. Safe to re-run.

Run from /Users/patrickmeyer/AIOmni:
    python3 scripts/prospects_handler_fix.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RANKINGS_TSX = ROOT / "app" / "(tabs)" / "rankings.tsx"


OLD_HANDLER = """    if (prospects.length === 0) {
      setProspectsLoading(true);
      try {
        const data = await fetchDedupedProspects(2026);
        if (data.length > 0) setProspects(data);
      } catch {}
      setProspectsLoading(false);
    }"""

NEW_HANDLER = """    if (prospects.length === 0) {
      setProspectsLoading(true);
      setProspectsError(null);
      try {
        // 15-second timeout — depends on Sleeper player sync which can hang
        // post-NFL-Draft when player IDs change. Without timeout, UI freezes.
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Prospects fetch timed out after 15 seconds')), 15000)
        );
        const data = await Promise.race([fetchDedupedProspects(2026), timeout]);
        if (data.length > 0) {
          setProspects(data);
        } else {
          setProspectsError('No prospects available right now. Check back closer to the NFL Draft.');
        }
      } catch (err: any) {
        console.error('[Prospects] fetch failed:', err);
        const isTimeout = err?.message?.includes('timed out');
        setProspectsError(
          isTimeout
            ? 'Prospects took too long to load. Pull to refresh or try again later.'
            : "Couldn't load prospects. Pull to refresh or try again later."
        );
      } finally {
        setProspectsLoading(false);
      }
    }"""


def patch_handler():
    print("Prospects handler hardening — v2")
    if not RANKINGS_TSX.exists():
        print(f"  [SKIPPED]  {RANKINGS_TSX} not found")
        return False

    s = RANKINGS_TSX.read_text()

    if "Promise.race([fetchDedupedProspects" in s:
        print("  [ALREADY]  prospects handler already has timeout via Promise.race")
        return False

    if OLD_HANDLER in s:
        s = s.replace(OLD_HANDLER, NEW_HANDLER)
        RANKINGS_TSX.write_text(s)
        print("  [APPLIED]  prospects handler now has:")
        print("              - try/catch/finally (loading always resets)")
        print("              - 15s timeout via Promise.race")
        print("              - sets prospectsError on failure for user-facing message")
        print(f"  ✓ {RANKINGS_TSX.name} updated")
        return True
    else:
        print("  [WARN]     handler anchor not found — manual review needed")
        print("             Look for 'if (prospects.length === 0) {' around line 348")
        return False


def main():
    print("=" * 72)
    a = patch_handler()
    print("=" * 72)
    print()
    if a:
        print("Verify:")
        print("  npx tsc --noEmit")
        print()
        print("Don't forget the manual UI patch in rankings.tsx render block")
        print("(around line 691) to display prospectsError — paste the JSX block")
        print("Claude provided in chat.")


if __name__ == "__main__":
    main()
