import { AIOmniLogo } from '../components/AIOmniLogo';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMemo, useState } from 'react';
import { signInWithEmail, signUpWithEmail, resetPassword, getUser } from '../../services/auth';
import { attachCustomerInfoListener, identifyPurchaseUser, refreshTier } from '../../services/purchases';
import { getAIConsent } from '../../services/aiConsent';

import { C, F, SZ, R, SP } from '../constants/tokens';
import { useTheme, type ThemeTokens } from '../constants/theme';
import { KeyboardAvoidingView, Linking, Platform, View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';

const SURFACE  = '#12252e';
const BORDER   = '#1a3542';
const BEVEL_HI = 'transparent';

type Mode = 'signin' | 'signup' | 'reset';

export default function AuthScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t } = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);

  const [mode,     setMode]     = useState<Mode>('signin');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [success,  setSuccess]  = useState('');

  const clear = () => { setError(''); setSuccess(''); };

  const handleSubmit = async () => {
    if (!email.trim())                    { setError('Enter your email.');    return; }
    if (mode !== 'reset' && !password)    { setError('Enter your password.'); return; }
    setLoading(true); clear();
    try {
      if (mode === 'signin') {
        const res = await signInWithEmail(email.trim(), password);
        if (res.success) {
          // Attach entitlements to the real account. _layout's bootstrap
          // already ran (and returned early on the signed-out path), so
          // without this the session stays on the anonymous RC customer.
          try {
            const u = await getUser();
            if (u) await identifyPurchaseUser(u.id);
            // _layout's bootstrap returned early on the signed-out branch, so
            // this session never ran refreshTier/attachCustomerInfoListener.
            // Without them a sandbox purchase wouldn't visibly unlock the tier
            // until relaunch — 2.1(b) bait for a reviewer. Deadline-capped so
            // a stalled network can't hold the sign-in spinner hostage.
            await Promise.race([
              refreshTier(),
              new Promise(res => setTimeout(res, 8000)),
            ]);
            attachCustomerInfoListener();
          } catch (e) {
            // Never strand the user on RC trouble — but leave a trace so a
            // review-session failure is diagnosable.
            console.log('post-signin purchases wiring failed', e);
          }
          // 5.1.1(i): App Review signs in on a fresh install, so THIS — not
          // _layout's bootstrap (which returned early while signed out) — is
          // the path that must present the AI disclosure. Build 197 routed
          // straight to tabs here, so the reviewer never saw the consent
          // screen → third rejection. Do not bypass this gate.
          const consent = await getAIConsent();
          router.replace(consent === null ? ('/ai-consent' as any) : '/(tabs)');
        }
        else setError(res.error ?? 'Sign in failed.');
      } else if (mode === 'signup') {
        const res = await signUpWithEmail(email.trim(), password);
        if (res.success) {
          setSuccess('Account created! Check your email to confirm, then sign in.');
          setMode('signin');
        } else setError(res.error ?? 'Sign up failed.');
      } else {
        const res = await resetPassword(email.trim());
        if (res.success) setSuccess('Reset email sent. Check your inbox.');
        else setError(res.error ?? 'Could not send reset email.');
      }
    } catch (e: any) {
      setError(e.message ?? 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  const title    = mode === 'signin' ? 'SIGN IN'         : mode === 'signup' ? 'CREATE ACCOUNT'  : 'RESET PASSWORD';
  const btnLabel = mode === 'signin' ? 'SIGN IN'         : mode === 'signup' ? 'CREATE ACCOUNT'  : 'SEND RESET EMAIL';

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[s.wrap, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }]}>

          {/* Logo */}
          <View style={s.logoBlock}>
            <AIOmniLogo width={200} />
            <Text style={s.logoSub}>See everything. Know everyone. Win always.</Text>
          </View>

          {/* Card */}
          <View style={s.card}>
            <View style={s.cardShine} />
            <View style={s.cardAccent} />

            <Text style={s.cardTitle}>{title}</Text>

            <Text style={s.label}>EMAIL</Text>
            <TextInput
              style={s.input}
              value={email}
              onChangeText={(t: string) => { setEmail(t); clear(); }}
              placeholder="you@example.com"
              placeholderTextColor={t.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />

            {mode !== 'reset' && (
              <>
                <Text style={s.label}>PASSWORD</Text>
                <TextInput
                  style={s.input}
                  value={password}
                  onChangeText={(t: string) => { setPassword(t); clear(); }}
                  placeholder="••••••••"
                  placeholderTextColor={t.textMuted}
                  secureTextEntry
                  autoCapitalize="none"
                />
              </>
            )}

            {error   ? <Text style={s.errorTxt}>{error}</Text>   : null}
            {success ? <Text style={s.successTxt}>{success}</Text> : null}

            <TouchableOpacity
              style={[s.submitBtn, loading && { opacity: 0.7 }]}
              onPress={handleSubmit}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color={C.ink} />
                : <Text style={s.submitTxt}>{btnLabel} →</Text>
              }
            </TouchableOpacity>

            <View style={s.switchRow}>
              {mode === 'signin' && <>
                <TouchableOpacity onPress={() => { setMode('signup'); clear(); }}>
                  <Text style={s.switchTxt}>Create account</Text>
                </TouchableOpacity>
                <Text style={s.divider}> · </Text>
                <TouchableOpacity onPress={() => { setMode('reset'); clear(); }}>
                  <Text style={s.switchTxt}>Forgot password</Text>
                </TouchableOpacity>
              </>}
              {mode === 'signup' && (
                <TouchableOpacity onPress={() => { setMode('signin'); clear(); }}>
                  <Text style={s.switchTxt}>Already have an account? Sign in</Text>
                </TouchableOpacity>
              )}
              {mode === 'reset' && (
                <TouchableOpacity onPress={() => { setMode('signin'); clear(); }}>
                  <Text style={s.switchTxt}>← Back to sign in</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Skip — for users who just want Sleeper without an account.
              5.1.1(i): this path MUST also pass the AI-consent gate — the App
              Review notes point the reviewer straight at it, and in build 197
              it routed to tabs with no disclosure ever shown. */}
          <TouchableOpacity
            onPress={async () => {
              const consent = await getAIConsent();
              router.replace(consent === null ? ('/ai-consent' as any) : '/(tabs)');
            }}
            style={s.skipBtn}
          >
            <Text style={s.skipTxt}>Continue without account</Text>
          </TouchableOpacity>

          <Text style={s.finePrint}>
            By continuing you agree to our{' '}
            <Text
              style={s.finePrintLink}
              onPress={() => Linking.openURL('https://getaiomni.com/terms')}
            >
              Terms of Service
            </Text>
            {' '}and{' '}
            <Text
              style={s.finePrintLink}
              onPress={() => Linking.openURL('https://getaiomni.com/privacy')}
            >
              Privacy Policy
            </Text>
            .
          </Text>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: SP[3], justifyContent: 'center' },

  logoBlock: { alignItems: 'center', marginBottom: 36 },
  logoText:  { fontFamily: F.bold, fontSize: 52, color: t.successText, letterSpacing: 4, marginBottom: 8 },
  logoSub:   { fontFamily: F.mono, color: t.textMuted, fontSize: SZ.sm, textAlign: 'center', letterSpacing: 0.5 },

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
    marginBottom: 16,
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

  errorTxt:   { fontFamily: F.mono, color: t.dangerText, fontSize: SZ.sm, marginBottom: 12, lineHeight: 18 },
  successTxt: { fontFamily: F.mono, color: t.successText,    fontSize: SZ.sm, marginBottom: 12, lineHeight: 18 },

  submitBtn: {
    backgroundColor: '#ffb800',
    borderRadius: R.sm,
    padding: 16,
    alignItems: 'center',
    marginBottom: 20,
    marginTop: 4,
  },
  submitTxt: { fontFamily: F.mono, color: '#0a1214', fontSize: SZ.base, letterSpacing: 2 },

  switchRow: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 2 },
  switchTxt: { fontFamily: F.mono, color: t.successText, fontSize: SZ.sm },
  divider:   { fontFamily: F.mono, color: t.textMuted, fontSize: SZ.sm },

  skipBtn:   { alignItems: 'center', paddingVertical: 14 },
  skipTxt:   { fontFamily: F.mono, color: t.textMuted, fontSize: SZ.sm },
  finePrint: { fontFamily: F.mono, color: t.textMuted, fontSize: SZ.xs - 1, textAlign: 'center', lineHeight: 16, opacity: 0.6, marginTop: 8 },
  finePrintLink: { textDecorationLine: 'underline', color: '#6a94a6' },
});
