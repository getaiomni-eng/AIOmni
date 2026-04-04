import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useState } from 'react';
import { FlatList, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, F, SP, SZ } from '../constants/tokens';

type Format   = 'PPR' | 'HALF' | 'STD';
type Position = 'ALL' | 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DST';
type Mode     = 'community' | 'mine';

interface Player {
  id: string; name: string; position: string; team: string;
  rank: number; bye?: number; trend?: 'up' | 'down' | 'neutral'; drafted?: boolean;
}

const SURFACE  = 'rgba(255,255,255,0.90)';
const BORDER   = 'rgba(88,131,191,0.32)';
const BEVEL_HI = 'rgba(255,255,255,0.95)';

const POS_COLORS: Record<string, string> = {
  QB: '#7b5ea7', RB: '#1e8c42', WR: '#2a7aaa',
  TE: '#b85a1a', K: '#6b7491', DST: '#7b5ea7',
};

const SEED_PLAYERS: Player[] = [
  { id:'4046',  name:'Christian McCaffrey',  position:'RB', team:'SF',  rank:1  },
  { id:'6786',  name:'CeeDee Lamb',           position:'WR', team:'DAL', rank:2  },
  { id:'7564',  name:'Tyreek Hill',           position:'WR', team:'MIA', rank:3  },
  { id:'4866',  name:'Justin Jefferson',       position:'WR', team:'MIN', rank:4  },
  { id:'6770',  name:"Ja'Marr Chase",          position:'WR', team:'CIN', rank:5  },
  { id:'4039',  name:'Saquon Barkley',         position:'RB', team:'PHI', rank:6  },
  { id:'4988',  name:'Amon-Ra St. Brown',      position:'WR', team:'DET', rank:7  },
  { id:'2449',  name:'Travis Kelce',           position:'TE', team:'KC',  rank:8  },
  { id:'7547',  name:'Josh Allen',             position:'QB', team:'BUF', rank:9  },
  { id:'4136',  name:'Derrick Henry',          position:'RB', team:'TEN', rank:10 },
  { id:'5123',  name:'Lamar Jackson',          position:'QB', team:'BAL', rank:11 },
  { id:'7569',  name:'Jalen Hurts',            position:'QB', team:'PHI', rank:12 },
  { id:'6813',  name:'Kyren Williams',         position:'RB', team:'LAR', rank:13 },
  { id:'4137',  name:'Alvin Kamara',           position:'RB', team:'NO',  rank:14 },
  { id:'4217',  name:'Patrick Mahomes',        position:'QB', team:'KC',  rank:15 },
  { id:'6828',  name:'Jahmyr Gibbs',           position:'RB', team:'DET', rank:16 },
  { id:'6826',  name:'Garrett Wilson',         position:'WR', team:'NYJ', rank:17 },
  { id:'4020',  name:'George Kittle',          position:'TE', team:'SF',  rank:18 },
  { id:'7576',  name:'Puka Nacua',             position:'WR', team:'LAR', rank:19 },
  { id:'4984',  name:'A.J. Brown',             position:'WR', team:'PHI', rank:20 },
  { id:'6791',  name:'Rashee Rice',            position:'WR', team:'KC',  rank:21 },
  { id:'6828',  name:'Bijan Robinson',         position:'RB', team:'ATL', rank:22 },
  { id:'5938',  name:'Mark Andrews',           position:'TE', team:'BAL', rank:23 },
  { id:'7554',  name:'Sam LaPorta',            position:'TE', team:'DET', rank:24 },
  { id:'5124',  name:'Tua Tagovailoa',         position:'QB', team:'MIA', rank:25 },
  { id:'4063',  name:'DK Metcalf',             position:'WR', team:'SEA', rank:26 },
  { id:'6783',  name:'Jonathan Taylor',        position:'RB', team:'IND', rank:27 },
  { id:'5016',  name:'Trey McBride',           position:'TE', team:'ARI', rank:28 },
  { id:'5849',  name:'DeVonta Smith',          position:'WR', team:'PHI', rank:29 },
  { id:'6800',  name:'Michael Pittman Jr.',    position:'WR', team:'IND', rank:30 },
].map(p => ({ ...p, trend: 'neutral' as const, drafted: false }));

