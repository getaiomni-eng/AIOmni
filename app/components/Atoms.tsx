import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { C, F, R, SZ } from '../constants/tokens';

// Position color map — adjusted for cream/light background
const POS_MAP: Record<string, { color: string; bg: string }> = {
  QB:  { color: '#7b5ea7', bg: 'rgba(123,94,167,0.12)'  },
  RB:  { color: '#1e8c42', bg: 'rgba(30,140,66,0.12)'   },
  WR:  { color: '#2a7aaa', bg: 'rgba(42,122,170,0.12)'  },
  TE:  { color: '#b85a1a', bg: 'rgba(184,90,26,0.12)'   },
  K:   { color: '#6b7491', bg: 'rgba(107,116,145,0.10)' },
  FLX: { color: '#1e8c42', bg: 'rgba(30,140,66,0.12)'   },
  DEF: { color: '#7b5ea7', bg: 'rgba(123,94,167,0.12)'  },
  DST: { color: '#7b5ea7', bg: 'rgba(123,94,167,0.12)'  },
  BN:  { color: C.dim2,    bg: 'rgba(26,31,46,0.06)'    },
};

export const PositionPill: React.FC<{ pos: string; size?: 'sm' | 'md' }> = ({ pos, size = 'sm' }) => {
  const c = POS_MAP[pos] ?? POS_MAP.BN;
  return (
    <View style={[styles.pill, { backgroundColor: c.bg, borderColor: c.color + '33', borderWidth: 1 }, size === 'md' && styles.pillMd]}>
      <Text style={[styles.pillTxt, { color: c.color }, size === 'md' && styles.pillTxtMd]}>{pos}</Text>
    </View>
  );
};

export const Badge: React.FC<{ label: string; color: string }> = ({ label, color }) => (
  <View style={[styles.badge, { backgroundColor: color + '18', borderColor: color + '44', borderWidth: 1 }]}>
    <Text style={[styles.badgeTxt, { color }]}>{label}</Text>
  </View>
);

export const InjuryTag: React.FC<{ tag?: string }> = ({ tag = 'Q' }) => {
  const c = tag === 'O' || tag === 'IR' ? '#a83040' : C.amber;
  return (
    <View style={[styles.inj, { backgroundColor: c + '15', borderColor: c + '33', borderWidth: 1 }]}>
      <Text style={[styles.injTxt, { color: c }]}>{tag}</Text>
    </View>
  );
};

export const SectionHeader: React.FC<{
  label: string;
  barColor?: string;
  right?: React.ReactNode;
}> = ({ label, barColor = C.gold, right }) => (
  <View style={styles.shd}>
    <View style={[styles.sbar, { backgroundColor: barColor }]} />
    <Text style={styles.slbl}>{label}</Text>
    <View style={styles.sline} />
    {right}
  </View>
);

export const ProgressBar: React.FC<{
  value: number; max: number; color?: string; height?: number;
}> = ({ value, max, color = C.sage, height = 3 }) => {
  const pct = Math.min((value / Math.max(max, 0.01)) * 100, 130);
  return (
    <View style={[styles.track, { height }]}>
      <View style={[styles.fill, { width: `${pct}%` as any, backgroundColor: color }]} />
    </View>
  );
};

const styles = StyleSheet.create({
  pill:      { paddingHorizontal: 7, paddingVertical: 2, borderRadius: R.full, flexShrink: 0 },
  pillMd:    { paddingHorizontal: 10, paddingVertical: 4 },
  pillTxt:   { fontSize: SZ.xxs + 1, fontFamily: F.mono, fontWeight: '700', letterSpacing: 0.3 },
  pillTxtMd: { fontSize: SZ.sm },
  badge:     { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 7 },
  badgeTxt:  { fontSize: SZ.xxs + 1, fontFamily: F.mono, fontWeight: '700', letterSpacing: 0.3 },
  inj:       { paddingHorizontal: 4, paddingVertical: 1, borderRadius: 5, flexShrink: 0 },
  injTxt:    { fontSize: SZ.xxs, fontFamily: F.mono, fontWeight: '700' },
  shd:       { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 7 },
  sbar:      { width: 3, height: 14, borderRadius: 2 },
  slbl:      { fontSize: SZ.xs, fontFamily: F.bold, color: C.blueDeep, letterSpacing: 2 },
  sline:     { flex: 1, height: 1, backgroundColor: 'rgba(88,131,191,0.15)' },
  track:     { backgroundColor: 'rgba(88,131,191,0.10)', borderRadius: 2, overflow: 'hidden' },
  fill:      { height: '100%' as any, borderRadius: 2 },
});