// AIOmni Custom Rankings Quiz — Phase 3 reveal.
// Shows the user's top 3 DNA dimensions with animated fill bars, then a CTA
// that loads the AIOmni Formula, runs Method 3 to produce personalized
// rankings, persists them, and routes to the My Rankings tab.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  generateRankingsFromQuiz,
  getStrongestDimensions,
  loadQuizResult,
  saveQuizResult,
} from '../services/quiz/engine';
import { getDNALabel } from '../services/quiz/dnaLabels';
import { ALL_DIMENSIONS, type Dimension, type QuizResult } from '../services/quiz/types';
import { getFormulaRankings } from '../services/rankings/aiomniEngineBridge';
import { clearOverrides } from '../services/rankings/userOverrides';
import { dark, F, palette } from './constants/tokens';

export default function QuizRevealScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [result, setResult] = useState<QuizResult | null>(null);
  const [showFull, setShowFull] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const r = await loadQuizResult();
      setResult(r);
    })();
  }, []);

  const top3 = useMemo(
    () => (result ? getStrongestDimensions(result.dimensions, 3) : []),
    [result],
  );

  const otherDims = useMemo(() => {
    if (!result) return [];
    const top3Set = new Set(top3.map(t => t.dim));
    return ALL_DIMENSIONS.filter(d => !top3Set.has(d)).map(dim => ({
      dim,
      score: result.dimensions[dim],
      ...getDNALabel(dim, result.dimensions[dim]),
    }));
  }, [result, top3]);

  const onGenerate = async () => {
    if (!result || generating) return;
    setGenerating(true);
    setError(null);
    try {
      const formula = await getFormulaRankings('PPR', 'redraft');
      const generated = await generateRankingsFromQuiz(
        result.dimensions,
        result.positionRanks,
        formula ?? [],
        'PPR',
      );
      const updated: QuizResult = { ...result, generatedRankings: generated };
      await saveQuizResult(updated);

      // Clear stale state so the quiz result wins on the rankings tab:
      //   - selectedBase from a prior session would short-circuit the gate
      //     in loadSavedState (`!base`) and we'd fall back to the formula.
      //   - overrides were relative to the previous base ordering, so
      //     they're no longer meaningful against the new generated list.
      await AsyncStorage.removeItem('rankings_base_source');
      await clearOverrides(undefined);

      router.replace('/(tabs)/rankings' as any);
    } catch (e: any) {
      console.log('quiz-reveal generate error:', e);
      setError(e?.message ?? 'Failed to generate rankings');
      setGenerating(false);
    }
  };

  if (!result) {
    return (
      <View style={[s.container, { paddingTop: insets.top + 40 }]}>
        <ActivityIndicator color={palette.aqua} />
      </View>
    );
  }

  return (
    <View style={[s.container, { paddingTop: insets.top + 16 }]}>
      <TouchableOpacity
        style={s.closeBtn}
        onPress={() => router.back()}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Ionicons name="close" size={24} color={dark.textSub} />
      </TouchableOpacity>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <Text style={s.eyebrow}>YOUR RANKINGS</Text>
        <Text style={s.title}>DNA.</Text>

        <View style={{ marginTop: 8 }}>
          {top3.map((d, i) => (
            <DimensionBar key={d.dim} index={i} dim={d.dim} score={d.score} label={d.label} desc={d.desc} compact={false} />
          ))}
        </View>

        <TouchableOpacity style={s.toggleBtn} onPress={() => setShowFull(!showFull)}>
          <Text style={s.toggleBtnText}>
            {showFull ? 'HIDE FULL PROFILE' : 'VIEW FULL PROFILE'}
          </Text>
          <Ionicons
            name={showFull ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={palette.aqua}
            style={{ marginLeft: 4 }}
          />
        </TouchableOpacity>

        {showFull && (
          <View style={{ marginTop: 4 }}>
            {otherDims.map((d, i) => (
              <DimensionBar key={d.dim} index={i} dim={d.dim} score={d.score} label={d.label} desc={d.desc} compact />
            ))}
          </View>
        )}

        {error && <Text style={s.errorText}>{error}</Text>}
      </ScrollView>

      <TouchableOpacity
        style={[s.cta, generating && s.ctaBusy, { marginBottom: insets.bottom + 16 }]}
        onPress={onGenerate}
        disabled={generating}
      >
        {generating ? (
          <ActivityIndicator color={dark.bg} />
        ) : (
          <Text style={s.ctaText}>GENERATE MY RANKINGS</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

// ─── Animated dimension bar ────────────────────────────────────────
function DimensionBar({
  index, dim, score, label, desc, compact,
}: {
  index: number; dim: Dimension; score: number;
  label: string; desc: string; compact: boolean;
}) {
  const scaleX = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(scaleX, {
      toValue: score / 100,
      duration: 800,
      delay: 100 + index * 120,
      useNativeDriver: true,
    }).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={[s.barCard, compact && s.barCardCompact]}>
      <View style={s.barHeaderRow}>
        <Text style={[s.barLabel, compact && s.barLabelCompact]}>{label}</Text>
        <Text style={s.barScore}>{score}</Text>
      </View>
      <View style={s.barTrack}>
        <Animated.View
          style={[
            s.barFill,
            // RN 0.76+: transformOrigin 'left' anchors scaleX to left edge.
            // Fallback if not supported: bar still animates but from center.
            { transform: [{ scaleX }], transformOrigin: 'left' as any },
          ]}
        />
      </View>
      {!compact && <Text style={s.barDesc}>{desc}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: dark.bg, paddingHorizontal: 20 },
  closeBtn: { alignSelf: 'flex-end', paddingBottom: 4 },
  eyebrow: { fontFamily: F.body, fontSize: 10, letterSpacing: 3, color: dark.textMuted, marginBottom: 2 },
  title:   { fontFamily: F.bold, fontSize: 42, color: dark.text, letterSpacing: 2, marginBottom: 4 },

  barCard: {
    backgroundColor: dark.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: dark.border,
    padding: 14,
    marginTop: 12,
  },
  barCardCompact: { padding: 10, marginTop: 8 },
  barHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 },
  barLabel: { fontFamily: F.bold, fontSize: 16, color: dark.text, letterSpacing: 1 },
  barLabelCompact: { fontSize: 13 },
  barScore: { fontFamily: F.bold, fontSize: 18, color: palette.aqua, letterSpacing: 1 },
  barTrack: { height: 6, backgroundColor: dark.surface, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: 6, width: '100%', backgroundColor: palette.aqua, borderRadius: 3 },
  barDesc: { fontFamily: F.body, fontSize: 12, color: dark.textSub, marginTop: 8, lineHeight: 18 },

  toggleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 12, marginTop: 8,
  },
  toggleBtnText: { fontFamily: F.bold, fontSize: 11, color: palette.aqua, letterSpacing: 2 },

  errorText: { fontFamily: F.body, fontSize: 12, color: palette.flame, marginTop: 12, textAlign: 'center' },

  cta: {
    backgroundColor: palette.amber,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  ctaBusy: { opacity: 0.7 },
  ctaText: { fontFamily: F.bold, fontSize: 14, color: dark.bg, letterSpacing: 3 },
});
