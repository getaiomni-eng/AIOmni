import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';

import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { askAI } from '../../services/ai';
import { getCurrentTier } from '../../services/purchases';
import { consumePrompt } from '../utils/promptCounter';
import { C, F, R, SP, SZ } from '../constants/tokens';
import { Icon } from '../components/AIOmniIcons';

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
  'A+': '#1e8c42',
  A: '#1e8c42',
  'A-': '#1e8c42',
  'B+': '#ffb800',
  B: '#ffb800',
  'B-': '#ffb800',
  'C+': '#b87820',
  C: '#b87820',
  'C-': '#b87820',
  'D+': '#a83040',
  D: '#a83040',
  F: '#a83040',
};

const EXAMPLES = [
  { give: 'CeeDee Lamb', get: 'Saquon Barkley + T. Lockett' },
  { give: 'Josh Allen + RB2', get: 'Lamar Jackson + WR2' },
  { give: 'Justin Jefferson', get: "Ja'Marr Chase + TE1" },
];

export default function TradesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [format, setFormat] = useState<Format>('redraft');
  const [giving, setGiving] = useState('');
  const [getting, setGetting] = useState('');
  const [loading, setLoading] = useState(false);
  const [youReceiveGrade, setYouReceiveGrade] = useState<Grade>('B+');
  const [youGiveGrade, setYouGiveGrade] = useState<Grade>('C+');
  const [verdict, setVerdict] = useState('');
  const [analysis, setAnalysis] = useState('');

  const analyzeTrade = async () => {
    // Charge a prompt up front; if over cap, route to paywall and bail.
    const ok = await consumePrompt();
    if (!ok) {
      const tier = await getCurrentTier();
      const ctx = tier === 'free' ? 'free_prompts_exhausted' : 'weekly_prompts_exhausted';
      router.push(`/paywall?context=${ctx}` as any);
      return;
    }
    try {
      const prompt = `You are AIOmni, expert fantasy football trade analyst.
Format: ${format.toUpperCase()}

YOU ARE GIVING UP:
${giving}

YOU ARE RECEIVING:
${getting}

Grade EACH side of the trade on an A+ to F scale based on ${format === 'dynasty' ? 'dynasty value (age, contract, future production)' : 'rest-of-season value for redraft'}.
Consider: positional value, injury status, depth chart, schedule, ${format === 'dynasty' ? 'age curves and rookie contracts' : 'weekly upside and floor'}.

Respond with ONLY a valid JSON object, no markdown, no code fences. Use this exact shape:
{"youReceiveGrade": "<letter grade>", "youGiveGrade": "<letter grade>", "verdict": "<accept/decline/consider in one short sentence>", "analysis": "<2-3 sentences explaining the grades, who wins, and why>"}`;
      const response = await askAI(prompt, 550);
      console.log('Raw AI response:', response);
      // Strip code fences and any pre/post text before the JSON
      let clean = response.replace(/```json|```/g, '').trim();
      const jsonStart = clean.indexOf('{');
      const jsonEnd = clean.lastIndexOf('}');
      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        clean = clean.slice(jsonStart, jsonEnd + 1);
      }
      try {
        const parsed = JSON.parse(clean);
        setYouReceiveGrade(parsed.youReceiveGrade);
        setYouGiveGrade(parsed.youGiveGrade);
        setVerdict(parsed.verdict);
        setAnalysis(parsed.analysis);
      } catch(e) {
        console.log('Parse error:', e);
        setVerdict('Could not parse response. Try again.');
        setAnalysis(response.slice(0, 300));
      }
    } catch (error) {
      setVerdict('Analysis timed out. Try again.');
      setAnalysis('Unable to complete analysis. Tap Analyze Again to retry.');
    }
  };

  const canAnalyze = giving.trim().length > 0 && getting.trim().length > 0;

  const analyze = async () => {
    if (!canAnalyze || loading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true);
    setVerdict('');
    setAnalysis('');
    await analyzeTrade();
    setLoading(false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#0a1214' }}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: SP[3], paddingBottom: insets.bottom + 16 }}
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
              onPress={() => setFormat(item)}
            >
              <View style={{flexDirection:'row', alignItems:'center', gap:4}}>
                {item === 'redraft' ? (
                  <Icon name="calendar" size={16} color={format === item ? '#ffffff' : C.blueDeep} />
                ) : (
                  <Icon name="crown" size={16} color={format === item ? '#ffffff' : C.gold} />
                )}
                <Text style={[styles.toggleTxt, format === item && styles.toggleTxtOn]}>
                  {item === 'redraft' ? 'REDRAFT' : 'DYNASTY'}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.inputCard}>
          <Text style={styles.fieldLbl}>YOU ARE GIVING</Text>
          <TextInput
            value={giving}
            onChangeText={text => setGiving(text)}
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
          <Text style={styles.fieldLbl}>YOU ARE RECEIVING</Text>
          <TextInput
            value={getting}
            onChangeText={text => setGetting(text)}
            placeholder="e.g. Saquon Barkley + T. Lockett"
            placeholderTextColor={C.dim2}
            style={styles.input}
            multiline
          />
        </View>

        {!verdict && (
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
              {verdict ? 'ANALYZE AGAIN' : 'ANALYZE THIS TRADE'}
            </Text>
          )}
        </TouchableOpacity>

        {verdict && !loading && (
          <View style={styles.resultCard}>
            <View style={styles.resultCardShine} />
            <View style={styles.gradeRow}>
              <View style={[styles.gradeBox, { flex: 1 }]}> 
                <Text style={styles.gradeLbl}>YOU RECEIVE</Text>
                <Text style={[styles.grade, { color: GRADE_COLOR[youReceiveGrade] }]}>{youReceiveGrade}</Text>
              </View>
              <Text style={styles.vs}>VS</Text>
              <View style={[styles.gradeBox, { flex: 1 }]}> 
                <Text style={styles.gradeLbl}>YOU GIVE UP</Text>
                <Text style={[styles.grade, { color: GRADE_COLOR[youGiveGrade] }]}>{youGiveGrade}</Text>
              </View>
            </View>
            <Text style={styles.analysis}>{analysis}</Text>
            <Text style={styles.verdict}>{verdict}</Text>
            <View style={styles.ctaRow}>
              {(['A', 'B'].includes(youReceiveGrade[0]) || ['A', 'B'].includes(youGiveGrade[0])) && (
                <TouchableOpacity style={[styles.ctaBtn, styles.acceptBtn]}>
                  <Text style={styles.ctaTxt}>ACCEPT</Text>
                </TouchableOpacity>
              )}
              {(['D', 'F'].includes(youReceiveGrade[0]) || ['D', 'F'].includes(youGiveGrade[0])) && (
                <TouchableOpacity style={[styles.ctaBtn, styles.declineBtn]}>
                  <Text style={styles.ctaTxt}>DECLINE</Text>
                </TouchableOpacity>
              )}
              {(['C'].includes(youReceiveGrade[0]) || ['C'].includes(youGiveGrade[0])) && (
                <>
                  <TouchableOpacity style={[styles.ctaBtn, styles.acceptBtn]}>
                    <Text style={styles.ctaTxt}>ACCEPT</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.ctaBtn, styles.declineBtn]}>
                    <Text style={styles.ctaTxt}>DECLINE</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
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
    color: '#f0f4f5',
    fontFamily: F.bold,
    fontSize: SZ['3xl'] - 2,
    lineHeight: 36,
    marginBottom: 22,
  },
  toggle: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: 16,
    backgroundColor: '#12252e',
    borderWidth: 1.5,
    borderColor: '#1a3542',
    marginBottom: 16,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  toggleBtnOn: {
    backgroundColor: '#1a3542',
    shadowColor: '#1be7ff',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  toggleTxt: { fontFamily: 'Audiowide_400Regular',
    fontSize: SZ.xs,
    color: C.dim2,
  },
  toggleTxtOn: { fontFamily: 'Audiowide_400Regular',
    color: '#f0f4f5',
  },
  inputCard: {
    backgroundColor: '#12252e',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#1a3542',
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
    color: '#f0f4f5',
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
    backgroundColor: '#12252e',
  },
  forTxt: {
    color: C.dim2,
    fontFamily: F.mono,
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
    backgroundColor: '#12252e',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1.5,
    borderColor: '#1a3542',
    marginRight: 8,
  },
  exTxt: {
    color: '#f0f4f5',
    fontFamily: F.mono,
    fontSize: SZ.sm,
  },
  analyzeBtn: {
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(88,131,191,0.24)',
    backgroundColor: '#12252e',
  },
  analyzeBtnOn: {
    backgroundColor: C.blueDeep,
    borderColor: C.blueDeep,
  },
  analyzeText: {
    fontFamily: F.mono,
    fontSize: SZ.sm,
  },
  analyzeTextOn: {
    color: '#ffffff',
    fontFamily: F.mono,
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
    backgroundColor: '#12252e',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1.5,
    borderColor: '#1a3542',
    marginTop: 18,
  },
  resultCardShine: {
    position: 'absolute',
    top: 0,
    left: '10%',
    right: '10%',
    height: 2,
    backgroundColor: '#12252e',
    borderRadius: 2,
  },
  gradeRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  gradeBox: {
    backgroundColor: '#0f1c22',
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
  },
  gradeLbl: {
    color: '#7a9eaa',
    fontSize: SZ.xs,
    fontFamily: F.mono,
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  grade: {
    fontSize: 48,
    fontFamily: F.bold,
  },
  vs: {
    color: C.dim2,
    fontFamily: F.mono,
    fontSize: SZ.sm,
    alignSelf: 'center',
  },
  analysis: {
    color: '#f0f4f5',
    fontSize: SZ.sm,
    lineHeight: 22,
    marginBottom: 12,
    fontFamily: F.outfit,
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
    borderLeftColor: '#ffb800',
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    color: '#ffb800',
    fontFamily: F.bold,
    fontSize: SZ.base,
    lineHeight: 22,
  },
  verdictEye: {
    color: C.dim2,
    fontSize: SZ.xs,
    fontFamily: F.mono,
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  verdictTxt: {
    color: '#f0f4f5',
    fontFamily: F.outfit,
    fontSize: SZ.sm,
  },
  ctaRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  ctaBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  acceptBtn: {
    backgroundColor: C.blueDeep,
  },
  declineBtn: {
    backgroundColor: '#a83040',
  },
  ctaTxt: {
    color: "#ffffff",
    fontFamily: F.mono,
    fontSize: SZ.base,
    letterSpacing: 1,
  },
});
