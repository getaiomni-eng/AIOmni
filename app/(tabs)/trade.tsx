import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { askAI } from "../../services/ai";
import { C, F, R, SP, SZ, shadow } from '../constants/tokens';

type Format = 'redraft' | 'dynasty';
type Grade  = 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D+' | 'D' | 'F';

const SURFACE  = 'rgba(255,255,255,0.90)';
const BORDER   = 'rgba(88,131,191,0.32)';
const BEVEL_HI = 'rgba(255,255,255,0.95)';

const GRADE_COLOR: Record<string, string> = {
  'A+': C.mint, 'A': C.mint,  'A-': C.mint,
  'B+': C.gold, 'B': C.gold,  'B-': C.gold,
  'C+': C.amber,'C': C.amber, 'C-': C.amber,
  'D+': '#a83040','D':'#a83040','F':'#a83040',
};

interface TradeResult {
  receiveGrade: Grade; giveGrade: Grade;
  verdict: string; tags: { label: string; color: string }[];
  accept: boolean; analysis: string;
}

async function analyzeTrade(giving: string, getting: string, format: Format): Promise<TradeResult> {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 15000);
  try {
    const prompt = `Analyze this fantasy football trade for a ${format} league with PPR scoring:\n\nGIVING UP: ${giving}\nRECEIVING: ${getting}\n\nRespond ONLY with valid JSON, no markdown, no backticks:\n{\n  "receiveGrade": "B+",\n  "giveGrade": "C+",\n  "verdict": "One sentence verdict.",\n  "analysis": "2-3 sentence analysis.",\n  "accept": true,\n  "tags": [{"label":"PPR advantage","color":"sage"}]\n}\n\nGrade scale A+ to F. Color options: sage, gold, amber, rose, ocean, mauve.`;
    clearTimeout(timeout);
    const text   = await askAI(prompt, 600) || '{}';
    const parsed = JSON.parse(text.replace(/```json|```/g,'').trim());
    const colorMap: Record<string,string> = { sage:C.mint, gold:C.gold, amber:C.amber, rose:'#a83040', ocean:C.blueDeep, mauve:C.mauve };
    parsed.tags = (parsed.tags ?? []).map((t: any) => ({ label:t.label, color:colorMap[t.color] ?? C.mint }));
    return parsed;
  } catch (e: any) {
    clearTimeout(timeout);
    return { receiveGrade:'B+', giveGrade:'C+', verdict:'Analysis timed out. Try again.', analysis:'Could not complete analysis. Tap Analyze Again to retry.', accept:true, tags:[{label:'Retry needed',color:C.amber}] };
  }
}

