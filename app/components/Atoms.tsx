import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { C, F, SZ, R, SP } from '../constants/tokens';

// ── Position Pill ─────────────────────────────────
export const PositionPill: React.FC<{ pos: string; size?: 'sm' | 'md' }> = ({ pos, size = 'sm' }) => {
  const colorMap: Record<string, { color: string; bg: string }> = {
    QB: { color: C.qb,    bg: C.qbBg  },
    RB: { color: C.rb,    bg: C.rbBg  },
    WR: { color: C.wr,    bg: C.wrBg  },
    TE: { color: C.te,    bg: C.teBg  },
    K:  { color: C.k,     bg: C.kBg   },
    FLX:{ color: C.rb,    bg: C.rbBg  },
    BN: { color: C.dim2,  bg: 'rgba(255,255,255,0.07)' },
  };
  const c = colorMap[pos] ?? colorMap.BN;
  return (
    <View style={[styles.pill, { backgroundColor: c.bg }, size === 'md' && styles.pillMd]}>
      <Text style={[styles.pillTxt, { color: c.color }, size === 'md' && styles.pillTxtMd]}>{pos}</Text>
    </View>
  );
};

// ── Badge ─────────────────────────────────────────
export const Badge: React.FC<{ label: string; color: string }> = ({ label, color }) => (
  <View style={[styles.badge, { backgroundColor: color + '22' }]}>
    <Text style={[styles.badgeTxt, { color }]}>{label}</Text>
  </View>
);

// ── Injury Tag ────────────────────────────────────
export const InjuryTag: React.FC<{ tag?: string }> = ({ tag = 'Q' }) => {
  const c = tag === 'O' || tag === 'IR' ? C.rose : C.amber;
  return (
    <View style={[styles.inj, { backgroundColor: c + '22' }]}>
      <Text style={[styles.injTxt, { color: c }]}>{tag}</Text>
    </View>
  );
};

// ── Section Header ────────────────────────────────
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

// ── Progress Bar ──────────────────────────────────
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
  pillTxt:   { fontSize: SZ.xxs + 1, fontFamily: F.monoBold, fontWeight: '700', letterSpacing: 0.3 },
  pillTxtMd: { fontSize: SZ.sm },
  badge:     { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 7 },
  badgeTxt:  { fontSize: SZ.xxs + 1, fontFamily: F.monoBold, fontWeight: '700', letterSpacing: 0.3 },
  inj:       { paddingHorizontal: 4, paddingVertical: 1, borderRadius: 5, flexShrink: 0 },
  injTxt:    { fontSize: SZ.xxs, fontFamily: F.monoBold, fontWeight: '700' },
  shd:       { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 7 },
  sbar:      { width: 2, height: 11, borderRadius: 2 },
  slbl:      { fontSize: SZ.xs, fontFamily: F.mono, color: C.dim, letterSpacing: 2 },
  sline:     { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.12)' },
  track:     { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 2, overflow: 'hidden' },
  fill:      { height: '100%' as any, borderRadius: 2 },
});
