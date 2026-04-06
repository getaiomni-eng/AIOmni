import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useState } from 'react';
import {
  FlatList, Image, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, F, SP, SZ, BEVEL } from '../constants/tokens';

type Format   = 'PPR' | 'HALF' | 'STD';
type Position = 'ALL' | 'QB' | 'RB' | 'WR' | 'TE' | 'K';
type Mode     = 'community' | 'mine';

interface Player {
  id: string; name: string; position: string; team: string;
  rank: number; bye?: number; trend?: 'up' | 'down' | 'neutral'; drafted?: boolean;
}

const POS_COLORS: Record<string, string> = {
  QB: '#7b5ea7', RB: '#1e8c42', WR: '#2a7aaa',
  TE: '#b85a1a', K: '#6b7491',
};

// 2025 consensus rankings
const SEED_PLAYERS: Player[] = [
  { id:'4046',  name:'Christian McCaffrey',  position:'RB', team:'SF',  rank:1  },
  { id:'6786',  name:'CeeDee Lamb',          position:'WR', team:'DAL', rank:2  },
  { id:'7564',  name:'Tyreek Hill',          position:'WR', team:'MIA', rank:3  },
  { id:'4866',  name:'Justin Jefferson',     position:'WR', team:'MIN', rank:4  },
  { id:'6770',  name:"Ja'Marr Chase",        position:'WR', team:'CIN', rank:5  },
  { id:'4039',  name:'Saquon Barkley',       position:'RB', team:'PHI', rank:6  },
  { id:'4988',  name:'Amon-Ra St. Brown',    position:'WR', team:'DET', rank:7  },
  { id:'2449',  name:'Travis Kelce',         position:'TE', team:'KC',  rank:8  },
  { id:'7547',  name:'Josh Allen',           position:'QB', team:'BUF', rank:9  },
  { id:'5892',  name:'Derrick Henry',        position:'RB', team:'BAL', rank:10 },
  { id:'5123',  name:'Lamar Jackson',        position:'QB', team:'BAL', rank:11 },
  { id:'7569',  name:'Jalen Hurts',          position:'QB', team:'PHI', rank:12 },
  { id:'6813',  name:'Kyren Williams',       position:'RB', team:'LAR', rank:13 },
  { id:'4137',  name:'Alvin Kamara',         position:'RB', team:'NO',  rank:14 },
  { id:'4217',  name:'Patrick Mahomes',      position:'QB', team:'KC',  rank:15 },
  { id:'9509',  name:'Jahmyr Gibbs',         position:'RB', team:'DET', rank:16 },
  { id:'6826',  name:'Garrett Wilson',       position:'WR', team:'NYJ', rank:17 },
  { id:'4020',  name:'George Kittle',        position:'TE', team:'SF',  rank:18 },
  { id:'10222', name:'Puka Nacua',           position:'WR', team:'LAR', rank:19 },
  { id:'4984',  name:'A.J. Brown',           position:'WR', team:'PHI', rank:20 },
  { id:'9988',  name:'Rashee Rice',          position:'WR', team:'KC',  rank:21 },
  { id:'9508',  name:'Bijan Robinson',       position:'RB', team:'ATL', rank:22 },
  { id:'5938',  name:'Mark Andrews',         position:'TE', team:'BAL', rank:23 },
  { id:'10859', name:'Sam LaPorta',          position:'TE', team:'DET', rank:24 },
  { id:'5124',  name:'Tua Tagovailoa',       position:'QB', team:'MIA', rank:25 },
  { id:'4063',  name:'DK Metcalf',           position:'WR', team:'SEA', rank:26 },
  { id:'6783',  name:'Jonathan Taylor',      position:'RB', team:'IND', rank:27 },
  { id:'9493',  name:'Trey McBride',         position:'TE', team:'ARI', rank:28 },
  { id:'5849',  name:'DeVonta Smith',        position:'WR', team:'PHI', rank:29 },
  { id:'7588',  name:'Michael Pittman Jr.',  position:'WR', team:'IND', rank:30 },
].map(p => ({ ...p, trend: 'neutral' as const, drafted: false }));

function PlayerPhoto({ playerId, size = 48 }: { playerId: string; size?: number }) {
  const [err, setErr] = useState(false);
  const s = { width: size, height: size, borderRadius: size / 2 };
  if (!err && playerId) {
    return (
      <Image
        source={{ uri: `https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg` }}
        style={[s, { backgroundColor: 'rgba(255,255,255,0.9)' }]}
        onError={() => setErr(true)}
      />
    );
  }
  return (
    <View style={[s, { backgroundColor: C.sageS, alignItems:'center', justifyContent:'center', borderWidth:1.5, borderColor: 'rgba(88,131,191,0.18)' }]}>
      <Text style={{ fontSize: size * 0.35, color: C.dim2 }}>?</Text>
    </View>
  );
}

