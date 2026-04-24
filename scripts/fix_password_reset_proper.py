#!/usr/bin/env python3
"""
Password reset — proper fix (replaces earlier disable approach).

Three changes, all minimal:

1. services/supabase.ts:
   detectSessionInUrl: false → true
   This lets Supabase read the recovery/confirmation token from deep-link
   URLs and establish a session automatically. Without this, updatePassword
   throws "Auth session missing!" on recovery links.

2. app/_layout.tsx:
   Add a processed-URL guard using AsyncStorage so the password-reset
   prompt only fires once per unique URL. iOS caches the last deep-link URL
   and Linking.getInitialURL() re-fires it on every cold start. Without the
   guard, users who reset their password get the prompt again every time
   they open the app — forever.

3. app/_layout.tsx:
   After successful updatePassword, sign out cleanly and route to /auth.
   Supabase's recovery flow does NOT leave the user authenticated — they
   must sign in with the new password. Previously routed to /(tabs), which
   caused downstream session errors.

Run from /Users/patrickmeyer/AIOmni:
    python3 scripts/fix_password_reset_proper.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SUPA = ROOT / "services" / "supabase.ts"
LAYOUT = ROOT / "app" / "_layout.tsx"


# ─── Patch 1: enable detectSessionInUrl ───────────────────────────────────
SUPA_OLD = "    detectSessionInUrl: false,"
SUPA_NEW = "    detectSessionInUrl: true,"


# ─── Patch 2+3: dedup guard + signout + correct redirect ──────────────────
# We rewrite the password-reset branch body to:
#   - check AsyncStorage for the URL hash; skip if already processed
#   - on success, sign out and route to /auth (not /(tabs))
#   - mark URL as processed so it never re-fires

LAYOUT_OLD = """      // ── Password reset callback ──
      if (url.includes('auth/reset') || url.includes('type=recovery')) {
        // Supabase auto-sets the session from the recovery token in the URL
        // Prompt user for new password
        setTimeout(() => {
          Alert.prompt(
            'Set New Password',
            'Enter your new password:',
            async (newPw) => {
              if (!newPw || newPw.length < 6) {
                Alert.alert('Error', 'Password must be at least 6 characters.');
                return;
              }
              try {
                const res = await updatePassword(newPw);
                if (res.success) {"""

LAYOUT_NEW = """      // ── Password reset callback ──
      if (url.includes('auth/reset') || url.includes('type=recovery')) {
        // Dedup: iOS caches the last-opened deep-link URL and replays it
        // on every cold start via Linking.getInitialURL. Without this guard
        // the recovery prompt would re-fire forever. Use the URL itself as
        // the dedup key (each recovery link is uniquely signed by Supabase).
        const processedKey = 'processed_reset_url';
        try {
          const lastProcessed = await AsyncStorage.getItem(processedKey);
          if (lastProcessed === url) return;
          await AsyncStorage.setItem(processedKey, url);
        } catch {}

        // Supabase auto-sets the session from the recovery token in the URL
        // (detectSessionInUrl: true in services/supabase.ts). Give it a
        // beat to parse the token before prompting.
        setTimeout(() => {
          Alert.prompt(
            'Set New Password',
            'Enter your new password:',
            async (newPw) => {
              if (!newPw || newPw.length < 6) {
                Alert.alert('Error', 'Password must be at least 6 characters.');
                return;
              }
              try {
                const res = await updatePassword(newPw);
                if (res.success) {"""


# Second half: the success / failure handlers
LAYOUT_OLD2 = """                if (res.success) {
                  Alert.alert('Password Updated', 'You can now sign in with your new password.');
                  router.replace('/(tabs)');
                } else {"""

LAYOUT_NEW2 = """                if (res.success) {
                  // Supabase recovery flow does NOT leave the user signed in.
                  // Force a clean signout and send them to the auth screen to
                  // log in with the new password.
                  try { await supabase.auth.signOut(); } catch {}
                  Alert.alert('Password Updated', 'Sign in with your new password.');
                  router.replace('/auth' as any);
                } else {"""


def patch_file(target: Path, patches: list) -> bool:
    if not target.exists():
        print(f"  ERROR: {target} not found")
        return False
    original = target.read_text()
    content = original
    applied = 0
    for desc, old, new in patches:
        count = content.count(old)
        if count == 1:
            content = content.replace(old, new)
            print(f"  [APPLIED]  {desc}")
            applied += 1
        elif count == 0:
            fingerprint = new.strip()[:60]
            if fingerprint in content:
                print(f"  [ALREADY]  {desc}")
            else:
                print(f"  [MISSING]  {desc}")
                return False
        else:
            print(f"  [AMBIG]    {desc} ({count} matches)")
            return False
    if content != original:
        target.write_text(content)
        print(f"  ✓ {target.name} updated ({applied} changes)")
    return True


def main():
    print("=" * 60)
    print("Password reset — proper fix")
    print("=" * 60)

    print("\n── services/supabase.ts ───────────────────────────────────")
    ok1 = patch_file(SUPA, [
        ("enable detectSessionInUrl", SUPA_OLD, SUPA_NEW),
    ])

    print("\n── app/_layout.tsx ────────────────────────────────────────")
    # First apply the dedup guard. This is required — new functionality.
    ok2a = patch_file(LAYOUT, [
        ("add processed-URL dedup guard", LAYOUT_OLD, LAYOUT_NEW),
    ])

    # Then attempt the redirect patch. Soft-skip if it's already in the
    # desired state (e.g. fix_password_reset_redirect.py was run earlier).
    layout_text = LAYOUT.read_text()
    if LAYOUT_OLD2 in layout_text:
        ok2b = patch_file(LAYOUT, [
            ("redirect to /auth after password update", LAYOUT_OLD2, LAYOUT_NEW2),
        ])
    elif "router.replace('/auth' as any);" in layout_text and "supabase.auth.signOut()" in layout_text:
        print("  [ALREADY]  redirect to /auth after password update")
        ok2b = True
    else:
        print("  [MISSING]  redirect to /auth after password update")
        ok2b = False

    if not (ok1 and ok2a and ok2b):
        print("\nFAILED. See missing patches above.")
        sys.exit(2)

    # ── Re-enable the previously-disabled handler if it was disabled ──
    # This handles the case where disable_password_reset_deeplink.py was
    # previously run. If that patch left `if (false && (url.includes...`
    # we undo it to match the new working version.
    content = LAYOUT.read_text()
    if "if (false && (url.includes('auth/reset')" in content:
        content = content.replace(
            "if (false && (url.includes('auth/reset') || url.includes('type=recovery'))) {",
            "if (url.includes('auth/reset') || url.includes('type=recovery')) {",
        )
        # Also strip the DISABLED comment block if present
        content = content.replace(
            "      // ── Password reset callback (DISABLED) ──\n"
            "      // Temporarily disabled: Supabase client has detectSessionInUrl: false,\n"
            "      // so the recovery token in the URL never establishes a session. The\n"
            "      // Alert.prompt below would then fail and show \"Auth session missing!\"\n"
            "      // to the user. Worse, Linking.getInitialURL fires on every app launch,\n"
            "      // re-triggering this stale prompt forever.\n"
            "      // Users can still reset their password from the Sign In screen.\n"
            "      // Re-enable once detectSessionInUrl is enabled AND we add a processed-\n"
            "      // URL dedup guard via AsyncStorage.\n",
            "      // ── Password reset callback ──\n",
        )
        LAYOUT.write_text(content)
        print("\n  [UNDO]     re-enabled previously-disabled handler")

    print("\n" + "=" * 60)
    print("✓ Password reset fixed properly")
    print("=" * 60)
    print()
    print("What this does now:")
    print("  • Supabase client reads recovery token from URL (detectSessionInUrl: true)")
    print("  • User sees 'Set New Password' prompt ONCE per reset email")
    print("  • URL is marked processed in AsyncStorage — won't re-fire on cold start")
    print("  • After password update, user is signed out and routed to /auth")
    print("  • User signs in with new password → lands in /(tabs) normally")
    print()
    print("Next:")
    print("  npx tsc --noEmit")
    print("  git add -A && git commit -m \"Password reset: detectSessionInUrl + dedup guard\"")
    print("  git push && eas build --platform ios --profile testflight --auto-submit")


if __name__ == "__main__":
    main()
