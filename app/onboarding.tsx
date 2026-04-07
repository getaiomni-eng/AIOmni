import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AIOmniLogo } from './components/AIOmniLogo';
import { C, F, SP } from './constants/tokens';

const { width: SCREEN_W } = Dimensions.get('window');
const SURFACE  = 'rgba(255,255,255,0.90)';
const BORDER   = 'rgba(88,131,191,0.32)';
const BEVEL_HI = 'rgba(255,255,255,0.95)';

export default function OnboardingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <LinearGradient colors={[C.bgTop, C.bgBot]} style={{ flex: 1 }}>
      <View style={[styles.inner, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}>

        {/* Logo + tagline */}
        <View style={styles.logoBlock}>
          <AIOmniLogo width={SCREEN_W * 0.7} />
          <View style={styles.logoDivider} />
          <Text style={styles.tagline}>SEE EVERYTHING · KNOW EVERYONE · WIN ALWAYS</Text>
        </View>

        {/* Value props */}
        <View style={styles.propsBlock}>
          <Text style={styles.propLine}>AI-POWERED FANTASY INTELLIGENCE</Text>
          <Text style={styles.propSub}>
            Reads your league settings, scoring format, and roster rules before every recommendation.
          </Text>
        </View>

        {/* CTA buttons */}
        <View style={styles.ctaBlock}>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => router.push('/auth')}
          >
            <Text style={styles.primaryBtnText}>CREATE ACCOUNT →</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => router.push('/auth')}
          >
            <Text style={styles.secondaryBtnText}>SIGN IN</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.skipBtn}
            onPress={() => router.replace('/(tabs)')}
          >
            <Text style={styles.skipBtnText}>CONTINUE WITHOUT ACCOUNT</Text>
          </TouchableOpacity>
        </View>

        {/* Platform strip */}
        <View style={styles.platformStrip}>
          <View style={[styles.platformDot, { backgroundColor: C.gold }]} />
          <Text style={styles.platformLabel}>SLEEPER</Text>
          <View style={styles.platformSep} />
          <View style={[styles.platformDot, { backgroundColor: C.gold }]} />
          <Text style={styles.platformLabel}>ESPN</Text>
          <View style={styles.platformSep} />
          <View style={[styles.platformDot, { backgroundColor: C.gold }]} />
          <Text style={styles.platformLabel}>YAHOO</Text>
        </View>

        <Text style={styles.legalNote}>
          Free · 25 AI prompts per week · No credit card required
        </Text>
        <Text style={styles.legalNote}>
          Connect your platforms anytime in Settings → My Platforms
        </Text>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: SP[4] },

  logoBlock:   { alignItems: 'center', marginBottom: 32 },
  logoDivider: { width: 36, height: 2, backgroundColor: C.gold, marginVertical: 12, opacity: 0.6 },
  tagline:     { fontFamily: F.mono, fontSize: 9, color: C.dim2, letterSpacing: 2, textAlign: 'center' },

  propsBlock: { alignItems: 'center', marginBottom: 32 },
  propLine:   { fontFamily: F.bold, fontSize: 18, color: C.ink, letterSpacing: 2, textAlign: 'center', marginBottom: 8 },
  propSub:    { fontFamily: F.outfit, fontSize: 14, color: C.dim, textAlign: 'center', lineHeight: 20, paddingHorizontal: 16 },

  ctaBlock: { marginBottom: 28 },

  primaryBtn: {
    backgroundColor: C.gold, borderRadius: 14,
    padding: 18, alignItems: 'center', marginBottom: 12,
    shadowColor: '#c9b100',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35, shadowRadius: 12, elevation: 4,
  },
  primaryBtnText: { fontFamily: F.bold, color: C.ink, fontSize: 16, letterSpacing: 2 },

  secondaryBtn: {
    backgroundColor: SURFACE, borderRadius: 14,
    padding: 16, alignItems: 'center', marginBottom: 12,
    borderWidth: 1.5,
    borderTopColor: 'rgba(255,255,255,0.95)',
    borderLeftColor: 'rgba(255,255,255,0.85)',
    borderBottomColor: 'rgba(88,131,191,0.45)',
    borderRightColor: 'rgba(88,131,191,0.28)',
  },
  secondaryBtnText: { fontFamily: F.bold, color: C.blueDeep, fontSize: 14, letterSpacing: 2 },

  skipBtn: { alignItems: 'center', paddingVertical: 12 },
  skipBtnText: { fontFamily: F.mono, color: C.dim2, fontSize: 11, letterSpacing: 1.5 },

  platformStrip: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 8, marginBottom: 12,
  },
  platformDot:   { width: 5, height: 5, borderRadius: 3 },
  platformLabel: { fontFamily: F.mono, fontSize: 10, color: C.dim2, letterSpacing: 2 },
  platformSep:   { width: 1, height: 10, backgroundColor: BORDER, marginHorizontal: 4 },

  legalNote: {
    fontFamily: F.mono, color: C.dim2,
    fontSize: 10, letterSpacing: 1,
    textAlign: 'center', opacity: 0.6, marginBottom: 4,
  },
});