import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useState, useCallback } from 'react';
import {
  Image, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, F, SP, SZ } from '../constants/tokens';

type Format   = 'PPR' | 'HALF' | 'STD' | 'SF' | 'DYN';
type Position = 'ALL' | 'QB' | 'RB' | 'WR' | 'TE' | 'K';
type Mode     = 'community' | 'mine';

interface Player {
  id: string; name: string; position: string; team: string;
  rank: number; adp: string; trend: 'up' | 'down' | 'flat'; trendVal: number;
  tier: number;
}

const POS_COLORS: Record<string, { bg: string; color: string }> = {
  QB: { bg: 'rgba(123,94,167,0.15)', color: '#7b5ea7' },
  RB: { bg: 'rgba(30,140,66,0.12)',  color: '#1e8c42' },
  WR: { bg: 'rgba(42,122,170,0.12)', color: '#2a7aaa' },
  TE: { bg: 'rgba(184,90,26,0.12)',  color: '#b85a1a' },
  K:  { bg: 'rgba(107,116,145,0.10)', color: '#6b7491' },
};

const SEED: Player[] = [
  { id:'9509',  name:'Bijan Robinson',       position:'RB', team:'ATL', rank:1,  adp:'1.2', trend:'up',   trendVal:2, tier:1 },
  { id:'7564',  name:"Ja'Marr Chase",        position:'WR', team:'CIN', rank:2,  adp:'2.1', trend:'up',   trendVal:1, tier:1 },
  { id:'6786',  name:'CeeDee Lamb',          position:'WR', team:'DAL', rank:3,  adp:'3.4', trend:'flat', trendVal:0, tier:1 },
  { id:'4866',  name:'Saquon Barkley',       position:'RB', team:'PHI', rank:4,  adp:'3.8', trend:'down', trendVal:1, tier:1 },
  { id:'6794',  name:'Justin Jefferson',     position:'WR', team:'MIN', rank:5,  adp:'5.1', trend:'up',   trendVal:3, tier:2 },
  { id:'1466',  name:'Travis Kelce',         position:'TE', team:'KC',  rank:6,  adp:'6.2', trend:'down', trendVal:2, tier:2 },
  { id:'4984',  name:'Josh Allen',           position:'QB', team:'BUF', rank:7,  adp:'7.0', trend:'up',   trendVal:1, tier:2 },
  { id:'4034',  name:'Christian McCaffrey',  position:'RB', team:'SF',  rank:8,  adp:'4.5', trend:'down', trendVal:5, tier:2 },
  { id:'3321',  name:'Tyreek Hill',          position:'WR', team:'MIA', rank:9,  adp:'8.8', trend:'flat', trendVal:0, tier:2 },
  { id:'7547',  name:'Amon-Ra St. Brown',    position:'WR', team:'DET', rank:10, adp:'9.5', trend:'up',   trendVal:2, tier:3 },
  { id:'3198',  name:'Derrick Henry',        position:'RB', team:'BAL', rank:11, adp:'10.2',trend:'flat', trendVal:0, tier:3 },
  { id:'9221',  name:'Jahmyr Gibbs',         position:'RB', team:'DET', rank:12, adp:'11.1',trend:'up',   trendVal:4, tier:3 },
  { id:'4881',  name:'Lamar Jackson',        position:'QB', team:'BAL', rank:13, adp:'12.0',trend:'up',   trendVal:1, tier:3 },
  { id:'6904',  name:'Jalen Hurts',          position:'QB', team:'PHI', rank:14, adp:'13.5',trend:'down', trendVal:2, tier:3 },
  { id:'9493', name:'Puka Nacua',           position:'WR', team:'LAR', rank:15, adp:'14.2',trend:'up',   trendVal:3, tier:3 },
  { id:'8150',  name:'Kyren Williams',       position:'RB', team:'LAR', rank:16, adp:'15.0',trend:'down', trendVal:1, tier:4 },
  { id:'4035',  name:'Alvin Kamara',         position:'RB', team:'NO',  rank:17, adp:'16.8',trend:'flat', trendVal:0, tier:4 },
  { id:'5859',  name:'A.J. Brown',           position:'WR', team:'PHI', rank:18, adp:'17.2',trend:'down', trendVal:3, tier:4 },
  { id:'8146',  name:'Garrett Wilson',       position:'WR', team:'NYJ', rank:19, adp:'18.5',trend:'up',   trendVal:2, tier:4 },
  { id:'4217',  name:'George Kittle',        position:'TE', team:'SF',  rank:20, adp:'19.0',trend:'flat', trendVal:0, tier:4 },
  { id:'4046',  name:'Patrick Mahomes',      position:'QB', team:'KC',  rank:21, adp:'20.1',trend:'down', trendVal:1, tier:4 },
  { id:'10229',  name:'Rashee Rice',          position:'WR', team:'KC',  rank:22, adp:'21.5',trend:'up',   trendVal:5, tier:5 },
  { id:'6813',  name:'Jonathan Taylor',      position:'RB', team:'IND', rank:23, adp:'22.0',trend:'flat', trendVal:0, tier:5 },
  { id:'5012',  name:'Mark Andrews',         position:'TE', team:'BAL', rank:24, adp:'23.2',trend:'up',   trendVal:2, tier:5 },
  { id:'10859', name:'Sam LaPorta',          position:'TE', team:'DET', rank:25, adp:'24.0',trend:'down', trendVal:1, tier:5 },
  { id:'5846',  name:'DK Metcalf',           position:'WR', team:'SEA', rank:26, adp:'25.5',trend:'up',   trendVal:1, tier:5 },
  { id:'8130',  name:'Trey McBride',         position:'TE', team:'ARI', rank:27, adp:'26.8',trend:'up',   trendVal:4, tier:5 },
  { id:'7525',  name:'DeVonta Smith',        position:'WR', team:'PHI', rank:28, adp:'27.0',trend:'flat', trendVal:0, tier:5 },
  { id:'6768',  name:'Tua Tagovailoa',       position:'QB', team:'MIA', rank:29, adp:'28.5',trend:'down', trendVal:2, tier:5 },
  { id:'6819',  name:'Michael Pittman Jr.',  position:'WR', team:'IND', rank:30, adp:'29.0',trend:'up',   trendVal:1, tier:5 },
];

