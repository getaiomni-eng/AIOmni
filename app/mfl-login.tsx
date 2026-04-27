import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View, Text, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet, Linking } from 'react-native';
import { AIOmniLogo } from './components/AIOmniLogo';
import { setMflCredentials, mflPlatform } from '../services/platform/mfl';
import { C, F, SZ, R, SP } from './constants/tokens';

export default function MflLoginScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [leagueId, setLeagueId] = useState('');
  const [franchiseId, setFranchiseId] = useState('');
  const [season, setSeason] = useState(String(new Date().getFullYear()));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleConnect = async () => {
    setError('');
    if (!leagueId.trim() || !franchiseId.trim()) {
      setError('League ID and franchise ID are required.');
      return;
    }
    setLoading(true);
    try {
      // Pad franchise ID to 4 digits if user typed "1" instead of "0001"
      const padded = franchiseId.trim().padStart(4, '0');
      await setMflCredentials({
        leagueId: leagueId.trim(),
        franchiseId: padded,
        season: season.trim() || String(new Date().getFullYear()),
      });
      const leagues = await mflPlatform.getLeagues();
      if (leagues.length === 0) {
        setError('Could not find that league. Check the league ID and season.');
        setLoading(false);
        return;
      }
      router.replace('/(tabs)' as any);
    } catch (e: any) {
      setError(e?.message ?? 'Connection failed.');
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#0a1214' }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.wrap, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }]}>

          <View style={styles.logoBlock}>
            <AIOmniLogo width={140} />
            <Text style={styles.logoSub}>Connect your MFL league.</Text>
          </View>

          <View style={styles.card}>
            <View style={styles.cardAccent} />
            <Text style={styles.cardTitle}>MYFANTASYLEAGUE</Text>

            <Text style={styles.label}>LEAGUE ID</Text>
            <TextInput
              style={styles.input}
              value={leagueId}
              onChangeText={(t: string) => { setLeagueId(t); setError(''); }}
              placeholder="53297"
              placeholderTextColor={C.dim2}
              keyboardType="number-pad"
              autoCapitalize="none"
              autoFocus
            />
            <Text style={styles.hint}>From your league URL: myfantasyleague.com/2026/home/<Text style={styles.hintBold}>53297</Text></Text>

            <Text style={styles.label}>YOUR FRANCHISE ID</Text>
            <TextInput
              style={styles.input}
              value={franchiseId}
              onChangeText={(t: string) => { setFranchiseId(t); setError(''); }}
              placeholder="0001"
              placeholderTextColor={C.dim2}
              keyboardType="number-pad"
              autoCapitalize="none"
            />
            <Text style={styles.hint}>Click your team — URL contains &F=<Text style={styles.hintBold}>0001</Text></Text>

            <Text style={styles.label}>SEASON</Text>
            <TextInput
              style={styles.input}
              value={season}
              onChangeText={(t: string) => { setSeason(t); setError(''); }}
              placeholder="2026"
              placeholderTextColor={C.dim2}
              keyboardType="number-pad"
              autoCapitalize="none"
            />
            <Text style={styles.hint}>The year the league plays in (typically the current year)</Text>

            {error ? <Text style={styles.errorTxt}>{error}</Text> : null}

            <TouchableOpacity
              style={[styles.submitBtn, loading && { opacity: 0.5 }]}
              onPress={handleConnect}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color={C.ink} />
                : <Text style={styles.submitTxt}>CONNECT →</Text>
              }
            </TouchableOpacity>

            <TouchableOpacity onPress={() => Linking.openURL('https://www.myfantasyleague.com/')}>
              <Text style={styles.cancelTxt}>Don't have an MFL league? Sign up at myfantasyleague.com</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => router.back()}>
              <Text style={styles.cancelTxt}>← Back to settings</Text>
            </TouchableOpacity>
          </View>

        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: SP[3], justifyContent: 'center' },
  logoBlock: { alignItems: 'center', marginBottom: 28 },
  logoSub:   { fontFamily: F.mono, color: '#4a6a76', fontSize: SZ.sm, textAlign: 'center', letterSpacing: 0.5, marginTop: 12 },

  card: {
    backgroundColor: '#12252e',
    borderRadius: R.lg,
    padding: 24,
    borderWidth: 1.5,
    borderColor: '#1a3542',
    overflow: 'hidden',
    position: 'relative',
  },
  cardAccent: { position: 'absolute', top: 0, left: 0, right: 0, height: 3, backgroundColor: '#e4ff1a' },
  cardTitle:  { fontFamily: F.bold, fontSize: SZ['2xl'], color: '#f0f4f5', letterSpacing: 2, marginBottom: 18, marginTop: 8 },

  label: { fontFamily: F.mono, fontSize: SZ.xs, color: '#4a6a76', letterSpacing: 1.5, marginBottom: 6, marginTop: 6 },
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
    marginBottom: 4,
  },
  hint: { fontFamily: F.mono, fontSize: SZ.xs, color: '#4a6a76', marginBottom: 12, lineHeight: 16 },
  hintBold: { color: '#e4ff1a' },

  errorTxt: { fontFamily: F.mono, color: '#ff5714', fontSize: SZ.sm, marginBottom: 12, lineHeight: 18 },

  submitBtn: {
    backgroundColor: '#e4ff1a',
    borderRadius: R.sm,
    padding: 16,
    alignItems: 'center',
    marginBottom: 12,
    marginTop: 12,
  },
  submitTxt: { fontFamily: F.mono, color: '#0a1214', fontSize: SZ.base, letterSpacing: 2 },
  cancelTxt: { fontFamily: F.mono, color: '#6eeb83', fontSize: SZ.sm, textAlign: 'center', paddingVertical: 6 },
});
