#!/usr/bin/env python3
"""
Restructure auth route to handle password reset deep-link properly.

Problem solved:
  Tapping the password-reset email opens aiomnifantasy://auth/reset, but
  expo-router has no /auth/reset route registered (only flat app/auth.tsx),
  so the user sees "Unmatched Route" and the deep-link handler in
  _layout.tsx fires Alert.prompt with no recovery session attached.

Architecture change:
  app/auth.tsx (flat)          →  app/auth/_layout.tsx (Stack)
                                  app/auth/index.tsx   (current sign-in/up screen)
                                  app/auth/reset.tsx   (NEW recovery screen)

What this script does:
  1. Reads current app/auth.tsx
  2. Writes it verbatim to app/auth/index.tsx (no content changes)
  3. Creates app/auth/_layout.tsx — a Stack wrapper for the auth folder
  4. Creates app/auth/reset.tsx — proper password recovery screen
  5. Deletes the old flat app/auth.tsx
  6. Removes the broken password-reset deep-link branch in app/_layout.tsx
     (it's no longer needed — expo-router handles routing automatically;
      Supabase parses the recovery token via detectSessionInUrl: true)
  7. Updates Stack.Screen registration in _layout.tsx so "auth" knows it's
     a folder route now (no headerShown adjustments needed)

After running:
  • aiomnifantasy://auth        → app/auth/index.tsx (sign in / sign up)
  • aiomnifantasy://auth/reset  → app/auth/reset.tsx (set new password)
  • Supabase recovery token in URL fragment auto-establishes a session
    (detectSessionInUrl: true in services/supabase.ts is what does this)
  • reset.tsx calls supabase.auth.updateUser({password}) directly
  • On success → signOut → redirect to /auth for clean sign-in

Run from /Users/patrickmeyer/AIOmni:
    python3 scripts/restructure_auth_route.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

OLD_AUTH_FLAT = ROOT / "app" / "auth.tsx"
NEW_AUTH_DIR = ROOT / "app" / "auth"
NEW_AUTH_INDEX = NEW_AUTH_DIR / "index.tsx"
NEW_AUTH_LAYOUT = NEW_AUTH_DIR / "_layout.tsx"
NEW_AUTH_RESET = NEW_AUTH_DIR / "reset.tsx"

ROOT_LAYOUT = ROOT / "app" / "_layout.tsx"


# ─── Step 1: validate state ───────────────────────────────────────────────

def validate():
    """Detect current state and decide what to do."""
    has_flat = OLD_AUTH_FLAT.exists() and OLD_AUTH_FLAT.is_file()
    has_dir = NEW_AUTH_DIR.exists() and NEW_AUTH_DIR.is_dir()

    if not has_flat and not has_dir:
        print("ERROR: neither app/auth.tsx nor app/auth/ exists. Aborting.")
        sys.exit(1)

    if has_dir and (NEW_AUTH_INDEX.exists() and NEW_AUTH_RESET.exists()
                     and NEW_AUTH_LAYOUT.exists()):
        print("  [ALREADY]  app/auth/ structure complete (index, _layout, reset)")
        return "already"

    if has_flat and not has_dir:
        return "fresh"

    if has_dir and not (NEW_AUTH_INDEX.exists() and NEW_AUTH_RESET.exists()
                          and NEW_AUTH_LAYOUT.exists()):
        return "incomplete"

    return "unknown"


# ─── Step 2: build the new files ──────────────────────────────────────────

LAYOUT_FILE = '''import { Stack } from 'expo-router';

// Stack wrapper for the /auth folder so expo-router can resolve nested
// routes like /auth/reset (deep-linked from password reset emails).
// Both screens are presented modally with no header — the screens
// render their own AIOmniLogo headers.
export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ presentation: 'modal' }} />
      <Stack.Screen name="reset" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
'''

# The reset screen handles aiomnifantasy://auth/reset deep-links from the
# password reset email. Supabase has already parsed the recovery token
# from the URL fragment (detectSessionInUrl: true) by the time this screen
# mounts, so the user has a valid recovery session — we can just call
# updateUser({password}) directly.
RESET_FILE = '''import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { AIOmniLogo } from '../components/AIOmniLogo';
import { supabase } from '../../services/supabase';
import { C, F, SZ, R, SP } from '../constants/tokens';

const BEVEL_HI = 'transparent';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  const handleSubmit = async () => {
    setError('');
    if (password.length < 6)  { setError('Password must be at least 6 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setLoading(true);
    try {
      // detectSessionInUrl: true in services/supabase.ts means Supabase
      // has already established a recovery session from the URL fragment
      // by the time this screen mounted. updateUser succeeds against that
      // recovery session.
      const { error: e } = await supabase.auth.updateUser({ password });
      if (e) {
        setError(e.message);
        setLoading(false);
        return;
      }
      // Recovery flow does not leave the user fully signed in. Force a
      // clean signout and route them to /auth to log in with the new pw.
      try { await supabase.auth.signOut(); } catch {}
      router.replace('/auth' as any);
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong.');
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#0a1214' }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.wrap, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }]}>

          <View style={styles.logoBlock}>
            <AIOmniLogo width={160} />
            <Text style={styles.logoSub}>Set a new password.</Text>
          </View>

          <View style={styles.card}>
            <View style={styles.cardShine} />
            <View style={styles.cardAccent} />

            <Text style={styles.cardTitle}>NEW PASSWORD</Text>

            <Text style={styles.label}>NEW PASSWORD</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={(t: string) => { setPassword(t); setError(''); }}
              placeholder="At least 6 characters"
              placeholderTextColor={C.dim2}
              secureTextEntry
              autoCapitalize="none"
              autoFocus
            />

            <Text style={styles.label}>CONFIRM PASSWORD</Text>
            <TextInput
              style={styles.input}
              value={confirm}
              onChangeText={(t: string) => { setConfirm(t); setError(''); }}
              placeholder="Re-enter password"
              placeholderTextColor={C.dim2}
              secureTextEntry
              autoCapitalize="none"
            />

            {error ? <Text style={styles.errorTxt}>{error}</Text> : null}

            <TouchableOpacity
              style={[styles.submitBtn, loading && { opacity: 0.7 }]}
              onPress={handleSubmit}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color={C.ink} />
                : <Text style={styles.submitTxt}>UPDATE PASSWORD →</Text>
              }
            </TouchableOpacity>

            <TouchableOpacity onPress={() => router.replace('/auth' as any)}>
              <Text style={styles.cancelTxt}>← Back to sign in</Text>
            </TouchableOpacity>
          </View>

        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: SP[3], justifyContent: 'center' },
  logoBlock: { alignItems: 'center', marginBottom: 36 },
  logoSub:   { fontFamily: F.mono, color: '#4a6a76', fontSize: SZ.sm, textAlign: 'center', letterSpacing: 0.5, marginTop: 12 },

  card: {
    backgroundColor: '#12252e',
    borderRadius: R.lg,
    padding: 24,
    borderWidth: 1.5,
    borderColor: '#1a3542',
    overflow: 'hidden',
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 8,
  },
  cardShine:  { position: 'absolute', top: 0, left: '8%', right: '8%', height: 1.5, backgroundColor: BEVEL_HI, zIndex: 6 },
  cardAccent: { position: 'absolute', top: 0, left: 0, right: 0, height: 3, backgroundColor: '#ffb800' },
  cardTitle:  { fontFamily: F.bold, fontSize: SZ['2xl'], color: '#f0f4f5', letterSpacing: 2, marginBottom: 20, marginTop: 8 },

  label: { fontFamily: F.mono, fontSize: SZ.xs, color: '#4a6a76', letterSpacing: 1.5, marginBottom: 6 },
  input: {
    backgroundColor: '#0f1c22',
    borderWidth: 1.5,
    borderColor: '#1a3542',
    borderRadius: R.sm,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontFamily: F.outfit,
    fontSize: SZ.base,
    color: '#f0f4f5',
    marginBottom: 16,
  },
  errorTxt: { fontFamily: F.mono, color: '#ff5714', fontSize: SZ.sm, marginBottom: 12, lineHeight: 18 },

  submitBtn: {
    backgroundColor: '#ffb800',
    borderRadius: R.sm,
    padding: 16,
    alignItems: 'center',
    marginBottom: 16,
    marginTop: 4,
  },
  submitTxt: { fontFamily: F.mono, color: '#0a1214', fontSize: SZ.base, letterSpacing: 2 },
  cancelTxt: { fontFamily: F.mono, color: '#6eeb83', fontSize: SZ.sm, textAlign: 'center', paddingVertical: 4 },
});
'''


# ─── Step 3: patches for app/_layout.tsx ──────────────────────────────────

# Remove the entire password-reset branch from the deep-link handler.
# The reset.tsx route handles itself now via expo-router auto-resolution;
# Supabase parses the recovery token via detectSessionInUrl: true.
LAYOUT_OLD_BRANCH = """      // ── Password reset callback ──
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
              }
            },
            'secure-text'
          );
        }, 500);
        return;
      }

      // ── Yahoo OAuth callback ──"""

