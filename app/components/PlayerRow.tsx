import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { C, F, SZ, SP, R } from '../constants/tokens';
import { PositionPill, InjuryTag, ProgressBar } from './Atoms';

export interface Player {
  slot:      string;
  pos:       string;
  name:      string;
  team:      string;
  pts?:      number;
  proj?:     number;
  injured?:  boolean;
  injTag?:   string;
  owned?:    string;
  trend?:    '↑' | '↓' | '→';
  lastWk?:   number;
}

interface Props {
  player:      Player;
  showScore?:  boolean;
  showBar?:    boolean;
  showAdd?:    boolean;
  showOwned?:  boolean;
  dimmed?:     boolean;
  onAdd?:      () => void;
  onPress?:    () => void;
}

export const PlayerRow: React.FC<Props> = ({
  player, showScore = true, showBar = true,
  showAdd = false, showOwned = false,
  dimmed = false, onAdd, onPress,
}) => {
  const { slot, pos, name, team, pts = 0, proj = 0, injured, injTag, owned, trend, lastWk } = player;
  const beating = showScore && pts > proj && proj > 0;
  const scoreColor = beating ? C.sage : C.ink;

  const trendColor = trend === '↑' ? C.sage : trend === '↓' ? C.rose : C.dim;

  return (
    <TouchableOpacity
      style={[styles.row, dimmed && { opacity: 0.58 }]}
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={0.7}
    >
      {/* Slot */}
      <Text style={styles.slot}>{slot}</Text>

      {/* Position */}
      <PositionPill pos={pos} />

      {/* Info */}
      <View style={styles.info}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          {injured && <InjuryTag tag={injTag ?? 'Q'} />}
        </View>
        <View style={styles.subRow}>
          <Text style={styles.team}>{team}</Text>
          {showOwned && owned && (
            <Text style={styles.owned}> · {owned}
              {trend && <Text style={{ color: trendColor }}> {trend}</Text>}
            </Text>
          )}
        </View>
        {showBar && proj > 0 && (
          <ProgressBar
            value={pts} max={proj}
            color={beating ? C.sage : 'rgba(255,255,255,0.2)'}
            height={3}
          />
        )}
      </View>

      {/* Score */}
      {showScore && (
        <View style={styles.scoreCol}>
          <Text style={[styles.pts, { color: scoreColor }]}>{pts.toFixed(1)}</Text>
          <Text style={styles.proj}>/{proj}</Text>
        </View>
      )}

      {/* Last week (waivers) */}
      {!showScore && lastWk !== undefined && (
        <View style={styles.scoreCol}>
          <Text style={styles.pts}>{lastWk}</Text>
          <Text style={styles.proj}>last</Text>
        </View>
      )}

      {/* Add button */}
      {showAdd && (
        <TouchableOpacity style={styles.addBtn} onPress={onAdd} hitSlop={8}>
          <Text style={styles.addTxt}>+ADD</Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  row:      { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: SP[3], paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)' },
  slot:     { fontSize: SZ.xs - 1, fontFamily: F.mono, color: C.dim, width: 24, flexShrink: 0 },
  info:     { flex: 1, minWidth: 0, gap: 2 },
  nameRow:  { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name:     { fontSize: SZ.base - 1, fontWeight: '600', color: C.ink, fontFamily: F.outfit, flex: 1 },
  subRow:   { flexDirection: 'row', alignItems: 'center' },
  team:     { fontSize: SZ.xs - 1, fontFamily: F.mono, color: C.dim },
  owned:    { fontSize: SZ.xs - 1, fontFamily: F.mono, color: C.dim },
  scoreCol: { alignItems: 'flex-end', width: 38, flexShrink: 0 },
  pts:      { fontSize: SZ.lg, fontWeight: '700', color: C.ink, lineHeight: 18, fontFamily: F.outfit },
  proj:     { fontSize: SZ.xs - 1, fontFamily: F.mono, color: C.dim, marginTop: 1 },
  addBtn:   { backgroundColor: C.sageS, borderWidth: 1, borderColor: C.sageBorder, borderRadius: R.sm - 2, paddingHorizontal: 9, paddingVertical: 5 },
  addTxt:   { fontSize: SZ.sm, fontWeight: '700', color: C.sage, fontFamily: F.monoBold },
});
