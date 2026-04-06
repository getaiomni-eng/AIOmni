import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator, Dimensions, KeyboardAvoidingView,
  Platform, StyleSheet, Text, TextInput,
  TouchableOpacity, Animated, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AIOmniLogo } from './components/AIOmniLogo';
import { C, F, SP, SZ } from './constants/tokens';

const { width: SCREEN_W } = Dimensions.get('window');
const SURFACE  = 'rgba(255,255,255,0.90)';
const BORDER   = 'rgba(88,131,191,0.32)';
const BEVEL_HI = 'rgba(255,255,255,0.95)';

export default function OnboardingScreen() {
  const [username, setUsername] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const shake   = useRef(new Animated.Value(0)).current;

  const triggerShake = () => {
    Animated.sequence([
      Animated.timing(shake, { toValue:  8, duration: 50, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -8, duration: 50, useNativeDriver: true }),
      Animated.timing(shake, { toValue:  6, duration: 50, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -6, duration: 50, useNativeDriver: true }),
      Animated.timing(shake, { toValue:  0, duration: 50, useNativeDriver: true }),
    ]).start();
  };

  const handleConnect = async () => {
    if (!username.trim()) { setError('Enter your Sleeper username'); triggerShake(); return; }
    setLoading(true); setError('');
    try {
      const res  = await fetch(`https://api.sleeper.app/v1/user/${username.trim()}`);
      const user = await res.json();
      if (!user?.user_id) {
        setError('Sleeper account not found. Check your username.');
        triggerShake(); setLoading(false); return;
      }
      await AsyncStorage.setItem('sleeper_username', username.trim());
      router.replace('/(tabs)');
    } catch {
      setError('Could not connect to Sleeper. Try again.');
      triggerShake();
    } finally { setLoading(false); }
  };

  return (
    <LinearGradient colors={[C.bgTop, C.bgBot]} style={{ flex: 1 }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={[styles.inner, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>

          {/* V27 Animated Logo */}
          <View style={styles.logoBlock}>
            <AIOmniLogo width={SCREEN_W * 0.78} />
            <View style={styles.logoDivider} />
            <Text style={styles.tagline}>SEE EVERYTHING · KNOW EVERYONE · WIN ALWAYS</Text>
          </View>

          {/* Connect card */}
          <Animated.View style={[styles.card, { transform: [{ translateX: shake }] }]}>
            <View style={styles.cardShine} />
            <Text style={styles.cardTitle}>Connect Sleeper</Text>
            <Text style={styles.cardSub}>Enter your username to load your leagues and rosters.</Text>

            <View style={[styles.inputWrap, error ? styles.inputWrapError : null]}>
              <Text style={styles.inputPrefix}>@</Text>
              <TextInput
                style={styles.input}
                placeholder="username"
                placeholderTextColor={C.dim2}
                value={username}
                onChangeText={t => { setUsername(t); if (error) setError(''); }}
                autoCapitalize="none"
                autoCorrect={false}
                onSubmitEditing={handleConnect}
                returnKeyType="go"
              />
            </View>

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <TouchableOpacity
              style={[styles.button, loading && { opacity: 0.7 }]}
              onPress={handleConnect}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color={C.ink} />
                : <Text style={styles.buttonText}>CONNECT SLEEPER →</Text>}
            </TouchableOpacity>
          </Animated.View>

          {/* Platform strip */}
          <View style={styles.platformStrip}>
            <View style={[styles.platformDot, { backgroundColor: C.gold }]} />
            <Text style={[styles.platformLabel, { color: C.blueDeep }]}>SLEEPER</Text>
            <View style={styles.platformSep} />
            <View style={[styles.platformDot, { backgroundColor: C.dim2 }]} />
            <Text style={styles.platformLabel}>ESPN</Text>
            <View style={styles.platformSep} />
            <View style={[styles.platformDot, { backgroundColor: C.dim2 }]} />
            <Text style={styles.platformLabel}>YAHOO</Text>
          </View>

          <Text style={styles.legalNote}>Free · 25 AI prompts per week · No credit card</Text>
        </View>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: SP[4] },

  logoBlock:   { alignItems: 'center', marginBottom: 28 },
  logoDivider: { width: 36, height: 2, backgroundColor: C.gold, marginVertical: 12, opacity: 0.6 },
  tagline:     { fontFamily: F.mono, fontSize: 9, color: C.dim2, letterSpacing: 2, textAlign: 'center' },

  card: {
    backgroundColor: SURFACE,
    borderRadius: 20, padding: 24,
    borderWidth: 1.5,
    borderColor: BORDER,
    borderTopColor: 'rgba(255,255,255,0.95)',
    borderLeftColor: 'rgba(255,255,255,0.85)',
    borderBottomColor: 'rgba(88,131,191,0.45)',
    borderRightColor: 'rgba(88,131,191,0.28)',
    marginBottom: 24,
    position: 'relative', overflow: 'hidden',
    shadowColor: '#3d6aaa',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12, shadowRadius: 18, elevation: 6,
  },
  cardShine: {
    position: 'absolute', top: 0, left: '8%', right: '8%',
    height: 1.5, backgroundColor: BEVEL_HI, zIndex: 6,
  },
  cardTitle: { fontFamily: F.bold, fontSize: 22, color: C.ink, marginBottom: 6 },
  cardSub:   { fontFamily: F.mono, color: C.dim2, fontSize: SZ.md, lineHeight: 20, marginBottom: 20 },

  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(88,131,191,0.06)',
    borderRadius: 12, borderWidth: 1.5, borderColor: BORDER,
    marginBottom: 12, paddingHorizontal: 14,
  },
  inputWrapError: { borderColor: 'rgba(168,48,64,0.5)' },
  inputPrefix:    { fontFamily: F.mono, fontSize: 20, color: C.dim2, marginRight: 6 },
  input: {
    flex: 1, color: C.ink, fontFamily: F.mono,
    fontSize: SZ.base, paddingVertical: 14,
  },
  errorText: {
    fontFamily: F.mono, color: '#a83040',
    fontSize: SZ.xs, letterSpacing: 1, marginBottom: 12,
  },
  button: {
    backgroundColor: C.gold, borderRadius: 12,
    padding: 16, alignItems: 'center', marginTop: 4,
    shadowColor: '#c9b100',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35, shadowRadius: 12, elevation: 4,
  },
  buttonText: { fontFamily: F.mono, color: C.ink, fontSize: SZ.base, letterSpacing: 2 },

  platformStrip: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 8, marginBottom: 16,
  },
  platformDot:   { width: 5, height: 5, borderRadius: 3 },
  platformLabel: { fontFamily: F.mono, fontSize: 10, color: C.dim2, letterSpacing: 2 },
  platformSep:   { width: 1, height: 10, backgroundColor: BORDER, marginHorizontal: 4 },

  legalNote: {
    fontFamily: F.mono, color: C.dim2,
    fontSize: 10, letterSpacing: 1,
    textAlign: 'center', opacity: 0.6,
  },
});
