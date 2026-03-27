import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const POS_COLORS: Record<string, string> = { QB: '#cc77ff', RB: '#00ffaa', WR: '#33ddff', TE: '#D4FF00', K: '#ff88bb', DEF: '#aabbcc', DST: '#aabbcc' };
const API_KEY = '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';
const POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K'];

export default function WaiverScreen() {
  const [players, setPlayers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPosition, setSelectedPosition] = useState('ALL');
  const [selectedPlayer, setSelectedPlayer] = useState<any>(null);
  const [advice, setAdvice] = useState('');
  const [adviceLoading, setAdviceLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);

  useEffect(() => { fetchTopAvailable(); }, []);

  const fetchTopAvailable = async () => {
    try {
      setLoading(true);
      const res = await fetch('https://api.sleeper.app/v1/players/nfl');
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
      const response = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 200, messages: [{ role: 'user', content: prompt }] }) });
      const data = await response.json();
      setAdvice(data.content[0].text);
    } catch { setAdvice('Could not load advice. Try again.'); }
    finally { setAdviceLoading(false); }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>WAIVER WIRE</Text>
        <Text style={styles.subtitle}>AI-POWERED PICKUP INTELLIGENCE</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow} contentContainerStyle={{ paddingHorizontal: 20 }}>
        {POSITIONS.map(pos => (
          <TouchableOpacity key={pos} style={[styles.filterBtn, selectedPosition === pos && { borderColor: pos === 'ALL' ? '#D4FF00' : (POS_COLORS[pos] || '#D4FF00'), backgroundColor: `${pos === 'ALL' ? '#D4FF00' : (POS_COLORS[pos] || '#D4FF00')}18` }]} onPress={() => setSelectedPosition(pos)}>
            <Text style={[styles.filterText, selectedPosition === pos && { color: pos === 'ALL' ? '#D4FF00' : (POS_COLORS[pos] || '#D4FF00') }]}>{pos}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color="#D4FF00" size="large" />
          <Text style={styles.loadingText}>LOADING AVAILABLE PLAYERS</Text>
        </View>
      ) : (
        <ScrollView style={styles.playerList} contentContainerStyle={{ paddingHorizontal: 20 }}>
          {filteredPlayers.map((player, index) => {
            const posColor = POS_COLORS[player.position] || '#444';
            return (
              <TouchableOpacity key={`${player.player_id || index}`} style={styles.playerCard} onPress={() => handleAdvice(player)} activeOpacity={0.8}>
                <View style={[styles.cardAccent, { backgroundColor: posColor }]} />
                <Text style={styles.rankText}>#{index + 1}</Text>
                <View style={styles.posDiamondWrap}>
                  <View style={[styles.posDiamond, { backgroundColor: posColor }]}>
                    <Text style={styles.posText}>{player.position}</Text>
                  </View>
                </View>
                <View style={styles.playerInfo}>
                  <Text style={styles.playerName}>{player.first_name} {player.last_name}</Text>
                  <Text style={styles.playerTeam}>{player.team}{player.injury_status ? ` · ⚠ ${player.injury_status}` : ''}</Text>
                </View>
                <View style={styles.aiHint}>
                  <Text style={styles.aiHintText}>AI</Text>
                </View>
              </TouchableOpacity>
            );
          })}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={[styles.modalAccent, { backgroundColor: POS_COLORS[selectedPlayer?.position] || '#D4FF00' }]} />
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>{selectedPlayer?.first_name} {selectedPlayer?.last_name}</Text>
                <View style={[styles.modalPosBadge, { backgroundColor: POS_COLORS[selectedPlayer?.position] || '#444' }]}>
                  <Text style={styles.modalPosBadgeText}>{selectedPlayer?.position} · {selectedPlayer?.team}</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setModalVisible(false)} style={styles.closeBtn}>
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
            {adviceLoading
              ? <View style={styles.loadingAdvice}><ActivityIndicator color="#D4FF00" size="large" /><Text style={styles.loadingAdviceText}>ANALYZING...</Text></View>
              : <Text style={styles.adviceText}>{advice}</Text>}
            <TouchableOpacity style={[styles.gotItBtn, { backgroundColor: POS_COLORS[selectedPlayer?.position] || '#D4FF00' }]} onPress={() => setModalVisible(false)}>
              <Text style={styles.gotItText}>GOT IT</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#03030a' },
  header: { paddingTop: 56, paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(212,255,0,0.08)' },
  title: { fontFamily: 'BebasNeue_400Regular', fontSize: 36, color: '#D4FF00', letterSpacing: 4, lineHeight: 38, textShadowColor: 'rgba(212,255,0,0.3)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 10 },
  subtitle: { fontFamily: 'SpaceMono_400Regular', fontSize: 9, color: '#444', letterSpacing: 2, marginTop: 4 },
  filterRow: { flexGrow: 0, marginVertical: 12 },
  filterBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 2, borderWidth: 1, borderColor: '#1a1a2e', marginRight: 8 },
  filterText: { fontFamily: 'SpaceMono_400Regular', color: '#444', fontSize: 10, letterSpacing: 1 },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  loadingText: { fontFamily: 'SpaceMono_400Regular', color: '#D4FF00', fontSize: 11, letterSpacing: 3, opacity: 0.6 },
  playerList: { flex: 1 },
  playerCard: { backgroundColor: 'rgba(8,8,22,0.9)', borderWidth: 1, borderColor: 'rgba(212,255,0,0.06)', borderRadius: 2, padding: 12, marginBottom: 6, flexDirection: 'row', alignItems: 'center', gap: 10, overflow: 'hidden' },
  cardAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 2 },
  rankText: { fontFamily: 'SpaceMono_400Regular', color: '#333', fontSize: 9, width: 28, letterSpacing: 0.5 },
  posDiamondWrap: { width: 34, alignItems: 'center' },
  posDiamond: { width: 28, height: 28, borderRadius: 4, transform: [{ rotate: '45deg' }], alignItems: 'center', justifyContent: 'center' },
  posText: { fontFamily: 'SpaceMono_400Regular', fontSize: 7, color: '#000', fontWeight: '700', transform: [{ rotate: '-45deg' }], letterSpacing: 0.5 },
  playerInfo: { flex: 1 },
  playerName: { fontFamily: 'Barlow_600SemiBold', color: '#fff', fontSize: 15, marginBottom: 2 },
  playerTeam: { fontFamily: 'SpaceMono_400Regular', color: '#444', fontSize: 10, letterSpacing: 0.5 },
  aiHint: { width: 28, height: 28, borderRadius: 2, borderWidth: 1, borderColor: 'rgba(212,255,0,0.3)', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(212,255,0,0.06)' },
  aiHintText: { fontFamily: 'SpaceMono_400Regular', color: '#D4FF00', fontSize: 9, letterSpacing: 1 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#060610', borderTopLeftRadius: 2, borderTopRightRadius: 2, padding: 24, minHeight: 280, borderTopWidth: 1, borderColor: 'rgba(212,255,0,0.15)', overflow: 'hidden' },
  modalAccent: { position: 'absolute', top: 0, left: 0, right: 0, height: 2 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  modalTitle: { fontFamily: 'BebasNeue_400Regular', color: '#fff', fontSize: 26, letterSpacing: 2, marginBottom: 8 },
  modalPosBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 2, alignSelf: 'flex-start' },
  modalPosBadgeText: { fontFamily: 'SpaceMono_400Regular', fontSize: 9, color: '#000', letterSpacing: 1 },
  closeBtn: { width: 32, height: 32, borderRadius: 2, borderWidth: 1, borderColor: '#1a1a2e', alignItems: 'center', justifyContent: 'center' },
  closeBtnText: { color: '#555', fontSize: 14 },
  loadingAdvice: { alignItems: 'center', padding: 24, gap: 14 },
  loadingAdviceText: { fontFamily: 'SpaceMono_400Regular', color: '#D4FF00', fontSize: 11, letterSpacing: 3, opacity: 0.7 },
  adviceText: { fontFamily: 'Barlow_400Regular', color: '#ccc', fontSize: 15, lineHeight: 24, marginBottom: 20 },
  gotItBtn: { borderRadius: 2, padding: 16, alignItems: 'center', marginTop: 8 },
  gotItText: { fontFamily: 'BebasNeue_400Regular', fontSize: 18, color: '#000', letterSpacing: 3 },
});
