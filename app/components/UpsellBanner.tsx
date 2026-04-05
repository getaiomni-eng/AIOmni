import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { C, F, R, SZ } from '../constants/tokens';

const SURFACE  = 'rgba(255,255,255,0.90)';
const BORDER   = 'rgba(88,131,191,0.32)';
const BEVEL_HI = 'rgba(255,255,255,0.95)';

const UPSELL_MESSAGES = [
  {
    trigger:  'coach',
    emoji:    '⚡',
    headline: "You're 3 prompts from your limit",
    body:     'Pro users get 75 AI Coach prompts per week — 3x more than free.',
    cta:      'Upgrade to Pro — $9.99/mo',
    color:    C.gold,
  },
  {
    trigger:  'trade',
    emoji:    '📊',
    headline: 'Your trade grade is ready',
    body:     'Pro unlocks full trade history, grade tracking, and opponent analysis every week.',
    cta:      'Upgrade to Pro — $9.99/mo',
    color:    C.gold,
  },
  {
    trigger:  'dynasty',
    emoji:    '👑',
    headline: 'Dynasty trades need Dynasty intelligence',
    body:     'Dynasty Elite grades future picks using live college rankings and rookie upside scores.',
    cta:      'Upgrade to Dynasty Elite — $19.99/mo',
    color:    '#1e8c42',
  },
  {
    trigger:  'trash',
    emoji:    '🔥',
    headline: 'Your league chat is missing AIOmni',
    body:     "Premium users get Adaptive Trash Talk — AI that learns every manager's voice.",
    cta:      'Upgrade to Premium — $14.99/mo',
    color:    '#7b5ea7',
  },
  {
    trigger:  'general',
    emoji:    '🏆',
    headline: "You're playing with one hand tied",
    body:     'Rankings tier gets community rankings from 500+ active players — updated weekly.',
    cta:      'Upgrade to Rankings — $5.99/mo',
    color:    '#2a7aaa',
  },
];

const COOLDOWN_MS    = 48 * 60 * 60 * 1000;
const MAX_DISMISSALS = 3;

type Props = {
  trigger?: 'coach' | 'trade' | 'dynasty' | 'trash' | 'general';
};

export default function UpsellBanner({ trigger = 'general' }: Props) {
  const [visible,   setVisible]   = useState(false);
  const [showTrial, setShowTrial] = useState(false);
  const [message,   setMessage]   = useState(UPSELL_MESSAGES[4]);
  const router = useRouter();

  useEffect(() => { checkShouldShow(); }, []);

  const checkShouldShow = async () => {
    try {
      const shownThisSession = await AsyncStorage.getItem('upsell_session_shown');
      if (shownThisSession === 'true') return;

      const lastShown = await AsyncStorage.getItem('upsell_last_shown');
      if (lastShown && Date.now() - parseInt(lastShown) < COOLDOWN_MS) return;

      const dismissals = parseInt(await AsyncStorage.getItem('upsell_dismissals') || '0');
      if (dismissals >= MAX_DISMISSALS) setShowTrial(true);

      const match = UPSELL_MESSAGES.find(m => m.trigger === trigger) || UPSELL_MESSAGES[4];
      setMessage(match);
      setVisible(true);

      await AsyncStorage.setItem('upsell_session_shown', 'true');
      await AsyncStorage.setItem('upsell_last_shown', Date.now().toString());
    } catch {}
  };

  const handleDismiss = async () => {
    try {
      const d = parseInt(await AsyncStorage.getItem('upsell_dismissals') || '0');
      await AsyncStorage.setItem('upsell_dismissals', (d + 1).toString());
    } catch {}
    setVisible(false);
  };

  const handleUpgrade = () => { setVisible(false); router.push('/paywall'); };

  if (!visible) return null;

  return (
    <View style={styles.container}>
      <View style={[styles.banner, { borderColor: message.color + '55' }]}>
        {/* bevel shine */}
        <View style={styles.shine} />
        {/* colour accent bar along top */}
        <View style={[styles.accentBar, { backgroundColor: message.color }]} />

        <TouchableOpacity style={styles.dismissBtn} onPress={handleDismiss} hitSlop={8}>
          <Text style={styles.dismissX}>✕</Text>
        </TouchableOpacity>

        <Text style={styles.emoji}>{message.emoji}</Text>
        <Text style={styles.headline}>{message.headline}</Text>
        <Text style={styles.body}>{message.body}</Text>

        {showTrial ? (
          <>
            <TouchableOpacity style={[styles.ctaBtn, { backgroundColor: message.color }]} onPress={handleUpgrade}>
              <Text style={[styles.ctaBtnText, { color: message.trigger === 'coach' || message.trigger === 'trade' ? C.ink : '#ffffff' }]}>
                🎁 Start 7-Day Free Trial →
              </Text>
            </TouchableOpacity>
            <Text style={styles.trialNote}>No charge for 7 days. Cancel anytime.</Text>
          </>
        ) : (
          <TouchableOpacity style={[styles.ctaBtn, { backgroundColor: message.color }]} onPress={handleUpgrade}>
            <Text style={[styles.ctaBtnText, { color: message.trigger === 'coach' || message.trigger === 'trade' ? C.ink : '#ffffff' }]}>
              {message.cta} →
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, marginBottom: 12 },
  banner: {
    backgroundColor: SURFACE,
    borderRadius: R.md,
    padding: 18,
    paddingTop: 22,
    borderWidth: 1.5,
    position: 'relative',
    overflow: 'hidden',
    shadowColor: '#3d6aaa',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.10,
    shadowRadius: 14,
    elevation: 4,
  },
  shine:     { position: 'absolute', top: 0, left: '8%', right: '8%', height: 1.5, backgroundColor: BEVEL_HI, zIndex: 6 },
  accentBar: { position: 'absolute', top: 0, left: 0, right: 0, height: 3 },
  dismissBtn:{ position: 'absolute', top: 12, right: 12, zIndex: 10, padding: 4 },
  dismissX:  { color: C.dim2, fontSize: 14, fontFamily: F.mono },
  emoji:     { fontSize: 26, marginBottom: 8, marginTop: 4 },
  headline:  { fontFamily: F.bold, color: C.ink, fontSize: SZ.lg, marginBottom: 6, paddingRight: 28, letterSpacing: 0.5 },
  body:      { fontFamily: F.mono, color: C.dim2, fontSize: SZ.sm, lineHeight: 20, marginBottom: 14 },
  ctaBtn:    { borderRadius: R.sm, padding: 13, alignItems: 'center' },
  ctaBtnText:{ fontFamily: F.bold, fontSize: SZ.base, letterSpacing: 1 },
  trialNote: { fontFamily: F.mono, color: C.dim2, fontSize: SZ.xs - 1, textAlign: 'center', marginTop: 6 },
});