const EXAMPLES = [
  { give:'CeeDee Lamb',      get:'Saquon Barkley + T.Lockett' },
  { give:'Josh Allen + RB2', get:'Lamar + WR2'                },
  { give:'Justin Jefferson', get:"Ja'Marr Chase + TE1"        },
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
    setLoading(true); setResult(null);
    const r = await analyzeTrade(giving, getting, format);
    setResult(r); setLoading(false);
    Haptics.notificationAsync(r.accept ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning);
  };

  const canAnalyze = giving.trim() && getting.trim();

  return (
    <LinearGradient colors={[C.bgTop, C.bgBot]} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16 }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        <View style={styles.titleWrap}>
          <Text style={styles.eyebrow}>TRADE ANALYZER</Text>
          <Text style={styles.headline}>A–F Grade{'\n'}on any trade.</Text>
        </View>

        {/* Format toggle */}
        <View style={styles.toggle}>
          {(['redraft','dynasty'] as Format[]).map(f => (
            <TouchableOpacity key={f} style={[styles.toggleBtn, format === f && styles.toggleBtnOn]} onPress={() => { setFormat(f); setResult(null); }}>
              <Text style={[styles.toggleTxt, format === f && styles.toggleTxtOn]}>{f === 'redraft' ? '📅 REDRAFT' : '👑 DYNASTY'}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Giving */}
        <View style={styles.inputCard}>
          <View style={styles.inputCardShine} />
          <Text style={styles.fieldLbl}>📤  YOU ARE GIVING</Text>
          <TextInput value={giving} onChangeText={v => { setGiving(v); setResult(null); }} placeholder="e.g. CeeDee Lamb" placeholderTextColor={C.dim2} style={styles.input} />
        </View>

        <View style={styles.forRow}>
          <View style={styles.divLine} />
          <Text style={styles.forTxt}>FOR</Text>
          <View style={styles.divLine} />
        </View>

        {/* Getting */}
        <View style={[styles.inputCard, { marginBottom: 14 }]}>
          <View style={styles.inputCardShine} />
          <Text style={styles.fieldLbl}>📥  YOU ARE GETTING</Text>
          <TextInput value={getting} onChangeText={v => { setGetting(v); setResult(null); }} placeholder="e.g. Saquon Barkley + T.Lockett" placeholderTextColor={C.dim2} style={styles.input} />
        </View>

        {/* Examples */}
        {!result && (
          <View style={{ marginBottom: 14 }}>
            <Text style={styles.exLbl}>QUICK EXAMPLES</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7 }}>
              {EXAMPLES.map((e, i) => (
                <TouchableOpacity key={i} onPress={() => { setGiving(e.give); setGetting(e.get); }}>
                  <View style={styles.exCard}><Text style={styles.exTxt}>{e.give} → {e.get}</Text></View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Analyze button */}
        <TouchableOpacity style={[styles.analyzeBtn, canAnalyze && styles.analyzeBtnOn]} onPress={analyze} disabled={!canAnalyze || loading} activeOpacity={0.8}>
          {loading
            ? <ActivityIndicator color={C.ink} />
            : <Text style={[styles.analyzeTxt, canAnalyze && styles.analyzeTxtOn]}>{result ? 'ANALYZE AGAIN' : 'ANALYZE THIS TRADE'}</Text>}
        </TouchableOpacity>

        {/* Result */}
        {result && !loading && (
          <View style={[styles.resultCard, { marginTop: 14 }]}>
            <View style={styles.resultCardShine} />
            <View style={styles.gradeRow}>
              <View style={[styles.gradeBox, { flex:1 }]}>
                <Text style={styles.gradeLbl}>YOU RECEIVE</Text>
                <Text style={[styles.grade, { color: GRADE_COLOR[result.receiveGrade] ?? C.mint }]}>{result.receiveGrade}</Text>
              </View>
              <Text style={styles.vs}>VS</Text>
              <View style={[styles.gradeBox, { flex:1 }]}>
                <Text style={styles.gradeLbl}>YOU GIVE UP</Text>
                <Text style={[styles.grade, { color: GRADE_COLOR[result.giveGrade] ?? C.amber }]}>{result.giveGrade}</Text>
              </View>
            </View>
            <Text style={styles.analysis}>{result.analysis}</Text>
            <View style={styles.tags}>
              {result.tags.map((t, i) => (
                <View key={i} style={[styles.tag, { backgroundColor:t.color+'18', borderColor:t.color+'44' }]}>
                  <Text style={[styles.tagTxt, { color:t.color }]}>{t.label}</Text>
                </View>
              ))}
            </View>
            <View style={[styles.verdict, { borderLeftColor: result.accept ? C.mint : '#a83040', backgroundColor: (result.accept ? C.mint : '#a83040') + '10' }]}>
              <Text style={[styles.verdictEye, { color: result.accept ? C.mint : '#a83040' }]}>VERDICT</Text>
              <Text style={styles.verdictTxt}>{result.verdict}</Text>
            </View>
            <TouchableOpacity style={[styles.cta, { backgroundColor: result.accept ? C.blueDeep : '#a83040' }]} onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)} activeOpacity={0.85}>
              <Text style={styles.ctaTxt}>{result.accept ? '✓  ACCEPT' : '✕  DECLINE'}</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  scroll:    { paddingHorizontal:SP[3], paddingBottom:100 },
  titleWrap: { marginBottom:16 },
  eyebrow:   { fontSize:SZ.sm+1, fontFamily:F.mono, color:C.blueDeep, letterSpacing:3, marginBottom:5 },
  headline:  { fontSize:SZ['3xl']-2, fontFamily:F.bold, color:C.ink, letterSpacing:-0.8, lineHeight:28 },

  toggle:      { flexDirection:'row', padding:3, borderRadius:13, backgroundColor:SURFACE, borderWidth:1.5, borderColor:BORDER, marginBottom:12 },
  toggleBtn:   { flex:1, paddingVertical:7, borderRadius:10, alignItems:'center', borderWidth:1, borderColor:'transparent' },
  toggleBtnOn: { backgroundColor:C.sageS, borderColor:BORDER },
  toggleTxt:   { fontSize:SZ.xs-1, fontFamily:F.mono, color:C.dim2 },
  toggleTxtOn: { color:C.blueDeep, fontFamily:F.bold },

  inputCard: {
    backgroundColor:SURFACE, borderWidth:1.5, borderColor:BORDER,
    borderRadius:14, padding:12, marginBottom:8, position:'relative', overflow:'hidden',
    shadowColor:'#3d6aaa', shadowOffset:{width:0,height:2}, shadowOpacity:0.08, shadowRadius:8, elevation:3,
  },
  inputCardShine: { position:'absolute', top:0, left:'8%', right:'8%', height:1.5, backgroundColor:BEVEL_HI, zIndex:6 },
  fieldLbl: { fontSize:SZ.xs-1, fontFamily:F.mono, color:C.dim2, letterSpacing:2, marginBottom:7 },
  input:    { backgroundColor:'rgba(88,131,191,0.06)', borderWidth:1.5, borderColor:BORDER, borderRadius:10, padding:10, fontSize:SZ.base, color:C.ink, fontFamily:F.mono },

  forRow:  { flexDirection:'row', alignItems:'center', gap:9, marginVertical:5 },
  divLine: { flex:1, height:1, backgroundColor:BORDER },
  forTxt:  { fontSize:SZ.sm+1, fontFamily:F.bold, color:C.dim2, letterSpacing:2 },

  exLbl:  { fontSize:SZ.xs-1, fontFamily:F.mono, color:C.dim2, letterSpacing:2, marginBottom:8 },
  exCard: { backgroundColor:SURFACE, borderWidth:1.5, borderColor:BORDER, borderRadius:12, padding:10, shadowColor:'#3d6aaa', shadowOffset:{width:0,height:1}, shadowOpacity:0.06, shadowRadius:4, elevation:2 },
  exTxt:  { fontSize:SZ.sm+1, color:C.ink, fontFamily:F.mono },

  analyzeBtn:   { backgroundColor:C.sageS, borderWidth:1.5, borderColor:BORDER, borderRadius:R.md, padding:17, alignItems:'center' },
  analyzeBtnOn: { backgroundColor:C.gold, borderColor:C.goldBorder, ...shadow.glow(C.gold,14,0.35) },
  analyzeTxt:   { fontSize:SZ.lg+2, fontFamily:F.bold, color:C.dim2, letterSpacing:0.5 },
  analyzeTxtOn: { color:C.ink },

  resultCard: {
    backgroundColor:SURFACE, borderWidth:1.5, borderColor:BORDER,
    borderRadius:14, padding:14, position:'relative', overflow:'hidden',
    shadowColor:'#3d6aaa', shadowOffset:{width:0,height:4}, shadowOpacity:0.1, shadowRadius:14, elevation:4,
  },
  resultCardShine: { position:'absolute', top:0, left:'8%', right:'8%', height:1.5, backgroundColor:BEVEL_HI, zIndex:6 },

  gradeRow:  { flexDirection:'row', gap:9, alignItems:'center', marginBottom:12 },
  gradeBox:  { backgroundColor:C.sageS, borderRadius:12, padding:13, alignItems:'center', borderWidth:1, borderColor:BORDER },
  gradeLbl:  { fontSize:SZ.xs-2, fontFamily:F.mono, color:C.dim2, letterSpacing:1, textAlign:'center', marginBottom:5 },
  grade:     { fontSize:SZ.hero+2, fontFamily:F.bold, lineHeight:48, textAlign:'center' },
  vs:        { fontSize:SZ.md, fontFamily:F.bold, color:C.dim2 },

  analysis: { fontSize:SZ.md, color:C.ink, lineHeight:17, marginBottom:10, fontFamily:F.mono },
  tags:     { flexDirection:'row', gap:6, flexWrap:'wrap', marginBottom:10 },
  tag:      { paddingHorizontal:9, paddingVertical:3, borderRadius:20, borderWidth:1 },
  tagTxt:   { fontSize:SZ.xs-1, fontFamily:F.mono },
  verdict:  { borderLeftWidth:2, borderRadius:10, padding:11, marginBottom:10 },
  verdictEye:{ fontSize:SZ.xs-2, fontFamily:F.mono, letterSpacing:1, marginBottom:2 },
  verdictTxt:{ fontSize:SZ.base-1, fontFamily:F.bold, color:C.ink },
  cta:       { borderRadius:12, padding:14, alignItems:'center' },
  ctaTxt:    { fontSize:SZ.lg, fontFamily:F.bold, color:'#ffffff', letterSpacing:2 },
});