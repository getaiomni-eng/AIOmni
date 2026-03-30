// app/(tabs)/rankings.tsx
// Rankings screen with text depth, settings gear, real data

import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Keyboard, Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput, TouchableOpacity,
  View,
} from 'react-native';

import { buildRankings, RankedPlayer, ScoringFormat } from '../../services/rankings';
import { C, F, POS, R, shadow, SZ, textShadow } from '../constants/tokens';

const POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const;
const FORMATS: { key: ScoringFormat; label: string }[] = [
  { key: 'ppr',      label: 'PPR'  },
  { key: 'half',     label: 'HALF' },
  { key: 'standard', label: 'STD'  },
];
const DRAFT_KEY = 'rankings_drafted_ids';

const INJURY_COLORS: Record<string, { bg: string; text: string }> = {
  'Out':             { bg: 'rgba(200,60,60,0.25)',  text: '#e87070' },
  'Injured Reserve': { bg: 'rgba(200,60,60,0.25)',  text: '#e87070' },
  'Doubtful':        { bg: 'rgba(200,120,60,0.25)', text: '#e0a050' },
  'Questionable':    { bg: 'rgba(200,180,60,0.25)', text: '#e0c850' },
  'Day-To-Day':      { bg: 'rgba(200,180,60,0.20)', text: '#d0c060' },
};

