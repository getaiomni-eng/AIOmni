import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { AIOmniLogo } from '../components/AIOmniLogo';
import { supabase } from '../../services/supabase';
import { F, SZ, R, SP } from '../constants/tokens';
import { useTheme, type ThemeTokens } from '../constants/theme';

const BEVEL_HI = 'transparent';

export default function ResetPasswordScreen() {
  const { t } = useTheme();
  const styles = useMemo(() => makeStyles(t), [t]);
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
    <View style={{ flex: 1, backgroundColor: t.bg }}>
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
              placeholderTextColor={t.textMuted}
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
              placeholderTextColor={t.textMuted}
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
                ? <ActivityIndicator color="#f0f4f5" />
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

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: SP[3], justifyContent: 'center' },
  logoBlock: { alignItems: 'center', marginBottom: 36 },
  logoSub:   { fontFamily: F.mono, color: t.textMuted, fontSize: SZ.sm, textAlign: 'center', letterSpacing: 0.5, marginTop: 12 },

  card: {
    backgroundColor: t.card,
    borderRadius: R.lg,
    padding: 24,
    borderWidth: 1.5,
    borderColor: t.border,
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
  cardTitle:  { fontFamily: F.bold, fontSize: SZ['2xl'], color: t.text, letterSpacing: 2, marginBottom: 20, marginTop: 8 },

  label: { fontFamily: F.mono, fontSize: SZ.xs, color: t.textMuted, letterSpacing: 1.5, marginBottom: 6 },
  input: {
    backgroundColor: t.surface,
    borderWidth: 1.5,
    borderColor: t.border,
    borderRadius: R.sm,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontFamily: F.outfit,
    fontSize: SZ.base,
    color: t.text,
    marginBottom: 16,
  },
  errorTxt: { fontFamily: F.mono, color: t.dangerText, fontSize: SZ.sm, marginBottom: 12, lineHeight: 18 },

  submitBtn: {
    backgroundColor: '#ffb800',
    borderRadius: R.sm,
    padding: 16,
    alignItems: 'center',
    marginBottom: 16,
    marginTop: 4,
  },
  submitTxt: { fontFamily: F.mono, color: '#0a1214', fontSize: SZ.base, letterSpacing: 2 },
  cancelTxt: { fontFamily: F.mono, color: t.successText, fontSize: SZ.sm, textAlign: 'center', paddingVertical: 4 },
});