const TIER_NAMES: Record<number, string> = { 1: 'TIER 1 — ELITE', 2: 'TIER 2 — BLUE CHIP', 3: 'TIER 3 — STARTER', 4: 'TIER 4 — FLEX PLAY', 5: 'TIER 5 — UPSIDE' };
const FORMATS: { key: Format; label: string }[] = [ { key: 'PPR', label: 'PPR' }, { key: 'HALF', label: 'HALF PPR' }, { key: 'STD', label: 'STANDARD' }, { key: 'SF', label: 'SUPERFLEX' }, { key: 'DYN', label: 'DYNASTY' } ];
const POSITIONS: Position[] = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K'];
const SURFACE = 'rgba(255,255,255,0.92)';

function PlayerPhoto({ playerId, size = 48 }: { playerId: string; size?: number }) {
  const [err, setErr] = useState(false);
  if (!err && playerId) return <Image source={{ uri: `https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg` }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: 'rgba(255,255,255,0.9)', borderWidth: 2, borderColor: 'rgba(88,131,191,0.15)' }} onError={() => setErr(true)} />;
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: 'rgba(88,131,191,0.08)', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'rgba(88,131,191,0.18)' }}><Text style={{ fontSize: size * 0.35, fontFamily: F.bold, color: C.dim2 }}>?</Text></View>;
}