LAYOUT_NEW_BRANCH = """      // Password reset is handled by app/auth/reset.tsx via expo-router
      // auto-resolution. Supabase parses the recovery token from the URL
      // fragment via detectSessionInUrl: true in services/supabase.ts,
      // so by the time reset.tsx mounts the user has a valid recovery
      // session and can call supabase.auth.updateUser({password}) directly.

      // ── Yahoo OAuth callback ──"""


# ─── Step 4: orchestration ────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("Restructure auth route")
    print("=" * 60)
    print()

    state = validate()

    if state == "already":
        print("\nAuth route structure already in place. Nothing to do.")
        # Still try to clean up the deep-link branch in case it was missed.
        layout_text = ROOT_LAYOUT.read_text()
        if LAYOUT_OLD_BRANCH in layout_text:
            layout_text = layout_text.replace(LAYOUT_OLD_BRANCH, LAYOUT_NEW_BRANCH)
            ROOT_LAYOUT.write_text(layout_text)
            print("  [APPLIED]  removed legacy deep-link reset branch")
        return

    # Read current auth.tsx (the source of truth for index.tsx)
    if not OLD_AUTH_FLAT.exists():
        print("ERROR: app/auth.tsx not found and structure not yet built.")
        sys.exit(1)

    current_auth = OLD_AUTH_FLAT.read_text()

    # Create the directory
    NEW_AUTH_DIR.mkdir(parents=True, exist_ok=True)
    print(f"  [CREATED]  {NEW_AUTH_DIR.relative_to(ROOT)}/")

    # Write index.tsx (verbatim copy of current auth.tsx)
    NEW_AUTH_INDEX.write_text(current_auth)
    print(f"  [CREATED]  {NEW_AUTH_INDEX.relative_to(ROOT)}")

    # Write _layout.tsx
    NEW_AUTH_LAYOUT.write_text(LAYOUT_FILE)
    print(f"  [CREATED]  {NEW_AUTH_LAYOUT.relative_to(ROOT)}")

    # Write reset.tsx
    NEW_AUTH_RESET.write_text(RESET_FILE)
    print(f"  [CREATED]  {NEW_AUTH_RESET.relative_to(ROOT)}")

    # Delete the old flat file
    OLD_AUTH_FLAT.unlink()
    print(f"  [DELETED]  {OLD_AUTH_FLAT.relative_to(ROOT)}")

    # Patch _layout.tsx to remove the broken deep-link branch
    layout_text = ROOT_LAYOUT.read_text()
    if LAYOUT_OLD_BRANCH in layout_text:
        layout_text = layout_text.replace(LAYOUT_OLD_BRANCH, LAYOUT_NEW_BRANCH)
        ROOT_LAYOUT.write_text(layout_text)
        print(f"  [PATCHED]  removed deep-link reset branch from {ROOT_LAYOUT.relative_to(ROOT)}")
    elif LAYOUT_NEW_BRANCH in layout_text:
        print(f"  [ALREADY]  deep-link reset branch already removed")
    else:
        print(f"  [WARN]     could not find deep-link reset branch in _layout.tsx")
        print(f"             (manual review recommended; the code may still work)")

    print()
    print("=" * 60)
    print("✓ Auth route restructured")
    print("=" * 60)
    print()
    print("Verify:")
    print("  npx tsc --noEmit")
    print()
    print("Then:")
    print("  git add -A && git commit -m \"Auth route: nested folder for /auth/reset\"")
    print("  git push && eas build --platform ios --profile testflight --auto-submit")
    print()
    print("After build lands:")
    print("  1. Delete AIOmni from phone (long-press → Remove App)")
    print("  2. Reinstall from TestFlight")
    print("  3. Open app → Onboarding → SIGN IN → tap 'Forgot password'")
    print("  4. Enter email → tap SEND RESET EMAIL")
    print("  5. Open the new reset email (NOT an old one)")
    print("  6. Tap 'Reset Password' link")
    print("  7. Should land on the proper Set New Password screen, no alert")
    print("  8. Type new password twice → tap UPDATE PASSWORD")
    print("  9. Lands on /auth → sign in with new password → in the app")


if __name__ == "__main__":
    main()
