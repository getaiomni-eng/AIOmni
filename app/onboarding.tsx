import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useState, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

const C = {
  void: '#03030a',
  y: '#D4FF00',
  surface: 'rgba(8,8,22,0.92)',
  border: 'rgba(212,255,0,0.10)',
  borderHi: 'rgba(212,255,0,0.28)',
  dim: '#4a4a5a',
  white: '#f0f0ff',
  red: '#ff2255',
};

export default function OnboardingScreen() {
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  const shake = useRef(new Animated.Value(0)).current;

  const triggerShake = () => {
    Animated.sequence([
      Animated.timing(shake, { toValue: 8, duration: 50, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -8, duration: 50, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 6, duration: 50, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -6, duration: 50, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  };

  const handleConnect = async () => {
    if (!username.trim()) { setError('Enter your Sleeper username'); triggerShake(); return; }
    setLoading(true); setError('');
    try {
      const res = await fetch(`https://api.sleeper.app/v1/user/${username.trim()}`);
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
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.inner}>

        <View style={styles.logoBlock}>
          <View style={styles.logoRow}>
            <Text style={styles.logoAIO}>AIO</Text>
            <Text style={styles.logoMni}>mni</Text>
          </View>
          <View style={styles.logoDivider} />
          <Text style={styles.tagline}>SEE EVERYTHING · KNOW EVERYONE · WIN ALWAYS</Text>
        </View>

        <Animated.View style={[styles.card, { transform: [{ translateX: shake }] }]}>
          <Text style={styles.cardTitle}>CONNECT SLEEPER</Text>
          <Text style={styles.cardSub}>Enter your username to load your leagues and rosters.</Text>

          <View style={[styles.inputWrap, error ? styles.inputWrapError : null]}>
            <Text style={styles.inputPrefix}>@</Text>
            <TextInput
              style={styles.input}
              placeholder="username"
              placeholderTextColor={C.dim}
              value={username}
              onChangeText={(t) => { setUsername(t); if (error) setError(''); }}
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={handleConnect}
              returnKeyType="go"
            />
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <TouchableOpacity style={[styles.button, loading && styles.buttonLoading]} onPress={handleConnect} disabled={loading}>
            {loading ? <ActivityIndicator color="#000" /> : <Text style={styles.buttonText}>CONNECT SLEEPER →</Text>}
          </TouchableOpacity>
        </Animated.View>

        <View style={styles.platformStrip}>
          <View style={[styles.platformDot, { backgroundColor: C.y }]} />
          <Text style={[styles.platformLabel, { color: C.y }]}>SLEEPER</Text>
          <View style={styles.platformSep} />
          <View style={[styles.platformDot, { backgroundColor: C.dim }]} />
          <Text style={styles.platformLabel}>ESPN</Text>
          <View style={styles.platformSep} />
          <View style={[styles.platformDot, { backgroundColor: C.dim }]} />
          <Text style={styles.platformLabel}>YAHOO</Text>
        </View>

        <Text style={styles.legalNote}>Free — 25 AI prompts per week</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.void },
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: 24 },

  logoBlock: { alignItems: 'center', marginBottom: 48 },
  logoRow: { flexDirection: 'row', alignItems: 'flex-end' },
  logoAIO: { fontFamily: 'BebasNeue_400Regular', fontSize: 80, color: C.y, letterSpacing: 6, lineHeight: 80 },
  logoMni: { fontFamily: 'BebasNeue_400Regular', fontSize: 40, color: C.y, letterSpacing: 8, marginBottom: 10, opacity: 0.6 },
  logoDivider: { width: 40, height: 2, backgroundColor: C.y, marginVertical: 12, opacity: 0.4 },
  tagline: { fontFamily: 'SpaceMono_400Regular', fontSize: 9, color: C.dim, letterSpacing: 2, textAlign: 'center' },

  card: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: C.borderHi,
    marginBottom: 24,
  },
  cardTitle: { fontFamily: 'BebasNeue_400Regular', fontSize: 28, color: C.y, letterSpacing: 3, marginBottom: 6 },
  cardSub: { fontFamily: 'Barlow_400Regular', color: C.dim, fontSize: 14, lineHeight: 20, marginBottom: 20 },

  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#03030a', borderRadius: 10, borderWidth: 1,
    borderColor: C.border, marginBottom: 12, paddingHorizontal: 14,
  },
  inputWrapError: { borderColor: C.red + '88' },
  inputPrefix: { fontFamily: 'BebasNeue_400Regular', fontSize: 22, color: C.dim, marginRight: 6, lineHeight: 50 },
  input: { flex: 1, color: C.white, fontFamily: 'Barlow_400Regular', fontSize: 16, paddingVertical: 14 },
  errorText: { fontFamily: 'SpaceMono_400Regular', color: C.red, fontSize: 11, letterSpacing: 1, marginBottom: 12 },

  button: { backgroundColor: C.y, borderRadius: 10, padding: 16, alignItems: 'center', marginTop: 4 },
  buttonLoading: { opacity: 0.7 },
  buttonText: { fontFamily: 'BebasNeue_400Regular', color: '#000', fontSize: 20, letterSpacing: 3 },

  platformStrip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 20 },
  platformDot: { width: 5, height: 5, borderRadius: 3 },
  platformLabel: { fontFamily: 'SpaceMono_400Regular', fontSize: 10, color: C.dim, letterSpacing: 2 },
  platformSep: { width: 1, height: 10, backgroundColor: C.border, marginHorizontal: 4 },

  legalNote: { fontFamily: 'SpaceMono_400Regular', color: C.dim, fontSize: 10, letterSpacing: 1, textAlign: 'center' },
});