function PlayerPhoto({ playerId, size = 48 }: { playerId: string; size?: number }) {
  const [err, setErr] = useState(false);
  const s = { width: size, height: size, borderRadius: size / 2 };
  if (!err) return <Image source={{ uri:`https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg` }} style={[s, { backgroundColor: SURFACE }]} onError={() => setErr(true)} />;
  return <View style={[s, { backgroundColor: C.sageS, alignItems:'center', justifyContent:'center', borderWidth:1.5, borderColor:BORDER }]}><Text style={{ fontSize: size*0.35, color: C.dim2 }}>?</Text></View>;
}

export default function RankingsScreen() {
  const insets = useSafeAreaInsets();
  const [mode,     setMode]     = useState<Mode>('community');
  const [format,   setFormat]   = useState<Format>('PPR');
  const [position, setPosition] = useState<Position>('ALL');
  const [search,   setSearch]   = useState('');
  const [players,  setPlayers]  = useState<Player[]>(SEED_PLAYERS);
  const [myRanks,  setMyRanks]  = useState<Player[]>([]);
  const [draftMode,setDraftMode]= useState(false);
  const [showPlatformPrompt, setShowPlatformPrompt] = useState(false);

  const POSITIONS: Position[] = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K'];

  useEffect(() => {
    AsyncStorage.getItem('custom_rankings').then(saved => {
      if (saved) setMyRanks(JSON.parse(saved));
      else { setShowPlatformPrompt(true); setMyRanks([...SEED_PLAYERS]); }
    });
  }, []);

  const saveMyRanks = (ranks: Player[]) => { setMyRanks(ranks); AsyncStorage.setItem('custom_rankings', JSON.stringify(ranks)); };
  const initFromPlatform = () => { setShowPlatformPrompt(false); saveMyRanks([...SEED_PLAYERS]); setMode('mine'); };

  const activeList = mode === 'mine' ? myRanks : players;
  const filtered   = activeList.filter(p => (position === 'ALL' || p.position === position) && (!search || p.name.toLowerCase().includes(search.toLowerCase()) || p.team.toLowerCase().includes(search.toLowerCase())));

  const moveUp = (idx: number) => {
    if (idx === 0) return;
    const list = [...myRanks];
    const gi = myRanks.findIndex(p => p.id === filtered[idx].id && p.name === filtered[idx].name);
    const pi = myRanks.findIndex(p => p.id === filtered[idx-1].id && p.name === filtered[idx-1].name);
    if (gi < 0 || pi < 0) return;
    [list[gi], list[pi]] = [list[pi], list[gi]];
    list.forEach((p,i) => { p.rank = i+1; });
    saveMyRanks(list);
  };

  const toggleDrafted = (player: Player) => saveMyRanks(myRanks.map(p => p.id === player.id && p.name === player.name ? { ...p, drafted: !p.drafted } : p));
  const resetMyRanks  = () => saveMyRanks(SEED_PLAYERS.map(p => ({ ...p, drafted: false })));

  const renderPlayer = ({ item, index, drag, isActive }: RenderItemParams<Player> & { index: number }) => {
    const posColor = POS_COLORS[item.position] || C.dim2;
    const isDrafted = item.drafted;
    return (
      <ScaleDecorator>
        <View style={[styles.playerRow, isDrafted && styles.playerRowDrafted, isActive && { backgroundColor: C.goldS, borderColor: C.goldBorder }]}>
          <View style={styles.rankWrap}>
            <Text style={[styles.rankNum, isDrafted && { color: C.dim2 }]}>{(index ?? 0) + 1}</Text>
          </View>
          <View style={{ opacity: isDrafted ? 0.4 : 1 }}>
            <PlayerPhoto playerId={item.id} size={44} />
            <View style={[styles.posBadge, { backgroundColor: posColor }]}>
              <Text style={styles.posBadgeText}>{item.position}</Text>
            </View>
          </View>
          <View style={[styles.playerInfo, isDrafted && { opacity: 0.5 }]}>
            <Text style={[styles.playerName, isDrafted && { textDecorationLine: 'line-through' }]} numberOfLines={1}>{item.name}</Text>
            <Text style={styles.playerTeam}>{item.team}{item.bye ? ` · BYE ${item.bye}` : ''}</Text>
          </View>
          <View style={styles.actions}>
            {draftMode && mode === 'mine' ? (
              <TouchableOpacity style={[styles.draftBtn, isDrafted && styles.draftBtnOn]} onPress={() => toggleDrafted(item)}>
                <Text style={[styles.draftBtnTxt, isDrafted && { color: C.blueDeep }]}>{isDrafted ? '✓' : '○'}</Text>
              </TouchableOpacity>
            ) : mode === 'mine' ? (
              <TouchableOpacity onLongPress={drag} delayLongPress={150} style={styles.dragHandle}>
                <Text style={styles.dragIcon}>⠿</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </ScaleDecorator>
    );
  };

  return (
    <LinearGradient colors={[C.bgTop, C.bgBot]} style={{ flex: 1 }}>
      <View style={[styles.container, { paddingTop: insets.top + 8 }]}>

        {/* Platform prompt */}
        {showPlatformPrompt && (
          <View style={styles.platformOverlay}>
            <View style={styles.platformSheet}>
              <Text style={styles.platformTitle}>START YOUR RANKINGS</Text>
              <Text style={styles.platformSub}>Choose a base to start your custom rankings from.</Text>
              {[
                { label:'AIOmni Consensus', sub:'Community-weighted rankings', color:C.gold,     platform:'aiomni'  },
                { label:'Sleeper ADP',      sub:'Based on Sleeper draft trends', color:C.blueDeep, platform:'sleeper' },
                { label:'ESPN ADP',         sub:'Based on ESPN draft trends',    color:'#e03030',  platform:'espn'    },
                { label:'Yahoo ADP',        sub:'Based on Yahoo draft trends',   color:'#6001D2',  platform:'yahoo'   },
              ].map(opt => (
                <TouchableOpacity key={opt.platform} style={[styles.platformOption, { borderColor: opt.color + '40' }]} onPress={initFromPlatform}>
                  <View style={[styles.platformDot, { backgroundColor: opt.color }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.platformOptLabel, { color: opt.color }]}>{opt.label}</Text>
                    <Text style={styles.platformOptSub}>{opt.sub}</Text>
                  </View>
                  <Text style={{ color: C.dim2, fontSize: 18 }}>›</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>RANKINGS</Text>
            <Text style={styles.headline}>{mode === 'community' ? 'Community Consensus' : 'My Custom Rankings'}</Text>
          </View>
          {mode === 'mine' && (
            <View style={styles.headerActions}>
              <TouchableOpacity style={[styles.draftModeBtn, draftMode && styles.draftModeBtnOn]} onPress={() => setDraftMode(d => !d)}>
                <Text style={[styles.draftModeTxt, draftMode && { color: C.blueDeep }]}>{draftMode ? '✓ DRAFT' : '⊙ DRAFT'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.resetBtn} onPress={resetMyRanks}>
                <Text style={styles.resetTxt}>RESET</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Mode toggle */}
        <View style={styles.modeToggle}>
          {(['community','mine'] as Mode[]).map(m => (
            <TouchableOpacity key={m} style={[styles.modeBtn, mode === m && styles.modeBtnOn]} onPress={() => setMode(m)}>
              <Text style={[styles.modeTxt, mode === m && styles.modeTxtOn]}>{m === 'community' ? '👥 COMMUNITY' : '⭐ MINE'}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Filters */}
        <View style={styles.filtersRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {(['PPR','HALF','STD'] as Format[]).map(f => (
              <TouchableOpacity key={f} style={[styles.filterChip, format === f && { backgroundColor: C.goldS, borderColor: C.goldBorder }]} onPress={() => setFormat(f)}>
                <Text style={[styles.filterChipTxt, format === f && { color: C.blueDeep }]}>{f === 'HALF' ? '0.5 PPR' : f}</Text>
              </TouchableOpacity>
            ))}
            <View style={styles.filterSep} />
            {POSITIONS.map(pos => (
              <TouchableOpacity key={pos} style={[styles.filterChip, position === pos && { backgroundColor: (POS_COLORS[pos] ?? C.blueDeep) + '18', borderColor: (POS_COLORS[pos] ?? C.blueDeep) + '55' }]} onPress={() => setPosition(pos)}>
                <Text style={[styles.filterChipTxt, position === pos && { color: POS_COLORS[pos] ?? C.blueDeep }]}>{pos}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Search */}
        <View style={styles.searchWrap}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput style={styles.searchInput} placeholder="Search players..." placeholderTextColor={C.dim2} value={search} onChangeText={setSearch} />
          {search ? <TouchableOpacity onPress={() => setSearch('')}><Text style={styles.searchClear}>✕</Text></TouchableOpacity> : null}
        </View>

        {/* Banner */}
        <View style={[styles.communityBanner, draftMode && mode === 'mine' && { borderColor: C.goldBorder, backgroundColor: C.goldS }]}>
          <Text style={[styles.communityTxt, draftMode && mode === 'mine' && { color: C.blueDeep }]}>
            {mode === 'community'
              ? `📊 Community consensus · ${format} scoring · Updated daily`
              : draftMode
                ? '⊙ Draft mode — tap ○ to mark as drafted'
                : '⭐ Your rankings · Hold ⠿ to drag and reorder'}
          </Text>
        </View>

        {/* List */}
        {mode === 'mine' ? (
          <DraggableFlatList
            data={filtered}
            keyExtractor={(item, i) => `${item.id}-${i}`}
            renderItem={renderPlayer}
            onDragEnd={({ data }) => saveMyRanks(data)}
            contentContainerStyle={{ paddingBottom: 100, paddingTop: 4 }}
            showsVerticalScrollIndicator={false}
            ItemSeparatorComponent={() => <View style={{ height: 4 }} />}
          />
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(item, i) => `${item.id}-${item.name}-${i}`}
            renderItem={({ item, index }) => renderPlayer({ item, index, drag: () => {}, isActive: false })}
            contentContainerStyle={{ paddingBottom: 100, paddingTop: 4 }}
            showsVerticalScrollIndicator={false}
            ItemSeparatorComponent={() => <View style={{ height: 4 }} />}
          />
        )}
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: SP[3] },

  header:        { flexDirection:'row', alignItems:'flex-start', justifyContent:'space-between', marginBottom:12 },
  eyebrow:       { fontSize:SZ.xs, fontFamily:F.mono, color:C.blueDeep, letterSpacing:2, marginBottom:2 },
  headline:      { fontSize:SZ.xl, fontFamily:F.bold, color:C.ink },
  headerActions: { flexDirection:'row', gap:8, alignItems:'center' },

  draftModeBtn:   { borderWidth:1.5, borderColor:BORDER, borderRadius:8, paddingHorizontal:10, paddingVertical:5, backgroundColor:SURFACE },
  draftModeBtnOn: { borderColor:C.blueDeep, backgroundColor:C.sageS },
  draftModeTxt:   { fontFamily:F.mono, color:C.dim2, fontSize:SZ.xs, letterSpacing:1 },
  resetBtn:       { borderWidth:1.5, borderColor:'rgba(168,48,64,0.3)', borderRadius:8, paddingHorizontal:10, paddingVertical:5 },
  resetTxt:       { fontFamily:F.mono, color:'#a83040', fontSize:SZ.xs, letterSpacing:1 },

  modeToggle: { flexDirection:'row', backgroundColor:SURFACE, borderRadius:12, padding:3, marginBottom:10, borderWidth:1.5, borderColor:BORDER },
  modeBtn:    { flex:1, paddingVertical:7, borderRadius:9, alignItems:'center' },
  modeBtnOn:  { backgroundColor:C.sageS },
  modeTxt:    { fontFamily:F.mono, color:C.dim2, fontSize:SZ.xs, letterSpacing:1 },
  modeTxtOn:  { color:C.blueDeep, fontFamily:F.bold },

  filtersRow:    { marginBottom:8 },
  filterChip:    { paddingHorizontal:10, paddingVertical:5, borderRadius:8, borderWidth:1.5, borderColor:BORDER, backgroundColor:SURFACE },
  filterChipTxt: { fontFamily:F.mono, color:C.dim2, fontSize:SZ.xs-1, letterSpacing:0.8 },
  filterSep:     { width:1, backgroundColor:BORDER, marginHorizontal:2 },

  searchWrap:  { flexDirection:'row', alignItems:'center', backgroundColor:SURFACE, borderWidth:1.5, borderColor:BORDER, borderRadius:10, paddingHorizontal:10, paddingVertical:6, marginBottom:8, gap:7 },
  searchIcon:  { fontSize:14 },
  searchInput: { flex:1, fontFamily:F.mono, color:C.ink, fontSize:SZ.sm },
  searchClear: { color:C.dim2, fontSize:14, padding:2 },

  communityBanner: { borderWidth:1.5, borderColor:BORDER, borderRadius:8, paddingHorizontal:10, paddingVertical:6, marginBottom:8, backgroundColor:SURFACE },
  communityTxt:    { fontFamily:F.mono, color:C.dim2, fontSize:SZ.xs-1, letterSpacing:0.5 },

  playerRow: {
    flexDirection:'row', alignItems:'center',
    backgroundColor:SURFACE, borderWidth:1.5, borderColor:BORDER,
    borderRadius:12, paddingVertical:8, paddingHorizontal:10, gap:10,
    shadowColor:'#3d6aaa', shadowOffset:{width:0,height:1}, shadowOpacity:0.06, shadowRadius:4, elevation:2,
  },
  playerRowDrafted: { opacity:0.45 },

  rankWrap:  { width:28, alignItems:'center' },
  rankNum:   { fontFamily:F.bold, color:C.ink, fontSize:SZ.base, lineHeight:18 },

  posBadge:     { position:'absolute', bottom:-2, right:-2, paddingHorizontal:4, paddingVertical:1, borderRadius:4, minWidth:22, alignItems:'center' },
  posBadgeText: { fontFamily:F.mono, fontSize:7, fontWeight:'700', color:'#ffffff' },

  playerInfo: { flex:1 },
  playerName: { fontFamily:F.bold, color:C.ink, fontSize:SZ.base },
  playerTeam: { fontFamily:F.mono, color:C.dim2, fontSize:SZ.xs-1, marginTop:1, letterSpacing:0.4 },

  actions:    { flexDirection:'row', alignItems:'center', gap:4 },
  dragHandle: { padding:10, justifyContent:'center', alignItems:'center' },
  dragIcon:   { fontSize:20, color:C.dim2, letterSpacing:-1 },

  draftBtn:    { width:32, height:32, borderRadius:8, borderWidth:1.5, borderColor:BORDER, alignItems:'center', justifyContent:'center', backgroundColor:SURFACE },
  draftBtnOn:  { borderColor:C.blueDeep, backgroundColor:C.sageS },
  draftBtnTxt: { fontSize:16, color:C.dim2 },

  platformOverlay: { position:'absolute', top:0, left:0, right:0, bottom:0, backgroundColor:'rgba(26,31,46,0.7)', zIndex:100, justifyContent:'center', padding:SP[3] },
  platformSheet:   { backgroundColor:'#ffffff', borderRadius:20, padding:24, borderWidth:1.5, borderColor:BORDER },
  platformTitle:   { fontFamily:F.bold, color:C.blueDeep, fontSize:SZ.sm, letterSpacing:2, marginBottom:8 },
  platformSub:     { fontFamily:F.mono, color:C.dim2, fontSize:SZ.sm, lineHeight:18, marginBottom:20 },
  platformOption:  { flexDirection:'row', alignItems:'center', gap:12, padding:14, borderRadius:12, borderWidth:1.5, marginBottom:8, backgroundColor:SURFACE },
  platformDot:     { width:10, height:10, borderRadius:5 },
  platformOptLabel:{ fontFamily:F.bold, fontSize:SZ.base, marginBottom:2 },
  platformOptSub:  { fontFamily:F.mono, color:C.dim2, fontSize:SZ.xs-1, letterSpacing:0.3 },
});