// First-run walkthrough (2026-09-04). "Idk how to navigate your app" came
// from a real ad-funnel user during draft week; this is three cards, once
// ever, dismissible at every step. Deliberately an overlay rather than a
// tour: nothing to tap through in-place, no anchored tooltips to break when
// layouts change.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../constants/theme';

const FLAG = 'coachmarks_v1_done';

const STEPS = [
  {
    icon: '🔗',
    title: 'Connect your leagues',
    body: 'Link Sleeper, ESPN, Yahoo, MFL, or Fleaflicker in Settings and every league you play in shows up here, with live rosters and matchups.',
  },
  {
    icon: '📋',
    title: 'Draft with THE O',
    body: 'The draft room works with any draft, even in person. Sleeper picks sync automatically; everywhere else you tap picks in as they happen.',
  },
  {
    icon: '🧠',
    title: 'Ask the AI Coach',
    body: 'It reads your actual rosters and scoring before it answers. Ask about any player, grade any trade, or tap a score for a matchup breakdown.',
  },
] as const;

export function CoachMarks() {
  const { t } = useTheme();
  const router = useRouter();
  const [step, setStep] = useState<number | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(FLAG).then(v => { if (!v) setStep(0); }).catch(() => {});
  }, []);

  if (step === null) return null;
  const done = async (goSettings = false) => {
    setStep(null);
    try { await AsyncStorage.setItem(FLAG, '1'); } catch {}
    if (goSettings) router.push('/(tabs)/settings' as any);
  };
  const s = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => done()}>
      <View style={st.backdrop}>
        <View style={[st.card, { backgroundColor: t.card, borderColor: t.border }]}>
          <Text style={st.icon}>{s.icon}</Text>
          <Text style={[st.title, { color: t.text }]}>{s.title}</Text>
          <Text style={[st.body, { color: t.textSub }]}>{s.body}</Text>
          <View style={st.dots}>
            {STEPS.map((_, i) => (
              <View key={i} style={[st.dot, { backgroundColor: i === step ? t.accentText : t.border }]} />
            ))}
          </View>
          <TouchableOpacity
            style={[st.cta, { backgroundColor: t.accentText }]}
            onPress={() => (last ? done(true) : setStep(step + 1))}
          >
            <Text style={st.ctaText}>{last ? 'Connect a league' : 'Next'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => done()} hitSlop={{ top: 10, bottom: 10, left: 20, right: 20 }}>
            <Text style={[st.skip, { color: t.textMuted }]}>{last ? 'Maybe later' : 'Skip'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 28 },
  card: { width: '100%', maxWidth: 380, borderRadius: 18, borderWidth: 1, padding: 26, alignItems: 'center', gap: 10 },
  icon: { fontSize: 40 },
  title: { fontFamily: 'Audiowide_400Regular', fontSize: 17, textAlign: 'center', letterSpacing: 0.5 },
  body: { fontSize: 14.5, lineHeight: 21, textAlign: 'center' },
  dots: { flexDirection: 'row', gap: 7, marginTop: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  cta: { alignSelf: 'stretch', borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 8 },
  ctaText: { color: '#0a1214', fontWeight: '700', fontSize: 15 },
  skip: { fontSize: 13, marginTop: 4 },
});
