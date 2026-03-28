import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassCard } from '../components/GlassCard';
import { C, F, SP, SZ } from '../constants/tokens';

const API_KEY = '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';
const DYNASTY_KEYWORDS = ['pick', 'round', '2025', '2026', '2027', '2028', 'first', 'second', 'third', 'future', 'rookie'];
const GRADE_COLORS: Record<string, string> = {
  'A+': C.sage, 'A': C.sage, 'A-': C.sage,
  'B+': '#7ec8e8', 'B': '#7ec8e8', 'B-': '#7ec8e8',
  'C+': C.amber, 'C': C.amber, 'C-': C.amber,
  'D+': '#c87878', 'D': '#c87878', 'D-': '#c87878', 'F': '#c87878',
};
const EXAMPLE_TRADES = [
  { give: 'CeeDee Lamb', get: 'Saquon Barkley + Tyler Lockett' },
  { give: 'Josh Allen + flex', get: 'Lamar Jackson + WR2' },
  { give: 'My 1st round pick', get: 'Davante Adams' },
];

type TradeResult = {
  yourGrade: string; theirGrade: string; verdict: string;
  yourAnalysis: string; theirAnalysis: string; recommendation: string;
};

export default function TradeAnalyzerScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [giving,           setGiving]           = useState('');
  const [getting,          setGetting]          = useState('');
  const [loading,          setLoading]          = useState(false);
  const [result,           setResult]           = useState<TradeResult | null>(null);
  const [showDynastyModal, setShowDynastyModal] = useState(false);
  const [leagueType,       setLeagueType]       = useState<'redraft' | 'dynasty'>('redraft');

  const isDynastyTrade = (text: string) => DYNASTY_KEYWORDS.some(kw => text.toLowerCase().includes(kw));

  const handleAnalyze = async () => {
    if (!giving.trim() || !getting.trim()) return;
    if ((isDynastyTrade(giving) || isDynastyTrade(getting)) && leagueType === 'redraft') {
      setShowDynastyModal(true); return;
    }
    setLoading(true); setResult(null);
    try {
      const prompt = `You are AIOmni, expert fantasy football trade analyst.\n\nAnalyze this trade and respond ONLY with a JSON object:\n{\n  "yourGrade": "B+",\n  "theirGrade": "C",\n  "verdict": "One sentence who wins",\n  "yourAnalysis": "2-3 sentences what user receives",\n  "theirAnalysis": "2-3 sentences what user gives",\n  "recommendation": "ACCEPT or DECLINE or COUNTER — one sentence why"\n}\n\nLeague Type: ${leagueType === 'dynasty' ? 'Dynasty' : 'Redraft'}\nYou are giving: ${giving}\nYou are getting: ${getting}\n\nGrade A+ through F. Return only valid JSON.`;
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 600, messages: [{ role: 'user', content: prompt }] }),
      });
      const data  = await response.json();
      const clean = data.content[0].text.trim().replace(/```json|```/g, '').trim();
      setResult(JSON.parse(clean));
    } catch {
      setResult({ yourGrade: '?', theirGrade: '?', verdict: 'Could not analyze. Try again.', yourAnalysis: '', theirAnalysis: '', recommendation: '' });
    } finally { setLoading(false); }
  };

  const recColor = result?.recommendation?.startsWith('ACCEPT') ? C.sage
    : result?.recommendation?.startsWith('DECLINE') ? '#c87878' : C.amber;

  return (
    <LinearGradient colors={[C.bgTop, C.bgBot]} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 12 }]} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Trade Analyzer</Text>
          <Text style={styles.subtitle}>A–F GRADE ON ANY TRADE</Text>
        </View>

        {/* League type toggle */}
        <View style={styles.toggleRow}>
          <TouchableOpacity
            style={[styles.toggleBtn, leagueType === 'redraft' && { borderColor: C.gold, backgroundColor: C.goldS }]}
            onPress={() => setLeagueType('redraft')}
          >
            <Text style={[styles.toggleText, leagueType === 'redraft' && { color: C.gold }]}>REDRAFT</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleBtn, leagueType === 'dynasty' && { borderColor: C.amber, backgroundColor: 'rgba(224,144,80,0.15)' }]}
            onPress={() => setLeagueType('dynasty')}
          >
            <Text style={[styles.toggleText, leagueType === 'dynasty' && { color: C.amber }]}>DYNASTY</Text>
          </TouchableOpacity>
        </View>

        {/* Inputs */}
        <GlassCard style={styles.inputBlock} padding={16} radius={16}>
          <Text style={styles.inputLabel}>📤 YOU ARE GIVING</Text>
          <TextInput
            style={styles.tradeInput}
            placeholder="e.g. CeeDee Lamb + flex"
            placeholderTextColor="rgba(255,255,255,0.3)"
            value={giving}
            onChangeText={setGiving}
            multiline
          />
        </GlassCard>

        <View style={styles.vsRow}>
          <View style={styles.vsDivider} />
          <Text style={styles.vsText}>FOR</Text>
          <View style={styles.vsDivider} />
        </View>

        <GlassCard style={styles.inputBlock} padding={16} radius={16}>
          <Text style={styles.inputLabel}>📥 YOU ARE GETTING</Text>
          <TextInput
            style={styles.tradeInput}
            placeholder="e.g. Saquon Barkley + WR2"
            placeholderTextColor="rgba(255,255,255,0.3)"
            value={getting}
            onChangeText={setGetting}
            multiline
          />
        </GlassCard>

        {/* Example trades */}
        {!result && !loading && (
          <View style={styles.exampleSection}>
            <Text style={styles.exampleLabel}>TRY AN EXAMPLE</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {EXAMPLE_TRADES.map((ex, i) => (
                <TouchableOpacity key={i} style={styles.exampleChip} onPress={() => { setGiving(ex.give); setGetting(ex.get); }}>
                  <Text style={styles.exampleText}>{ex.give} → {ex.get}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Analyze button */}
        <TouchableOpacity
          style={[styles.analyzeBtn, (!giving.trim() || !getting.trim()) && { opacity: 0.4 }]}
          onPress={handleAnalyze}
          disabled={loading || !giving.trim() || !getting.trim()}
        >
          {loading
            ? <ActivityIndicator color="#1a1208" />
            : <Text style={styles.analyzeBtnText}>ANALYZE THIS TRADE</Text>}
        </TouchableOpacity>

        {/* Result */}
        {result && (
          <View style={styles.resultSection}>
            {/* Grades */}
            <View style={styles.gradeRow}>
              <GlassCard style={[styles.gradeCard, { borderColor: `${GRADE_COLORS[result.yourGrade] || '#fff'}40` }]} padding={16} radius={16}>
                <Text style={styles.gradeLabel}>YOU RECEIVE</Text>
                <Text style={[styles.gradeValue, { color: GRADE_COLORS[result.yourGrade] || C.ink }]}>{result.yourGrade}</Text>
              </GlassCard>
              <Text style={styles.gradeVs}>VS</Text>
              <GlassCard style={[styles.gradeCard, { borderColor: `${GRADE_COLORS[result.theirGrade] || '#fff'}40` }]} padding={16} radius={16}>
                <Text style={styles.gradeLabel}>YOU GIVE UP</Text>
                <Text style={[styles.gradeValue, { color: GRADE_COLORS[result.theirGrade] || C.ink }]}>{result.theirGrade}</Text>
              </GlassCard>
            </View>

            {/* Verdict */}
            <GlassCard style={{ borderLeftWidth: 3, borderLeftColor: C.gold, marginBottom: 12 }} padding={16} radius={14}>
              <Text style={styles.verdictLabel}>◈ VERDICT</Text>
              <Text style={styles.verdictText}>{result.verdict}</Text>
            </GlassCard>

            {/* Analysis */}
            <GlassCard style={{ marginBottom: 8 }} padding={16} radius={14}>
              <Text style={styles.analysisTitle}>📥 WHAT YOU'RE GETTING</Text>
              <Text style={styles.analysisText}>{result.yourAnalysis}</Text>
            </GlassCard>
            <GlassCard style={{ marginBottom: 12 }} padding={16} radius={14}>
              <Text style={styles.analysisTitle}>📤 WHAT YOU'RE GIVING UP</Text>
              <Text style={styles.analysisText}>{result.theirAnalysis}</Text>
            </GlassCard>

            {/* Recommendation */}
            <GlassCard style={{ borderWidth: 2, borderColor: recColor, marginBottom: 16, alignItems: 'center' }} padding={16} radius={14}>
              <Text style={[styles.recommendText, { color: recColor }]}>{result.recommendation}</Text>
            </GlassCard>

            <TouchableOpacity style={styles.resetBtn} onPress={() => { setGiving(''); setGetting(''); setResult(null); }}>
              <Text style={styles.resetText}>ANALYZE ANOTHER TRADE</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* Dynasty Elite modal */}
      <Modal visible={showDynastyModal} transparent animationType="slide" onRequestClose={() => setShowDynastyModal(false)}>
        <View style={styles.modalOverlay}>
          <GlassCard style={styles.modalCard} padding={28} radius={20}>
            <Text style={styles.modalEmoji}>👑</Text>
            <Text style={styles.modalTitle}>Dynasty Trade Detected</Text>
            <Text style={styles.modalBody}>Future pick valuation requires Dynasty Elite — AI weighs live college rankings and multi-year roster impact.</Text>
            <View style={styles.modalFeatures}>
              {['Live college football rankings', 'Future pick grade engine', 'Rookie draft board', 'Dynasty AI memory'].map(f => (
                <View key={f} style={styles.modalFeatureRow}>
                  <Text style={[styles.modalFeatureCheck, { color: C.amber }]}>✓</Text>
                  <Text style={[styles.modalFeatureText, { color: C.amber }]}>{f}</Text>
                </View>
              ))}
            </View>
            <TouchableOpacity style={[styles.modalUpgradeBtn, { backgroundColor: C.amber }]} onPress={() => { setShowDynastyModal(false); router.push('/paywall'); }}>
              <Text style={styles.modalUpgradeBtnText}>UPGRADE TO DYNASTY ELITE — $19.99/MO →</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalSkipBtn} onPress={() => { setShowDynastyModal(false); setLeagueType('dynasty'); handleAnalyze(); }}>
              <Text style={styles.modalSkipText}>Analyze anyway (redraft values only)</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowDynastyModal(false)} style={{ alignItems: 'center', marginTop: 8 }}>
              <Text style={{ fontFamily: F.outfit, color: C.dim, fontSize: SZ.sm }}>Maybe later</Text>
            </TouchableOpacity>
          </GlassCard>
        </View>
      </Modal>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  scroll:           { paddingHorizontal: SP[3], paddingBottom: 80 },
  header:           { paddingBottom: 16, marginBottom: 16 },
  title:            { fontSize: SZ['2xl'], fontWeight: '700', color: C.ink, fontFamily: F.bold },
  subtitle:         { fontSize: SZ.xs - 1, fontFamily: F.mono, color: C.dim, letterSpacing: 2, marginTop: 3 },

  toggleRow:        { flexDirection: 'row', gap: 10, marginBottom: 16 },
  toggleBtn:        { flex: 1, borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', backgroundColor: 'rgba(255,255,255,0.08)' },
  toggleText:       { fontFamily: F.mono, color: C.dim, fontSize: SZ.xs, letterSpacing: 2 },

  inputBlock:       { marginBottom: 4 },
  inputLabel:       { fontFamily: F.mono, color: C.dim, fontSize: SZ.xs - 1, letterSpacing: 2, marginBottom: 10 },
  tradeInput:       { color: C.ink, fontFamily: F.outfit, fontSize: SZ.base, minHeight: 60, textAlignVertical: 'top' },

  vsRow:            { flexDirection: 'row', alignItems: 'center', marginVertical: 12 },
  vsDivider:        { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.12)' },
  vsText:           { fontFamily: F.bold, color: C.dim, fontSize: SZ.lg, letterSpacing: 3, marginHorizontal: 14 },

  exampleSection:   { marginTop: 12, marginBottom: 4 },
  exampleLabel:     { fontFamily: F.mono, color: C.dim, fontSize: SZ.xs - 1, letterSpacing: 2, marginBottom: 10 },
  exampleChip:      { backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  exampleText:      { fontFamily: F.outfit, color: C.dim, fontSize: SZ.sm },

  analyzeBtn:       { backgroundColor: C.gold, borderRadius: 14, padding: 18, alignItems: 'center', marginTop: 16, marginBottom: 8 },
  analyzeBtnText:   { fontFamily: F.bold, color: '#1a1208', fontSize: SZ.lg, letterSpacing: 3 },

  resultSection:    { marginTop: 8 },
  gradeRow:         { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 10 },
  gradeCard:        { flex: 1, alignItems: 'center' },
  gradeLabel:       { fontFamily: F.mono, color: C.dim, fontSize: SZ.xs - 2, letterSpacing: 1.5, marginBottom: 8 },
  gradeValue:       { fontFamily: F.bold, fontSize: 52, letterSpacing: 2, lineHeight: 52 },
  gradeVs:          { fontFamily: F.bold, color: C.dim, fontSize: SZ.lg, letterSpacing: 3 },

  verdictLabel:     { fontFamily: F.mono, color: C.gold, fontSize: SZ.xs - 2, letterSpacing: 2, marginBottom: 8 },
  verdictText:      { fontFamily: F.semibold, color: C.ink, fontSize: SZ.md, lineHeight: 22 },

  analysisTitle:    { fontFamily: F.mono, color: C.gold, fontSize: SZ.xs - 1, letterSpacing: 1.5, marginBottom: 10 },
  analysisText:     { fontFamily: F.outfit, color: C.dim, fontSize: SZ.md, lineHeight: 20 },

  recommendText:    { fontFamily: F.bold, fontSize: SZ.lg, letterSpacing: 2, textAlign: 'center' },

  resetBtn:         { borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 8 },
  resetText:        { fontFamily: F.mono, color: C.dim, fontSize: SZ.xs, letterSpacing: 2 },

  modalOverlay:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end', padding: SP[3], paddingBottom: 40 },
  modalCard:        {},
  modalEmoji:       { fontSize: 40, textAlign: 'center', marginBottom: 12 },
  modalTitle:       { fontFamily: F.bold, color: C.ink, fontSize: SZ['2xl'], textAlign: 'center', marginBottom: 12 },
  modalBody:        { fontFamily: F.outfit, color: C.dim, fontSize: SZ.md, lineHeight: 22, textAlign: 'center', marginBottom: 20 },
  modalFeatures:    { backgroundColor: 'rgba(224,144,80,0.10)', borderRadius: 14, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: 'rgba(224,144,80,0.25)' },
  modalFeatureRow:  { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 10 },
  modalFeatureCheck:{ fontSize: SZ.md, fontWeight: '700' },
  modalFeatureText: { fontFamily: F.semibold, fontSize: SZ.sm },
  modalUpgradeBtn:  { borderRadius: 14, padding: 16, alignItems: 'center', marginBottom: 10 },
  modalUpgradeBtnText: { fontFamily: F.bold, color: '#1a1208', fontSize: SZ.base, letterSpacing: 2 },
  modalSkipBtn:     { borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', borderRadius: 14, padding: 14, alignItems: 'center', marginBottom: 8 },
  modalSkipText:    { fontFamily: F.outfit, color: C.dim, fontSize: SZ.sm },
});