export default function RankingsScreen() {
  const router = useRouter();
  const [players, setPlayers]       = useState<RankedPlayer[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [position, setPosition]     = useState<string>('ALL');
  const [format, setFormat]         = useState<ScoringFormat>('ppr');
  const [search, setSearch]         = useState('');
  const [draftMode, setDraftMode]   = useState(false);
  const [draftedIds, setDraftedIds] = useState<Set<string>>(new Set());
  const [sourceCount, setSourceCount] = useState(0);
  const fadeAnim                    = useRef(new Animated.Value(0)).current;

  const loadRankings = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true); else setLoading(true);
    try {
      const data = await buildRankings(format);
      setPlayers(data);
      let sources = 1; // Sleeper always counted
      if (data.some(p => p.statLine && !p.statLine.startsWith('🔥'))) sources++;
      if (data.some(p => p.injuryStatus))     sources++;
      if (data.some(p => p.snapPct !== null))  sources++;
      if (data.some(p => p.newsHeadline))      sources++;
      if (data.some(p => p.impliedTeamScore))  sources++;
      if (data.some(p => p.trendingAdds > 0))  sources++;
      setSourceCount(sources);
    } catch (e) {
      console.log('Rankings load error:', e);
    }
    setLoading(false);
    setRefreshing(false);
    Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
  }, [format]);

  useEffect(() => {
    AsyncStorage.getItem(DRAFT_KEY).then(val => {
      if (val) setDraftedIds(new Set(JSON.parse(val)));
    });
  }, []);

  useEffect(() => { loadRankings(); }, [loadRankings]);

  const toggleDrafted = useCallback(async (playerId: string) => {
    setDraftedIds(prev => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId); else next.add(playerId);
      AsyncStorage.setItem(DRAFT_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);

  const clearDrafted = useCallback(async () => {
    setDraftedIds(new Set());
    await AsyncStorage.removeItem(DRAFT_KEY);
  }, []);

  const filtered = useMemo(() => {
    let list = players;
    if (position !== 'ALL') list = list.filter(p => p.position === position);
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter(p =>
        p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q)
      );
    }
    return list.map((p, i) => ({ ...p, rank: position === 'ALL' ? p.rank : i + 1 }));
  }, [players, position, search]);

  const renderPlayer = useCallback(({ item }: { item: RankedPlayer }) => {
    const isDrafted  = draftedIds.has(item.id || item.name);
    const posConfig  = POS[item.position] || POS.BN;
    const injColor   = item.injuryStatus ? INJURY_COLORS[item.injuryStatus] : null;
    const displayRank = position !== 'ALL' ? item.rank : item.rank;

    return (
      <TouchableOpacity
        activeOpacity={draftMode ? 0.6 : 1}
        onPress={draftMode ? () => toggleDrafted(item.id || item.name) : undefined}
        style={[styles.row, isDrafted && draftMode && styles.rowDrafted]}
      >
        <View style={styles.rankCol}>
          <Text style={[styles.rankNum, isDrafted && draftMode && styles.textDrafted]}>
            {displayRank}
          </Text>
        </View>

        <View style={[styles.posPill, { backgroundColor: posConfig.bg }]}>
          <Text style={[styles.posText, { color: posConfig.color }]}>
            {item.position}
          </Text>
        </View>

        <View style={styles.infoCol}>
          <View style={styles.nameRow}>
            <Text style={[styles.playerName, isDrafted && draftMode && styles.textDrafted]} numberOfLines={1}>
              {item.name}
            </Text>
            {item.trendingAdds > 0 && (
              <View style={styles.trendBadge}>
                <Ionicons name="trending-up" size={11} color={C.sage} />
                <Text style={styles.trendText}>
                  {item.trendingAdds > 999 ? `${(item.trendingAdds / 1000).toFixed(1)}k` : item.trendingAdds}
                </Text>
              </View>
            )}
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.teamText}>{item.team}</Text>
            {item.posRank > 0 && <Text style={styles.posRankText}> · {item.position}{item.posRank}</Text>}
            {item.statLine ? <Text style={styles.statText}> · {item.statLine}</Text> : null}
            {item.snapPct !== null && <Text style={styles.snapText}> · {item.snapPct}%</Text>}
          </View>
          {item.injuryStatus && injColor && (
            <View style={[styles.injuryBadge, { backgroundColor: injColor.bg }]}>
              <Text style={[styles.injuryText, { color: injColor.text }]}>
                {item.injuryStatus}{item.injuryDetail ? ` — ${item.injuryDetail}` : ''}
              </Text>
            </View>
          )}
          {item.newsHeadline && !item.injuryStatus && (
            <Text style={styles.newsText} numberOfLines={1}>
              📰 {item.newsHeadline} {item.newsAge ? `(${item.newsAge})` : ''}
            </Text>
          )}
        </View>

        <View style={styles.rightCol}>
          {draftMode ? (
            <View style={[styles.checkCircle, isDrafted && styles.checkCircleActive]}>
              {isDrafted && <Ionicons name="checkmark" size={14} color="#0a0a0a" />}
            </View>
          ) : (
            item.impliedTeamScore ? (
              <Text style={styles.vegasText}>{item.impliedTeamScore.toFixed(1)}</Text>
            ) : null
          )}
        </View>
      </TouchableOpacity>
    );
  }, [draftMode, draftedIds, toggleDrafted, position]);

  const keyExtractor = useCallback((item: RankedPlayer) => item.id || item.name, []);

  if (loading) {
    return (
      <LinearGradient colors={[C.bgTop, C.bgBot]} style={styles.container}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={C.gold} />
          <Text style={styles.loadingText}>Aggregating rankings…</Text>
          <Text style={styles.loadingSubtext}>Sleeper · ESPN · nflverse · RotoWire · Vegas</Text>
        </View>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient colors={[C.bgTop, C.bgBot]} style={styles.container}>
      <Animated.View style={[styles.inner, { opacity: fadeAnim }]}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Rankings</Text>
          <View style={styles.headerRight}>
            <View style={styles.sourceTag}>
              <Text style={styles.sourceTagText}>{sourceCount} sources</Text>
            </View>
            <TouchableOpacity
              style={[styles.draftToggle, draftMode && styles.draftToggleActive]}
              onPress={() => setDraftMode(d => !d)}
            >
              <Ionicons name={draftMode ? 'checkmark-circle' : 'checkmark-circle-outline'} size={16} color={draftMode ? C.gold : C.dim2} />
              <Text style={[styles.draftToggleText, draftMode && { color: C.gold }]}>Draft</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push('/settings')} style={styles.gearBtn}>
              <Ionicons name="settings-sharp" size={20} color={C.dim2} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Search */}
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={16} color={C.dim2} style={{ marginRight: 8 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search player or team…"
            placeholderTextColor="rgba(255,255,255,0.4)"
            value={search}
            onChangeText={setSearch}
            returnKeyType="done"
            onSubmitEditing={Keyboard.dismiss}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={16} color={C.dim2} />
            </TouchableOpacity>
          )}
        </View>

        {/* Format toggle */}
        <View style={styles.formatRow}>
          {FORMATS.map(f => (
            <TouchableOpacity
              key={f.key}
              style={[styles.formatBtn, format === f.key && styles.formatBtnActive]}
              onPress={() => setFormat(f.key)}
            >
              <Text style={[styles.formatText, format === f.key && styles.formatTextActive]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
          <View style={{ flex: 1 }} />
          {draftMode && draftedIds.size > 0 && (
            <TouchableOpacity onPress={clearDrafted} style={styles.clearBtn}>
              <Text style={styles.clearText}>Clear ({draftedIds.size})</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Position filters */}
        <View style={styles.posRow}>
          {POSITIONS.map(pos => {
            const isActive = position === pos;
            const posColor = pos === 'ALL' ? C.gold : (POS[pos]?.color ?? C.dim2);
            return (
              <TouchableOpacity
                key={pos}
                style={[
                  styles.posFilter,
                  isActive && { backgroundColor: posColor + '30', borderColor: posColor },
                ]}
                onPress={() => setPosition(pos)}
              >
                <Text style={[
                  styles.posFilterText,
                  { color: isActive ? posColor : C.dim2 },
                  isActive && { fontFamily: F.bold },
                ]}>
                  {pos}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Column headers */}
        <View style={styles.colHeaders}>
          <Text style={[styles.colHeader, { width: 34 }]}>#</Text>
          <Text style={[styles.colHeader, { width: 42 }]}>POS</Text>
          <Text style={[styles.colHeader, { flex: 1 }]}>PLAYER</Text>
          <Text style={[styles.colHeader, { width: 44, textAlign: 'right' }]}>
            {draftMode ? '' : 'IMP'}
          </Text>
        </View>

        {/* Player list */}
        <FlatList
          data={filtered}
          renderItem={renderPlayer}
          keyExtractor={keyExtractor}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 100 }}
          initialNumToRender={25}
          maxToRenderPerBatch={15}
          windowSize={7}
          removeClippedSubviews={Platform.OS === 'android'}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => loadRankings(true)}
              tintColor={C.gold}
              colors={[C.gold]}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Ionicons name="search-outline" size={40} color={C.dim2} />
              <Text style={styles.emptyText}>No players found</Text>
            </View>
          }
        />
      </Animated.View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { flex: 1, paddingTop: Platform.OS === 'ios' ? 60 : 40, paddingHorizontal: 16 },

  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { fontFamily: F.semibold, fontSize: SZ.lg, color: C.ink, marginTop: 16, ...textShadow.body },
  loadingSubtext: { fontFamily: F.mono, fontSize: SZ.xs, color: C.dim2, marginTop: 6, ...textShadow.subtle },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  title: { fontFamily: F.black, fontSize: SZ['4xl'], color: C.ink, letterSpacing: -0.5, ...textShadow.hero },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sourceTag: { backgroundColor: C.surface, paddingHorizontal: 8, paddingVertical: 4, borderRadius: R.xs, borderWidth: 1, borderColor: C.surfBorder },
  sourceTagText: { fontFamily: F.mono, fontSize: SZ.xxs, color: C.dim, ...textShadow.subtle },
  draftToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: R.sm, borderWidth: 1, borderColor: C.surfBorder },
  draftToggleActive: { borderColor: C.goldBorder, backgroundColor: C.goldS },
  draftToggleText: { fontFamily: F.semibold, fontSize: SZ.xs, color: C.dim2, ...textShadow.subtle },
  gearBtn: { padding: 6 },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.glass, borderRadius: R.md, borderWidth: 1, borderColor: C.glassBorder,
    paddingHorizontal: 12, paddingVertical: Platform.OS === 'ios' ? 10 : 6, marginBottom: 10,
    ...shadow.card,
  },
  searchInput: { flex: 1, fontFamily: F.outfit, fontSize: SZ.md, color: C.ink, padding: 0, ...textShadow.body },

  formatRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 6 },
  formatBtn: {
    paddingHorizontal: 16, paddingVertical: 7, borderRadius: R.sm,
    borderWidth: 1, borderColor: C.surfBorder, backgroundColor: 'transparent',
  },
  formatBtnActive: { borderColor: C.goldBorder, backgroundColor: C.goldS },
  formatText: { fontFamily: F.bold, fontSize: SZ.xs, color: C.dim2, letterSpacing: 0.8, ...textShadow.subtle },
  formatTextActive: { color: C.gold, ...textShadow.gold },
  clearBtn: { paddingHorizontal: 10, paddingVertical: 5 },
  clearText: { fontFamily: F.mono, fontSize: SZ.xxs, color: '#e87070', ...textShadow.subtle },

  posRow: { flexDirection: 'row', marginBottom: 10, gap: 4 },
  posFilter: {
    flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: R.sm,
    borderWidth: 1, borderColor: 'transparent', backgroundColor: C.surface,
  },
  posFilterText: { fontFamily: F.semibold, fontSize: SZ.xxs, letterSpacing: 0.5, ...textShadow.subtle },

  colHeaders: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: C.surfBorder, marginBottom: 4 },
  colHeader: { fontFamily: F.mono, fontSize: SZ.xxs, color: C.dim2, letterSpacing: 1, ...textShadow.subtle },

  row: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  rowDrafted: { opacity: 0.3 },

  rankCol: { width: 34, alignItems: 'center' },
  rankNum: { fontFamily: F.monoBold, fontSize: SZ.md, color: C.dim, ...textShadow.body },

  posPill: { width: 42, paddingVertical: 4, borderRadius: R.xs, alignItems: 'center', marginRight: 8 },
  posText: { fontFamily: F.bold, fontSize: SZ.xxs, letterSpacing: 0.5, ...textShadow.subtle },

  infoCol: { flex: 1, marginRight: 8 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  playerName: { fontFamily: F.bold, fontSize: SZ.base, color: C.ink, flexShrink: 1, ...textShadow.body },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 2 },
  teamText: { fontFamily: F.mono, fontSize: SZ.xs, color: C.dim, ...textShadow.subtle },
  posRankText: { fontFamily: F.mono, fontSize: SZ.xs, color: C.dim2, ...textShadow.subtle },
  statText: { fontFamily: F.mono, fontSize: SZ.xs, color: C.dim, ...textShadow.subtle },
  snapText: { fontFamily: F.mono, fontSize: SZ.xs, color: C.mint, ...textShadow.subtle },

  trendBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: 'rgba(45,122,94,0.18)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: R.xs,
  },
  trendText: { fontFamily: F.mono, fontSize: 9, color: C.sage, ...textShadow.subtle },

  injuryBadge: { marginTop: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: R.xs, alignSelf: 'flex-start' },
  injuryText: { fontFamily: F.mono, fontSize: 9, letterSpacing: 0.3, ...textShadow.subtle },

  newsText: { fontFamily: F.outfit, fontSize: 10, color: C.dim2, marginTop: 2, ...textShadow.subtle },

  rightCol: { width: 44, alignItems: 'center', justifyContent: 'center' },
  vegasText: { fontFamily: F.mono, fontSize: SZ.xs, color: C.dim, ...textShadow.subtle },

  checkCircle: {
    width: 24, height: 24, borderRadius: 12, borderWidth: 1.5,
    borderColor: C.surfBorder, alignItems: 'center', justifyContent: 'center',
  },
  checkCircleActive: { backgroundColor: C.gold, borderColor: C.gold },

  textDrafted: { textDecorationLine: 'line-through', color: C.dim2 },

  emptyWrap: { alignItems: 'center', paddingTop: 60 },
  emptyText: { fontFamily: F.outfit, fontSize: SZ.md, color: C.dim2, marginTop: 12, ...textShadow.body },
});
