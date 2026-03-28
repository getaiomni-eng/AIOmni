import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PositionPill } from '../components/Atoms';
import { GlassCard } from '../components/GlassCard';
import { C, F, SP, SZ } from '../constants/tokens';

const API_KEY = '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';
const POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K'];

export default function WaiverScreen() {
  const insets = useSafeAreaInsets();
  const [players,          setPlayers]          = useState<any[]>([]);
  const [loading,          setLoading]          = useState(true);
  const [selectedPosition, setSelectedPosition] = useState('ALL');
  const [selectedPlayer,   setSelectedPlayer]   = useState<any>(null);
  const [advice,           setAdvice]           = useState('');
  const [adviceLoading,    setAdviceLoading]    = useState(false);
  const [modalVisible,     setModalVisible]     = useState(false);

  useEffect(() => { fetchTopAvailable(); }, []);

  const fetchTopAvailable = async () => {
    try {
      setLoading(true);
      const res  = await fetch('https://api.sleeper.app/v1/players/nfl');
      const data = await res.json();
      const skillPlayers = Object.values(data)
        .filter((p: any) => ['QB','RB','WR','TE','K'].includes(p.position) && p.team && p.first_name && p.last_name && p.fantasy_positions?.length > 0)
        .slice(0, 100);
      setPlayers(skillPlayers);
    } catch (err) { console.error('Error fetching players:', err); }
    finally { setLoading(false); }
  };

  const filteredPlayers = players.filter(p => selectedPosition === 'ALL' || p.position === selectedPosition);

  const handleAdvice = async (player: any) => {
    setSelectedPlayer(player); setAdvice(''); setModalVisible(true); setAdviceLoading(true);
    const prompt = `You are AIOmni, expert fantasy football waiver wire analyst.\nPlayer: ${player.first_name} ${player.last_name} | ${player.position} | ${player.team}${player.injury_status ? ` | Injury: ${player.injury_status}` : ''}\nShould I add off waivers? What's their upside? Be sharp, direct, under 80 words.`;
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 200, messages: [{ role: 'user', content: prompt }] }),
      });
      const data = await response.json();
      setAdvice(data.content[0].text);
    } catch { setAdvice('Could not load advice. Try again.'); }
    finally { setAdviceLoading(false); }
  };

  return (
    <LinearGradient colors={[C.bgTop, C.bgBot]} style={{ flex: 1 }}>
      <View style={[styles.wrap, { paddingTop: insets.top + 12 }]}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Waiver Wire</Text>
          <Text style={styles.subtitle}>AI-POWERED PICKUP INTELLIGENCE</Text>
        </View>

        {/* Position filters */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow} contentContainerStyle={{ paddingHorizontal: SP[3], gap: 8 }}>
          {POSITIONS.map(pos => (
            <TouchableOpacity
              key={pos}
              style={[styles.filterBtn, selectedPosition === pos && { borderColor: C.gold, backgroundColor: C.goldS }]}
              onPress={() => setSelectedPosition(pos)}
            >
              <Text style={[styles.filterText, selectedPosition === pos && { color: C.gold }]}>{pos}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={C.gold} size="large" />
            <Text style={styles.loadingText}>LOADING AVAILABLE PLAYERS</Text>
          </View>
        ) : (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SP[3], paddingBottom: 40 }}>
            {filteredPlayers.map((player, index) => (
              <TouchableOpacity key={`${player.player_id || index}`} activeOpacity={0.8} onPress={() => handleAdvice(player)}>
                <GlassCard style={styles.playerCard} padding={12} radius={14}>
                  <Text style={styles.rankText}>#{index + 1}</Text>
                  <PositionPill pos={player.position} />
                  <View style={styles.playerInfo}>
                    <Text style={styles.playerName}>{player.first_name} {player.last_name}</Text>
                    <Text style={styles.playerTeam}>{player.team}{player.injury_status ? ` · ⚠ ${player.injury_status}` : ''}</Text>
                  </View>
                  <View style={styles.aiHint}>
                    <Text style={styles.aiHintText}>AI</Text>
                  </View>
                </GlassCard>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </View>

      {/* Player modal */}
      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <GlassCard style={styles.modalCard} padding={24} radius={20}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>{selectedPlayer?.first_name} {selectedPlayer?.last_name}</Text>
                <PositionPill pos={selectedPlayer?.position ?? 'WR'} />
              </View>
              <TouchableOpacity onPress={() => setModalVisible(false)} style={styles.closeBtn}>
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
            {adviceLoading
              ? <View style={{ alignItems: 'center', padding: 24, gap: 14 }}>
                  <ActivityIndicator color={C.gold} size="large" />
                  <Text style={{ fontFamily: F.mono, color: C.gold, fontSize: SZ.xs, letterSpacing: 2 }}>ANALYZING...</Text>
                </View>
              : <Text style={styles.adviceText}>{advice}</Text>}
            <TouchableOpacity style={styles.gotItBtn} onPress={() => setModalVisible(false)}>
              <Text style={styles.gotItText}>GOT IT</Text>
            </TouchableOpacity>
          </GlassCard>
        </View>
      </Modal>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  wrap:         { flex: 1 },
  header:       { paddingHorizontal: SP[3], paddingBottom: 12, marginBottom: 4 },
  title:        { fontSize: SZ['2xl'], fontWeight: '700', color: C.ink, fontFamily: F.bold },
  subtitle:     { fontSize: SZ.xs - 1, fontFamily: F.mono, color: C.dim, letterSpacing: 2, marginTop: 3 },
  filterRow:    { flexGrow: 0, marginBottom: 12 },
  filterBtn:    { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', backgroundColor: 'rgba(255,255,255,0.08)' },
  filterText:   { fontFamily: F.mono, color: C.dim, fontSize: SZ.xs, letterSpacing: 1 },
  loadingBox:   { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  loadingText:  { fontFamily: F.mono, color: C.gold, fontSize: SZ.xs, letterSpacing: 3, opacity: 0.6 },
  playerCard:   { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  rankText:     { fontFamily: F.mono, color: C.dim, fontSize: SZ.xs - 1, width: 28 },
  playerInfo:   { flex: 1 },
  playerName:   { fontFamily: F.semibold, color: C.ink, fontSize: SZ.base, marginBottom: 2 },
  playerTeam:   { fontFamily: F.mono, color: C.dim, fontSize: SZ.xs, letterSpacing: 0.5 },
  aiHint:       { width: 28, height: 28, borderRadius: 8, borderWidth: 1, borderColor: C.goldBorder, alignItems: 'center', justifyContent: 'center', backgroundColor: C.goldS },
  aiHintText:   { fontFamily: F.mono, color: C.gold, fontSize: SZ.xs - 1, letterSpacing: 1 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end', padding: SP[3], paddingBottom: 40 },
  modalCard:    {},
  modalHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  modalTitle:   { fontFamily: F.bold, color: C.ink, fontSize: SZ.xl, marginBottom: 8 },
  closeBtn:     { width: 32, height: 32, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  closeBtnText: { color: C.dim, fontSize: SZ.base },
  adviceText:   { fontFamily: F.outfit, color: C.ink, fontSize: SZ.md, lineHeight: 24, marginBottom: 20 },
  gotItBtn:     { backgroundColor: C.gold, borderRadius: 12, padding: 14, alignItems: 'center' },
  gotItText:    { fontFamily: F.bold, fontSize: SZ.base, color: '#1a1208', letterSpacing: 2 },
});