function PlayerCard({ player, index, drag, isActive, isDrag }: { player: Player; index: number; drag?: () => void; isActive?: boolean; isDrag: boolean }) {
  const posStyle = POS_COLORS[player.position] || POS_COLORS.K;
  const consensus = Math.max(50, 100 - index * 2.5);
  const isTop3 = index < 3;

  return (
    <View style={[s.card, isActive && s.cardActive]}>
      <View style={s.cardShine} />
      <Text style={[s.rank, isTop3 && { color: C.gold }]}>{index + 1}</Text>
      <PlayerPhoto playerId={player.id} size={48} />
      <View style={s.info}>
        <Text style={s.name}>{player.name.toUpperCase()}</Text>
        <View style={s.metaRow}>
          <Text style={s.team}>{player.team}</Text>
          <View style={[s.posBadge, { backgroundColor: posStyle.bg }]}>
            <Text style={[s.posText, { color: posStyle.color }]}>{player.position}</Text>
          </View>
        </View>
        <View style={s.consensusBar}>
          <View style={[s.consensusFill, { width: `${consensus}%`, backgroundColor: isTop3 ? C.gold : '#5883bf' }]} />
        </View>
      </View>
      <View style={s.rightCol}>
        {isDrag ? (
          <TouchableOpacity onLongPress={drag} delayLongPress={100} style={s.dragHandle}>
            <Text style={s.dragIcon}>≡</Text>
          </TouchableOpacity>
        ) : (
          <>
            <Text style={s.adp}>ADP {player.adp}</Text>
            <Text style={[s.trend, player.trend === 'up' && { color: '#1e8c42' }, player.trend === 'down' && { color: '#a83040' }, player.trend === 'flat' && { color: C.dim2 }]}>
              {player.trend === 'up' ? `▲ ${player.trendVal}` : player.trend === 'down' ? `▼ ${player.trendVal}` : '—'}
            </Text>
          </>
        )}
      </View>
    </View>
  );
}

