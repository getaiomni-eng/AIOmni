// app/(tabs)/rankings.tsx
// Rankings screen — aggregated from Sleeper, ESPN, nflverse, RotoWire, Vegas
// Position filters, format toggle, search, draft mode with checkmarks

import Ionicons from '@expo/vector-icons/Ionicons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
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
import { C, F, POS, R, SZ } from '../constants/tokens';

// ─── Constants ────────────────────────────────────────────────────────────────
const POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const;
const FORMATS: { key: ScoringFormat; label: string }[] = [
  { key: 'ppr',      label: 'PPR'  },
  { key: 'half',     label: 'HALF' },
  { key: 'standard', label: 'STD'  },
];
const DRAFT_KEY = 'rankings_drafted_ids';

// ─── Injury badge colors ──────────────────────────────────────────────────────
const INJURY_COLORS: Record<string, { bg: string; text: string }> = {
  'Out':             { bg: 'rgba(200,60,60,0.25)',  text: '#e87070' },
  'Injured Reserve': { bg: 'rgba(200,60,60,0.25)',  text: '#e87070' },
  'Doubtful':        { bg: 'rgba(200,120,60,0.25)', text: '#e0a050' },
  'Questionable':    { bg: 'rgba(200,180,60,0.25)', text: '#e0c850' },
  'Day-To-Day':      { bg: 'rgba(200,180,60,0.20)', text: '#d0c060' },
};

