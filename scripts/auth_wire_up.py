#!/usr/bin/env python3
"""
Auth wire-up — fixes two real bugs caught in TestFlight:

Bug 1: _layout.tsx routes unauthenticated users into /(tabs).
       The app then crashes with "Auth session missing!" when downstream
       code tries to fetch user data from Supabase.
  Fix: route unauthenticated users to /auth instead.

Bug 2: onboarding.tsx has a "CONTINUE WITHOUT ACCOUNT" button that
       skips auth entirely. This was always a launch-blocker — the app
       requires a session for rankings overrides, behavioral sync,
       subscriptions, and memory. Remove the button.
  Fix: delete the skip button and its styles.

Plus: Wrap the behavioral sync call with a guard so it doesn't pop
      a native alert on missing session.

Run from /Users/patrickmeyer/AIOmni:
    python3 scripts/auth_wire_up.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LAYOUT = ROOT / "app" / "_layout.tsx"
ONBOARD = ROOT / "app" / "onboarding.tsx"

# ═══════════════════════════════════════════════════════════════════════════
# PATCH 1 — _layout.tsx: route unauthenticated users to /auth
# ═══════════════════════════════════════════════════════════════════════════

LAYOUT_PATCHES = [
    # Fix 1a: change the unauthenticated redirect from /(tabs) → /auth
    (
        "redirect unauth users to /auth",
        "        let user = null;\n"
        "        try { user = await getUser(); } catch {}\n"
        "        if (!user) {\n"
        "          try { await initPurchases(); } catch {}\n"
        "          router.replace('/(tabs)' as any);\n"
        "          return;\n"
        "        }",

        "        let user = null;\n"
        "        try { user = await getUser(); } catch {}\n"
        "        if (!user) {\n"
        "          router.replace('/auth' as any);\n"
        "          return;\n"
        "        }",
    ),

    # Fix 1b: guard behavioralSync against running without a session. The
    # existing useEffect already wraps in try/catch for logging, but the
    # downstream supabase calls inside syncUserBehavioralData can surface
    # native alerts on iOS if they throw uncaught. Tighten the guard so
    # we only invoke sync when a user id is actually present.
    (
        "guard behavioralSync",
        "    const run = async () => {\n"
        "      try {\n"
        "        const { data } = await supabase.auth.getUser();\n"
        "        if (data?.user?.id) {\n"
        "          await syncUserBehavioralData(data.user.id);\n"
        "        }\n"
        "      } catch (e) {\n"
        "        console.log('behavioralSync error:', e);\n"
        "      }\n"
        "    };",

        "    const run = async () => {\n"
        "      try {\n"
        "        // getSession is lighter than getUser and does not throw on\n"
        "        // missing session — it simply returns {data: {session: null}}.\n"
        "        const { data } = await supabase.auth.getSession();\n"
        "        if (data?.session?.user?.id) {\n"
        "          await syncUserBehavioralData(data.session.user.id);\n"
        "        }\n"
        "      } catch (e) {\n"
        "        console.log('behavioralSync error:', e);\n"
        "      }\n"
        "    };",
    ),
]


# ═══════════════════════════════════════════════════════════════════════════
# PATCH 2 — onboarding.tsx: remove the "CONTINUE WITHOUT ACCOUNT" button
# ═══════════════════════════════════════════════════════════════════════════

ONBOARD_PATCHES = [
    # Remove the skip button JSX entirely, including the surrounding blank
    # line so the result is clean.
    (
        "remove skip button JSX",
        "            <Text style={styles.secondaryBtnText}>SIGN IN</Text>\n"
        "          </TouchableOpacity>\n\n"
        "          <TouchableOpacity\n"
        "            style={styles.skipBtn}\n"
        "            onPress={() => router.replace('/(tabs)')}\n"
        "          >\n"
        "            <Text style={styles.skipBtnText}>CONTINUE WITHOUT ACCOUNT</Text>\n"
        "          </TouchableOpacity>\n"
        "        </Animated.View>",

        "            <Text style={styles.secondaryBtnText}>SIGN IN</Text>\n"
        "          </TouchableOpacity>\n"
        "        </Animated.View>",
    ),
]


def apply_patches(target: Path, patches: list) -> int:
    if not target.exists():
        print(f"  ERROR: {target} not found")
        return -1
    original = target.read_text()
    content = original
    applied = 0
    skipped = 0
    failed = []

    for desc, old, new in patches:
        count = content.count(old)
        if count == 1:
            content = content.replace(old, new)
            applied += 1
            print(f"  [APPLIED]  {desc}")
        elif count == 0:
            # Already applied?
            # Use the distinctive part of NEW to check.
            fingerprint = new.strip()[:60]
            if fingerprint in content:
                skipped += 1
                print(f"  [ALREADY]  {desc}")
            else:
                failed.append(desc)
                print(f"  [MISSING]  {desc}")
        else:
            failed.append(f"{desc} ({count} matches)")
            print(f"  [AMBIG]    {desc} ({count} matches)")

    if failed:
        print(f"  WARNING: {target.name} NOT modified.")
        return -1

    if content != original:
        target.write_text(content)
        print(f"  ✓ Patched {target.name} ({applied} applied, {skipped} already)")
    else:
        print(f"  — {target.name} no changes needed")
    return applied


def main():
    print("=" * 60)
    print("Auth wire-up — _layout.tsx + onboarding.tsx")
    print("=" * 60)

    print("\n── _layout.tsx ────────────────────────────────────────────")
    r1 = apply_patches(LAYOUT, LAYOUT_PATCHES)
    if r1 < 0:
        sys.exit(2)

    print("\n── onboarding.tsx ─────────────────────────────────────────")
    r2 = apply_patches(ONBOARD, ONBOARD_PATCHES)
    if r2 < 0:
        sys.exit(2)

    print("\n" + "=" * 60)
    print("✓ Auth wire-up complete")
    print("=" * 60)
    print()
    print("What changed:")
    print("  • Unauthenticated users now redirect to /auth (not /(tabs))")
    print("  • 'CONTINUE WITHOUT ACCOUNT' button removed from onboarding")
    print("  • behavioralSync uses getSession (lighter, no throw on empty)")
    print()
    print("Next:")
    print("  npx tsc --noEmit")
    print("  Commit + eas build.")
    print()
    print("Separately (Supabase dashboard, 5 min):")
    print("  Authentication → Email Templates → update 'Confirm signup'")
    print("    • Subject: 'Welcome to AIOmni — confirm your email'")
    print("  Authentication → SMTP Settings")
    print("    • Sender name: AIOmni")
    print("    • Sender email: aiomni@getaiomni.com (or leave noreply)")


if __name__ == "__main__":
    main()
