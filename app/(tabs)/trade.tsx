import { askAI } from "../../services/ai";
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useState } from 'react';
import {
  ActivityIndicator, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassCard, SurfaceCard } from '../components/GlassCard';
import { C, F, R, SP, SZ, shadow } from '../constants/tokens';


type Format = 'redraft' | 'dynasty';
type Grade  = 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D+' | 'D' | 'F';

const GRADE_COLOR: Record<string, string> = {
  'A+': C.sage, 'A': C.sage,  'A-': C.sage,
  'B+': C.gold, 'B': C.gold,  'B-': C.gold,
  'C+': C.amber,'C': C.amber, 'C-': C.amber,
  'D+': C.rose, 'D': C.rose,  'F':  C.rose,
};

interface TradeResult {
  receiveGrade: Grade;
  giveGrade:    Grade;
  verdict:      string;
  tags:         { label: string; color: string }[];
  accept:       boolean;
  analysis:     string;
}

async function analyzeTrade(giving: string, getting: string, format: Format): Promise<TradeResult> {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 15000);
  try {
    const prompt = `Analyze this fantasy football trade for a ${format} league with PPR scoring:

GIVING UP: ${giving}
RECEIVING: ${getting}

Respond ONLY with valid JSON, no markdown, no backticks:
{
  "receiveGrade": "B+",
  "giveGrade": "C+",
  "verdict": "One sentence verdict.",
  "analysis": "2-3 sentence analysis of the trade value.",
  "accept": true,
  "tags": [
    {"label": "PPR advantage", "color": "sage"},
    {"label": "Depth upgrade", "color": "ocean"}
  ]
}

Grade scale: A+ (massive win) to F (never do this). Color options: sage, gold, amber, rose, ocean, mauve.`;

    clearTimeout(timeout);
    const text   = await askAI(prompt, 600) || '{}';
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    const colorMap: Record<string, string> = { sage: C.sage, gold: C.gold, amber: C.amber, rose: C.rose, ocean: C.ocean, mauve: C.mauve };
    parsed.tags = (parsed.tags ?? []).map((t: any) => ({ label: t.label, color: colorMap[t.color] ?? C.sage }));
    return parsed;
  } catch (e: any) {
    clearTimeout(timeout);
    console.log('analyzeTrade error:', e);
    return {
      receiveGrade: 'B+', giveGrade: 'C+',
      verdict:  'Analysis timed out. Check your connection and try again.',
      analysis: 'Could not complete analysis. Tap Analyze Again to retry.',
      accept:   true,
      tags:     [{ label: 'Retry needed', color: C.amber }],
    };
  }
}

const EXAMPLES = [
  { give: 'CeeDee Lamb',      get: 'Saquon Barkley + T.Lockett' },
  { give: 'Josh Allen + RB2', get: 'Lamar + WR2'                },
  { give: 'Justin Jefferson', get: "Ja'Marr Chase + TE1"        },
];

