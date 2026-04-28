#!/usr/bin/env python3
"""
═══════════════════════════════════════════════════════════════════════════
Build 127 patches — Prospects stall + Fleaflicker 404 handling
═══════════════════════════════════════════════════════════════════════════

PATCH A — Prospects defensive coding
  Currently fetchDedupedProspects(2026) is awaited without try/catch/finally.
  If it throws or hangs (it depends on Sleeper player sync which is broken),
  setProspectsLoading(false) never runs and the UI stalls forever.

  Fix:
    - Wrap in try/catch/finally so loading state always resets
    - Add 15-second timeout via Promise.race
    - Set a new prospectsError state for user-facing message
    - finally{} guarantees spinner clears

PATCH B — Fleaflicker 404 handling
  Private Fleaflicker leagues return 404 from FetchLeague endpoint. Currently
  this throws PlatformError which propagates and probably crashes the screen
  or shows a raw error.

  Fix:
    - Catch 404 specifically in getCreds-driven fetch paths
    - Throw a clean FleaflickerPrivateLeagueError instead
    - UI layer can catch this and show "Private leagues coming in v1.1" message

  This is a defensive patch only. Doesn't enable private league support — that
  requires the cookie auth implementation (separate v1.1 session, ~6-10 hrs).

Idempotent. Safe to re-run.

Run from /Users/patrickmeyer/AIOmni:
    python3 scripts/build127_patches.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RANKINGS_TSX = ROOT / "app" / "(tabs)" / "rankings.tsx"
FLEAFLICKER_TS = ROOT / "services" / "platform" / "fleaflicker.ts"


# ─── PATCH A: Prospects defensive coding ───────────────────────────────────

# Current bug: handleProspectsTab awaits fetchDedupedProspects without
# try/catch/finally. If it hangs or throws, setProspectsLoading(false)
# never runs.

OLD_PROSPECTS_HANDLER = """    setProspectsGated(false);
    setMode('prospects');
    if (prospects.length === 0) {
      setProspectsLoading(true);
        const data = await fetchDedupedProspects(2026);
        if (data.length > 0) setProspects(data);
      setProspectsLoading(false);
    }"""

NEW_PROSPECTS_HANDLER = """    setProspectsGated(false);
    setMode('prospects');
    if (prospects.length === 0) {
      setProspectsLoading(true);
      setProspectsError(null);
      try {
        // 15-second timeout — Sleeper player sync can hang post-NFL-Draft
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
        setProspectsError(
          err?.message?.includes('timed out')
            ? 'Prospects took too long to load. Pull to refresh or try again later.'
            : 'Couldn\\'t load prospects. Pull to refresh or try again later.'
        );
      } finally {
        setProspectsLoading(false);
      }
    }"""


# We also need to add the prospectsError state declaration
OLD_PROSPECTS_STATE = """  const [prospectsLoading, setProspectsLoading] = useState(false);
  const [prospectsGated, setProspectsGated] = useState(false);"""

NEW_PROSPECTS_STATE = """  const [prospectsLoading, setProspectsLoading] = useState(false);
  const [prospectsGated, setProspectsGated] = useState(false);
  const [prospectsError, setProspectsError] = useState<string | null>(null);"""


def patch_prospects():
    print("PATCH A — Prospects defensive coding")
    if not RANKINGS_TSX.exists():
        print(f"  [SKIPPED]  {RANKINGS_TSX} not found")
        return False

    s = RANKINGS_TSX.read_text()
    any_change = False

    # State declaration
    if "prospectsError" in s:
        print("  [ALREADY]  prospectsError state already declared")
    elif OLD_PROSPECTS_STATE in s:
        s = s.replace(OLD_PROSPECTS_STATE, NEW_PROSPECTS_STATE)
        print("  [APPLIED]  added prospectsError state")
        any_change = True
    else:
        print("  [WARN]     prospects state anchor not found — manual review")

    # Handler logic
    if "Promise.race([fetchDedupedProspects" in s:
        print("  [ALREADY]  prospects handler already has timeout/try-catch")
    elif OLD_PROSPECTS_HANDLER in s:
        s = s.replace(OLD_PROSPECTS_HANDLER, NEW_PROSPECTS_HANDLER)
        print("  [APPLIED]  prospects handler wrapped in try/catch/finally + 15s timeout")
        any_change = True
    else:
        print("  [WARN]     prospects handler anchor not found — manual review")
        print("             Look for handleProspectsTab function around line 336")

    if any_change:
        RANKINGS_TSX.write_text(s)
        print(f"  ✓ {RANKINGS_TSX.name} updated")
        print()
        print("  ⚠️  YOU MUST ADD UI for prospectsError display.")
        print("     Find the {mode === 'prospects' && (...)} block (around line 677)")
        print("     and add a prospectsError check before prospectsLoading:")
        print()
        print("     {mode === 'prospects' && (")
        print("       prospectsGated ? <Gate/> :")
        print("       prospectsError ? <Text style={{color:'#ff5714',padding:20}}>{prospectsError}</Text> :")
        print("       prospectsLoading ? <Spinner/> :")
        print("       <ProspectsList/>")
        print("     )}")
    return any_change


# ─── PATCH B: Fleaflicker 404 handling ─────────────────────────────────────
#
# The ff() helper currently throws PlatformError on any non-OK response. We
# add a check that converts 404 specifically into a clearly-typed error
# that the UI layer can catch and display as "private league" messaging.

OLD_FF_HELPER = """async function ff<T>(endpoint: string, params: Record<string, string | number> = {}): Promise<T> {
  const qs = new URLSearchParams({ sport: 'NFL', ...Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k, String(v)])
  )}).toString();
  const url = `${BASE}/${endpoint}?${qs}`;
  const res = await fetch(url);
  if (!res.ok) throw new PlatformError(`Fleaflicker ${endpoint} failed: ${res.status}`, 'fleaflicker');
  return res.json() as Promise<T>;
}"""

NEW_FF_HELPER = """// Sentinel error class — UI catches this specifically to show a clean
// "private league not yet supported" message instead of a generic crash.
export class FleaflickerPrivateLeagueError extends Error {
  constructor(public readonly leagueId?: string) {
    super(
      leagueId
        ? `Fleaflicker league ${leagueId} appears to be private. Private-league support is coming in a future release.`
        : 'This Fleaflicker league appears to be private. Private-league support is coming in a future release.'
    );
    this.name = 'FleaflickerPrivateLeagueError';
  }
}

