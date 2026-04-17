// app/(tabs)/waiver.tsx
// AIOmni Waiver Wire — V7 Dark Theme
// Multi-platform: Sleeper / ESPN / Yahoo
// Tap player → AI advice reads YOUR league settings (FAAB vs rolling, roster depth, scoring)

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image, Modal, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { askAI } from '../../services/ai';
import { loadESPNCredentials } from '../../services/espn';
import {
  AvailablePlayer,
  WaiverContext,
  WaiverPlatform,
  buildWaiverAdvicePrompt,
  getAvailablePlayers,
  getWaiverContext,
  invalidateWaiverCache,
} from '../../services/waivers';
import { getValidYahooToken } from '../../services/yahoo';

// ─── V7 THEME ───────────────────────────────────────────────
const C = {
  bg:       '#0a1214',
  card:     '#12252e',
  cardAlt:  '#14282f',
  border:   '#1a3542',
  muted:    '#0f1c22',
  amber:    '#ffb800',
  aqua:     '#1be7ff',
  green:    '#6eeb83',
  flame:    '#ff5714',
  text:     '#f0f4f5',
  textDim:  '#7a9eaa',
  red:      '#ff4d6a',
};

const POS_COLORS: Record<string, string> = {
  QB:   '#ff6b9d',
  RB:   '#1be7ff',
  WR:   '#6eeb83',
  TE:   '#ffb800',
  K:    '#7a9eaa',
  DEF:  '#c78dff',
  DST:  '#c78dff',
};

const POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

const F = {
  heading: 'BebasNeue-Regular',
  body:    'Barlow-Regular',
  bodyB:   'Barlow-Bold',
  data:    'SpaceMono-Regular',
};

// ─── PLAYER PHOTO ───────────────────────────────────────────

function PlayerPhoto({ photoId, size = 44 }: { photoId?: string; size?: number }) {
  const [err, setErr] = useState(false);
  const s = { width: size, height: size, borderRadius: size / 2 };
  if (!err && photoId) {
    return (
      <Image
        source={{ uri: `https://sleepercdn.com/content/nfl/players/thumb/${photoId}.jpg` }}
        style={[s, { backgroundColor: C.muted, borderWidth: 1.5, borderColor: C.border }]}
        onError={() => setErr(true)}
      />
    );
  }
  return (
    <View style={[s, { backgroundColor: C.muted, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: C.border }]}>
      <Text style={{ fontSize: size * 0.35, color: C.textDim, fontFamily: F.bodyB }}>?</Text>
    </View>
  );
}

// ─── PLATFORM DETECTION ─────────────────────────────────────

interface LeagueChoice {
  platform: WaiverPlatform;
  leagueId: string;
  leagueName: string;
}

async function detectAvailablePlatforms(): Promise<LeagueChoice[]> {
  const choices: LeagueChoice[] = [];

  // Sleeper
  const sleeperUsername = await AsyncStorage.getItem('sleeper_username');
  if (sleeperUsername) {
    try {
      const u = await (await fetch(`https://api.sleeper.app/v1/user/${sleeperUsername}`)).json();
      const state = await (await fetch('https://api.sleeper.app/v1/state/nfl')).json();
      const season = state?.season ?? '2025';
      const leagues = await (await fetch(`https://api.sleeper.app/v1/user/${u.user_id}/leagues/nfl/${season}`)).json();
      if (Array.isArray(leagues)) {
        for (const lg of leagues) {
          choices.push({ platform: 'sleeper', leagueId: lg.league_id, leagueName: lg.name });
        }
      }
    } catch {}
  }

  // ESPN
  const espnCreds = await loadESPNCredentials();
  if (espnCreds?.leagueId) {
    try {
      const { getESPNLeague } = await import('../../services/espn');
      const data = await getESPNLeague(espnCreds.leagueId, espnCreds);
      choices.push({
        platform: 'espn',
        leagueId: String(espnCreds.leagueId),
        leagueName: data?.settings?.name ?? 'ESPN League',
      });
    } catch {}
  }

  // Yahoo
  const yahooToken = await getValidYahooToken();
  if (yahooToken) {
    try {
      const { getYahooLeagues } = await import('../../services/yahoo');
      const leagues = await getYahooLeagues(yahooToken);
      for (const lg of leagues) {
        choices.push({ platform: 'yahoo', leagueId: lg.league_key, leagueName: lg.name });
      }
    } catch {}
  }

  return choices;
}

