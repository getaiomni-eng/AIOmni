import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { askAI } from '../../services/ai';
import { C, F, R, SP, SZ } from '../constants/tokens';

type Format = 'redraft' | 'dynasty';
type Grade = 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D+' | 'D' | 'F';

type TradeResult = {
  receiveGrade: Grade;
  giveGrade: Grade;
  verdict: string;
  analysis: string;
  accept: boolean;
  tags: { label: string; color: string }[];
};

const GRADE_COLOR: Record<Grade, string> = {
  'A+': C.mint,
  A: C.mint,
  'A-': C.mint,
  'B+': C.gold,
  B: C.gold,
  'B-': C.gold,
  'C+': C.amber,
  C: C.amber,
  'C-': C.amber,
  'D+': '#a83040',
  D: '#a83040',
  F: '#a83040',
};

const EXAMPLES = [
  { give: 'CeeDee Lamb', get: 'Saquon Barkley + T. Lockett' },
  { give: 'Josh Allen + RB2', get: 'Lamar Jackson + WR2' },
  { give: 'Justin Jefferson', get: "Ja'Marr Chase + TE1" },
];

async function analyzeTrade(giving: string, getting: string, format: Format): Promise<TradeResult> {
  try {
    const prompt = `Analyze this fantasy football trade for a ${format} league with PPR scoring.\n\nGIVING UP: ${giving}\nRECEIVING: ${getting}\n\nRespond with JSON exactly like this format and no markdown:\n{\n  \"receiveGrade\": \"B+\",\n  \"giveGrade\": \"C+\",\n  \"verdict\": \"One sentence verdict.\",\n  \"analysis\": \"2-3 sentence analysis.\",\n  \"accept\": true,\n  \"tags\": [{\"label\":\"PPR advantage\",\"color\":\"sage\"}]\n}\n\nUse color options: sage, gold, amber, rose, ocean, mauve.`;
    const response = await askAI(prompt, 550);
    const text = response?.replace(/```json|```/g, '').trim() || '{}';
    const parsed = JSON.parse(text);
    const colorMap: Record<string, string> = {
      sage: C.mint,
      gold: C.gold,
      amber: C.amber,
      rose: '#a83040',
      ocean: C.blueDeep,
      mauve: C.mauve,
    };
    parsed.tags = (parsed.tags ?? []).map((tag: any) => ({ label: tag.label, color: colorMap[tag.color] ?? C.mint }));
    return parsed;
  } catch (error) {
    return {
      receiveGrade: 'B+',
      giveGrade: 'C+',
      verdict: 'Analysis timed out. Try again.',
      analysis: 'Unable to complete analysis. Tap Analyze Again to retry.',
      accept: true,
      tags: [{ label: 'Retry needed', color: C.amber }],
    };
  }
}

