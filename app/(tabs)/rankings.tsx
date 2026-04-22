import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator, Image, Modal, ScrollView, StyleSheet,
    Text, TextInput, TouchableOpacity, View,
  FlatList,
} from 'react-native';

import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
    RankedPlayer,
    RankingsSource,
    getSelectedBase,
    setSelectedBase,
} from '../../services/rankingsData';
import { getEngineRankings, getEngineRankingsForSource, invalidateEngineCache, assignGlobalTier, assignPositionalTier } from '../../services/rankings/aiomniEngineBridge';
import { getOverrides, setOverride, clearOverrides, applyOverrides } from '../../services/rankings/userOverrides';
import { fetchDedupedProspects } from '../../services/rankingsData';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getCurrentTier } from '../../services/purchases';
import { F, SP, dark, palette } from '../constants/tokens';
import PlayerCardModal from '../components/PlayerCardModal';
import { HeatIcon } from '../components/HeatIcon';
import { computeHeatBatch } from '../../services/heat';
import { getHeatSignalsMap } from '../../services/heatData';
import { useHeatAccess, HeatAccess } from '../hooks/useHeatAccess';
import { PlatformErrorCard, classifyPlatformError } from '../components/PlatformErrorCard';

type Format   = 'PPR' | 'HALF' | 'STD' | 'SF' | 'DYN';
type Position = 'ALL' | 'QB' | 'RB' | 'WR' | 'TE' | 'K';
type Mode     = 'community' | 'mine' | 'prospects';

const POS_COLORS: Record<string, { bg: string; color: string }> = {
  QB: { bg: 'rgba(167,139,250,0.15)', color: '#a78bfa' },
  RB: { bg: palette.aqua + '15', color: palette.aqua },
  WR: { bg: palette.green + '15', color: palette.green },
  TE: { bg: palette.amber + '15', color: palette.amber },
  K:  { bg: dark.textMuted + '15', color: dark.textMuted },
};

const TIER_NAMES: Record<number, string> = {
  1: 'TIER 1 — ELITE',
  2: 'TIER 2 — BLUE CHIP',
  3: 'TIER 3 — STARTER',
  4: 'TIER 4 — FLEX PLAY',
  5: 'TIER 5 — UPSIDE',
};

const FORMATS: { key: Format; label: string }[] = [
  { key: 'PPR', label: 'PPR' },
  { key: 'HALF', label: 'HALF PPR' },
  { key: 'STD', label: 'STANDARD' },
  { key: 'SF', label: 'SUPERFLEX' },
  { key: 'DYN', label: 'DYNASTY' },
];

const POSITIONS: Position[] = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K'];

const BASE_SOURCES: { key: RankingsSource; label: string; sub: string; color: string }[] = [
  { key: 'aiomni', label: 'AIOmni AI Rankings', sub: 'AI-synthesized from all sources', color: '#6eeb83' },
  { key: 'sleeper', label: 'Sleeper ADP', sub: 'Based on Sleeper draft data', color: '#00FFF9' },
  { key: 'espn', label: 'ESPN ADP', sub: 'Based on ESPN draft data', color: '#e52534' },
  { key: 'yahoo', label: 'Yahoo ADP', sub: 'Requires Yahoo connection', color: '#7c3aed' },
  { key: 'nfl', label: 'NFL.com', sub: 'Official NFL rankings', color: palette.aqua },
];

// ── Seed data (fallback if API fails) ────────────────────────
const SEED: RankedPlayer[] = [
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
  { id:'9493',  name:'Puka Nacua',           position:'WR', team:'LAR', rank:15, adp:'14.2',trend:'up',   trendVal:3, tier:3 },
  { id:'8150',  name:'Kyren Williams',       position:'RB', team:'LAR', rank:16, adp:'15.0',trend:'down', trendVal:1, tier:4 },
  { id:'4035',  name:'Alvin Kamara',         position:'RB', team:'NO',  rank:17, adp:'16.8',trend:'flat', trendVal:0, tier:4 },
  { id:'5859',  name:'A.J. Brown',           position:'WR', team:'PHI', rank:18, adp:'17.2',trend:'down', trendVal:3, tier:4 },
  { id:'8146',  name:'Garrett Wilson',       position:'WR', team:'NYJ', rank:19, adp:'18.5',trend:'up',   trendVal:2, tier:4 },
  { id:'4217',  name:'George Kittle',        position:'TE', team:'SF',  rank:20, adp:'19.0',trend:'flat', trendVal:0, tier:4 },
  { id:'4046',  name:'Patrick Mahomes',      position:'QB', team:'KC',  rank:21, adp:'20.1',trend:'down', trendVal:1, tier:4 },
  { id:'10229', name:'Rashee Rice',          position:'WR', team:'KC',  rank:22, adp:'21.5',trend:'up',   trendVal:5, tier:5 },
  { id:'6813',  name:'Jonathan Taylor',      position:'RB', team:'IND', rank:23, adp:'22.0',trend:'flat', trendVal:0, tier:5 },
  { id:'5012',  name:'Mark Andrews',         position:'TE', team:'BAL', rank:24, adp:'23.2',trend:'up',   trendVal:2, tier:5 },
  { id:'10859', name:'Sam LaPorta',          position:'TE', team:'DET', rank:25, adp:'24.0',trend:'down', trendVal:1, tier:5 },
  { id:'5846',  name:'DK Metcalf',           position:'WR', team:'SEA', rank:26, adp:'25.5',trend:'up',   trendVal:1, tier:5 },
  { id:'8130',  name:'Trey McBride',         position:'TE', team:'ARI', rank:27, adp:'26.8',trend:'up',   trendVal:4, tier:5 },
  { id:'7525',  name:'DeVonta Smith',        position:'WR', team:'PHI', rank:28, adp:'27.0',trend:'flat', trendVal:0, tier:5 },
  { id:'6768',  name:'Tua Tagovailoa',       position:'QB', team:'MIA', rank:29, adp:'28.5',trend:'down', trendVal:2, tier:5 },
  { id:'6819',  name:'Michael Pittman Jr.',  position:'WR', team:'IND', rank:30, adp:'29.0',trend:'up',   trendVal:1, tier:5 },
];

