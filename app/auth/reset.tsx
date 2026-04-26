import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import * as Linking from 'expo-linking';
import { AIOmniLogo } from '../components/AIOmniLogo';
import { supabase } from '../../services/supabase';
import { C, F, SZ, R, SP } from '../constants/tokens';

const BEVEL_HI = 'transparent';

// ─── Parse Supabase recovery tokens from the deep-link URL ────────────────
// The URL arrives as:
//   aiomnifantasy://auth/reset#access_token=xxx&refresh_token=yyy&type=recovery&...
//
// Both expo-linking and React Native's Linking module expose the URL but
// neither parses the fragment for us. We do it manually.
function parseRecoveryTokens(url: string): { accessToken: string | null; refreshToken: string | null; type: string | null } {
  if (!url) return { accessToken: null, refreshToken: null, type: null };

  // Supabase puts tokens in the URL FRAGMENT (after #), not the query string.
  // Some redirects may put them in the query string instead — handle both.
  const fragmentIndex = url.indexOf('#');
  const queryIndex = url.indexOf('?');
  const paramsStart = fragmentIndex >= 0 ? fragmentIndex + 1
                    : queryIndex >= 0 ? queryIndex + 1
                    : -1;

  if (paramsStart < 0) return { accessToken: null, refreshToken: null, type: null };

  const params = new URLSearchParams(url.substring(paramsStart));
  return {
    accessToken: params.get('access_token'),
    refreshToken: params.get('refresh_token'),
    type: params.get('type'),
  };
}

export default function ResetPasswordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  // Session establishment state. Update Password is disabled until we
  // have a valid recovery session attached to the Supabase client.
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionError, setSessionError] = useState('');
  // DEBUG — remove once auth flow works
  const [debugUrl, setDebugUrl] = useState<string>('(no URL captured yet)');
  const [debugParsed, setDebugParsed] = useState<string>('(not parsed yet)');

  // ─── On mount: grab the deep-link URL and establish the recovery session ──
  useEffect(() => {
    let cancelled = false;

    async function establishSession(url: string | null) {
      if (cancelled) return;
      // DEBUG — store raw URL for visibility
      setDebugUrl(url ?? '(null)');
      if (!url) {
        setSessionError('No reset link detected. Open this screen from your password reset email.');
        return;
      }

      const { accessToken, refreshToken, type } = parseRecoveryTokens(url);
      // DEBUG — store parsed values
      setDebugParsed(
        `type=${type ?? '(missing)'}\n` +
        `access_token=${accessToken ? accessToken.substring(0, 20) + '...' : '(missing)'}\n` +
        `refresh_token=${refreshToken ? refreshToken.substring(0, 20) + '...' : '(missing)'}`
      );

      if (type !== 'recovery') {
        setSessionError('This link is not a password recovery link. Try requesting a new reset email.');
        return;
      }

      if (!accessToken || !refreshToken) {
        setSessionError('Reset link is missing the required tokens. Try requesting a new reset email.');
        return;
      }

      try {
        const { error: setErr } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });

        if (cancelled) return;

        if (setErr) {
          setSessionError(setErr.message || 'Could not validate this reset link.');
          return;
        }

        setSessionReady(true);
      } catch (e: any) {
        if (cancelled) return;
        setSessionError(e?.message ?? 'Could not validate this reset link.');
      }
    }

    // Initial URL — set when app was cold-launched via the deep link
    Linking.getInitialURL()
      .then((url) => establishSession(url))
      .catch(() => establishSession(null));

    // Hot URL — set if the deep link arrives while app is already running
    const sub = Linking.addEventListener('url', (event) => {
      establishSession(event.url);
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

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
      // clean signout and route them to /auth to log in with the new pw.
      try { await supabase.auth.signOut(); } catch {}
      router.replace('/auth' as any);
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong.');
      setLoading(false);
    }
  };

  // Either the session-establishment error (shown until resolved) or
  // the user-action error (shown after a submit attempt).
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

          {/* DEBUG — remove once auth flow works */}
          <View style={{ marginTop: 24, padding: 12, backgroundColor: '#0f1c22', borderRadius: 8, borderWidth: 1, borderColor: '#1a3542' }}>
            <Text style={{ color: '#6eeb83', fontFamily: F.mono, fontSize: 9, letterSpacing: 1, marginBottom: 4 }}>DEBUG · URL</Text>
            <Text selectable style={{ color: '#f0f4f5', fontFamily: F.mono, fontSize: 9, marginBottom: 8 }}>{debugUrl}</Text>
            <Text style={{ color: '#6eeb83', fontFamily: F.mono, fontSize: 9, letterSpacing: 1, marginBottom: 4 }}>DEBUG · PARSED</Text>
            <Text selectable style={{ color: '#f0f4f5', fontFamily: F.mono, fontSize: 9 }}>{debugParsed}</Text>
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
