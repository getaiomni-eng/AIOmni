import { useRouter } from 'expo-router';
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
