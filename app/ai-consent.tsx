// app/ai-consent.tsx
// One-time disclosure + permission gate for third-party AI processing.
// Required by App Store guideline 5.1.1(i)/5.1.2(i) — see services/aiConsent.ts.
// Declining is a real choice: the app still works, AI features stay locked and
// can be enabled later from Settings.
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AI_DISCLOSURE, setAIConsent } from '../services/aiConsent';

const BG = '#0a1214';
const CARD = '#12252e';
const BORDER = '#1a3542';
const TEXT = '#f0f4f5';
const SUB = '#7a9eaa';
const AQUA = '#1be7ff';

export default function AIConsentScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);

  const decide = async (value: 'granted' | 'declined') => {
    setBusy(true);
    await setAIConsent(value);
    router.replace('/(tabs)');
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 16 }]}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        <Text style={styles.title}>Before you use the AI</Text>
        <Text style={styles.lede}>
          AIOmni's AI features — the Coach, Trade Analyzer, Draft Copilot, and the
          player insights on the Home and League tabs — are powered by an AI service
          run by {AI_DISCLOSURE.recipient}. To answer your questions, AIOmni sends some
          of your fantasy data to them for processing.
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>What gets sent to {AI_DISCLOSURE.recipient}</Text>
          {AI_DISCLOSURE.sent.map((line, i) => (
            <View key={i} style={styles.row}>
              <Text style={[styles.bullet, { color: AQUA }]}>•</Text>
              <Text style={styles.rowText}>{line}</Text>
            </View>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>What never gets sent to {AI_DISCLOSURE.recipient}</Text>
          {AI_DISCLOSURE.notSent.map((line, i) => (
            <View key={i} style={styles.row}>
              <Text style={[styles.bullet, { color: SUB }]}>•</Text>
              <Text style={styles.rowText}>{line}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.fine}>
          Your data is sent through AIOmni's servers and is not used to train AI models.
          You can change this choice at any time in Settings.
        </Text>

        <TouchableOpacity onPress={() => Linking.openURL('https://getaiomni.com/privacy')}>
          <Text style={styles.link}>Read the full Privacy Policy</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.primaryBtn, busy && { opacity: 0.6 }]}
          disabled={busy}
          onPress={() => decide('granted')}
        >
          <Text style={styles.primaryText}>Agree and continue</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryBtn}
          disabled={busy}
          onPress={() => decide('declined')}
        >
          <Text style={styles.secondaryText}>Not now — use AIOmni without AI</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root:         { flex: 1, backgroundColor: BG, paddingHorizontal: 20 },
  title:        { fontFamily: 'BebasNeue', fontSize: 30, color: TEXT, letterSpacing: 1, marginBottom: 10 },
  lede:         { fontSize: 15, lineHeight: 22, color: SUB, marginBottom: 20 },
  card:         { backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER, padding: 16, marginBottom: 14 },
  cardTitle:    { fontSize: 15, fontWeight: '700', color: TEXT, marginBottom: 10 },
  row:          { flexDirection: 'row', marginBottom: 8 },
  bullet:       { fontSize: 15, marginRight: 8, lineHeight: 20 },
  rowText:      { flex: 1, fontSize: 14, lineHeight: 20, color: TEXT },
  fine:         { fontSize: 13, lineHeight: 19, color: SUB, marginBottom: 12 },
  link:         { fontSize: 14, color: AQUA, marginBottom: 24 },
  primaryBtn:   { backgroundColor: AQUA, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginBottom: 12 },
  primaryText:  { fontFamily: 'BebasNeue', fontSize: 18, letterSpacing: 1, color: '#0a1214' },
  secondaryBtn: { paddingVertical: 14, alignItems: 'center' },
  secondaryText:{ fontSize: 14, color: SUB },
});