export default function TradesScreen() {
  const insets = useSafeAreaInsets();
  const [format,  setFormat]  = useState<Format>('redraft');
  const [giving,  setGiving]  = useState('');
  const [getting, setGetting] = useState('');
  const [loading, setLoading] = useState(false);
  const [result,  setResult]  = useState<TradeResult | null>(null);

  const analyze = async () => {
    if (!giving.trim() || !getting.trim() || loading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true);
    setResult(null);
    const r = await analyzeTrade(giving, getting, format);
    setResult(r);
    setLoading(false);
    Haptics.notificationAsync(r.accept ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning);
  };

  const canAnalyze = giving.trim() && getting.trim();

  return (
    <LinearGradient colors={[C.bgTop, C.bgBot]} style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Title ── */}
        <View style={styles.titleWrap}>
          <Text style={styles.eyebrow}>TRADE ANALYZER</Text>
          <Text style={styles.headline}>A–F Grade{'\n'}on any trade.</Text>
        </View>

        {/* ── Format toggle ── */}
        <View style={styles.toggle}>
          {(['redraft','dynasty'] as Format[]).map(f => (
            <TouchableOpacity
              key={f}
              style={[styles.toggleBtn, format === f && styles.toggleBtnOn]}
              onPress={() => { setFormat(f); setResult(null); }}
            >
              <Text style={[styles.toggleTxt, format === f && styles.toggleTxtOn]}>
                {f === 'redraft' ? '📅 REDRAFT' : '👑 DYNASTY'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Giving ── */}
        <GlassCard style={styles.mb8} padding={12}>
          <Text style={styles.fieldLbl}>📤  YOU ARE GIVING</Text>
          <TextInput
            value={giving}
            onChangeText={v => { setGiving(v); setResult(null); }}
            placeholder="e.g. CeeDee Lamb"
            placeholderTextColor="rgba(255,255,255,0.35)"
            style={styles.input}
          />
        </GlassCard>

        {/* ── FOR divider ── */}
        <View style={styles.forRow}>
          <View style={styles.divLine} />
          <Text style={styles.forTxt}>FOR</Text>
          <View style={styles.divLine} />
        </View>

        {/* ── Getting ── */}
        <GlassCard style={styles.mb14} padding={12}>
          <Text style={styles.fieldLbl}>📥  YOU ARE GETTING</Text>
          <TextInput
            value={getting}
            onChangeText={v => { setGetting(v); setResult(null); }}
            placeholder="e.g. Saquon Barkley + T.Lockett"
            placeholderTextColor="rgba(255,255,255,0.35)"
            style={styles.input}
          />
        </GlassCard>

        {/* ── Examples ── */}
        {!result && (
          <View style={styles.mb14}>
            <Text style={styles.exLbl}>QUICK EXAMPLES</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7 }}>
              {EXAMPLES.map((e, i) => (
                <TouchableOpacity key={i} onPress={() => { setGiving(e.give); setGetting(e.get); }}>
                  <GlassCard padding={8} radius={12}>
                    <Text style={styles.exTxt}>{e.give} → {e.get}</Text>
                  </GlassCard>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* ── Analyze button ── */}
        <TouchableOpacity
          style={[styles.analyzeBtn, canAnalyze && styles.analyzeBtnOn]}
          onPress={analyze}
          disabled={!canAnalyze || loading}
          activeOpacity={0.8}
        >
          {loading
            ? <ActivityIndicator color="#2a2010" />
            : <Text style={[styles.analyzeTxt, canAnalyze && styles.analyzeTxtOn]}>
                {result ? 'ANALYZE AGAIN' : 'ANALYZE THIS TRADE'}
              </Text>}
        </TouchableOpacity>

        {/* ── Result ── */}
        {result && !loading && (
          <GlassCard style={{ marginTop: 14 }} padding={14}>
            {/* Grade pair */}
            <View style={styles.gradeRow}>
              <SurfaceCard style={{ flex: 1 }} padding={13}>
                <Text style={styles.gradeLbl}>YOU RECEIVE</Text>
                <Text style={[styles.grade, { color: GRADE_COLOR[result.receiveGrade] ?? C.sage }]}>
                  {result.receiveGrade}
                </Text>
              </SurfaceCard>
              <Text style={styles.vs}>VS</Text>
              <SurfaceCard style={{ flex: 1 }} padding={13}>
                <Text style={styles.gradeLbl}>YOU GIVE UP</Text>
                <Text style={[styles.grade, { color: GRADE_COLOR[result.giveGrade] ?? C.amber }]}>
                  {result.giveGrade}
                </Text>
              </SurfaceCard>
            </View>

            <Text style={styles.analysis}>{result.analysis}</Text>

            <View style={styles.tags}>
              {result.tags.map((t, i) => (
                <View key={i} style={[styles.tag, { backgroundColor: t.color + '22', borderColor: t.color + '44' }]}>
                  <Text style={[styles.tagTxt, { color: t.color }]}>{t.label}</Text>
                </View>
              ))}
            </View>

            <View style={[styles.verdict, { borderLeftColor: result.accept ? C.sage : C.rose, backgroundColor: (result.accept ? C.sage : C.rose) + '18' }]}>
              <Text style={[styles.verdictEye, { color: result.accept ? C.sage : C.rose }]}>VERDICT</Text>
              <Text style={styles.verdictTxt}>{result.verdict}</Text>
            </View>

            <TouchableOpacity
              style={[styles.cta, { backgroundColor: result.accept ? C.sage : C.rose }]}
              onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)}
              activeOpacity={0.85}
            >
              <Text style={styles.ctaTxt}>{result.accept ? '✓  ACCEPT' : '✕  DECLINE'}</Text>
            </TouchableOpacity>
          </GlassCard>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  scroll:       { paddingHorizontal: SP[3], paddingBottom: 100 },
  titleWrap:    { marginBottom: 16 },
  eyebrow:      { fontSize: SZ.sm + 1, fontFamily: F.mono, color: C.gold, letterSpacing: 3, marginBottom: 5 },
  headline:     { fontSize: SZ['3xl'] - 2, fontWeight: '900', color: C.ink, letterSpacing: -0.8, lineHeight: 28, fontFamily: F.black },
  toggle:       { flexDirection: 'row', padding: 3, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.10)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', marginBottom: 12 },
  toggleBtn:    { flex: 1, paddingVertical: 7, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: 'transparent' },
  toggleBtnOn:  { backgroundColor: 'rgba(255,255,255,0.18)', borderColor: 'rgba(255,255,255,0.20)' },
  toggleTxt:    { fontSize: SZ.xs - 1, fontFamily: F.mono, color: C.dim },
  toggleTxtOn:  { color: C.ink, fontWeight: '700' },
  mb8:          { marginBottom: 8 },
  mb14:         { marginBottom: 14 },
  fieldLbl:     { fontSize: SZ.xs - 1, fontFamily: F.mono, color: C.dim, letterSpacing: 2, marginBottom: 7 },
  input:        { backgroundColor: 'rgba(255,255,255,0.10)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', borderRadius: 10, padding: 10, fontSize: SZ.base, color: C.ink, fontFamily: F.outfit },
  forRow:       { flexDirection: 'row', alignItems: 'center', gap: 9, marginVertical: 5 },
  divLine:      { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.12)' },
  forTxt:       { fontSize: SZ.sm + 1, fontWeight: '700', color: C.dim, fontFamily: F.mono, letterSpacing: 2 },
  exLbl:        { fontSize: SZ.xs - 1, fontFamily: F.mono, color: C.dim, letterSpacing: 2, marginBottom: 8 },
  exTxt:        { fontSize: SZ.sm + 1, color: C.ink2, fontFamily: F.outfit },
  analyzeBtn:   { backgroundColor: 'rgba(200,168,75,0.18)', borderRadius: R.md, padding: 17, alignItems: 'center' },
  analyzeBtnOn: { backgroundColor: C.gold, ...shadow.glow(C.gold) },
  analyzeTxt:   { fontSize: SZ.lg + 2, fontWeight: '800', color: C.dim, letterSpacing: 0.5, fontFamily: F.extrabold },
  analyzeTxtOn: { color: '#2a2010' },
  gradeRow:     { flexDirection: 'row', gap: 9, alignItems: 'center', marginBottom: 12 },
  gradeLbl:     { fontSize: SZ.xs - 2, fontFamily: F.mono, color: C.dim, letterSpacing: 1, textAlign: 'center', marginBottom: 5 },
  grade:        { fontSize: SZ.hero + 2, fontWeight: '900', lineHeight: 48, textAlign: 'center', fontFamily: F.black },
  vs:           { fontSize: SZ.md, fontWeight: '700', color: C.dim, fontFamily: F.mono },
  analysis:     { fontSize: SZ.md, color: C.ink2, lineHeight: 17, marginBottom: 10, fontFamily: F.outfit },
  tags:         { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 10 },
  tag:          { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 20, borderWidth: 1 },
  tagTxt:       { fontSize: SZ.xs - 1, fontFamily: F.mono },
  verdict:      { borderLeftWidth: 2, borderRadius: 10, padding: 11, marginBottom: 10 },
  verdictEye:   { fontSize: SZ.xs - 2, fontFamily: F.mono, letterSpacing: 1, marginBottom: 2 },
  verdictTxt:   { fontSize: SZ.base - 1, fontWeight: '700', color: C.ink, fontFamily: F.bold },
  cta:          { borderRadius: 12, padding: 14, alignItems: 'center' },
  ctaTxt:       { fontSize: SZ.lg, fontWeight: '900', color: '#fff', letterSpacing: 2, fontFamily: F.black },
});