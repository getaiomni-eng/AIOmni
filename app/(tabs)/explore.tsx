import { useState } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

const API_KEY = 'YOUR_CLAUDE_API_KEY';
const DYNASTY_KEYWORDS = ['pick', 'round', '2025', '2026', '2027', '2028', 'first', 'second', 'third', 'future', 'rookie'];
const GRADE_COLORS: Record<string, string> = { 'A+': '#D4FF00', 'A': '#D4FF00', 'A-': '#D4FF00', 'B+': '#00ffaa', 'B': '#00ffaa', 'B-': '#00ffaa', 'C+': '#ffaa00', 'C': '#ffaa00', 'C-': '#ffaa00', 'D+': '#ff2255', 'D': '#ff2255', 'D-': '#ff2255', 'F': '#ff2255' };
const EXAMPLE_TRADES = [
  { give: 'CeeDee Lamb', get: 'Saquon Barkley + Tyler Lockett' },
  { give: 'Josh Allen + flex', get: 'Lamar Jackson + WR2' },
  { give: 'My 1st round pick', get: 'Davante Adams' },
];

type TradeResult = { yourGrade: string; theirGrade: string; verdict: string; yourAnalysis: string; theirAnalysis: string; recommendation: string; };

export default function TradeAnalyzerScreen() {
  const [giving, setGiving] = useState('');
  const [getting, setGetting] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TradeResult | null>(null);
  const [showDynastyModal, setShowDynastyModal] = useState(false);
  const [leagueType, setLeagueType] = useState<'redraft' | 'dynasty'>('redraft');
  const router = useRouter();

  const isDynastyTrade = (text: string) => DYNASTY_KEYWORDS.some(kw => text.toLowerCase().includes(kw));

  const handleAnalyze = async () => {
    if (!giving.trim() || !getting.trim()) return;
    if ((isDynastyTrade(giving) || isDynastyTrade(getting)) && leagueType === 'redraft') { setShowDynastyModal(true); return; }
    setLoading(true); setResult(null);
    try {
      const prompt = `You are AIOmni, expert fantasy football trade analyst.\n\nAnalyze this trade and respond ONLY with a JSON object:\n{\n  "yourGrade": "B+",\n  "theirGrade": "C",\n  "verdict": "One sentence who wins",\n  "yourAnalysis": "2-3 sentences what user receives",\n  "theirAnalysis": "2-3 sentences what user gives",\n  "recommendation": "ACCEPT or DECLINE or COUNTER — one sentence why"\n}\n\nLeague Type: ${leagueType === 'dynasty' ? 'Dynasty' : 'Redraft'}\nYou are giving: ${giving}\nYou are getting: ${getting}\n\nGrade A+ through F. Return only valid JSON.`;
      const response = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 600, messages: [{ role: 'user', content: prompt }] }) });
      const data = await response.json();
      const clean = data.content[0].text.trim().replace(/```json|```/g, '').trim();
      setResult(JSON.parse(clean));
    } catch {
      setResult({ yourGrade: '?', theirGrade: '?', verdict: 'Could not analyze. Try again.', yourAnalysis: '', theirAnalysis: '', recommendation: '' });
    } finally { setLoading(false); }
  };

  const recColor = result?.recommendation?.startsWith('ACCEPT') ? '#D4FF00' : result?.recommendation?.startsWith('DECLINE') ? '#ff2255' : '#ffaa00';

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        <View style={styles.header}>
          <Text style={styles.title}>TRADE ANALYZER</Text>
          <Text style={styles.subtitle}>A–F GRADE ON ANY TRADE</Text>
        </View>

        {/* League type toggle */}
        <View style={styles.toggleRow}>
          <TouchableOpacity style={[styles.toggleBtn, leagueType === 'redraft' && styles.toggleActive]} onPress={() => setLeagueType('redraft')}>
            <Text style={[styles.toggleText, leagueType === 'redraft' && styles.toggleTextActive]}>REDRAFT</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.toggleBtn, leagueType === 'dynasty' && { borderColor: '#ffaa00', backgroundColor: 'rgba(255,170,0,0.06)' }]} onPress={() => setLeagueType('dynasty')}>
            <Text style={[styles.toggleText, leagueType === 'dynasty' && { color: '#ffaa00' }]}>DYNASTY</Text>
          </TouchableOpacity>
        </View>

        {/* Inputs */}
        <View style={styles.inputBlock}>
          <Text style={styles.inputLabel}>📤 YOU ARE GIVING</Text>
          <TextInput style={styles.tradeInput} placeholder="e.g. CeeDee Lamb + flex" placeholderTextColor="#222" value={giving} onChangeText={setGiving} multiline />
        </View>

        <View style={styles.vsRow}>
          <View style={styles.vsDivider} />
          <Text style={styles.vsText}>FOR</Text>
          <View style={styles.vsDivider} />
        </View>

        <View style={styles.inputBlock}>
          <Text style={styles.inputLabel}>📥 YOU ARE GETTING</Text>
          <TextInput style={styles.tradeInput} placeholder="e.g. Saquon Barkley + WR2" placeholderTextColor="#222" value={getting} onChangeText={setGetting} multiline />
        </View>

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
        <TouchableOpacity style={[styles.analyzeBtn, (!giving.trim() || !getting.trim()) && styles.analyzeBtnDisabled]} onPress={handleAnalyze} disabled={loading || !giving.trim() || !getting.trim()}>
          {loading ? <ActivityIndicator color="#000" /> : <Text style={styles.analyzeBtnText}>ANALYZE THIS TRADE</Text>}
        </TouchableOpacity>

        {/* Result */}
        {result && (
          <View style={styles.resultSection}>
            {/* Grades */}
            <View style={styles.gradeRow}>
              <View style={[styles.gradeCard, { borderColor: `${GRADE_COLORS[result.yourGrade] || '#fff'}40` }]}>
                <Text style={styles.gradeLabel}>YOU RECEIVE</Text>
                <Text style={[styles.gradeValue, { color: GRADE_COLORS[result.yourGrade] || '#fff' }]}>{result.yourGrade}</Text>
              </View>
              <Text style={styles.gradeVs}>VS</Text>
              <View style={[styles.gradeCard, { borderColor: `${GRADE_COLORS[result.theirGrade] || '#fff'}40` }]}>
                <Text style={styles.gradeLabel}>YOU GIVE UP</Text>
                <Text style={[styles.gradeValue, { color: GRADE_COLORS[result.theirGrade] || '#fff' }]}>{result.theirGrade}</Text>
              </View>
            </View>

            {/* Verdict */}
            <View style={styles.verdictCard}>
              <Text style={styles.verdictLabel}>◈ VERDICT</Text>
              <Text style={styles.verdictText}>{result.verdict}</Text>
            </View>

            {/* Analysis */}
            <View style={styles.analysisCard}>
              <Text style={styles.analysisTitle}>📥 WHAT YOU'RE GETTING</Text>
              <Text style={styles.analysisText}>{result.yourAnalysis}</Text>
            </View>
            <View style={styles.analysisCard}>
              <Text style={styles.analysisTitle}>📤 WHAT YOU'RE GIVING UP</Text>
              <Text style={styles.analysisText}>{result.theirAnalysis}</Text>
            </View>

            {/* Recommendation */}
            <View style={[styles.recommendCard, { borderColor: recColor }]}>
              <Text style={[styles.recommendText, { color: recColor }]}>{result.recommendation}</Text>
            </View>

            <TouchableOpacity style={styles.resetBtn} onPress={() => { setGiving(''); setGetting(''); setResult(null); }}>
              <Text style={styles.resetText}>ANALYZE ANOTHER TRADE</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* Dynasty Elite modal */}
      <Modal visible={showDynastyModal} transparent animationType="slide" onRequestClose={() => setShowDynastyModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalAccent} />
            <Text style={styles.modalEmoji}>👑</Text>
            <Text style={styles.modalTitle}>DYNASTY TRADE DETECTED</Text>
            <Text style={styles.modalBody}>Future pick valuation requires Dynasty Elite — AI weighs live college rankings and multi-year roster impact.</Text>
            <View style={styles.modalFeatures}>
              {['Live college football rankings', 'Future pick grade engine', 'Rookie draft board', 'Dynasty AI memory'].map(f => (
                <View key={f} style={styles.modalFeatureRow}>
                  <Text style={styles.modalFeatureCheck}>✓</Text>
                  <Text style={styles.modalFeatureText}>{f}</Text>
                </View>
              ))}
            </View>
            <TouchableOpacity style={styles.modalUpgradeBtn} onPress={() => { setShowDynastyModal(false); router.push('/paywall'); }}>
              <Text style={styles.modalUpgradeBtnText}>UPGRADE TO DYNASTY ELITE — $19.99/MO →</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalSkipBtn} onPress={() => { setShowDynastyModal(false); setLeagueType('dynasty'); handleAnalyze(); }}>
              <Text style={styles.modalSkipText}>Analyze anyway (redraft values only)</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowDynastyModal(false)}>
              <Text style={styles.modalDismiss}>Maybe later</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#03030a' },
  scroll: { paddingHorizontal: 20, paddingBottom: 60 },
  header: { paddingTop: 56, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: 'rgba(212,255,0,0.08)', marginBottom: 20 },
  title: { fontFamily: 'BebasNeue_400Regular', fontSize: 36, color: '#D4FF00', letterSpacing: 4, lineHeight: 38, textShadowColor: 'rgba(212,255,0,0.3)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 10 },
  subtitle: { fontFamily: 'SpaceMono_400Regular', fontSize: 9, color: '#444', letterSpacing: 2, marginTop: 4 },

  toggleRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  toggleBtn: { flex: 1, backgroundColor: 'rgba(8,8,22,0.9)', borderRadius: 2, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: '#1a1a2e' },
  toggleActive: { borderColor: 'rgba(212,255,0,0.4)', backgroundColor: 'rgba(212,255,0,0.06)' },
  toggleText: { fontFamily: 'SpaceMono_400Regular', color: '#444', fontSize: 10, letterSpacing: 2 },
  toggleTextActive: { color: '#D4FF00' },

  inputBlock: { marginBottom: 8 },
  inputLabel: { fontFamily: 'SpaceMono_400Regular', color: '#444', fontSize: 9, letterSpacing: 2, marginBottom: 8 },
  tradeInput: { backgroundColor: 'rgba(8,8,22,0.9)', borderRadius: 2, padding: 16, color: '#fff', fontFamily: 'Barlow_400Regular', fontSize: 15, minHeight: 70, borderWidth: 1, borderColor: '#1a1a2e', textAlignVertical: 'top' },

  vsRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 14 },
  vsDivider: { flex: 1, height: 1, backgroundColor: '#1a1a2e' },
  vsText: { fontFamily: 'BebasNeue_400Regular', color: '#333', fontSize: 18, letterSpacing: 3, marginHorizontal: 14 },

  exampleSection: { marginTop: 12, marginBottom: 4 },
  exampleLabel: { fontFamily: 'SpaceMono_400Regular', color: '#333', fontSize: 9, letterSpacing: 2, marginBottom: 10 },
  exampleChip: { backgroundColor: 'rgba(8,8,22,0.9)', borderRadius: 2, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: '#1a1a2e' },
  exampleText: { fontFamily: 'Barlow_400Regular', color: '#555', fontSize: 12 },

  analyzeBtn: { backgroundColor: '#D4FF00', borderRadius: 2, padding: 18, alignItems: 'center', marginTop: 16, marginBottom: 8 },
  analyzeBtnDisabled: { opacity: 0.3 },
  analyzeBtnText: { fontFamily: 'BebasNeue_400Regular', color: '#000', fontSize: 22, letterSpacing: 4 },

  resultSection: { marginTop: 8 },
  gradeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 10 },
  gradeCard: { flex: 1, backgroundColor: 'rgba(8,8,22,0.9)', borderRadius: 2, padding: 16, alignItems: 'center', borderWidth: 1 },
  gradeLabel: { fontFamily: 'SpaceMono_400Regular', color: '#444', fontSize: 8, letterSpacing: 1.5, marginBottom: 8 },
  gradeValue: { fontFamily: 'BebasNeue_400Regular', fontSize: 52, letterSpacing: 2, lineHeight: 52 },
  gradeVs: { fontFamily: 'BebasNeue_400Regular', color: '#222', fontSize: 18, letterSpacing: 3 },

  verdictCard: { backgroundColor: 'rgba(212,255,0,0.05)', borderRadius: 2, padding: 16, marginBottom: 12, borderLeftWidth: 3, borderLeftColor: '#D4FF00' },
  verdictLabel: { fontFamily: 'SpaceMono_400Regular', color: '#D4FF00', fontSize: 8, letterSpacing: 2, marginBottom: 8 },
  verdictText: { fontFamily: 'Barlow_600SemiBold', color: '#fff', fontSize: 15, lineHeight: 22 },

  analysisCard: { backgroundColor: 'rgba(8,8,22,0.9)', borderRadius: 2, padding: 16, marginBottom: 8, borderWidth: 1, borderColor: '#1a1a2e' },
  analysisTitle: { fontFamily: 'SpaceMono_400Regular', color: '#D4FF00', fontSize: 9, letterSpacing: 1.5, marginBottom: 10 },
  analysisText: { fontFamily: 'Barlow_400Regular', color: '#888', fontSize: 14, lineHeight: 20 },

  recommendCard: { borderRadius: 2, padding: 16, marginBottom: 16, borderWidth: 2, alignItems: 'center', backgroundColor: 'rgba(8,8,22,0.9)' },
  recommendText: { fontFamily: 'BebasNeue_400Regular', fontSize: 18, letterSpacing: 3, textAlign: 'center' },

  resetBtn: { borderWidth: 1, borderColor: '#1a1a2e', borderRadius: 2, padding: 14, alignItems: 'center', marginBottom: 8 },
  resetText: { fontFamily: 'SpaceMono_400Regular', color: '#444', fontSize: 10, letterSpacing: 2 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#060610', borderTopLeftRadius: 2, borderTopRightRadius: 2, padding: 28, borderTopWidth: 1, borderColor: 'rgba(255,170,0,0.3)', overflow: 'hidden' },
  modalAccent: { position: 'absolute', top: 0, left: 0, right: 0, height: 2, backgroundColor: '#ffaa00' },
  modalEmoji: { fontSize: 40, textAlign: 'center', marginBottom: 12 },
  modalTitle: { fontFamily: 'BebasNeue_400Regular', color: '#fff', fontSize: 28, letterSpacing: 3, textAlign: 'center', marginBottom: 12 },
  modalBody: { fontFamily: 'Barlow_400Regular', color: '#666', fontSize: 14, lineHeight: 22, textAlign: 'center', marginBottom: 20 },
  modalFeatures: { backgroundColor: 'rgba(255,170,0,0.06)', borderRadius: 2, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: 'rgba(255,170,0,0.2)' },
  modalFeatureRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 10 },
  modalFeatureCheck: { color: '#ffaa00', fontSize: 14, fontWeight: '700' },
  modalFeatureText: { fontFamily: 'Barlow_600SemiBold', color: '#ffaa00', fontSize: 13 },
  modalUpgradeBtn: { backgroundColor: '#ffaa00', borderRadius: 2, padding: 16, alignItems: 'center', marginBottom: 10 },
  modalUpgradeBtnText: { fontFamily: 'BebasNeue_400Regular', color: '#000', fontSize: 16, letterSpacing: 2 },
  modalSkipBtn: { borderWidth: 1, borderColor: '#1a1a2e', borderRadius: 2, padding: 14, alignItems: 'center', marginBottom: 10 },
  modalSkipText: { fontFamily: 'Barlow_400Regular', color: '#555', fontSize: 13 },
  modalDismiss: { fontFamily: 'Barlow_400Regular', color: '#333', textAlign: 'center', fontSize: 13, paddingVertical: 8 },
});