// ─── MAIN SCREEN ────────────────────────────────────────────

export default function WaiverScreen() {
  const insets = useSafeAreaInsets();

  const [leagueChoices, setLeagueChoices] = useState<LeagueChoice[]>([]);
  const [activeLeague, setActiveLeague] = useState<LeagueChoice | null>(null);
  const [showLeaguePicker, setShowLeaguePicker] = useState(false);

  const [players, setPlayers] = useState<AvailablePlayer[]>([]);
  const [context, setContext] = useState<WaiverContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [posFilter, setPosFilter] = useState('ALL');
  const [search, setSearch] = useState('');

  const [selectedPlayer, setSelectedPlayer] = useState<AvailablePlayer | null>(null);
  const [advice, setAdvice] = useState('');
  const [adviceLoading, setAdviceLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);

  // ── On mount: detect available platforms ──
  useEffect(() => {
    (async () => {
      const choices = await detectAvailablePlatforms();
      setLeagueChoices(choices);
      if (choices.length > 0) {
        // Restore last used league, or default to first
        const lastKey = await AsyncStorage.getItem('waiver_last_league');
        const last = lastKey ? choices.find(c => `${c.platform}:${c.leagueId}` === lastKey) : null;
        setActiveLeague(last ?? choices[0]);
      } else {
        setLoading(false);
      }
    })();
  }, []);

  // ── When active league changes, fetch players + context ──
  useEffect(() => {
    if (activeLeague) {
      AsyncStorage.setItem('waiver_last_league', `${activeLeague.platform}:${activeLeague.leagueId}`);
      loadWaivers(false);
    }
  }, [activeLeague]);

  // Refresh when returning to tab
  useFocusEffect(useCallback(() => {
    if (activeLeague) loadWaivers(false);
  }, [activeLeague]));

  const loadWaivers = async (force: boolean) => {
    if (!activeLeague) return;
    if (force) {
      setRefreshing(true);
      invalidateWaiverCache(activeLeague.platform, activeLeague.leagueId);
    } else {
      setLoading(true);
    }
    try {
      const [playerList, ctx] = await Promise.all([
        getAvailablePlayers(activeLeague.platform, activeLeague.leagueId, force),
        getWaiverContext(activeLeague.platform, activeLeague.leagueId),
      ]);
      setPlayers(playerList);
      setContext(ctx);
    } catch (e) {
      console.log('loadWaivers error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const filtered = players.filter(p =>
    (posFilter === 'ALL' || p.position === posFilter) &&
    (!search || p.name.toLowerCase().includes(search.toLowerCase()) || p.team.toLowerCase().includes(search.toLowerCase()))
  );

  const handleAdvice = async (player: AvailablePlayer) => {
    setSelectedPlayer(player);
    setAdvice('');
    setModalVisible(true);
    setAdviceLoading(true);

    try {
      const prompt = buildWaiverAdvicePrompt(player, context);
      const text = await askAI(prompt, 220);
      setAdvice(text || 'No advice available.');
    } catch (e: any) {
      if (e?.message?.includes('prompt_limit_reached')) {
        setAdvice("You've used all your weekly prompts. Upgrade to Pro for more.");
      } else {
        setAdvice('Could not load AI advice. Check your connection and try again.');
      }
    } finally {
      setAdviceLoading(false);
    }
  };

  // ─── EMPTY STATE ─────────────────────────────────────────
  if (!loading && leagueChoices.length === 0) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 40 }]}>
        <Text style={styles.title}>WAIVER WIRE</Text>
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>NO LEAGUES CONNECTED</Text>
          <Text style={styles.emptyText}>
            Connect Sleeper, ESPN, or Yahoo in Settings to see your available players.
          </Text>
        </View>
      </View>
    );
  }

  // ─── MAIN VIEW ───────────────────────────────────────────
  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>

      {/* ── HEADER ── */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>WAIVER WIRE</Text>
          <Text style={styles.title}>PICKUPS.</Text>
        </View>
        <TouchableOpacity style={styles.refreshBtn} onPress={() => loadWaivers(true)}>
          <Text style={styles.refreshText}>{refreshing ? '...' : '↻'}</Text>
        </TouchableOpacity>
      </View>

      {/* ── ACTIVE LEAGUE BAR ── */}
      {activeLeague && (
        <TouchableOpacity
          style={styles.leagueBar}
          onPress={() => leagueChoices.length > 1 && setShowLeaguePicker(true)}
          activeOpacity={leagueChoices.length > 1 ? 0.7 : 1}
        >
          <View style={[styles.platformDot, { backgroundColor: getPlatformColor(activeLeague.platform) }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.leagueBarName}>{activeLeague.leagueName}</Text>
            <Text style={styles.leagueBarMeta}>
              {activeLeague.platform.toUpperCase()}
              {context?.scoringFormat ? ` · ${context.scoringFormat.toUpperCase()}` : ''}
              {context?.waiverType === 'faab' ? ` · FAAB $${context.faabRemaining ?? '?'}` : ''}
              {context?.waiverType === 'rolling' ? ' · ROLLING' : ''}
            </Text>
          </View>
          {leagueChoices.length > 1 && <Text style={styles.leagueBarArrow}>⌄</Text>}
        </TouchableOpacity>
      )}

      {/* ── SEARCH ── */}
      <View style={styles.searchWrap}>
        <Text style={styles.searchIcon}>⌕</Text>
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="SEARCH PLAYERS OR TEAMS"
          placeholderTextColor={C.textDim}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {/* ── POSITION FILTER ── */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.posScroll} contentContainerStyle={styles.posScrollContent}>
        {POSITIONS.map(pos => (
          <TouchableOpacity
            key={pos}
            style={[styles.posChip, posFilter === pos && { backgroundColor: POS_COLORS[pos] || C.aqua }]}
            onPress={() => setPosFilter(pos)}
          >
            <Text style={[styles.posChipText, posFilter === pos && { color: '#000' }]}>{pos}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* ── PLAYER LIST ── */}
      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={C.amber} size="large" />
          <Text style={styles.loadingText}>LOADING AVAILABLE PLAYERS</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => `${item.platform}:${item.id}`}
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 80 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item, index }) => (
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => handleAdvice(item)}
              style={styles.playerCard}
            >
              <Text style={styles.rank}>{index + 1}</Text>
              <PlayerPhoto photoId={item.photoId} size={44} />
              <View style={[styles.posBadge, { backgroundColor: POS_COLORS[item.position] || C.textDim }]}>
                <Text style={styles.posText}>{item.position}</Text>
              </View>
              <View style={styles.playerInfo}>
                <Text style={styles.playerName}>{item.name}</Text>
                <Text style={styles.playerMeta}>
                  {item.team}
                  {item.injuryStatus ? ` · ⚠ ${item.injuryStatus}` : ''}
                  {item.trendingAdds && item.trendingAdds > 0 ? ` · +${formatCount(item.trendingAdds)}` : ''}
                  {item.percentOwned !== undefined && item.percentOwned > 0 ? ` · ${Math.round(item.percentOwned)}%` : ''}
                </Text>
              </View>
              <View style={styles.aiHint}>
                <Text style={styles.aiHintText}>AI</Text>
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No players match your filters.</Text>
            </View>
          }
        />
      )}

      {/* ── LEAGUE PICKER MODAL ── */}
      <Modal visible={showLeaguePicker} transparent animationType="slide" onRequestClose={() => setShowLeaguePicker(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>SELECT LEAGUE</Text>
            <ScrollView>
              {leagueChoices.map(lg => (
                <TouchableOpacity
                  key={`${lg.platform}:${lg.leagueId}`}
                  style={[styles.leagueRow, activeLeague?.leagueId === lg.leagueId && styles.leagueRowActive]}
                  onPress={() => {
                    setActiveLeague(lg);
                    setShowLeaguePicker(false);
                  }}
                >
                  <View style={[styles.platformDot, { backgroundColor: getPlatformColor(lg.platform) }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.leagueRowName}>{lg.leagueName}</Text>
                    <Text style={styles.leagueRowMeta}>{lg.platform.toUpperCase()}</Text>
                  </View>
                  {activeLeague?.leagueId === lg.leagueId && <Text style={styles.checkmark}>✓</Text>}
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.modalCancel} onPress={() => setShowLeaguePicker(false)}>
              <Text style={styles.modalCancelTxt}>CANCEL</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── AI ADVICE MODAL ── */}
      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.adviceCard}>
            <View style={styles.adviceHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
                <PlayerPhoto photoId={selectedPlayer?.photoId} size={56} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.adviceName}>{selectedPlayer?.name}</Text>
                  <Text style={styles.adviceMeta}>
                    {selectedPlayer?.team} · {selectedPlayer?.position}
                    {selectedPlayer?.age ? ` · Age ${selectedPlayer.age}` : ''}
                  </Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setModalVisible(false)} style={styles.closeBtn}>
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            {context && (
              <View style={styles.contextStrip}>
                <Text style={styles.contextStripText}>
                  {context.waiverType === 'faab'
                    ? `${context.scoringFormat.toUpperCase()} · FAAB $${context.faabRemaining ?? '?'}/$${context.faabBudget ?? '?'}`
                    : `${context.scoringFormat.toUpperCase()} · ROLLING WAIVERS`}
                </Text>
              </View>
            )}

            {adviceLoading ? (
              <View style={styles.adviceLoading}>
                <ActivityIndicator color={C.amber} size="large" />
                <Text style={styles.adviceLoadingText}>READING YOUR LEAGUE SETTINGS...</Text>
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
    </View>
  );
}

// ─── HELPERS ────────────────────────────────────────────────

function getPlatformColor(platform: WaiverPlatform): string {
  if (platform === 'sleeper') return '#00FFF9';
  if (platform === 'espn') return '#e52534';
  if (platform === 'yahoo') return '#7c3aed';
  return C.textDim;
}

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// ─── STYLES ─────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  eyebrow: {
    fontFamily: F.data,
    fontSize: 10,
    letterSpacing: 3,
    color: C.textDim,
    marginBottom: 2,
  },
  title: {
    fontFamily: F.heading,
    fontSize: 42,
    color: C.text,
    letterSpacing: 2,
  },
  refreshBtn: {
    backgroundColor: C.card,
    borderRadius: 10,
    width: 40, height: 40,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.border,
  },
  refreshText: {
    fontFamily: F.bodyB,
    fontSize: 18,
    color: C.aqua,
  },

  // League bar
  leagueBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.card,
    marginHorizontal: 12,
    marginBottom: 10,
    borderRadius: 12,
    padding: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  platformDot: {
    width: 10, height: 10,
    borderRadius: 5,
  },
  leagueBarName: {
    fontFamily: F.bodyB,
    fontSize: 15,
    color: C.text,
  },
  leagueBarMeta: {
    fontFamily: F.data,
    fontSize: 10,
    color: C.textDim,
    letterSpacing: 1,
    marginTop: 2,
  },
  leagueBarArrow: {
    fontFamily: F.bodyB,
    fontSize: 18,
    color: C.textDim,
  },

  // Search
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.card,
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  searchIcon: {
    fontSize: 16,
    color: C.aqua,
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontFamily: F.data,
    fontSize: 11,
    letterSpacing: 1.5,
    color: C.text,
    paddingVertical: 12,
  },

  // Position filter
  posScroll: { marginVertical: 8, maxHeight: 40 },
  posScrollContent: { paddingHorizontal: 12, gap: 6, flexDirection: 'row' },
  posChip: {
    backgroundColor: C.card,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: C.border,
  },
  posChipText: {
    fontFamily: F.data,
    fontSize: 12,
    color: C.textDim,
    letterSpacing: 1,
  },

  // Loading
  loadingBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  loadingText: {
    fontFamily: F.data,
    fontSize: 11,
    letterSpacing: 3,
    color: C.amber,
    opacity: 0.8,
  },

  // Player card
  playerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.card,
    borderRadius: 12,
    padding: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: C.border,
  },
  rank: {
    fontFamily: F.data,
    fontSize: 12,
    color: C.textDim,
    width: 26,
    textAlign: 'right',
  },
  posBadge: {
    borderRadius: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    minWidth: 36,
    alignItems: 'center',
  },
  posText: {
    fontFamily: F.data,
    fontSize: 10,
    color: '#000',
    fontWeight: '700',
  },
  playerInfo: { flex: 1 },
  playerName: {
    fontFamily: F.bodyB,
    fontSize: 15,
    color: C.text,
  },
  playerMeta: {
    fontFamily: F.data,
    fontSize: 11,
    color: C.textDim,
    marginTop: 2,
    letterSpacing: 0.5,
  },
  aiHint: {
    width: 32, height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(255,184,0,0.12)',
    borderWidth: 1,
    borderColor: C.amber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiHintText: {
    fontFamily: F.bodyB,
    fontSize: 10,
    color: C.amber,
    letterSpacing: 1,
  },

  // Empty state
  emptyState: {
    alignItems: 'center',
    padding: 40,
    gap: 12,
  },
  emptyTitle: {
    fontFamily: F.heading,
    fontSize: 22,
    color: C.text,
    letterSpacing: 2,
  },
  emptyText: {
    fontFamily: F.body,
    fontSize: 14,
    color: C.textDim,
    textAlign: 'center',
    lineHeight: 22,
  },

  // Modal shared
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(10,18,20,0.8)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: C.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingBottom: 40,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderColor: C.border,
    maxHeight: '70%',
  },
  modalHandle: {
    width: 36, height: 4,
    borderRadius: 2,
    backgroundColor: C.border,
    alignSelf: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontFamily: F.heading,
    color: C.amber,
    fontSize: 22,
    letterSpacing: 2,
    marginBottom: 12,
  },
  leagueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 12,
    marginBottom: 6,
    backgroundColor: C.muted,
    borderWidth: 1,
    borderColor: C.border,
  },
  leagueRowActive: {
    borderColor: C.amber,
  },
  leagueRowName: {
    fontFamily: F.bodyB,
    fontSize: 15,
    color: C.text,
  },
  leagueRowMeta: {
    fontFamily: F.data,
    fontSize: 10,
    color: C.textDim,
    marginTop: 2,
    letterSpacing: 1,
  },
  checkmark: {
    fontFamily: F.bodyB,
    fontSize: 18,
    color: C.amber,
  },
  modalCancel: {
    marginTop: 12,
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  modalCancelTxt: {
    fontFamily: F.data,
    color: C.textDim,
    fontSize: 12,
    letterSpacing: 1.5,
  },

  // Advice modal
  adviceCard: {
    backgroundColor: C.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 34,
    borderTopWidth: 1,
    borderColor: C.border,
  },
  adviceHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  adviceName: {
    fontFamily: F.bodyB,
    fontSize: 20,
    color: C.text,
  },
  adviceMeta: {
    fontFamily: F.data,
    fontSize: 11,
    color: C.textDim,
    marginTop: 2,
    letterSpacing: 0.5,
  },
  closeBtn: {
    width: 32, height: 32,
    borderRadius: 8,
    backgroundColor: C.muted,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.border,
  },
  closeBtnText: {
    fontFamily: F.bodyB,
    fontSize: 14,
    color: C.textDim,
  },
  contextStrip: {
    backgroundColor: C.muted,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  contextStripText: {
    fontFamily: F.data,
    fontSize: 11,
    color: C.aqua,
    letterSpacing: 1.2,
  },
  adviceLoading: {
    alignItems: 'center',
    padding: 30,
    gap: 14,
  },
  adviceLoadingText: {
    fontFamily: F.data,
    fontSize: 10,
    color: C.amber,
    letterSpacing: 2,
  },
  adviceText: {
    fontFamily: F.body,
    fontSize: 15,
    color: C.text,
    lineHeight: 23,
    marginBottom: 18,
  },
  gotItBtn: {
    backgroundColor: C.amber,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  gotItText: {
    fontFamily: F.bodyB,
    fontSize: 14,
    color: '#000',
    letterSpacing: 2,
  },
});