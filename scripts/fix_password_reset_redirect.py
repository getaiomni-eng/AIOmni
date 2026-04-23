#!/usr/bin/env python3
"""
Password reset redirect fix.

Bug: After a user taps the password reset email link and sets a new password
     via the Alert.prompt dialog, the app routes them to /(tabs) directly.
     But Supabase's password recovery flow does NOT establish a signed-in
     session after updateUser({password}). The user still needs to sign in
     with their new credentials. Routing to /(tabs) leads to downstream
     supabase.auth.getUser() calls throwing "Auth session missing!" and
     cascading into an Alert the user sees.

Fix: After successful password update, sign the user out (to be safe) and
     route them to /auth with a success message. They sign in with the new
     password and proceed normally.

Run from /Users/patrickmeyer/AIOmni:
    python3 scripts/fix_password_reset_redirect.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "app" / "_layout.tsx"

OLD = """              try {
                const res = await updatePassword(newPw);
                if (res.success) {
                  Alert.alert('Password Updated', 'You can now sign in with your new password.');
                  router.replace('/(tabs)');
                } else {
                  Alert.alert('Error', res.error ?? 'Failed to update password.');
                }
              } catch (e: any) {
                Alert.alert('Error', e.message ?? 'Something went wrong.');
              }"""

NEW = """              try {
                const res = await updatePassword(newPw);
                if (res.success) {
                  // Supabase's recovery flow does NOT auto-sign-in after
                  // password update. Force a clean sign-out and route to
                  // /auth so the user signs in with their new password.
                  try { await supabase.auth.signOut(); } catch {}
                  Alert.alert('Password Updated', 'Sign in with your new password.');
                  router.replace('/auth' as any);
                } else {
                  Alert.alert('Error', res.error ?? 'Failed to update password.');
                }
              } catch (e: any) {
                Alert.alert('Error', e.message ?? 'Something went wrong.');
              }"""


def main():
    if not TARGET.exists():
        print(f"ERROR: {TARGET} not found")
        sys.exit(1)

    content = TARGET.read_text()
    count = content.count(OLD)

    if count == 1:
        content = content.replace(OLD, NEW)
        TARGET.write_text(content)
        print("  [APPLIED]  password reset redirect → /auth")
        print(f"\n✓ Patched {TARGET.name}")
    elif count == 0:
        if "Sign in with your new password." in content:
            print("  [ALREADY]  password reset redirect → /auth")
        else:
            print("  [MISSING]  could not find the deep-link handler block.")
            print("    Expected:")
            print("      router.replace('/(tabs)');")
            print("    After:")
            print("      Alert.alert('Password Updated', ...)")
            print("    inside _layout.tsx handleDeepLink password reset branch.")
            sys.exit(2)
    else:
        print(f"  [AMBIG]    block appears {count} times — unexpected")
        sys.exit(2)


if __name__ == "__main__":
    print("=" * 60)
    print("Password reset redirect fix")
    print("=" * 60)
    print()
    main()
    print()
    print("Next:")
    print("  npx tsc --noEmit")
    print("  git add -A && git commit -m \"Password reset: redirect to /auth after update\"")
    print("  git push && eas build --platform ios --profile testflight --auto-submit")