export default function RankingsScreen() {
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

  // ─── Load rankings ────────────────────────────────────────────────────────
  const loadRankings = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true); else setLoading(true);
    try {
      const data = await buildRankings(format);
      setPlayers(data);
      // Count how many sources returned data
      let sources = 0;
      if (data.some(p => p.statLine && !p.statLine.startsWith('🔥'))) sources++; // ESPN
      if (data.some(p => p.trendingAdds > 0)) sources++;  // Sleeper
      if (data.some(p => p.injuryStatus))     sources++;  // Injuries
      if (data.some(p => p.snapPct !== null))  sources++;  // Snaps
      if (data.some(p => p.newsHeadline))      sources++;  // RotoWire
      if (data.some(p => p.impliedTeamScore))  sources++;  // Vegas
      setSourceCount(sources);
    } catch (e) {
      console.log('Rankings load error:', e);
    }
    setLoading(false);
    setRefreshing(false);
    Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
  }, [format]);

  // ─── Load drafted IDs from storage ────────────────────────────────────────
  useEffect(() => {
    AsyncStorage.getItem(DRAFT_KEY).then(val => {
      if (val) setDraftedIds(new Set(JSON.parse(val)));
    });
  }, []);

  useEffect(() => { loadRankings(); }, [loadRankings]);

  // ─── Draft toggle ─────────────────────────────────────────────────────────
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

  // ─── Filter + search ─────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = players;
    if (position !== 'ALL') list = list.filter(p => p.position === position);
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter(p =>
        p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q)
      );
    }
    // Re-rank after filtering
    return list.map((p, i) => ({ ...p, rank: i + 1 }));
  }, [players, position, search]);

  // ─── Render player row ────────────────────────────────────────────────────
  const renderPlayer = useCallback(({ item }: { item: RankedPlayer }) => {
    const isDrafted  = draftedIds.has(item.id || item.name);
    const posConfig  = POS[item.position] || POS.BN;
    const injColor   = item.injuryStatus ? INJURY_COLORS[item.injuryStatus] : null;

    return (
      <TouchableOpacity
        activeOpacity={draftMode ? 0.6 : 1}
        onPress={draftMode ? () => toggleDrafted(item.id || item.name) : undefined}
        style={[styles.row, isDrafted && draftMode && styles.rowDrafted]}
      >
        {/* Rank */}
        <View style={styles.rankCol}>
          <Text style={[styles.rankNum, isDrafted && draftMode && styles.textDrafted]}>
            {item.rank}
          </Text>
        </View>

        {/* Position pill */}
        <View style={[styles.posPill, { backgroundColor: posConfig.bg }]}>
          <Text style={[styles.posText, { color: posConfig.color }]}>
            {item.position}
          </Text>
        </View>

        {/* Player info */}
        <View style={styles.infoCol}>
          <View style={styles.nameRow}>
            <Text style={[styles.playerName, isDrafted && draftMode && styles.textDrafted]} numberOfLines={1}>
              {item.name}
            </Text>
            {item.trendingAdds > 0 && (
              <View style={styles.trendBadge}>
                <Ionicons name="trending-up" size={11} color={C.sage} />
                <Text style={styles.trendText}>{item.trendingAdds > 999 ? `${(item.trendingAdds / 1000).toFixed(1)}k` : item.trendingAdds}</Text>
              </View>
            )}
            {item.trendingDrops > 500 && !item.trendingAdds && (
              <View style={[styles.trendBadge, { backgroundColor: 'rgba(200,60,60,0.15)' }]}>
                <Ionicons name="trending-down" size={11} color="#e87070" />
              </View>
            )}
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.teamText}>{item.team}</Text>
            {item.statLine ? <Text style={styles.statText}> · {item.statLine}</Text> : null}
            {item.snapPct !== null && <Text style={styles.snapText}> · {item.snapPct}% snaps</Text>}
          </View>
          {/* Injury badge */}
          {item.injuryStatus && injColor && (
            <View style={[styles.injuryBadge, { backgroundColor: injColor.bg }]}>
              <Text style={[styles.injuryText, { color: injColor.text }]}>
                {item.injuryStatus}{item.injuryDetail ? ` — ${item.injuryDetail}` : ''}
              </Text>
            </View>
          )}
          {/* News */}
          {item.newsHeadline && !item.injuryStatus && (
            <Text style={styles.newsText} numberOfLines={1}>
              📰 {item.newsHeadline} {item.newsAge ? `(${item.newsAge})` : ''}
            </Text>
          )}
        </View>

        {/* Vegas implied / Draft check */}
        <View style={styles.rightCol}>
          {draftMode ? (
            <View style={[styles.checkCircle, isDrafted && styles.checkCircleActive]}>
              {isDrafted && <Ionicons name="checkmark" size={14} color={C.ink} />}
            </View>
          ) : (
            item.impliedTeamScore ? (
              <Text style={styles.vegasText}>{item.impliedTeamScore.toFixed(1)}</Text>
            ) : null
          )}
        </View>
      </TouchableOpacity>
    );
  }, [draftMode, draftedIds, toggleDrafted]);

  const keyExtractor = useCallback((item: RankedPlayer) => item.id || item.name, []);

  // ─── Loading state ────────────────────────────────────────────────────────
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
            <Text style={styles.sourceTag}>{sourceCount} sources</Text>
            <TouchableOpacity
              style={[styles.draftToggle, draftMode && styles.draftToggleActive]}
              onPress={() => setDraftMode(d => !d)}
            >
              <Ionicons name={draftMode ? 'checkmark-circle' : 'checkmark-circle-outline'} size={16} color={draftMode ? C.gold : C.dim2} />
              <Text style={[styles.draftToggleText, draftMode && { color: C.gold }]}>Draft</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Search */}
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={16} color={C.dim2} style={{ marginRight: 8 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search player or team…"
            placeholderTextColor={C.dim2}
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
          <Text style={[styles.colHeader, { width: 36 }]}>#</Text>
          <Text style={[styles.colHeader, { width: 40 }]}>POS</Text>
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
          initialNumToRender={20}
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

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { flex: 1, paddingTop: Platform.OS === 'ios' ? 60 : 40, paddingHorizontal: 16 },

  // Loading
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { fontFamily: F.semibold, fontSize: SZ.lg, color: C.ink, marginTop: 16 },
  loadingSubtext: { fontFamily: F.mono, fontSize: SZ.xs, color: C.dim2, marginTop: 6 },

  // Header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontFamily: F.black, fontSize: SZ['3xl'], color: C.ink, letterSpacing: -0.5 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sourceTag: { fontFamily: F.mono, fontSize: SZ.xxs, color: C.dim2, backgroundColor: C.surface, paddingHorizontal: 8, paddingVertical: 3, borderRadius: R.xs, overflow: 'hidden' },
  draftToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: R.sm, borderWidth: 1, borderColor: C.surfBorder },
  draftToggleActive: { borderColor: C.goldBorder, backgroundColor: C.goldS },
  draftToggleText: { fontFamily: F.semibold, fontSize: SZ.xs, color: C.dim2 },

  // Search
  searchWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.glass, borderRadius: R.md, borderWidth: 1, borderColor: C.glassBorder,
    paddingHorizontal: 12, paddingVertical: Platform.OS === 'ios' ? 10 : 6, marginBottom: 10,
  },
  searchInput: { flex: 1, fontFamily: F.outfit, fontSize: SZ.md, color: C.ink, padding: 0 },

  // Format toggle
  formatRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 6 },
  formatBtn: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: R.sm,
    borderWidth: 1, borderColor: C.surfBorder, backgroundColor: 'transparent',
  },
  formatBtnActive: { borderColor: C.goldBorder, backgroundColor: C.goldS },
  formatText: { fontFamily: F.bold, fontSize: SZ.xs, color: C.dim2, letterSpacing: 0.8 },
  formatTextActive: { color: C.gold },
  clearBtn: { paddingHorizontal: 10, paddingVertical: 5 },
  clearText: { fontFamily: F.mono, fontSize: SZ.xxs, color: '#e87070' },

  // Position filters
  posRow: { flexDirection: 'row', marginBottom: 10, gap: 4 },
  posFilter: {
    flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: R.sm,
    borderWidth: 1, borderColor: 'transparent', backgroundColor: C.surface,
  },
  posFilterText: { fontFamily: F.semibold, fontSize: SZ.xxs, letterSpacing: 0.5 },

  // Column headers
  colHeaders: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: C.surfBorder, marginBottom: 4 },
  colHeader: { fontFamily: F.mono, fontSize: SZ.xxs, color: C.dim2, letterSpacing: 1 },

  // Player row
  row: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  rowDrafted: { opacity: 0.35 },

  // Rank
  rankCol: { width: 36, alignItems: 'center' },
  rankNum: { fontFamily: F.mono, fontSize: SZ.sm, color: C.dim },

  // Position pill
  posPill: { width: 40, paddingVertical: 3, borderRadius: R.xs, alignItems: 'center', marginRight: 8 },
  posText: { fontFamily: F.bold, fontSize: SZ.xxs, letterSpacing: 0.5 },

  // Info
  infoCol: { flex: 1, marginRight: 8 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  playerName: { fontFamily: F.semibold, fontSize: SZ.md, color: C.ink, flexShrink: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 1 },
  teamText: { fontFamily: F.mono, fontSize: SZ.xxs, color: C.dim2 },
  statText: { fontFamily: F.mono, fontSize: SZ.xxs, color: C.dim },
  snapText: { fontFamily: F.mono, fontSize: SZ.xxs, color: C.mint },

  // Trending
  trendBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: 'rgba(45,122,94,0.15)', paddingHorizontal: 5, paddingVertical: 1, borderRadius: R.xs,
  },
  trendText: { fontFamily: F.mono, fontSize: 9, color: C.sage },

  // Injury
  injuryBadge: { marginTop: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: R.xs, alignSelf: 'flex-start' },
  injuryText: { fontFamily: F.mono, fontSize: 9, letterSpacing: 0.3 },

  // News
  newsText: { fontFamily: F.outfit, fontSize: 10, color: C.dim2, marginTop: 2 },

  // Right column
  rightCol: { width: 44, alignItems: 'center', justifyContent: 'center' },
  vegasText: { fontFamily: F.mono, fontSize: SZ.xs, color: C.dim2 },

  // Draft checkmark
  checkCircle: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 1.5,
    borderColor: C.surfBorder, alignItems: 'center', justifyContent: 'center',
  },
  checkCircleActive: { backgroundColor: C.gold, borderColor: C.gold },

  // Text states
  textDrafted: { textDecorationLine: 'line-through', color: C.dim2 },

  // Empty
  emptyWrap: { alignItems: 'center', paddingTop: 60 },
  emptyText: { fontFamily: F.outfit, fontSize: SZ.md, color: C.dim2, marginTop: 12 },
});