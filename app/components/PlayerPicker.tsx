// PlayerPicker — modal for selecting players in Phase 2 of the quiz.
// Loads AIOmni Formula for the current format, filters to a single position,
// shows a searchable list. Already-selected players are dimmed.

import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { getFormulaRankings } from '../../services/rankings/aiomniEngineBridge';
import type { RankedPlayer, ScoringFormat } from '../../services/rankingsData';
import { dark, F, palette } from '../constants/tokens';

interface Props {
  visible: boolean;
  position: 'QB' | 'RB' | 'WR' | 'TE' | 'K';
  format: ScoringFormat;
  alreadySelectedIds: string[];
  onSelect: (player: RankedPlayer) => void;
  onClose: () => void;
}

function PlayerThumb({ playerId, sleeperId, size = 40 }: { playerId: string; sleeperId?: string; size?: number }) {
  const [err, setErr] = useState(false);
  const looksLikeGsisId = playerId?.startsWith('00-');
  const effectiveId = sleeperId || (looksLikeGsisId ? null : playerId);
  if (!err && effectiveId) {
    return (
      <Image
        source={{ uri: `https://sleepercdn.com/content/nfl/players/thumb/${effectiveId}.jpg` }}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: dark.surface, borderWidth: 1.5, borderColor: dark.border }}
        onError={() => setErr(true)}
      />
    );
  }
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: dark.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: dark.border }}>
      <Text style={{ fontSize: size * 0.4, fontFamily: F.bold, color: dark.textMuted }}>?</Text>
    </View>
  );
}

export default function PlayerPicker({
  visible, position, format, alreadySelectedIds, onSelect, onClose,
}: Props) {
  const [allPlayers, setAllPlayers] = useState<RankedPlayer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // Debounce search input by 200ms
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(t);
  }, [query]);

  // Reset search when modal opens, then load formula
  useEffect(() => {
    if (!visible) return;
    setQuery('');
    setDebouncedQuery('');
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, position, format]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getFormulaRankings(format, 'redraft');
      setAllPlayers(data ?? []);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load players');
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    return allPlayers
      .filter(p => p.position === position)
      .filter(p => !q || p.name.toLowerCase().includes(q));
  }, [allPlayers, debouncedQuery, position]);

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={onClose} style={s.closeBtn}>
            <Ionicons name="close" size={24} color={dark.text} />
          </TouchableOpacity>
          <Text style={s.title}>SELECT {position}</Text>
          <View style={s.closeBtn} />
        </View>

        <View style={s.searchWrap}>
          <Ionicons name="search" size={16} color={palette.aqua} style={{ marginRight: 8 }} />
          <TextInput
            style={s.searchInput}
            placeholder="Search players"
            placeholderTextColor={dark.textMuted}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
          />
        </View>

        {loading ? (
          <View style={s.center}>
            <ActivityIndicator color={palette.aqua} />
          </View>
        ) : error ? (
          <View style={s.center}>
            <Text style={s.errorText}>{error}</Text>
            <TouchableOpacity onPress={load} style={s.retryBtn}>
              <Text style={s.retryText}>RETRY</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={item => item.id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const taken = alreadySelectedIds.includes(item.id);
              return (
                <TouchableOpacity
                  style={[s.row, taken && s.rowTaken]}
                  onPress={() => !taken && onSelect(item)}
                  disabled={taken}
                  activeOpacity={taken ? 1 : 0.7}
                >
                  <PlayerThumb playerId={item.id} sleeperId={(item as any).sleeperId} />
                  <View style={s.rowInfo}>
                    <Text style={s.rowName} numberOfLines={1}>{item.name}</Text>
                    <Text style={s.rowMeta}>{item.position} · {item.team} · ADP {item.adp}</Text>
                  </View>
                  {taken && <Text style={s.takenBadge}>SELECTED</Text>}
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              <View style={s.center}>
                <Text style={s.emptyText}>No players match your search.</Text>
              </View>
            }
          />
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: dark.bg, paddingTop: 50 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: dark.border,
  },
  title: { fontFamily: F.bold, fontSize: 16, color: dark.text, letterSpacing: 2 },
  closeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: dark.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: dark.border,
    paddingHorizontal: 12,
    margin: 16,
  },
  searchInput: { flex: 1, fontFamily: F.body, fontSize: 14, color: dark.text, paddingVertical: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  errorText: { fontFamily: F.body, fontSize: 14, color: palette.flame, marginBottom: 16 },
  retryBtn: { paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: palette.aqua },
  retryText: { fontFamily: F.bold, fontSize: 12, color: palette.aqua, letterSpacing: 2 },
  emptyText: { fontFamily: F.body, fontSize: 14, color: dark.textMuted },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: dark.borderLight,
  },
  rowTaken: { opacity: 0.4 },
  rowInfo: { flex: 1, marginLeft: 12 },
  rowName: { fontFamily: F.bodyBold, fontSize: 14, color: dark.text },
  rowMeta: { fontFamily: F.body, fontSize: 11, color: dark.textSub, letterSpacing: 1, marginTop: 2 },
  takenBadge: {
    fontFamily: F.bold,
    fontSize: 9,
    color: palette.aqua,
    letterSpacing: 1.5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: palette.aqua,
  },
});