export default function RankingsScreen() {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>('community');
  const [format, setFormat] = useState<Format>('PPR');
  const [position, setPosition] = useState<Position>('ALL');
  const [search, setSearch] = useState('');
  const [myRanks, setMyRanks] = useState<Player[]>([]);

  useEffect(() => {
    AsyncStorage.getItem('my_rankings_v3').then(saved => {
      if (saved) { try { setMyRanks(JSON.parse(saved)); } catch { setMyRanks([...SEED]); } }
      else setMyRanks([...SEED]);
    });
  }, []);

  const saveMyRanks = (ranks: Player[]) => { setMyRanks(ranks); AsyncStorage.setItem('my_rankings_v3', JSON.stringify(ranks)); };
  const resetToConsensus = () => saveMyRanks([...SEED]);

  const filtered = (mode === 'mine' ? myRanks : SEED).filter(p =>
    (position === 'ALL' || p.position === position) &&
    (!search || p.name.toLowerCase().includes(search.toLowerCase()) || p.team.toLowerCase().includes(search.toLowerCase()))
  );

  const grouped: { tier: number; players: Player[] }[] = [];
  let lastTier = -1;
  filtered.forEach((p, i) => { if (p.tier !== lastTier) { grouped.push({ tier: p.tier, players: [] }); lastTier = p.tier; } grouped[grouped.length - 1].players.push({ ...p, rank: i + 1 }); });

  const renderDragItem = useCallback(({ item, drag, isActive, getIndex }: RenderItemParams<Player>) => (
    <ScaleDecorator>
      <TouchableOpacity onLongPress={drag} disabled={isActive} delayLongPress={150}>
        <PlayerCard player={item} index={getIndex?.() ?? 0} drag={drag} isActive={isActive} isDrag={true} />
      </TouchableOpacity>
    </ScaleDecorator>
  ), []);

  const Header = () => (
    <View style={{ paddingTop: insets.top + 8, backgroundColor: C.bgTop }}>
      <Text style={s.eyebrow}>RANKINGS</Text>
      <Text style={s.title}>RANKINGS.</Text>

      <View style={s.toggle}>
        <TouchableOpacity onPress={() => setMode('community')} style={[s.toggleBtn, mode === 'community' && s.toggleBtnOn]}>
          <Text style={[s.toggleText, mode === 'community' && s.toggleTextOn]}>COMMUNITY</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setMode('mine')} style={[s.toggleBtn, mode === 'mine' && s.toggleBtnOn]}>
          <Text style={[s.toggleText, mode === 'mine' && s.toggleTextOn]}>MY RANKINGS</Text>
        </TouchableOpacity>
      </View>

      <View style={s.searchWrap}>
        <View style={s.searchShine} />
        <Text style={s.searchIcon}>⌕</Text>
        <TextInput style={s.searchInput} placeholder="SEARCH PLAYERS OR TEAMS" placeholderTextColor={C.dim2} value={search} onChangeText={setSearch} autoCapitalize="none" autoCorrect={false} />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.pillScroll}>
        {POSITIONS.map(pos => (
          <TouchableOpacity key={pos} onPress={() => setPosition(pos)} style={[s.pill, position === pos && s.pillOn]}>
            <Text style={[s.pillText, position === pos && s.pillTextOn]}>{pos}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.formatScroll}>
        {FORMATS.map(fmt => (
          <TouchableOpacity key={fmt.key} onPress={() => setFormat(fmt.key)} style={[s.formatPill, format === fmt.key && s.formatPillOn]}>
            <Text style={[s.formatText, format === fmt.key && s.formatTextOn]}>{fmt.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={s.hintRow}>
        <Text style={s.hint}>CONSENSUS · 1,247 VOTES</Text>
        <Text style={s.hint}>{mode === 'mine' ? 'LONG PRESS TO DRAG' : 'ADP'}</Text>
      </View>

      {mode === 'mine' && (
        <View style={s.editBar}>
          <TouchableOpacity onPress={resetToConsensus} style={s.resetBtn}>
            <Text style={s.resetText}>RESET TO CONSENSUS</Text>
          </TouchableOpacity>
          <Text style={s.editHint}>DRAG TO REORDER</Text>
        </View>
      )}
    </View>
  );

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <LinearGradient colors={[C.bgTop, C.bgBot]} style={{ flex: 1 }}>
        {mode === 'mine' ? (
          <DraggableFlatList
            data={filtered}
            onDragEnd={({ data }) => saveMyRanks(data)}
            keyExtractor={item => item.id}
            renderItem={renderDragItem}
            ListHeaderComponent={Header}
            contentContainerStyle={{ paddingHorizontal: SP[3], paddingBottom: 100 }}
            showsVerticalScrollIndicator={false}
          />
        ) : (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SP[3], paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
            <Header />
            {grouped.map(group => (
              <React.Fragment key={group.tier}>
                <View style={s.tierDivider}><View style={s.tierLine} /><Text style={s.tierLabel}>{TIER_NAMES[group.tier]}</Text><View style={s.tierLine} /></View>
                {group.players.map((p, i) => <View key={p.id}><PlayerCard player={p} index={filtered.findIndex(fp => fp.id === p.id)} isDrag={false} /></View>)}
              </React.Fragment>
            ))}
          </ScrollView>
        )}
      </LinearGradient>
    </GestureHandlerRootView>
  );
}

const s = StyleSheet.create({
  eyebrow: { fontFamily: F.mono, fontSize: 10, letterSpacing: 3, color: C.dim2, marginBottom: 2 },
  title: { fontFamily: F.bold, fontSize: 42, color: C.ink, letterSpacing: 2, marginBottom: 14 },
  toggle: { flexDirection: 'row', borderRadius: 14, overflow: 'hidden', borderWidth: 1.5, borderColor: 'rgba(88,131,191,0.32)', backgroundColor: 'rgba(255,255,255,0.6)', marginBottom: 14 },
  toggleBtn: { flex: 1, paddingVertical: 11, alignItems: 'center' },
  toggleBtnOn: { backgroundColor: '#3d6aaa' },
  toggleText: { fontFamily: F.bold, fontSize: 15, letterSpacing: 2, color: '#3d6aaa' },
  toggleTextOn: { color: '#ffffed' },
  searchWrap: { backgroundColor: SURFACE, borderRadius: 14, borderWidth: 1.5, borderTopColor: 'rgba(255,255,255,0.95)', borderLeftColor: 'rgba(255,255,255,0.85)', borderBottomColor: 'rgba(88,131,191,0.45)', borderRightColor: 'rgba(88,131,191,0.28)', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, marginBottom: 12, position: 'relative', overflow: 'hidden' },
  searchShine: { position: 'absolute', top: 0, left: '8%', right: '8%', height: 1.5, backgroundColor: 'rgba(255,255,255,0.95)', zIndex: 6 },
  searchIcon: { fontSize: 18, color: '#3d6aaa', marginRight: 10 },
  searchInput: { flex: 1, fontFamily: F.mono, fontSize: 11, letterSpacing: 1.5, color: C.ink, paddingVertical: 12 },
  pillScroll: { marginBottom: 8 },
  pill: { paddingHorizontal: 18, paddingVertical: 8, borderRadius: 10, borderWidth: 1.5, borderColor: 'rgba(88,131,191,0.25)', marginRight: 6 },
  pillOn: { backgroundColor: '#fee229', borderColor: '#fee229' },
  pillText: { fontFamily: F.bold, fontSize: 14, letterSpacing: 2, color: C.ink },
  pillTextOn: { color: C.ink },
  formatScroll: { marginBottom: 10 },
  formatPill: { paddingHorizontal: 13, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(88,131,191,0.18)', marginRight: 5 },
  formatPillOn: { backgroundColor: 'rgba(61,106,170,0.12)', borderColor: 'rgba(61,106,170,0.4)' },
  formatText: { fontFamily: F.mono, fontSize: 10, letterSpacing: 1, color: 'rgba(26,31,46,0.5)' },
  formatTextOn: { color: '#3d6aaa', fontWeight: '700' },
  hintRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6, paddingHorizontal: 4 },
  hint: { fontFamily: F.mono, fontSize: 9, letterSpacing: 1.5, color: C.dim2 },
  editBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  resetBtn: { backgroundColor: 'rgba(61,106,170,0.1)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: 'rgba(61,106,170,0.2)' },
  resetText: { fontFamily: F.mono, fontSize: 9, letterSpacing: 1.5, color: '#3d6aaa' },
  editHint: { fontFamily: F.mono, fontSize: 9, letterSpacing: 1, color: C.dim2 },
  tierDivider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 10, paddingHorizontal: 4 },
  tierLine: { flex: 1, height: 1, backgroundColor: 'rgba(88,131,191,0.15)' },
  tierLabel: { fontFamily: F.bold, fontSize: 14, letterSpacing: 3, color: '#3d6aaa' },
  card: { backgroundColor: SURFACE, borderRadius: 16, borderWidth: 1.5, borderTopColor: 'rgba(255,255,255,0.95)', borderLeftColor: 'rgba(255,255,255,0.85)', borderBottomColor: 'rgba(88,131,191,0.45)', borderRightColor: 'rgba(88,131,191,0.28)', padding: 12, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10, position: 'relative', overflow: 'hidden', shadowColor: '#3d6aaa', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 14, elevation: 3 },
  cardShine: { position: 'absolute', top: 0, left: '8%', right: '8%', height: 1.5, backgroundColor: 'rgba(255,255,255,0.95)', zIndex: 6 },
  cardActive: { shadowOpacity: 0.2, shadowRadius: 20, transform: [{ scale: 1.02 }] },
  rank: { fontFamily: F.bold, fontSize: 28, color: '#3d6aaa', width: 30, textAlign: 'center' },
  info: { flex: 1, minWidth: 0 },
  name: { fontFamily: F.bold, fontSize: 17, color: C.ink, letterSpacing: 1, lineHeight: 20 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  team: { fontFamily: F.mono, fontSize: 10, color: C.dim2, letterSpacing: 1 },
  posBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5 },
  posText: { fontFamily: F.mono, fontSize: 9, letterSpacing: 1, fontWeight: '700' },
  consensusBar: { height: 3, borderRadius: 2, backgroundColor: 'rgba(88,131,191,0.08)', marginTop: 5, overflow: 'hidden' },
  consensusFill: { height: 3, borderRadius: 2 },
  rightCol: { alignItems: 'flex-end', gap: 3, flexShrink: 0 },
  adp: { fontFamily: F.mono, fontSize: 9, color: C.dim2, letterSpacing: 0.5 },
  trend: { fontFamily: F.mono, fontSize: 10, fontWeight: '700' },
  dragHandle: { width: 36, height: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(88,131,191,0.06)', borderRadius: 8 },
  dragIcon: { fontSize: 22, color: '#3d6aaa', fontWeight: '700' },
});