function PlayerPhoto({ playerId, size = 48 }: { playerId: string; size?: number }) {
  const [err, setErr] = useState(false);
  if (!err && playerId) return (
    <Image
      source={{ uri: `https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg` }}
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: dark.surface, borderWidth: 2, borderColor: dark.border }}
      onError={() => setErr(true)}
    />
  );
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: dark.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: dark.border }}>
      <Text style={{ fontSize: size * 0.35, fontFamily: F.bold, color: dark.textMuted }}>?</Text>
    </View>
  );
}

// ─── HEAT MERGE HELPER ─────────────────────────────────────────
// Attach Sleeper trending velocity signals + computed Heat score
// to each ranked player. Non-blocking: returns plain list on failure.
async function mergeHeat<T extends { id: string }>(players: T[]): Promise<any[]> {
  try {
    const heatMap = await getHeatSignalsMap();
    const withSignals = players.map(p => ({ ...p, heatSignals: heatMap.get(p.id) }));
    return computeHeatBatch(withSignals as any);
  } catch (e) {
    console.log('mergeHeat error:', e);
    return players;
  }
}

function PlayerCard({ player, index, onChangeRank, onOpenCard, heatAccess }: {
  player: RankedPlayer; index: number; onChangeRank?: (p: RankedPlayer) => void; onOpenCard?: (p: RankedPlayer) => void;
  heatAccess?: HeatAccess;
}) {
  const posStyle = POS_COLORS[player.position] || POS_COLORS.K;
  const consensus = Math.max(50, 100 - index * 2.5);
  const isTop3 = index < 3;

  return (
    <TouchableOpacity style={s.card} activeOpacity={0.7} onPress={() => onOpenCard?.(player)}>
      <Text style={[s.rank, isTop3 && { color: palette.amber }]}>{index + 1}</Text>
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
          <View style={[s.consensusFill, { width: `${consensus}%`, backgroundColor: isTop3 ? palette.amber : palette.green }]} />
        </View>
      </View>
      <View style={s.rightCol}>
        {onChangeRank ? (
          <TouchableOpacity onPress={() => onChangeRank(player)} style={s.rankChangeBtn}>
            <Text style={s.rankChangeTxt}>CHANGE</Text>
          </TouchableOpacity>
        ) : (
          <>
            <Text style={s.adp}>ADP {player.adp}</Text>
            <Text style={[s.trend, player.trend === 'up' && { color: palette.aqua }, player.trend === 'down' && { color: palette.flame }, player.trend === 'flat' && { color: dark.textMuted }]}>
              {player.trend === 'up' ? `▲ ${player.trendVal}` : player.trend === 'down' ? `▼ ${player.trendVal}` : '—'}
            </Text>
          </>
        )}
        {heatAccess && ((player as any).heatScore ?? 0) >= heatAccess.iconThreshold && heatAccess.showIcon && (
          <View style={{ marginTop: 4 }}>
            <HeatIcon
              score={(player as any).heatScore ?? 0}
              direction={(player as any).heatDirection ?? 'flat'}
              size={26}
              showScore={heatAccess.showScore}
              compact
            />
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ── Base Selection Modal ─────────────────────────────────────
function BaseSelectionModal({ visible, onSelect, onClose }: {
  visible: boolean;
  onSelect: (source: RankingsSource) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.modalOverlay}>
        <View style={s.modalSheet}>
          <View style={s.modalHandle} />
          <Text style={s.modalTitle}>CHOOSE YOUR BASE RANKINGS</Text>
          <Text style={s.modalSub}>Pick a starting point. You can customize after.</Text>

          {BASE_SOURCES.map(src => (
            <TouchableOpacity
              key={src.key}
              style={s.sourceRow}
              onPress={() => onSelect(src.key)}
              activeOpacity={0.7}
            >
              <View style={[s.sourceDot, { backgroundColor: src.color }]} />
              <View style={{ flex: 1 }}>
                <Text style={s.sourceLabel}>{src.label}</Text>
                <Text style={s.sourceSub}>{src.sub}</Text>
              </View>
              <Text style={[s.sourceArrow, { color: src.color }]}>→</Text>
            </TouchableOpacity>
          ))}

          <TouchableOpacity style={s.modalCancel} onPress={onClose}>
            <Text style={s.modalCancelTxt}>CANCEL</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ── Change Base Modal ────────────────────────────────────────
function ChangeBaseModal({ visible, onRestart, onClose }: {
  visible: boolean;
  onRestart: () => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.modalOverlay}>
        <View style={[s.modalSheet, { paddingBottom: 24 }]}>
          <View style={s.modalHandle} />
          <Text style={s.modalTitle}>CHANGE BASE RANKINGS</Text>
          <Text style={s.modalSub}>Your custom adjustments will be lost if you restart.</Text>

          <TouchableOpacity
            style={[s.changeBtn, { backgroundColor: palette.amber + '15', borderColor: palette.amber + '30' }]}
            onPress={onRestart}
          >
            <Text style={[s.changeBtnTxt, { color: palette.amber }]}>RESTART FROM NEW BASE</Text>
            <Text style={s.changeBtnSub}>Pick a new source and start fresh</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.modalCancel} onPress={onClose}>
            <Text style={s.modalCancelTxt}>KEEP CURRENT</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

export default function RankingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>('community');
  const [format, setFormat] = useState<Format>('PPR');
  const [position, setPosition] = useState<Position>('ALL');
  const [search, setSearch] = useState('');
  const [communityData, setCommunityData] = useState<RankedPlayer[]>(SEED);
  // myRanksEngine = pristine engine output for this format (no user edits).
  // overrides     = user's per-player delta map (loaded from userOverrides module).
  // myRanks       = what the UI renders — engine + overrides, re-sorted, re-ranked.
  const [myRanksEngine, setMyRanksEngine] = useState<RankedPlayer[]>([]);
  const [overrides, setOverrides] = useState<Map<string, number>>(new Map());
  const [communityError, setCommunityError] = useState<any>(null);
  const heatAccess = useHeatAccess();
  const myRanks = useMemo(
    () => applyOverrides(myRanksEngine, overrides),
    [myRanksEngine, overrides],
  );
  const [loading, setLoading] = useState(false);
  const [prospects, setProspects] = useState<any[]>([]);
  const [prospectsLoading, setProspectsLoading] = useState(false);
  const [prospectsGated, setProspectsGated] = useState(false);
  const [leagues, setLeagues] = useState<{id: string; name: string}[]>([]);
  const [selectedLeagueId, setSelectedLeagueId] = useState<string | undefined>(undefined);
  const [selectedLeagueName, setSelectedLeagueName] = useState<string>('All Leagues');
  const [selectedBase, setSelectedBaseState] = useState<RankingsSource | null>(null);
  const [baseModalVisible, setBaseModalVisible] = useState(false);
  const [changeModalVisible, setChangeModalVisible] = useState(false);

  useEffect(() => {
    loadSavedState();
    loadCommunityRankings();
    loadLeagues();
  }, [format]);

  const loadCommunityRankings = async () => {
    setLoading(true);
    setCommunityError(null);
    try {
      const data = await getEngineRankings(format);
      if (data.length > 0) setCommunityData(await mergeHeat(data));
    } catch (e) {
      console.log('getEngineRankings error:', e);
      setCommunityError(e);
    } finally {
      setLoading(false);
    }
  };

  const loadLeagues = async () => {
    try {
      const username = await AsyncStorage.getItem('sleeper_username');
      if (!username) return;
      const userRes = await fetch('https://api.sleeper.app/v1/user/' + username);
      const user = await userRes.json();
      const leaguesRes = await fetch('https://api.sleeper.app/v1/user/' + user.user_id + '/leagues/nfl/2025');
      const data = await leaguesRes.json();
      if (Array.isArray(data)) {
        setLeagues([
          { id: '', name: 'All Leagues' },
          ...data.map((l: any) => ({ id: l.league_id, name: l.name })),
        ]);
      }
    } catch (e) { console.log('loadLeagues error:', e); }
  };

  const handleLeagueChange = async (leagueId: string, leagueName: string) => {
    setSelectedLeagueId(leagueId || undefined);
    setSelectedLeagueName(leagueName);
    try {
      const live = await getEngineRankings(format);
      const ovs = await getOverrides(leagueId || undefined);
      setMyRanksEngine(live.length > 0 ? await mergeHeat(live) : [...SEED]);
      setOverrides(ovs);
    } catch {
      setMyRanksEngine([...SEED]);
      setOverrides(new Map());
    }
  };

  const handleProspectsTab = async () => {
    const tier = await getCurrentTier();
    if (tier === 'free') {
      setProspectsGated(true);
      setMode('prospects');
      return;
    }
    setProspectsGated(false);
    setMode('prospects');
    if (prospects.length === 0) {
      setProspectsLoading(true);
      try {
        const data = await fetchDedupedProspects(2026);
        if (data.length > 0) setProspects(data);
      } catch {}
      setProspectsLoading(false);
    }
  };

  const loadSavedState = async () => {
    const base = await getSelectedBase();
    setSelectedBaseState(base);
    try {
      const live = await getEngineRankings(format);
      const ovs = await getOverrides(selectedLeagueId);
      setMyRanksEngine(live.length > 0 ? await mergeHeat(live) : [...SEED]);
      setOverrides(ovs);
    } catch {
      setMyRanksEngine([...SEED]);
      setOverrides(new Map());
    }
  };

  const handleSelectBase = async (source: RankingsSource) => {
    setBaseModalVisible(false);
    setLoading(true);
    try {
      // Switching base source invalidates prior deltas (they were relative
      // to the old source's ordering). Clear the user's overrides for this
      // league, then reload engine output for the new source. useMemo
      // recomputes `myRanks` automatically off the new engine + empty deltas.
      const leagueScope = selectedLeagueId || null;
      await clearOverrides(leagueScope);
      setOverrides(new Map());
      const rankings = await getEngineRankingsForSource(source, format);
      setMyRanksEngine(rankings.length > 0 ? await mergeHeat(rankings) : [...SEED]);
      await setSelectedBase(source);
      setSelectedBaseState(source);
    } catch (e) {
      console.log('handleSelectBase error:', e);
      setMyRanksEngine([...SEED]);
    }
    setLoading(false);
  };

  const handleMyRankingsTab = () => {
    setMode('mine');
    if (!selectedBase && myRanks.length === 0) {
      setBaseModalVisible(true);
    }
  };

  const handleChangeBase = () => {
    setChangeModalVisible(false);
    setBaseModalVisible(true);
  };

  const resetToConsensus = async () => {
    try {
      invalidateEngineCache();
      // Clear legacy full-list storage keys (dead code paths from Hour 1)
      const localKey = selectedLeagueId ? 'my_custom_rankings_' + format + '_' + selectedLeagueId : 'my_custom_rankings_' + format;
      await AsyncStorage.removeItem(localKey);
      await AsyncStorage.removeItem('my_custom_rankings_v7');
      // Clear user overrides (the new storage model)
      await clearOverrides(selectedLeagueId);
      setOverrides(new Map());
      // Re-fetch engine
      const live = await getEngineRankings(format, true);
      setMyRanksEngine(live.length > 0 ? live : [...SEED]);
    } catch (e) {
      console.log('reset error:', e);
      setMyRanksEngine([...SEED]);
      setOverrides(new Map());
    }
  };

  const rawData = mode === 'mine' ? myRanks : communityData;
  const filtered = rawData.filter(p =>
    (position === 'ALL' || p.position === position) &&
    (!search || p.name.toLowerCase().includes(search.toLowerCase()) || p.team.toLowerCase().includes(search.toLowerCase()))
  );

  // Tier source depends on mode + position filter.
  //   My Rankings: recompute tiers from user's list order. Moving a Tier 3
  //     RB to rank 1 puts them in the user's Tier 1 — their rankings, their tiers.
  //   Community:   use the tier from engine output (locked to algorithm).
  const grouped: { tier: number; players: RankedPlayer[] }[] = [];
  let lastTier = -1;
  filtered.forEach((p, i) => {
    const rank = i + 1;
    let t: number;
    if (mode === 'mine') {
      t = position === 'ALL' ? assignGlobalTier(rank) : assignPositionalTier(rank);
    } else {
      t = position === 'ALL' ? p.tier : ((p as any).positionalTier ?? p.tier);
    }
    if (t !== lastTier) { grouped.push({ tier: t, players: [] }); lastTier = t; }
    grouped[grouped.length - 1].players.push({ ...p, rank });
  });

  // Flatten grouped into typed items for FlatList (used in My Rankings).
  // Each item is either a divider or a player. FlatList's virtualization
  // handles both types transparently via the type-tagged renderRow below.
  type MyRanksItem =
    | { type: 'divider'; tier: number; key: string }
    | { type: 'player'; player: RankedPlayer; displayIndex: number; key: string };
  const flatItems: MyRanksItem[] = [];
  grouped.forEach((group, gIdx) => {
    flatItems.push({ type: 'divider', tier: group.tier, key: `tier-${gIdx}-${group.tier}` });
    group.players.forEach((p) => {
      flatItems.push({ type: 'player', player: p, displayIndex: p.rank - 1, key: p.id });
    });
  });

  const [movePlayer, setMovePlayer] = useState<RankedPlayer | null>(null);
  const [cardVisible, setCardVisible] = useState(false);
  const [cardPlayer, setCardPlayer] = useState<RankedPlayer | null>(null);
  const [moveRank, setMoveRank] = useState('');

  const openMoveModal = (player: RankedPlayer) => {
    setMovePlayer(player);
    const idx = myRanks.findIndex(p => p.id === player.id);
    setMoveRank(String(idx + 1));
  };

  const confirmMove = () => {
    if (!movePlayer) return;
    const target = parseInt(moveRank, 10);
    if (isNaN(target) || target < 1) { setMovePlayer(null); return; }
    // Delta is relative to the ENGINE rank (not the displayed rank), so the
    // user's intent survives re-engine runs, format switches, and other
    // overrides shifting the list around them.
    const enginePlayer = myRanksEngine.find(p => p.id === movePlayer.id);
    if (!enginePlayer) { setMovePlayer(null); return; }
    const delta = target - enginePlayer.rank;
    const newOverrides = new Map(overrides);
    if (delta === 0) {
      newOverrides.delete(movePlayer.id);
    } else {
      newOverrides.set(movePlayer.id, Math.max(-200, Math.min(200, delta)));
    }
    setOverrides(newOverrides);
    // Persist in background — UI already reflects the change via useMemo
    setOverride(movePlayer.id, delta, selectedLeagueId).catch(e => console.log('setOverride:', e));
    setMovePlayer(null);
  };

  const renderRow = ({ item }: { item: MyRanksItem }) => {
    if (item.type === 'divider') {
      return (
        <View style={s.tierDivider}>
          <View style={s.tierLine} />
          <Text style={s.tierLabel}>{TIER_NAMES[item.tier]}</Text>
          <View style={s.tierLine} />
        </View>
      );
    }
    return (
      <PlayerCard
        player={item.player}
        index={item.displayIndex}
        onChangeRank={openMoveModal}
        onOpenCard={(p) => { setCardPlayer(p); setCardVisible(true); }}
        heatAccess={heatAccess}
      />
    );
  };

  const baseLabel = selectedBase
    ? BASE_SOURCES.find(s => s.key === selectedBase)?.label ?? selectedBase
    : null;

  const Header = () => (
    <View style={{ paddingTop: insets.top + 8, backgroundColor: dark.bg }}>
      <Text style={s.eyebrow}>RANKINGS</Text>
      <Text style={s.title}>RANKINGS.</Text>

      <View style={s.toggle}>
        <TouchableOpacity onPress={() => setMode('community')} style={[s.toggleBtn, mode === 'community' && s.toggleBtnOn]}>
          <Text style={[s.toggleText, mode === 'community' && s.toggleTextOn]}>COMMUNITY</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleMyRankingsTab} style={[s.toggleBtn, mode === 'mine' && s.toggleBtnOn]}>
          <Text style={[s.toggleText, mode === 'mine' && s.toggleTextOn]}>MY RANKINGS</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleProspectsTab} style={[s.toggleBtn, mode === 'prospects' && { backgroundColor: palette.flame }]}>
          <Text style={[s.toggleText, mode === 'prospects' && s.toggleTextOn]}>PROSPECTS</Text>
        </TouchableOpacity>
      </View>

      <View style={s.searchWrap}>
        <Text style={s.searchIcon}>⌕</Text>
        <TextInput style={s.searchInput} placeholder="SEARCH PLAYERS OR TEAMS" placeholderTextColor={dark.textMuted} value={search} onChangeText={setSearch} autoCapitalize="none" autoCorrect={false} />
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
        <Text style={s.hint}>AIOMNI ENGINE · MULTI-SOURCE BLEND</Text>
        <Text style={s.hint}>{mode === 'mine' ? 'TAP CHANGE TO REORDER' : 'ADP'}</Text>
      </View>

      {mode === 'mine' && (
        <View style={s.editBar}>
          {selectedBase ? (
            <TouchableOpacity onPress={() => setChangeModalVisible(true)} style={s.changeBaseBtn}>
              <Text style={s.changeBaseTxt}>BASE: {baseLabel?.toUpperCase()}</Text>
              <Text style={s.changeBaseArrow}>CHANGE ›</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={() => setBaseModalVisible(true)} style={s.changeBaseBtn}>
              <Text style={s.changeBaseTxt}>SELECT BASE RANKINGS</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={resetToConsensus} style={s.resetBtn}>
            <Text style={s.resetText}>RESET</Text>
          </TouchableOpacity>
        </View>
      )}

      {loading && (
        <View style={{ alignItems: 'center', paddingVertical: 20 }}>
          <ActivityIndicator color={palette.green} size="large" />
          <Text style={{ color: dark.textMuted, fontFamily: F.body, fontSize: 11, marginTop: 8 }}>LOADING RANKINGS FROM SOURCE...</Text>
        </View>
      )}
    </View>
  );

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={{ flex: 1, backgroundColor: dark.bg }}>
        {mode === 'mine' && myRanks.length > 0 ? (
          <>
          <FlatList
            data={flatItems}
            keyExtractor={item => item.key}
            renderItem={renderRow}
            ListHeaderComponent={Header}
            contentContainerStyle={{ paddingHorizontal: SP[3], paddingBottom: 100 }}
            showsVerticalScrollIndicator={false}
          />

          <Modal visible={!!movePlayer} transparent animationType="fade" onRequestClose={() => setMovePlayer(null)}>
            <TouchableOpacity style={s.moveBg} activeOpacity={1} onPress={() => setMovePlayer(null)}>
              <View style={s.moveCard}>
                <Text style={s.moveTitle}>MOVE PLAYER</Text>
                <Text style={s.moveName}>{movePlayer?.name}</Text>
                <Text style={s.moveLabel}>New rank</Text>
                <TextInput
                  style={s.moveInput}
                  value={moveRank}
                  onChangeText={setMoveRank}
                  keyboardType="number-pad"
                  autoFocus
                  selectTextOnFocus
                  maxLength={4}
                />
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity style={s.moveBtnCancel} onPress={() => setMovePlayer(null)}>
                    <Text style={s.moveBtnCancelTxt}>CANCEL</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.moveBtnConfirm} onPress={confirmMove}>
                    <Text style={s.moveBtnConfirmTxt}>MOVE</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableOpacity>
          </Modal>
          </>
        ) : mode === 'community' ? (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SP[3], paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
            <Header />
            {communityError ? (() => {
              const c = classifyPlatformError(communityError);
              return (
                <PlatformErrorCard
                  kind={c.kind}
                  message={c.message}
                  onRetry={loadCommunityRankings}
                />
              );
            })() : null}
            {!loading && grouped.map((group, gIdx) => (
              <React.Fragment key={`tier-${gIdx}-${group.tier}`}>
                <View style={s.tierDivider}>
                  <View style={s.tierLine} />
                  <Text style={s.tierLabel}>{TIER_NAMES[group.tier]}</Text>
                  <View style={s.tierLine} />
                </View>
                {group.players.map((p) => (
                  <View key={p.id}>
                    <PlayerCard player={p} index={filtered.findIndex(fp => fp.id === p.id)} onOpenCard={(pl) => { setCardPlayer(pl); setCardVisible(true); }} heatAccess={heatAccess} />
                  </View>
                ))}
              </React.Fragment>
            ))}
          </ScrollView>
        ) : null}


        {mode === 'prospects' && (
          prospectsGated ? (
            <View style={{ alignItems: 'center', paddingTop: 60, paddingHorizontal: 20 }}>
              <Text style={{ fontFamily: F.bold, fontSize: 22, color: dark.text, textAlign: 'center', letterSpacing: 1, marginBottom: 12 }}>PROSPECT RANKINGS</Text>
              <Text style={{ fontFamily: F.body, fontSize: 14, color: dark.textMuted, textAlign: 'center', lineHeight: 22, marginBottom: 24 }}>
                College prospect rankings filtered through your dynasty scoring format. Requires Rankings subscription ($2.99/mo).
              </Text>
              <TouchableOpacity 
                style={{ backgroundColor: palette.flame, borderRadius: 14, paddingHorizontal: 32, paddingVertical: 16 }}
                onPress={() => router.push('/paywall' as any)}
              >
                <Text style={{ fontFamily: F.bold, fontSize: 14, color: dark.bg, letterSpacing: 2 }}>UPGRADE TO RANKINGS</Text>
              </TouchableOpacity>
            </View>
          ) : prospectsLoading ? (
            <View style={{ alignItems: 'center', paddingTop: 60 }}>
              <ActivityIndicator color={palette.flame} size="large" />
              <Text style={{ color: dark.textMuted, fontFamily: F.body, marginTop: 12 }}>Loading prospects...</Text>
            </View>
          ) : (
            prospects.filter(p =>
              (position === 'ALL' || p.position === position) &&
              (!search || p.name.toLowerCase().includes(search.toLowerCase()) || (p.school || '').toLowerCase().includes(search.toLowerCase()))
            ).map((p: any, i: number) => {
              const posStyle = POS_COLORS[p.position] || POS_COLORS.K;
              return (
                <View key={p.id} style={s.card}>
                  <Text style={[s.rank, i < 3 && { color: palette.flame }]}>{p.consensus_rank || i + 1}</Text>
                  <View style={s.info}>
                    <Text style={s.name}>{(p.name || '').toUpperCase()}</Text>
                    <View style={s.metaRow}>
                      <Text style={s.team}>{p.school || '—'}</Text>
                      <View style={[s.posBadge, { backgroundColor: posStyle.bg }]}>
                        <Text style={[s.posText, { color: posStyle.color }]}>{p.position}</Text>
                      </View>
                      {p.class_year && <Text style={{ fontFamily: F.body, fontSize: 9, color: dark.textMuted, marginLeft: 4 }}>{p.class_year}</Text>}
                    </View>
                    {(p.height || p.weight || p.forty_time) && (
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                        {p.height ? <Text style={{ fontFamily: F.body, fontSize: 9, color: dark.textMuted }}>{p.height}</Text> : null}
                        {p.weight ? <Text style={{ fontFamily: F.body, fontSize: 9, color: dark.textMuted }}>{p.weight} lbs</Text> : null}
                        {p.forty_time ? <Text style={{ fontFamily: F.body, fontSize: 9, color: palette.amber }}>{p.forty_time}s 40</Text> : null}
                      </View>
                    )}
                  </View>
                  <View style={s.rightCol}>
                    {p.positional_rank && <Text style={{ fontFamily: F.body, fontSize: 9, color: dark.textMuted }}>{p.position}{p.positional_rank}</Text>}
                    {p.prospect_grade > 0 && <Text style={{ fontFamily: F.bold, fontSize: 11, color: palette.flame }}>Grade {p.prospect_grade}</Text>}
                  </View>
                </View>
              );
            })
          )
        )}

        {cardPlayer && (
          <PlayerCardModal
            visible={cardVisible}
            player={{ id: cardPlayer.id, name: cardPlayer.name, position: cardPlayer.position, team: cardPlayer.team }}
            platform={'sleeper'}
            onClose={() => setCardVisible(false)}
            onAskAI={() => {
              const q = `What should I know about ${cardPlayer.name} (${cardPlayer.position} - ${cardPlayer.team}) for my ${format} league? Current rank is #${cardPlayer.rank}.`;
              setCardVisible(false);
              setTimeout(() => {
                router.push({ pathname: '/(tabs)/coach', params: { q } } as any);
              }, 150);
            }}
          />
        )}

        <BaseSelectionModal
          visible={baseModalVisible}
          onSelect={handleSelectBase}
          onClose={() => setBaseModalVisible(false)}
        />
        <ChangeBaseModal
          visible={changeModalVisible}
          onRestart={handleChangeBase}
          onClose={() => setChangeModalVisible(false)}
        />
      </View>
    </GestureHandlerRootView>
  );
}

const s = StyleSheet.create({
  eyebrow:    { fontFamily: F.body, fontSize: 10, letterSpacing: 3, color: dark.textMuted, marginBottom: 2 },
  title:      { fontFamily: F.bold, fontSize: 42, color: dark.text, letterSpacing: 2, marginBottom: 14 },
  toggle:     { flexDirection: 'row', borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: dark.border, backgroundColor: dark.card, marginBottom: 14 },
  toggleBtn:  { flex: 1, paddingVertical: 11, alignItems: 'center' },
  toggleBtnOn:{ backgroundColor: palette.green },
  toggleText: { fontFamily: F.bold, fontSize: 15, letterSpacing: 2, color: dark.textSub },
  toggleTextOn:{ color: dark.bg },
  searchWrap: { backgroundColor: dark.card, borderRadius: 14, borderWidth: 1, borderColor: dark.border, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, marginBottom: 12 },
  searchIcon: { fontSize: 18, color: palette.green, marginRight: 10 },
  searchInput:{ flex: 1, fontFamily: F.body, fontSize: 11, letterSpacing: 1.5, color: dark.text, paddingVertical: 12 },
  pillScroll: { marginBottom: 8 },
  pill:       { paddingHorizontal: 18, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: dark.border, marginRight: 6 },
  pillOn:     { backgroundColor: palette.amber, borderColor: palette.amber },
  pillText:   { fontFamily: F.bold, fontSize: 14, letterSpacing: 2, color: dark.textSub },
  pillTextOn: { color: dark.bg },
  formatScroll:{ marginBottom: 10 },
  formatPill: { paddingHorizontal: 13, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: dark.border, marginRight: 5 },
  formatPillOn:{ backgroundColor: palette.green + '18', borderColor: palette.green + '40' },
  formatText: { fontFamily: F.body, fontSize: 10, letterSpacing: 1, color: dark.textMuted },
  formatTextOn:{ color: palette.green, fontWeight: '700' },
  hintRow:    { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6, paddingHorizontal: 4 },
  hint:       { fontFamily: F.body, fontSize: 9, letterSpacing: 1.5, color: dark.textMuted },

  // Edit bar
  editBar:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8 },
  changeBaseBtn:{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: palette.green + '10', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: palette.green + '25' },
  changeBaseTxt:{ fontFamily: F.bold, fontSize: 10, letterSpacing: 1, color: palette.green },
  changeBaseArrow:{ fontFamily: F.body, fontSize: 10, color: palette.green, opacity: 0.6 },
  resetBtn:     { backgroundColor: dark.surface, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: dark.border },
  resetText:    { fontFamily: F.bold, fontSize: 9, letterSpacing: 1.5, color: dark.textMuted },

  // Tier
  tierDivider:{ flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 10, paddingHorizontal: 4 },
  tierLine:   { flex: 1, height: 1, backgroundColor: dark.border },
  tierLabel:  { fontFamily: F.bold, fontSize: 14, letterSpacing: 3, color: palette.green },

  // Card
  card:       { backgroundColor: dark.card, borderRadius: 16, borderWidth: 1, borderColor: dark.border, padding: 12, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10, height: 74 },
  cardActive: { borderColor: palette.green + '40', transform: [{ scale: 1.02 }] },
  rank:       { fontFamily: F.bold, fontSize: 28, color: palette.green, width: 30, textAlign: 'center' },
  info:       { flex: 1, minWidth: 0 },
  name:       { fontFamily: F.bold, fontSize: 17, color: dark.text, letterSpacing: 1, lineHeight: 20 },
  metaRow:    { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  team:       { fontFamily: F.body, fontSize: 10, color: dark.textMuted, letterSpacing: 1 },
  posBadge:   { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5 },
  posText:    { fontFamily: F.body, fontSize: 9, letterSpacing: 1, fontWeight: '700' },
  consensusBar:{ height: 3, borderRadius: 2, backgroundColor: dark.border, marginTop: 5, overflow: 'hidden' },
  consensusFill:{ height: 3, borderRadius: 2 },
  rightCol:   { alignItems: 'flex-end', gap: 3, flexShrink: 0 },
  adp:        { fontFamily: F.body, fontSize: 9, color: dark.textMuted, letterSpacing: 0.5 },
  trend:      { fontFamily: F.body, fontSize: 10, fontWeight: '700' },
  rankChangeBtn: { paddingHorizontal: 10, paddingVertical: 7, backgroundColor: palette.green + '18', borderRadius: 8, borderWidth: 1, borderColor: palette.green + '44' },
  rankChangeTxt: { fontFamily: F.bold, fontSize: 9, color: palette.green, letterSpacing: 1.2 },
  moveBg:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  moveCard:  { backgroundColor: dark.card, borderRadius: 18, padding: 24, width: '100%', maxWidth: 340, borderWidth: 1, borderColor: dark.border },
  moveTitle: { fontFamily: F.bold, fontSize: 10, color: palette.green, letterSpacing: 2, marginBottom: 8 },
  moveName:  { fontFamily: F.bold, fontSize: 20, color: dark.text, marginBottom: 18 },
  moveLabel: { fontFamily: F.body, fontSize: 10, color: dark.textMuted, letterSpacing: 1.5, marginBottom: 6 },
  moveInput: { backgroundColor: dark.surface, borderRadius: 10, borderWidth: 1, borderColor: dark.border, fontFamily: F.bold, fontSize: 24, color: dark.text, paddingHorizontal: 16, paddingVertical: 12, marginBottom: 18, textAlign: 'center' },
  moveBtnCancel: { flex: 1, paddingVertical: 14, borderRadius: 10, alignItems: 'center', backgroundColor: dark.surface, borderWidth: 1, borderColor: dark.border },
  moveBtnConfirm:{ flex: 1, paddingVertical: 14, borderRadius: 10, alignItems: 'center', backgroundColor: palette.green },
  moveBtnCancelTxt: { fontFamily: F.bold, fontSize: 11, color: dark.textMuted, letterSpacing: 1.5 },
  moveBtnConfirmTxt:{ fontFamily: F.bold, fontSize: 11, color: '#0a1214', letterSpacing: 1.5 },

  // Modals
  modalOverlay:  { flex: 1, backgroundColor: 'rgba(10,18,20,0.7)', justifyContent: 'flex-end' },
  modalSheet:    { backgroundColor: dark.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 12, paddingBottom: 40, paddingHorizontal: 20, borderTopWidth: 1, borderColor: dark.border },
  modalHandle:   { width: 36, height: 4, borderRadius: 2, backgroundColor: dark.border, alignSelf: 'center', marginBottom: 20 },
  modalTitle:    { fontFamily: F.bold, color: dark.text, fontSize: 16, letterSpacing: 2, marginBottom: 6 },
  modalSub:      { fontFamily: F.body, color: dark.textMuted, fontSize: 12, lineHeight: 18, marginBottom: 20 },
  sourceRow:     { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 12, borderRadius: 12, marginBottom: 4, backgroundColor: dark.surface, borderWidth: 1, borderColor: dark.border },
  sourceDot:     { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  sourceLabel:   { fontFamily: F.bold, color: dark.text, fontSize: 14, letterSpacing: 0.5 },
  sourceSub:     { fontFamily: F.body, color: dark.textMuted, fontSize: 10, marginTop: 2 },
  sourceArrow:   { fontSize: 18, fontWeight: '700' },
  modalCancel:   { marginTop: 12, alignItems: 'center', paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: dark.border },
  modalCancelTxt:{ fontFamily: F.body, color: dark.textMuted, fontSize: 12, letterSpacing: 1.5 },
  changeBtn:     { borderRadius: 14, padding: 18, marginBottom: 8, borderWidth: 1 },
  changeBtnTxt:  { fontFamily: F.bold, fontSize: 14, letterSpacing: 1, marginBottom: 4 },
  changeBtnSub:  { fontFamily: F.body, fontSize: 11, color: dark.textMuted },
});