export default function RankingsScreen() {
  const insets = useSafeAreaInsets();
  const [mode,      setMode]      = useState<Mode>('community');
  const [format,    setFormat]    = useState<Format>('PPR');
  const [position,  setPosition]  = useState<Position>('ALL');
  const [search,    setSearch]    = useState('');
  const [players]                 = useState<Player[]>(SEED_PLAYERS);
  const [rankedPlayers, setRankedPlayers] = useState<Player[]>([]);
  const [draftMode, setDraftMode] = useState(false);
  const [showPlatformPrompt, setShowPlatformPrompt] = useState(false);

  const resetMyRanks = () => {
    setRankedPlayers([...SEED_PLAYERS]);
    AsyncStorage.setItem('custom_rankings_v2', JSON.stringify(SEED_PLAYERS));
  };

  const POSITIONS: Position[] = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K'];

  useEffect(() => {
    AsyncStorage.getItem('custom_rankings_v2').then(saved => {
      if (saved) {
        try { setRankedPlayers(JSON.parse(saved)); }
        catch { setShowPlatformPrompt(true); setRankedPlayers([...SEED_PLAYERS]); }
      } else {
        setShowPlatformPrompt(true);
        setRankedPlayers([...SEED_PLAYERS]);
      }
    });
  }, []);

  const saveMyRanks = (ranks: Player[]) => {
    setRankedPlayers(ranks);
    AsyncStorage.setItem('custom_rankings_v2', JSON.stringify(ranks));
  };

  const initFromPlatform = () => {
    setShowPlatformPrompt(false);
    saveMyRanks([...SEED_PLAYERS]);
    setMode('mine');
  };

  const activeList = mode === 'mine' ? rankedPlayers : players;
  const filtered = activeList.filter(p =>
    (position === 'ALL' || p.position === position) &&
    (!search || p.name.toLowerCase().includes(search.toLowerCase()) || p.team.toLowerCase().includes(search.toLowerCase()))
  );

  const toggleDrafted = (player: Player) => {
    saveMyRanks(rankedPlayers.map(p =>
      p.id === player.id && p.name === player.name ? { ...p, drafted: !p.drafted } : p
    ));
  };

  const onDragEnd = ({ data }: { data: Player[] }) => { saveMyRanks(data); };

  const renderDraggableItem = ({ item, drag, isActive, getIndex }: RenderItemParams<Player>) => {
    const index    = getIndex?.() ?? 0;
    const posColor = POS_COLORS[item.position] || C.dim2;
    const isDrafted = item.drafted;

    return (
      <ScaleDecorator>
        <TouchableOpacity
          onLongPress={drag}
          disabled={isActive}
          style={[styles.playerRow, isActive && styles.playerRowActive, isDrafted && styles.playerRowDrafted]}
        >
          <View style={styles.playerLeft}>
            <Text style={[styles.rankNum, { color: index < 3 ? C.gold : C.blueDeep }]}>{index + 1}</Text>
            <PlayerPhoto playerId={item.id} size={40} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={[styles.playerName, isDrafted && styles.playerNameDrafted]}>{item.name}</Text>
              <Text style={styles.playerSub}>{item.team} · {item.position}</Text>
            </View>
          </View>
          <View style={styles.playerRight}>
            {mode === 'mine' && (
              <TouchableOpacity onPress={() => toggleDrafted(item)} style={styles.draftBtn}>
                <Text style={[styles.draftTxt, isDrafted && styles.draftTxtOn]}>{isDrafted ? '✓' : '+'}</Text>
              </TouchableOpacity>
            )}
          </View>
        </TouchableOpacity>
      </ScaleDecorator>
    );
  };

  const renderStaticItem = ({ item, index }: { item: Player; index: number }) => {
    const posColor = POS_COLORS[item.position] || C.dim2;
    const isDrafted = item.drafted;

    return (
      <View style={[styles.playerRow, isDrafted && styles.playerRowDrafted]}>
        <View style={styles.playerLeft}>
          <Text style={[styles.rankNum, { color: index < 3 ? C.gold : C.blueDeep }]}>{index + 1}</Text>
          <PlayerPhoto playerId={item.id} size={40} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={[styles.playerName, isDrafted && styles.playerNameDrafted]}>{item.name}</Text>
            <Text style={styles.playerSub}>{item.team} · {item.position}</Text>
          </View>
        </View>
        <View style={styles.playerRight}>
          {mode === 'mine' && (
            <TouchableOpacity onPress={() => toggleDrafted(item)} style={styles.draftBtn}>
              <Text style={[styles.draftTxt, isDrafted && styles.draftTxtOn]}>{isDrafted ? '✓' : '+'}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  return (
    <LinearGradient colors={[C.bgTop, C.bgBot]} style={{ flex: 1 }}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.eyebrow}>RANKINGS</Text>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Rankings.</Text>
          <TouchableOpacity onPress={() => setMode('mine')} style={[styles.myRankingsPill, mode === 'mine' && styles.myRankingsPillOn]}>
            <Text style={[styles.myRankingsTxt, mode === 'mine' && styles.myRankingsTxtOn]}>My Rankings</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.filterRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {POSITIONS.map(pos => (
              <TouchableOpacity
                key={pos}
                onPress={() => setPosition(pos)}
                style={[styles.posBtn, position === pos && { backgroundColor: pos === 'ALL' ? C.blueDeep : POS_COLORS[pos] || C.blueDeep }]}
              >
                <Text style={[styles.posTxt, position === pos && styles.posTxtOn]}>{pos}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </View>

      {mode === 'mine' && draftMode && (
        <View style={styles.editBar}>
          <TouchableOpacity onPress={resetMyRanks} style={styles.resetBtn}>
            <Text style={styles.resetTxt}>Reset to Consensus</Text>
          </TouchableOpacity>
          <Text style={styles.editHint}>Long press to drag & reorder</Text>
        </View>
      )}

      {mode === 'mine' && draftMode ? (
        <DraggableFlatList
          data={filtered}
          onDragEnd={onDragEnd}
          keyExtractor={(item) => item.id}
          renderItem={renderDraggableItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => item.id}
          renderItem={renderStaticItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}

      {showPlatformPrompt && (
        <View style={styles.promptOverlay}>
          <View style={styles.promptCard}>
            <Text style={styles.promptTitle}>Set Up Your Rankings</Text>
            <Text style={styles.promptTxt}>Start with 2025 consensus rankings and customize for your league.</Text>
            <TouchableOpacity onPress={initFromPlatform} style={styles.promptBtn}>
              <Text style={styles.promptBtnTxt}>Get Started</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: SP[3],
    paddingBottom: 8,
  },
  eyebrow: {
    fontSize: 9,
    fontFamily: F.mono,
    color: C.dim2,
    letterSpacing: 2,
    marginBottom: 4,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: {
    fontSize: 36,
    fontFamily: F.bold,
    color: C.ink,
  },
  myRankingsPill: {
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: C.sageG,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  myRankingsPillOn: {
    borderColor: C.blueDeep,
    borderWidth: 2,
  },
  myRankingsTxt: {
    fontSize: SZ.sm,
    fontFamily: F.mono,
    color: C.blueDeep,
    letterSpacing: 0.5,
  },
  myRankingsTxtOn: {
    color: C.blueDeep,
    fontFamily: F.bold,
  },
  filters: {
    paddingHorizontal: SP[3],
    paddingBottom: 12,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  modeBtn: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  modeBtnOn: {
    backgroundColor: "#ffffff",
  },
  modeTxt: {
    fontSize: SZ.sm,
    fontFamily: F.mono,
    color: "#ffffff",
  },
  modeTxtOn: {
    color: C.ink,
  },
  filterRow: {
    marginBottom: 12,
  },
  posBtn: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  posBtnOn: {
    backgroundColor: C.blueDeep,
  },
  posTxt: {
    fontSize: SZ.sm,
    fontFamily: F.mono,
    color: "#ffffff",
  },
  posTxtOn: {
    color: "#ffffff",
    fontFamily: F.mono,
  },
  searchRow: {
    marginBottom: 8,
  },
  searchInput: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 12,
    padding: 12,
    fontSize: SZ.sm,
    color: C.ink,
    fontFamily: F.mono,
    borderWidth: 1.5,
    borderColor: 'rgba(88,131,191,0.18)',
  },
  editBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SP[3],
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  resetBtn: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  resetTxt: {
    fontSize: SZ.xs,
    fontFamily: F.mono,
    color: "#ffffff",
  },
  editHint: {
    fontSize: SZ.xs,
    fontFamily: F.mono,
    color: C.dim2,
  },
  list: {
    paddingHorizontal: SP[3],
    paddingBottom: 100,
  },
  playerRow: {
    ...BEVEL.card,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  playerRowActive: {
    opacity: 0.8,
    transform: [{ scale: 1.02 }],
  },
  playerRowDrafted: {
    backgroundColor: 'rgba(217,253,243,0.9)',
    borderColor: C.mint,
  },
  playerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  rankNum: {
    fontSize: SZ.lg,
    fontFamily: F.bold,
    width: 32,
    textAlign: 'center',
  },
  playerName: {
    fontSize: 14,
    fontFamily: F.bold,
    color: C.ink,
  },
  playerNameDrafted: {
    textDecorationLine: 'line-through',
    color: C.dim2,
  },
  playerSub: {
    fontSize: 8,
    fontFamily: F.mono,
    color: C.dim2,
    marginTop: 2,
  },
  playerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  draftBtn: {
    backgroundColor: 'rgba(88,131,191,0.1)',
    borderRadius: 8,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  draftTxt: {
    fontSize: SZ.sm,
    fontFamily: F.mono,
    color: C.dim2,
  },
  draftTxtOn: {
    color: C.mint,
  },
  promptOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  promptCard: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 24,
    width: '80%',
    alignItems: 'center',
  },
  promptTitle: {
    fontSize: SZ.lg,
    fontFamily: F.bold,
    color: C.ink,
    marginBottom: 8,
  },
  promptTxt: {
    fontSize: SZ.sm,
    fontFamily: F.outfit,
    color: C.dim,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  promptBtn: {
    backgroundColor: C.blueDeep,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  promptBtnTxt: {
    color: "#ffffff",
    fontSize: SZ.sm,
    fontFamily: F.mono,
  },
});
