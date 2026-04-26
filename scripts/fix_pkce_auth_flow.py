#!/usr/bin/env python3
"""
Switch to PKCE auth flow — fixes password reset on iOS deep links.

Why this is needed:
  Without flowType: 'pkce', Supabase sends recovery tokens in the URL
  FRAGMENT (after #). iOS strips fragments from custom URL schemes
  (aiomnifantasy://) before any app code sees them. That's why
  Linking.getInitialURL() returned null in the debug build.

  PKCE flow sends the recovery token as a QUERY PARAM (?code=...) which
  iOS preserves. expo-router parses query params automatically and
  passes them to screens via useLocalSearchParams().

Two changes:
  1. services/supabase.ts — add flowType: 'pkce' to auth config
  2. app/auth/reset.tsx   — use useLocalSearchParams() instead of Linking,
                             call exchangeCodeForSession() instead of
                             setSession(). Also removes the debug display.

Run from /Users/patrickmeyer/AIOmni:
    python3 scripts/fix_pkce_auth_flow.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SUPA = ROOT / "services" / "supabase.ts"
RESET = ROOT / "app" / "auth" / "reset.tsx"


# ─── Patch 1: add flowType: 'pkce' to supabase.ts ─────────────────────────
SUPA_OLD = """  auth: {
    storage:          AsyncStorage,
    autoRefreshToken: true,
    persistSession:   true,
    detectSessionInUrl: true,"""

SUPA_NEW = """  auth: {
    storage:          AsyncStorage,
    autoRefreshToken: true,
    persistSession:   true,
    detectSessionInUrl: true,
    // PKCE flow: tokens arrive as ?code=xyz in query string instead of
    // URL fragment. iOS strips fragments from custom URL schemes; query
    // params survive. Required for password reset deep-links to work.
    flowType: 'pkce',"""


# ─── Patch 2: rewrite reset.tsx to use expo-router params + exchangeCode ──
RESET_NEW = '''import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { AIOmniLogo } from '../components/AIOmniLogo';
import { supabase } from '../../services/supabase';
import { C, F, SZ, R, SP } from '../constants/tokens';

const BEVEL_HI = 'transparent';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // PKCE flow puts the recovery token in the query string as ?code=xyz.
  // expo-router parses it and exposes it through useLocalSearchParams.
  const params = useLocalSearchParams<{ code?: string }>();

  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  // Session state — exchanging the code for a session is async, so the
  // form stays disabled until we have a real recovery session attached.
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionError, setSessionError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function exchangeCode() {
      const code = params.code;
      if (!code) {
        setSessionError('No reset link detected. Open this screen from your password reset email.');
        return;
      }

      try {
        const { error: e } = await supabase.auth.exchangeCodeForSession(code);
        if (cancelled) return;

        if (e) {
          setSessionError(e.message || 'This reset link is invalid or has expired. Try requesting a new one.');
          return;
        }

        setSessionReady(true);
      } catch (e: any) {
        if (cancelled) return;
        setSessionError(e?.message ?? 'Could not validate this reset link.');
      }
    }

    exchangeCode();

    return () => { cancelled = true; };
  }, [params.code]);

  const handleSubmit = async () => {
    setError('');
    if (!sessionReady) {
      setError(sessionError || 'Reset link not yet validated. Wait a moment and try again.');
      return;
    }
    if (password.length < 6)  { setError('Password must be at least 6 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setLoading(true);
    try {
      const { error: e } = await supabase.auth.updateUser({ password });
      if (e) {
        setError(e.message);
        setLoading(false);
        return;
      }
      // Recovery flow does not leave the user fully signed in. Force a
      // clean signout and route them to /auth to sign in with the new pw.
      try { await supabase.auth.signOut(); } catch {}
      router.replace('/auth' as any);
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong.');
      setLoading(false);
    }
  };

  const displayedError = error || sessionError;
  const submitDisabled = !sessionReady || loading;

  return (
    <View style={{ flex: 1, backgroundColor: '#0a1214' }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.wrap, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }]}>

          <View style={styles.logoBlock}>
            <AIOmniLogo width={160} />
            <Text style={styles.logoSub}>
              {sessionReady ? 'Set a new password.' : 'Validating reset link...'}
            </Text>
          </View>

          <View style={styles.card}>
            <View style={styles.cardShine} />
            <View style={styles.cardAccent} />

            <Text style={styles.cardTitle}>NEW PASSWORD</Text>

            <Text style={styles.label}>NEW PASSWORD</Text>
            <TextInput
              style={[styles.input, !sessionReady && { opacity: 0.4 }]}
              value={password}
              onChangeText={(t: string) => { setPassword(t); setError(''); }}
              placeholder="At least 6 characters"
              placeholderTextColor={C.dim2}
              secureTextEntry
              autoCapitalize="none"
              editable={sessionReady}
              autoFocus={sessionReady}
            />

            <Text style={styles.label}>CONFIRM PASSWORD</Text>
            <TextInput
              style={[styles.input, !sessionReady && { opacity: 0.4 }]}
              value={confirm}
              onChangeText={(t: string) => { setConfirm(t); setError(''); }}
              placeholder="Re-enter password"
              placeholderTextColor={C.dim2}
              secureTextEntry
              autoCapitalize="none"
              editable={sessionReady}
            />

            {displayedError ? <Text style={styles.errorTxt}>{displayedError}</Text> : null}

            <TouchableOpacity
              style={[styles.submitBtn, submitDisabled && { opacity: 0.5 }]}
              onPress={handleSubmit}
              disabled={submitDisabled}
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


def main():
    print("=" * 60)
    print("PKCE auth flow + reset screen rewrite")
    print("=" * 60)
    print()

    # ── Patch supabase.ts ─────────────────────────────────────────────────
    if not SUPA.exists():
        print(f"ERROR: {SUPA} not found")
        sys.exit(1)

    supa_text = SUPA.read_text()
    if "flowType: 'pkce'" in supa_text:
        print("  [ALREADY]  services/supabase.ts has flowType: 'pkce'")
    elif SUPA_OLD in supa_text:
        SUPA.write_text(supa_text.replace(SUPA_OLD, SUPA_NEW))
        print("  [APPLIED]  added flowType: 'pkce' to services/supabase.ts")
    else:
        print("  [MISSING]  could not locate auth config block in services/supabase.ts")
        sys.exit(2)

    # ── Rewrite reset.tsx ─────────────────────────────────────────────────
    if not RESET.exists():
        print(f"ERROR: {RESET} not found")
        sys.exit(1)

    reset_text = RESET.read_text()
    if "useLocalSearchParams" in reset_text and "exchangeCodeForSession" in reset_text:
        if "DEBUG" in reset_text or "debugUrl" in reset_text:
            # Has the debug build mixed in — overwrite with clean version
            RESET.write_text(RESET_NEW)
            print("  [APPLIED]  rewrote app/auth/reset.tsx (PKCE + removed debug)")
        else:
            print("  [ALREADY]  app/auth/reset.tsx already on PKCE flow")
    else:
        # Either initial version or first-rewrite version — overwrite
        RESET.write_text(RESET_NEW)
        print("  [APPLIED]  rewrote app/auth/reset.tsx for PKCE flow")

    print()
    print("=" * 60)
    print("✓ PKCE flow ready")
    print("=" * 60)
    print()
    print("What changed:")
    print("  • supabase.ts: flowType: 'pkce' (tokens via query, not fragment)")
    print("  • reset.tsx: useLocalSearchParams + exchangeCodeForSession")
    print("  • Debug display removed")
    print()
    print("Next:")
    print("  npx tsc --noEmit")
    print("  git add -A && git commit -m \"Switch to PKCE auth flow for password reset\"")
    print("  git push && eas build --platform ios --profile testflight --auto-submit")


if __name__ == "__main__":
    main()