export default function TradesScreen() {
  const insets = useSafeAreaInsets();
  const [format, setFormat] = useState<Format>('redraft');
  const [giving, setGiving] = useState('');
  const [getting, setGetting] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TradeResult | null>(null);

  const canAnalyze = giving.trim().length > 0 && getting.trim().length > 0;

  const analyze = async () => {
    if (!canAnalyze || loading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true);
    setResult(null);
    const r = await analyzeTrade(giving, getting, format);
    setResult(r);
    setLoading(false);
    Haptics.notificationAsync(
      r.accept ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning,
    );
  };

  return (
    <LinearGradient colors={[C.bgTop, C.bgBot]} style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: SP[3], paddingBottom: 80 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.eyebrow}>TRADE ANALYZER</Text>
        <Text style={styles.headline}>A–F grade for every trade.</Text>

        <View style={styles.toggle}>
          {(['redraft', 'dynasty'] as Format[]).map(item => (
            <TouchableOpacity
              key={item}
              style={[styles.toggleBtn, format === item && styles.toggleBtnOn]}
              onPress={() => {
                setFormat(item);
                setResult(null);
              }}
            >
              <Text style={[styles.toggleTxt, format === item && styles.toggleTxtOn]}>
                {item === 'redraft' ? '📅 REDRAFT' : '👑 DYNASTY'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.inputCard}>
          <Text style={styles.fieldLbl}>📤 YOU ARE GIVING</Text>
          <TextInput
            value={giving}
            onChangeText={text => {
              setGiving(text);
              setResult(null);
            }}
            placeholder="e.g. CeeDee Lamb"
            placeholderTextColor={C.dim2}
            style={styles.input}
            multiline
          />
        </View>

        <View style={styles.forRow}>
          <View style={styles.divLine} />
          <Text style={styles.forTxt}>FOR</Text>
          <View style={styles.divLine} />
        </View>

        <View style={[styles.inputCard, { marginBottom: 12 }]}> 
          <Text style={styles.fieldLbl}>📥 YOU ARE RECEIVING</Text>
          <TextInput
            value={getting}
            onChangeText={text => {
              setGetting(text);
              setResult(null);
            }}
            placeholder="e.g. Saquon Barkley + T. Lockett"
            placeholderTextColor={C.dim2}
            style={styles.input}
            multiline
          />
        </View>

        {!result && (
          <View style={{ marginBottom: 14 }}>
            <Text style={styles.exLbl}>QUICK EXAMPLES</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {EXAMPLES.map((example, idx) => (
                <TouchableOpacity key={idx} onPress={() => {
                  setGiving(example.give);
                  setGetting(example.get);
                }}>
                  <View style={styles.exCard}>
                    <Text style={styles.exTxt}>{example.give} → {example.get}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        <TouchableOpacity
          style={[styles.analyzeBtn, canAnalyze && styles.analyzeBtnOn]}
          onPress={analyze}
          disabled={!canAnalyze || loading}
          activeOpacity={0.85}
        >
          {loading ? (
            <ActivityIndicator color={C.ink} />
          ) : (
            <Text style={[styles.analyzeTxt, canAnalyze && styles.analyzeTxtOn]}>
              {result ? 'ANALYZE AGAIN' : 'ANALYZE THIS TRADE'}
            </Text>
          )}
        </TouchableOpacity>

        {result && !loading && (
          <View style={styles.resultCard}>
            <View style={styles.resultCardShine} />
            <View style={styles.gradeRow}>
              <View style={[styles.gradeBox, { flex: 1 }]}> 
                <Text style={styles.gradeLbl}>YOU RECEIVE</Text>
                <Text style={[styles.grade, { color: GRADE_COLOR[result.receiveGrade] }]}>{result.receiveGrade}</Text>
              </View>
              <Text style={styles.vs}>VS</Text>
              <View style={[styles.gradeBox, { flex: 1 }]}> 
                <Text style={styles.gradeLbl}>YOU GIVE UP</Text>
                <Text style={[styles.grade, { color: GRADE_COLOR[result.giveGrade] }]}>{result.giveGrade}</Text>
              </View>
            </View>
            <Text style={styles.analysis}>{result.analysis}</Text>
            <View style={styles.tags}>
              {result.tags.map((tag, idx) => (
                <View key={idx} style={[styles.tag, { backgroundColor: tag.color + '18', borderColor: tag.color + '40' }]}>
                  <Text style={[styles.tagTxt, { color: tag.color }]}>{tag.label}</Text>
                </View>
              ))}
            </View>
            <View style={[styles.verdict, { borderLeftColor: result.accept ? C.mint : '#a83040', backgroundColor: (result.accept ? C.mint : '#a83040') + '12' }]}>
              <Text style={[styles.verdictEye, { color: result.accept ? C.mint : '#a83040' }]}>VERDICT</Text>
              <Text style={styles.verdictTxt}>{result.verdict}</Text>
            </View>
            <TouchableOpacity
              style={[styles.cta, { backgroundColor: result.accept ? C.blueDeep : '#a83040' }]}
              activeOpacity={0.85}
              onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)}
            >
              <Text style={styles.ctaTxt}>{result.accept ? '✓ ACCEPT' : '✕ DECLINE'}</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  eyebrow: {
    color: C.blueDeep,
    fontFamily: F.mono,
    fontSize: SZ.sm,
    letterSpacing: 2,
    marginBottom: 6,
  },
  headline: {
    color: C.ink,
    fontFamily: F.bold,
    fontSize: SZ['3xl'] - 2,
    lineHeight: 36,
    marginBottom: 22,
  },
  toggle: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1.5,
    borderColor: 'rgba(88,131,191,0.34)',
    marginBottom: 16,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  toggleBtnOn: {
    backgroundColor: "#ffffff",
    shadowColor: '#3d6aaa',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  toggleTxt: {
    fontFamily: F.mono,
    fontSize: SZ.xs,
    color: C.dim2,
  },
  toggleTxtOn: {
    color: C.ink,
    fontFamily: F.bold,
  },
  inputCard: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: 'rgba(88,131,191,0.18)',
    padding: 16,
    marginBottom: 12,
  },
  fieldLbl: {
    color: C.dim2,
    fontFamily: F.mono,
    fontSize: SZ.xs,
    letterSpacing: 1,
    marginBottom: 10,
  },
  input: {
    minHeight: 110,
    color: C.ink,
    fontFamily: F.mono,
    fontSize: SZ.sm,
    lineHeight: 20,
  },
  forRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: 10,
  },
  divLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(88,131,191,0.28)',
  },
  forTxt: {
    color: C.dim2,
    fontFamily: F.bold,
    fontSize: SZ.sm,
    letterSpacing: 1.5,
  },
  exLbl: {
    color: C.dim2,
    fontFamily: F.mono,
    fontSize: SZ.xs,
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  exCard: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(88,131,191,0.18)',
    marginRight: 8,
  },
  exTxt: {
    color: C.ink,
    fontFamily: F.mono,
    fontSize: SZ.sm,
  },
  analyzeBtn: {
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(88,131,191,0.24)',
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  analyzeBtnOn: {
    backgroundColor: C.blueDeep,
    borderColor: C.blueDeep,
  },
  analyzeTxt: {
    color: C.dim2,
    fontFamily: F.bold,
    fontSize: SZ.base,
  },
  analyzeTxtOn: {
    color: "#ffffff",
  },
  resultCard: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1.5,
    borderColor: 'rgba(88,131,191,0.18)',
    marginTop: 18,
  },
  resultCardShine: {
    position: 'absolute',
    top: 0,
    left: '10%',
    right: '10%',
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 2,
  },
  gradeRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  gradeBox: {
    backgroundColor: 'rgba(217,253,243,0.8)',
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
  },
  gradeLbl: {
    color: C.dim2,
    fontSize: SZ.xs,
    fontFamily: F.mono,
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  grade: {
    fontSize: SZ.hero,
    fontFamily: F.bold,
  },
  vs: {
    color: C.dim2,
    fontFamily: F.bold,
    fontSize: SZ.sm,
    alignSelf: 'center',
  },
  analysis: {
    color: C.ink,
    fontSize: SZ.sm,
    lineHeight: 22,
    marginBottom: 12,
    fontFamily: F.mono,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  tag: {
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
  },
  tagTxt: {
    fontFamily: F.mono,
    fontSize: SZ.xs,
  },
  verdict: {
    borderLeftWidth: 4,
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
  },
  verdictEye: {
    color: C.dim2,
    fontSize: SZ.xs,
    fontFamily: F.mono,
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  verdictTxt: {
    color: C.ink,
    fontFamily: F.bold,
    fontSize: SZ.sm,
  },
  cta: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  ctaTxt: {
    color: "#ffffff",
    fontFamily: F.bold,
    fontSize: SZ.base,
    letterSpacing: 1,
  },
});
