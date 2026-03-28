import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const UPSELL_MESSAGES = [
  {
    trigger: 'coach',
    emoji: '⚡',
    headline: 'You\'re 3 prompts from your daily limit',
    body: 'Pro users get unlimited AI Coach access — no daily caps, ever.',
    cta: 'Upgrade to Pro — $9.99/mo',
    tier: 'Pro',
  },
  {
    trigger: 'trade',
    emoji: '📊',
    headline: 'Your trade grade is ready',
    body: 'Pro unlocks full trade history, grade tracking, and opponent analysis every week.',
    cta: 'Upgrade to Pro — $9.99/mo',
    tier: 'Pro',
  },
  {
    trigger: 'dynasty',
    emoji: '👑',
    headline: 'Dynasty trades need Dynasty intelligence',
    body: 'Dynasty Elite grades future picks using live college rankings and rookie upside scores.',
    cta: 'Upgrade to Dynasty Elite — $19.99/mo',
    tier: 'Dynasty Elite',
  },
  {
    trigger: 'trash',
    emoji: '🔥',
    headline: 'Your league chat is missing AIOmni',
    body: 'Premium users get Adaptive Trash Talk — AI that learns every manager\'s voice and roasts them personally.',
    cta: 'Upgrade to Premium — $14.99/mo',
    tier: 'Premium',
  },
  {
    trigger: 'general',
    emoji: '🏆',
    headline: 'You\'re playing with one hand tied',
    body: 'Rankings tier users see community rankings from 500+ active players — updated weekly.',
    cta: 'Upgrade to Rankings — $5.99/mo',
    tier: 'Rankings',
  },
];

const COOLDOWN_MS = 48 * 60 * 60 * 1000; // 48 hours
const MAX_DISMISSALS = 3;

type Props = {
  trigger?: 'coach' | 'trade' | 'dynasty' | 'trash' | 'general';
};

export default function UpsellBanner({ trigger = 'general' }: Props) {
  const [visible, setVisible] = useState(false);
  const [showTrial, setShowTrial] = useState(false);
  const [message, setMessage] = useState(UPSELL_MESSAGES[4]);
  const router = useRouter();

  useEffect(() => {
    checkShouldShow();
  }, []);

  const checkShouldShow = async () => {
    try {
      // Check session flag — only 1 per session
      const shownThisSession = await AsyncStorage.getItem('upsell_session_shown');
      if (shownThisSession === 'true') return;

      // Check 48hr cooldown
      const lastShown = await AsyncStorage.getItem('upsell_last_shown');
      if (lastShown) {
        const elapsed = Date.now() - parseInt(lastShown);
        if (elapsed < COOLDOWN_MS) return;
      }

      // Check dismissal count — after 3, show trial offer instead
      const dismissals = parseInt(await AsyncStorage.getItem('upsell_dismissals') || '0');
      if (dismissals >= MAX_DISMISSALS) {
        setShowTrial(true);
      }

      // Find matching message for trigger
      const match = UPSELL_MESSAGES.find(m => m.trigger === trigger) || UPSELL_MESSAGES[4];
      setMessage(match);
      setVisible(true);

      // Mark session
      await AsyncStorage.setItem('upsell_session_shown', 'true');
      await AsyncStorage.setItem('upsell_last_shown', Date.now().toString());
    } catch (err) {
      // Fail silently — never break the app for an upsell
    }
  };

  const handleDismiss = async () => {
    try {
      const dismissals = parseInt(await AsyncStorage.getItem('upsell_dismissals') || '0');
      await AsyncStorage.setItem('upsell_dismissals', (dismissals + 1).toString());
    } catch {}
    setVisible(false);
  };

  const handleUpgrade = () => {
    setVisible(false);
    router.push('/paywall');
  };

  if (!visible) return null;

  return (
    <View style={styles.container}>
      <View style={styles.banner}>
        <TouchableOpacity style={styles.dismissBtn} onPress={handleDismiss}>
          <Text style={styles.dismissX}>✕</Text>
        </TouchableOpacity>

        <Text style={styles.emoji}>{message.emoji}</Text>
        <Text style={styles.headline}>{message.headline}</Text>
        <Text style={styles.body}>{message.body}</Text>

        {showTrial ? (
          <>
            <TouchableOpacity style={styles.trialBtn} onPress={handleUpgrade}>
              <Text style={styles.trialBtnText}>🎁 Start 7-Day Free Trial →</Text>
            </TouchableOpacity>
            <Text style={styles.trialNote}>No charge for 7 days. Cancel anytime.</Text>
          </>
        ) : (
          <TouchableOpacity style={styles.ctaBtn} onPress={handleUpgrade}>
            <Text style={styles.ctaBtnText}>{message.cta} →</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  banner: {
    backgroundColor: '#1a1400',
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: ''#b8891a'',
    position: 'relative',
  },
  dismissBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 10,
    padding: 4,
  },
  dismissX: {
    color: '#555',
    fontSize: 16,
  },
  emoji: {
    fontSize: 28,
    marginBottom: 8,
  },
  headline: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 15,
    marginBottom: 6,
    paddingRight: 24,
  },
  body: {
    color: '#888',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 14,
  },
  ctaBtn: {
    backgroundColor: ''#b8891a'',
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
  },
  ctaBtnText: {
    color: '#000',
    fontWeight: 'bold',
    fontSize: 14,
  },
  trialBtn: {
    backgroundColor: ''#b8891a'',
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    marginBottom: 6,
  },
  trialBtnText: {
    color: '#000',
    fontWeight: 'bold',
    fontSize: 14,
  },
  trialNote: {
    color: '#555',
    fontSize: 11,
    textAlign: 'center',
  },
});
