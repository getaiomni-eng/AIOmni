import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme, type ThemeTokens } from '../constants/theme';
import { F, SZ, SP, R } from '../constants/tokens';
import { PositionPill, InjuryTag, ProgressBar } from './Atoms';

export interface Player {
  slot:     string;
  pos:      string;
  name:     string;
  team:     string;
  pts?:     number;
  proj?:    number;
  injured?: boolean;
  injTag?:  string;
  owned?:   string;
  trend?:   '↑' | '↓' | '→';
  lastWk?:  number;
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
  const { t } = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);

  const { slot, pos, name, team, pts = 0, proj = 0,
          injured, injTag, owned, trend, lastWk } = player;

  const beating    = showScore && pts > proj && proj > 0;
  const scoreColor = beating ? t.successText : t.accentText;
  const trendColor = trend === '↑' ? t.successText : trend === '↓' ? t.dangerText : t.textMuted;

  // Position-based progress bar colors
  const positionBarColors: Record<string, string> = {
    QB: '#7b5ea7',
    RB: '#1e8c42',
    WR: '#2a7aaa',
    TE: '#b85a1a',
    K:  '#888888',
    FLX: '#1e8c42',
    DEF: '#7b5ea7',
    BN: 'rgba(88,131,191,0.25)',
  };
  const barColor = positionBarColors[pos] || 'rgba(88,131,191,0.25)';

  return (
    <TouchableOpacity
      style={[s.row, dimmed && { opacity: 0.5 }]}
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={0.7}
    >
      {/* Slot label */}
      <Text style={s.slot}>{slot}</Text>

      {/* Position pill */}
      <PositionPill pos={pos} />

      {/* Player info */}
      <View style={s.info}>
        <View style={s.nameRow}>
          <Text style={s.name} numberOfLines={1}>{name}</Text>
          {injured && <InjuryTag tag={injTag ?? 'Q'} />}
        </View>
        <View style={s.subRow}>
          <Text style={s.team}>{team}</Text>
          {showOwned && owned && (
            <Text style={s.owned}>
              {' · '}{owned}
              {trend && <Text style={{ color: trendColor }}> {trend}</Text>}
            </Text>
          )}
        </View>
        {showBar && proj > 0 && (
          <ProgressBar
            value={pts}
            max={proj}
            color={barColor}
            height={3}
          />
        )}
      </View>

      {/* Score */}
      {showScore && (
        <View style={s.scoreCol}>
          <Text style={[s.pts, { color: scoreColor }]}>{pts.toFixed(1)}</Text>
          <Text style={s.proj}>/{proj}</Text>
        </View>
      )}

      {/* Last week (waivers view) */}
      {!showScore && lastWk !== undefined && (
        <View style={s.scoreCol}>
          <Text style={s.pts}>{lastWk}</Text>
          <Text style={s.proj}>last</Text>
        </View>
      )}

      {/* Add button */}
      {showAdd && (
        <TouchableOpacity style={s.addBtn} onPress={onAdd} hitSlop={8}>
          <Text style={s.addTxt}>+ADD</Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
};

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: SP[3], paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: t.border,
  },
  slot:     { fontSize: SZ.xs - 1, fontFamily: F.mono, color: t.textMuted, width: 24, flexShrink: 0 },
  info:     { flex: 1, minWidth: 0, gap: 2 },
  nameRow:  { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name:     { fontSize: SZ.base - 1, fontFamily: F.bold, color: t.text, flex: 1 },
  subRow:   { flexDirection: 'row', alignItems: 'center' },
  team:     { fontSize: SZ.xs - 1, fontFamily: F.mono, color: t.textMuted },
  owned:    { fontSize: SZ.xs - 1, fontFamily: F.mono, color: t.textMuted },
  scoreCol: { alignItems: 'flex-end', width: 40, flexShrink: 0 },
  pts:      { fontSize: SZ.lg, fontFamily: F.bold, color: t.text, lineHeight: 18 },
  proj:     { fontSize: SZ.xs - 1, fontFamily: F.mono, color: t.textMuted, marginTop: 1 },
  addBtn: {
    backgroundColor: t.border,
    borderWidth: 1.5, borderColor: t.border,
    borderRadius: R.sm - 2,
    paddingHorizontal: 9, paddingVertical: 5,
  },
  addTxt: { fontSize: SZ.sm, fontFamily: F.mono, color: t.successText, fontWeight: '700' },
});
