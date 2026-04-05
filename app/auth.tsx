import { AIOmniLogo } from './components/AIOmniLogo';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState } from 'react';
import { signInWithEmail, signUpWithEmail, resetPassword } from '../services/auth';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, SZ, R, SP } from './constants/tokens';
import { KeyboardAvoidingView, Platform, View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';

const SURFACE  = 'rgba(255,255,255,0.92)';
const BORDER   = 'rgba(88,131,191,0.32)';
const BEVEL_HI = 'rgba(255,255,255,0.95)';

type Mode = 'signin' | 'signup' | 'reset';

export default function AuthScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

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
        if (res.success) router.replace('/(tabs)');
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
    <LinearGradient colors={[C.bgTop, C.bgBot]} style={{ flex: 1 }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.wrap, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }]}>

          {/* Logo */}
          <View style={styles.logoBlock}>
            <AIOmniLogo width={200} />
            <Text style={styles.logoSub}>See everything. Know everyone. Win always.</Text>
          </View>

          {/* Card */}
          <View style={styles.card}>
            <View style={styles.cardShine} />
            <View style={styles.cardAccent} />

            <Text style={styles.cardTitle}>{title}</Text>

            <Text style={styles.label}>EMAIL</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={(t: string) => { setEmail(t); clear(); }}
              placeholder="you@example.com"
              placeholderTextColor={C.dim2}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />

            {mode !== 'reset' && (
              <>
                <Text style={styles.label}>PASSWORD</Text>
                <TextInput
                  style={styles.input}
                  value={password}
                  onChangeText={(t: string) => { setPassword(t); clear(); }}
                  placeholder="••••••••"
                  placeholderTextColor={C.dim2}
                  secureTextEntry
                  autoCapitalize="none"
                />
              </>
            )}

            {error   ? <Text style={styles.errorTxt}>{error}</Text>   : null}
            {success ? <Text style={styles.successTxt}>{success}</Text> : null}

            <TouchableOpacity
              style={[styles.submitBtn, loading && { opacity: 0.7 }]}
              onPress={handleSubmit}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color={C.ink} />
                : <Text style={styles.submitTxt}>{btnLabel} →</Text>
              }
            </TouchableOpacity>

            <View style={styles.switchRow}>
              {mode === 'signin' && <>
                <TouchableOpacity onPress={() => { setMode('signup'); clear(); }}>
                  <Text style={styles.switchTxt}>Create account</Text>
                </TouchableOpacity>
                <Text style={styles.divider}> · </Text>
                <TouchableOpacity onPress={() => { setMode('reset'); clear(); }}>
                  <Text style={styles.switchTxt}>Forgot password</Text>
                </TouchableOpacity>
              </>}
              {mode === 'signup' && (
                <TouchableOpacity onPress={() => { setMode('signin'); clear(); }}>
                  <Text style={styles.switchTxt}>Already have an account? Sign in</Text>
                </TouchableOpacity>
              )}
              {mode === 'reset' && (
                <TouchableOpacity onPress={() => { setMode('signin'); clear(); }}>
                  <Text style={styles.switchTxt}>← Back to sign in</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Skip — for users who just want Sleeper without an account */}
          <TouchableOpacity onPress={() => router.replace('/(tabs)')} style={styles.skipBtn}>
            <Text style={styles.skipTxt}>Continue without account</Text>
          </TouchableOpacity>

          <Text style={styles.finePrint}>
            By continuing you agree to our Terms of Service and Privacy Policy.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: SP[3], justifyContent: 'center' },

  logoBlock: { alignItems: 'center', marginBottom: 36 },
  logoText:  { fontFamily: F.bold, fontSize: 52, color: C.blueDeep, letterSpacing: 4, marginBottom: 8 },
  logoSub:   { fontFamily: F.mono, color: C.dim2, fontSize: SZ.sm, textAlign: 'center', letterSpacing: 0.5 },

  card: {
    backgroundColor: SURFACE,
    borderRadius: R.lg,
    padding: 24,
    borderWidth: 1.5,
    borderColor: BORDER,
    overflow: 'hidden',
    position: 'relative',
    shadowColor: '#3d6aaa',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 8,
    marginBottom: 16,
  },
  cardShine:  { position: 'absolute', top: 0, left: '8%', right: '8%', height: 1.5, backgroundColor: BEVEL_HI, zIndex: 6 },
  cardAccent: { position: 'absolute', top: 0, left: 0, right: 0, height: 3, backgroundColor: C.blueDeep },
  cardTitle:  { fontFamily: F.bold, fontSize: SZ['2xl'], color: C.ink, letterSpacing: 2, marginBottom: 20, marginTop: 8 },

  label: { fontFamily: F.mono, fontSize: SZ.xs, color: C.dim2, letterSpacing: 1.5, marginBottom: 6 },
  input: {
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: BORDER,
    borderRadius: R.sm,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontFamily: F.outfit,
    fontSize: SZ.base,
    color: C.ink,
    marginBottom: 16,
  },

  errorTxt:   { fontFamily: F.mono, color: '#a83040', fontSize: SZ.sm, marginBottom: 12, lineHeight: 18 },
  successTxt: { fontFamily: F.mono, color: C.mint,    fontSize: SZ.sm, marginBottom: 12, lineHeight: 18 },

  submitBtn: {
    backgroundColor: C.gold,
    borderRadius: R.sm,
    padding: 16,
    alignItems: 'center',
    marginBottom: 20,
    marginTop: 4,
  },
  submitTxt: { fontFamily: F.bold, color: '#ffffff', fontSize: SZ.base, letterSpacing: 2 },

  switchRow: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 2 },
  switchTxt: { fontFamily: F.mono, color: C.blueDeep, fontSize: SZ.sm },
  divider:   { fontFamily: F.mono, color: C.dim2, fontSize: SZ.sm },

  skipBtn:   { alignItems: 'center', paddingVertical: 14 },
  skipTxt:   { fontFamily: F.mono, color: C.dim2, fontSize: SZ.sm },
  finePrint: { fontFamily: F.mono, color: C.dim2, fontSize: SZ.xs - 1, textAlign: 'center', lineHeight: 16, opacity: 0.6, marginTop: 8 },
});
