// QuizSlot — single rank slot used in Phase 2 of the Custom Rankings Quiz.
// Empty: shows "+ Add player" with rank number on left.
// Filled: shows rank, photo, name, team, and a remove (X) button.

import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { RankedPlayer } from '../../services/rankingsData';
import { dark, F, palette } from '../constants/tokens';

interface Props {
  rank: number;
  player: RankedPlayer | null;
  onTap: () => void;
  onRemove?: () => void;
}

function PlayerThumb({ playerId, sleeperId, size = 36 }: { playerId: string; sleeperId?: string; size?: number }) {
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

export default function QuizSlot({ rank, player, onTap, onRemove }: Props) {
  const filled = !!player;

  return (
    <TouchableOpacity
      style={[s.slot, filled && s.slotFilled]}
      onPress={onTap}
      activeOpacity={0.7}
    >
      <Text style={[s.rankNum, filled && s.rankNumFilled]}>{rank}</Text>
      {filled && player ? (
        <>
          <PlayerThumb playerId={player.id} sleeperId={(player as any).sleeperId} />
          <View style={s.playerInfo}>
            <Text style={s.playerName} numberOfLines={1}>{player.name}</Text>
            <Text style={s.playerMeta}>{player.position} · {player.team}</Text>
          </View>
          {onRemove && (
            <TouchableOpacity style={s.removeBtn} onPress={onRemove}>
              <Ionicons name="close" size={18} color={dark.textMuted} />
            </TouchableOpacity>
          )}
        </>
      ) : (
        <Text style={s.placeholder}>+ Add player</Text>
      )}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  slot: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: dark.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: dark.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
    minHeight: 56,
  },
  slotFilled: { borderColor: palette.aqua + '40' },
  rankNum: {
    fontFamily: F.bold,
    fontSize: 14,
    color: dark.textMuted,
    width: 28,
    textAlign: 'center',
    letterSpacing: 1,
  },
  rankNumFilled: { color: palette.aqua },
  placeholder: {
    flex: 1,
    fontFamily: F.body,
    fontSize: 13,
    color: dark.textMuted,
    letterSpacing: 1,
    marginLeft: 8,
  },
  playerInfo: { flex: 1, marginLeft: 12 },
  playerName: { fontFamily: F.bodyBold, fontSize: 14, color: dark.text },
  playerMeta: { fontFamily: F.body, fontSize: 11, color: dark.textSub, letterSpacing: 1, marginTop: 2 },
  removeBtn: { padding: 6 },
});
