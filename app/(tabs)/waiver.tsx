import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Image, Modal, ScrollView,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { askAI } from '../../services/ai';
import { PositionPill } from '../components/Atoms';
import { C, F, SP, SZ } from '../constants/tokens';

const SURFACE  = 'rgba(255,255,255,0.90)';
const BORDER   = 'rgba(88,131,191,0.32)';
const BEVEL_HI = 'rgba(255,255,255,0.95)';
const POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K'];

// Player photo with fallback
function PlayerPhoto({ playerId, size = 44 }: { playerId: string; size?: number }) {
  const [err, setErr] = useState(false);
  const s = { width: size, height: size, borderRadius: size / 2 };
  if (!err && playerId) {
    return (
      <Image
        source={{ uri: `https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg` }}
        style={[s, { backgroundColor: SURFACE }]}
        onError={() => setErr(true)}
      />
    );
  }
  return (
    <View style={[s, { backgroundColor: C.sageS, alignItems:'center', justifyContent:'center', borderWidth:1.5, borderColor:BORDER }]}>
      <Text style={{ fontSize: size * 0.35, color: C.dim2 }}>?</Text>
    </View>
  );
}

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

      // Use Sleeper trending players for current relevance
      const trendRes  = await fetch('https://api.sleeper.app/v1/players/nfl/trending/add?limit=200&lookback_hours=48');
      const trending  = await trendRes.json(); // [{ player_id, count }]

      // Fetch full player map
      const allRes  = await fetch('https://api.sleeper.app/v1/players/nfl');
      const allData = await allRes.json();

      // Build sorted list from trending — these are always active/relevant
      const trendingPlayers = trending
        .map((t: any) => allData[t.player_id])
        .filter((p: any) => p && ['QB','RB','WR','TE','K'].includes(p.position) && p.team && p.first_name && p.last_name)
        .slice(0, 150);

      // If trending doesn't fill enough, supplement with search_rank sorted players
      if (trendingPlayers.length < 50) {
        const ranked = Object.values(allData)
          .filter((p: any) =>
            ['QB','RB','WR','TE','K'].includes(p.position) &&
            p.team && p.first_name && p.last_name &&
            p.search_rank && p.search_rank < 500 &&
            p.active !== false
          )
          .sort((a: any, b: any) => (a.search_rank ?? 9999) - (b.search_rank ?? 9999))
          .slice(0, 150);
        setPlayers(ranked);
      } else {
        setPlayers(trendingPlayers);
      }
    } catch (err) {
      // Fallback: search_rank sorted active players
      try {
        const allRes  = await fetch('https://api.sleeper.app/v1/players/nfl');
        const allData = await allRes.json();
        const ranked  = Object.values(allData)
          .filter((p: any) =>
            ['QB','RB','WR','TE','K'].includes(p.position) &&
            p.team && p.first_name && p.last_name &&
            p.search_rank && p.search_rank < 300 &&
            p.active !== false
          )
          .sort((a: any, b: any) => (a.search_rank ?? 9999) - (b.search_rank ?? 9999))
          .slice(0, 150);
        setPlayers(ranked);
      } catch {}
    } finally {
      setLoading(false);
    }
  };

  const filteredPlayers = players.filter(p =>
    selectedPosition === 'ALL' || p.position === selectedPosition
  );

  const handleAdvice = async (player: any) => {
    setSelectedPlayer(player);
    setAdvice('');
    setModalVisible(true);
    setAdviceLoading(true);

    const prompt = `You are AIOmni, expert fantasy football waiver wire analyst.
Player: ${player.first_name} ${player.last_name} | ${player.position} | ${player.team}${player.injury_status ? ` | Injury: ${player.injury_status}` : ''}
Age: ${player.age ?? 'unknown'} | Experience: ${player.years_exp ?? 0} years
Should I add off waivers? What's their upside? Be sharp, direct, under 80 words.`;

    try {
      const text = await askAI(prompt, 200);
      setAdvice(text || 'No advice available for this player.');
    } catch (e: any) {
      // Handle proxy auth error gracefully
      if (e?.message?.includes('prompt_limit_reached')) {
        setAdvice("You've used all your weekly prompts. Upgrade to Pro for unlimited AI advice.");
      } else {
        setAdvice('Could not load AI advice. Check your connection and try again.');
      }
    } finally {
      setAdviceLoading(false);
    }
  };

  return (
    <LinearGradient colors={[C.bgTop, C.bgBot]} style={{ flex: 1 }}>
      <View style={[styles.wrap, { paddingTop: insets.top + 12 }]}>

        <View style={styles.header}>
          <Text style={styles.title}>Waiver Wire</Text>
          <Text style={styles.subtitle}>AI-POWERED PICKUP INTELLIGENCE</Text>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterRow}
          contentContainerStyle={{ paddingHorizontal: SP[3], gap: 8 }}
        >
          {POSITIONS.map(pos => (
            <TouchableOpacity
              key={pos}
              style={[styles.filterBtn, selectedPosition === pos && { borderColor: C.blueDeep, backgroundColor: C.sageS }]}
              onPress={() => setSelectedPosition(pos)}
            >
              <Text style={[styles.filterText, selectedPosition === pos && { color: C.blueDeep }]}>{pos}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={C.blueDeep} size="large" />
            <Text style={styles.loadingText}>LOADING AVAILABLE PLAYERS</Text>
          </View>
        ) : (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: SP[3], paddingBottom: 40 }}
          >
            {filteredPlayers.map((player, index) => (
              <TouchableOpacity
                key={`${player.player_id || index}`}
                activeOpacity={0.8}
                onPress={() => handleAdvice(player)}
              >
                <View style={styles.playerCard}>
                  <View style={styles.playerCardShine} />
                  <Text style={styles.rankText}>#{index + 1}</Text>

                  {/* Player photo */}
                  <PlayerPhoto playerId={player.player_id} size={44} />

                  <PositionPill pos={player.position} />
                  <View style={styles.playerInfo}>
                    <Text style={styles.playerName}>{player.first_name} {player.last_name}</Text>
                    <Text style={styles.playerTeam}>
                      {player.team}{player.injury_status ? ` · ⚠ ${player.injury_status}` : ''}
                    </Text>
                  </View>
                  <View style={styles.aiHint}>
                    <Text style={styles.aiHintText}>AI</Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </View>

      {/* AI Advice Modal */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalShine} />
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection:'row', alignItems:'center', gap:10, marginBottom:8 }}>
                  <PlayerPhoto playerId={selectedPlayer?.player_id} size={52} />
                  <View>
                    <Text style={styles.modalTitle}>{selectedPlayer?.first_name} {selectedPlayer?.last_name}</Text>
                    <Text style={{ fontFamily:F.mono, color:C.dim2, fontSize:SZ.xs }}>{selectedPlayer?.team} · Age {selectedPlayer?.age}</Text>
                  </View>
                </View>
                <PositionPill pos={selectedPlayer?.position ?? 'WR'} />
              </View>
              <TouchableOpacity onPress={() => setModalVisible(false)} style={styles.closeBtn}>
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            {adviceLoading ? (
              <View style={{ alignItems:'center', padding:24, gap:14 }}>
                <ActivityIndicator color={C.blueDeep} size="large" />
                <Text style={{ fontFamily:F.mono, color:C.blueDeep, fontSize:SZ.xs, letterSpacing:2 }}>ANALYZING...</Text>
              </View>
            ) : (
              <Text style={styles.adviceText}>{advice}</Text>
            )}

            <TouchableOpacity style={styles.gotItBtn} onPress={() => setModalVisible(false)}>
              <Text style={styles.gotItText}>GOT IT</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  wrap:        { flex: 1 },
  header:      { paddingHorizontal: SP[3], paddingBottom: 12, marginBottom: 4 },
  title:       { fontSize: SZ['2xl'], fontFamily: F.bold, color: C.ink },
  subtitle:    { fontSize: SZ.xs - 1, fontFamily: F.mono, color: C.dim2, letterSpacing: 2, marginTop: 3 },

  filterRow:   { flexGrow: 0, marginBottom: 12 },
  filterBtn:   { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1.5, borderColor: BORDER, backgroundColor: SURFACE },
  filterText:  { fontFamily: F.mono, color: C.dim2, fontSize: SZ.xs, letterSpacing: 1 },

  loadingBox:  { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  loadingText: { fontFamily: F.mono, color: C.blueDeep, fontSize: SZ.xs, letterSpacing: 3, opacity: 0.7 },

  playerCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8,
    backgroundColor: SURFACE, borderWidth: 1.5, borderColor: BORDER,
    borderRadius: 14, padding: 12, position: 'relative', overflow: 'hidden',
    shadowColor: '#3d6aaa', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 3,
  },
  playerCardShine: { position: 'absolute', top: 0, left: '8%', right: '8%', height: 1.5, backgroundColor: BEVEL_HI, zIndex: 6 },

  rankText:   { fontFamily: F.mono, color: C.dim2, fontSize: SZ.xs - 1, width: 28 },
  playerInfo: { flex: 1 },
  playerName: { fontFamily: F.bold, color: C.ink, fontSize: SZ.base, marginBottom: 2 },
  playerTeam: { fontFamily: F.mono, color: C.dim2, fontSize: SZ.xs, letterSpacing: 0.5 },
  aiHint:     { width: 28, height: 28, borderRadius: 8, borderWidth: 1.5, borderColor: C.goldBorder, alignItems: 'center', justifyContent: 'center', backgroundColor: C.goldS },
  aiHintText: { fontFamily: F.mono, color: C.blueDeep, fontSize: SZ.xs - 1, letterSpacing: 1 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(26,31,46,0.5)', justifyContent: 'flex-end', padding: SP[3], paddingBottom: 40 },
  modalCard: {
    backgroundColor: '#ffffff', borderRadius: 20, padding: 24,
    borderWidth: 1.5, borderColor: BORDER, position: 'relative', overflow: 'hidden',
    shadowColor: '#3d6aaa', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.12, shadowRadius: 20, elevation: 12,
  },
  modalShine:  { position: 'absolute', top: 0, left: '8%', right: '8%', height: 1.5, backgroundColor: BEVEL_HI, zIndex: 6 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  modalTitle:  { fontFamily: F.bold, color: C.ink, fontSize: SZ.xl, marginBottom: 2 },
  closeBtn:    { width: 32, height: 32, borderRadius: 10, borderWidth: 1.5, borderColor: BORDER, alignItems: 'center', justifyContent: 'center', backgroundColor: C.sageS },
  closeBtnText:{ color: C.blueDeep, fontSize: SZ.base, fontFamily: F.bold },
  adviceText:  { fontFamily: F.mono, color: C.ink, fontSize: SZ.md, lineHeight: 24, marginBottom: 20 },
  gotItBtn:    { backgroundColor: C.gold, borderRadius: 12, padding: 14, alignItems: 'center' },
  gotItText:   { fontFamily: F.bold, fontSize: SZ.base, color: C.ink, letterSpacing: 2 },
});