async function ff<T>(endpoint: string, params: Record<string, string | number> = {}): Promise<T> {
  const qs = new URLSearchParams({ sport: 'NFL', ...Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k, String(v)])
  )}).toString();
  const url = `${BASE}/${endpoint}?${qs}`;
  const res = await fetch(url);
  if (!res.ok) {
    // 404 from FetchLeague* endpoints almost always means private league
    // (or genuinely deleted league). Either way, no public API path exists.
    if (res.status === 404 && endpoint.startsWith('FetchLeague')) {
      const leagueId = params.league_id ? String(params.league_id) : undefined;
      throw new FleaflickerPrivateLeagueError(leagueId);
    }
    throw new PlatformError(`Fleaflicker ${endpoint} failed: ${res.status}`, 'fleaflicker');
  }
  return res.json() as Promise<T>;
}"""


def patch_fleaflicker():
    print()
    print("PATCH B — Fleaflicker 404 handling")
    if not FLEAFLICKER_TS.exists():
        print(f"  [SKIPPED]  {FLEAFLICKER_TS} not found")
        return False

    s = FLEAFLICKER_TS.read_text()

    if "FleaflickerPrivateLeagueError" in s:
        print("  [ALREADY]  FleaflickerPrivateLeagueError already defined")
        return False

    if OLD_FF_HELPER in s:
        s = s.replace(OLD_FF_HELPER, NEW_FF_HELPER)
        FLEAFLICKER_TS.write_text(s)
        print("  [APPLIED]  ff() helper now throws FleaflickerPrivateLeagueError on 404")
        print("             from FetchLeague endpoints (private league signal)")
        print(f"  ✓ {FLEAFLICKER_TS.name} updated")
        print()
        print("  ⚠️  Optional: UI layer can catch FleaflickerPrivateLeagueError")
        print("     to show user-friendly message. For now, the error message")
        print("     is descriptive enough that React Native red screen will")
        print("     read clearly.")
        return True
    else:
        print("  [WARN]     ff() helper anchor not found — manual review")
        return False


# ─── MAIN ──────────────────────────────────────────────────────────────────

def main():
    print("=" * 72)
    print("Build 127 patches — Prospects + Fleaflicker")
    print("=" * 72)
    print()

    a = patch_prospects()
    b = patch_fleaflicker()

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
    print("If clean, commit:")
    print("  git add -A")
    print("  git commit -m 'Build 127: prospects defensive coding + Fleaflicker 404'")
    print("  git push")
    print()
    print("Manual UI step still needed for prospectsError display — see warning above.")


if __name__ == "__main__":
    main()
