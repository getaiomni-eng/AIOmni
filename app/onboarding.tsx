import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Dimensions, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AIOmniLogo, AIOmniWordmark } from './components/AIOmniLogo';
import { F, SP } from './constants/tokens';

const { width: SCREEN_W } = Dimensions.get('window');
const SURFACE = '#12252e';
const BORDER  = '#1a3542';

export default function OnboardingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Animation values
  const logoScale    = useRef(new Animated.Value(0.3)).current;
  const logoOpacity  = useRef(new Animated.Value(0)).current;
  const spinAnim     = useRef(new Animated.Value(0)).current;
  const wordFade     = useRef(new Animated.Value(0)).current;
  const tagFade      = useRef(new Animated.Value(0)).current;
  const propSlide    = useRef(new Animated.Value(30)).current;
  const propFade     = useRef(new Animated.Value(0)).current;
  const btnSlide     = useRef(new Animated.Value(60)).current;
  const btnFade      = useRef(new Animated.Value(0)).current;
  const stripFade    = useRef(new Animated.Value(0)).current;
  const dot1Pulse    = useRef(new Animated.Value(0.4)).current;
  const dot2Pulse    = useRef(new Animated.Value(0.4)).current;
  const dot3Pulse    = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    // 1. Logo appears and scales up
    Animated.parallel([
      Animated.timing(logoOpacity, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.spring(logoScale, { toValue: 1, tension: 60, friction: 8, useNativeDriver: true }),
    ]).start();

    // 2. Continuous spin
    Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 8000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();

    // 3. Wordmark fades in
    Animated.timing(wordFade, { toValue: 1, duration: 500, delay: 400, useNativeDriver: true }).start();

    // 4. Tagline fades in
    Animated.timing(tagFade, { toValue: 1, duration: 400, delay: 700, useNativeDriver: true }).start();

    // 5. Props slide up
    Animated.parallel([
      Animated.timing(propFade, { toValue: 1, duration: 500, delay: 900, useNativeDriver: true }),
      Animated.timing(propSlide, { toValue: 0, duration: 500, delay: 900, useNativeDriver: true }),
    ]).start();

    // 6. Buttons slide up
    Animated.parallel([
      Animated.timing(btnFade, { toValue: 1, duration: 500, delay: 1200, useNativeDriver: true }),
      Animated.timing(btnSlide, { toValue: 0, duration: 500, delay: 1200, useNativeDriver: true }),
    ]).start();

    // 7. Platform strip fades in
    Animated.timing(stripFade, { toValue: 1, duration: 400, delay: 1500, useNativeDriver: true }).start();

    // 8. Platform dots pulse continuously
    const pulseDot = (dot: Animated.Value, delay: number) => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(dot, { toValue: 1, duration: 1200, delay, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0.4, duration: 1200, useNativeDriver: true }),
        ])
      ).start();
    };
    pulseDot(dot1Pulse, 0);
    pulseDot(dot2Pulse, 400);
    pulseDot(dot3Pulse, 800);
  }, []);

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={{ flex: 1, backgroundColor: '#0a1214' }}>
      <View style={[styles.inner, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}>

        {/* Logo + tagline */}
        <View style={styles.logoBlock}>
          <Animated.View style={{ opacity: logoOpacity, transform: [{ scale: logoScale }, { rotate: spin }] }}>
            <AIOmniLogo size={SCREEN_W * 0.55} />
          </Animated.View>

          <Animated.View style={{ marginTop: 16, opacity: wordFade }}>
            <AIOmniWordmark fontSize={32} color='#f0f4f5' />
          </Animated.View>

          <Animated.View style={[styles.logoDivider, { opacity: tagFade }]} />

          <Animated.Text style={[styles.tagline, { opacity: tagFade }]}>
            SEE EVERYTHING · KNOW EVERYONE · WIN ALWAYS
          </Animated.Text>
        </View>

        {/* Value props */}
        <Animated.View style={[styles.propsBlock, { opacity: propFade, transform: [{ translateY: propSlide }] }]}>
          <Text style={styles.propLine}>AI-POWERED FANTASY INTELLIGENCE</Text>
          <Text style={styles.propSub}>
            Reads your league settings, scoring format, and roster rules before every recommendation.
          </Text>
        </Animated.View>

        {/* CTA buttons */}
        <Animated.View style={[styles.ctaBlock, { opacity: btnFade, transform: [{ translateY: btnSlide }] }]}>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => router.push('/auth')}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryBtnText}>CREATE ACCOUNT →</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => router.push('/auth')}
            activeOpacity={0.8}
          >
            <Text style={styles.secondaryBtnText}>SIGN IN</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.skipBtn}
            onPress={() => router.replace('/(tabs)')}
          >
            <Text style={styles.skipBtnText}>CONTINUE WITHOUT ACCOUNT</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Platform strip */}
        <Animated.View style={[styles.platformStrip, { opacity: stripFade }]}>
          <Animated.View style={[styles.platformDot, { backgroundColor: '#00FFF9', opacity: dot1Pulse }]} />
          <Text style={styles.platformLabel}>SLEEPER</Text>
          <View style={styles.platformSep} />
          <Animated.View style={[styles.platformDot, { backgroundColor: '#e52534', opacity: dot2Pulse }]} />
          <Text style={styles.platformLabel}>ESPN</Text>
          <View style={styles.platformSep} />
          <Animated.View style={[styles.platformDot, { backgroundColor: '#7c3aed', opacity: dot3Pulse }]} />
          <Text style={styles.platformLabel}>YAHOO</Text>
        </Animated.View>

        <Animated.Text style={[styles.legalNote, { opacity: stripFade }]}>
          Free · 25 AI prompts per week · No credit card required
        </Animated.Text>
        <Animated.Text style={[styles.legalNote, { opacity: stripFade }]}>
          Connect your platforms anytime in Settings → My Platforms
        </Animated.Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  inner: { flex: 1, justifyContent: 'center', paddingHorizontal: SP[4] },

  logoBlock:   { alignItems: 'center', marginBottom: 32 },
  logoDivider: { width: 36, height: 2, backgroundColor: '#ffb800', marginVertical: 12, opacity: 0.6 },
  tagline:     { fontFamily: F.mono, fontSize: 9, color: '#4a6a76', letterSpacing: 2, textAlign: 'center' },

  propsBlock: { alignItems: 'center', marginBottom: 32 },
  propLine:   { fontFamily: F.bold, fontSize: 18, color: '#f0f4f5', letterSpacing: 2, textAlign: 'center', marginBottom: 8 },
  propSub:    { fontFamily: F.body, fontSize: 14, color: '#4a6a76', textAlign: 'center', lineHeight: 20, paddingHorizontal: 16 },

  ctaBlock: { marginBottom: 28 },

  primaryBtn: {
    backgroundColor: '#ffb800', borderRadius: 14,
    padding: 18, alignItems: 'center', marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35, shadowRadius: 12, elevation: 4,
  },
  primaryBtnText: { fontFamily: F.bold, color: '#0a1214', fontSize: 16, letterSpacing: 2 },

  secondaryBtn: {
    backgroundColor: SURFACE, borderRadius: 14,
    padding: 16, alignItems: 'center', marginBottom: 12,
    borderWidth: 1.5, borderColor: BORDER,
  },
  secondaryBtnText: { fontFamily: F.bold, color: '#6eeb83', fontSize: 14, letterSpacing: 2 },

  skipBtn: { alignItems: 'center', paddingVertical: 12 },
  skipBtnText: { fontFamily: F.mono, color: '#4a6a76', fontSize: 11, letterSpacing: 1.5 },

  platformStrip: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 8, marginBottom: 12,
  },
  platformDot:   { width: 6, height: 6, borderRadius: 3 },
  platformLabel: { fontFamily: F.mono, fontSize: 10, color: '#4a6a76', letterSpacing: 2 },
  platformSep:   { width: 1, height: 10, backgroundColor: BORDER, marginHorizontal: 4 },

  legalNote: {
    fontFamily: F.mono, color: '#4a6a76',
    fontSize: 10, letterSpacing: 1,
    textAlign: 'center', opacity: 0.6, marginBottom: 4,
  },
});