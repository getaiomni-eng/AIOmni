import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { C, R } from '../constants/tokens';

interface Props {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  variant?: 'glass' | 'surface' | 'gold' | 'sage' | 'blue' | 'rose';
  padding?: number;
  radius?: number;
  noShine?: boolean;
}

const VARIANTS = {
  glass: {
    bg:     'rgba(255,255,255,0.92)',
    border: 'rgba(88,131,191,0.38)',
    borderTop:    'rgba(255,255,255,0.95)',
    borderLeft:   'rgba(255,255,255,0.85)',
    borderBottom: 'rgba(88,131,191,0.45)',
    borderRight:  'rgba(88,131,191,0.28)',
    shadow: '#3d6aaa',
    shadowOpacity: 0.12,
  },
  surface: {
    bg:     'rgba(255,255,255,0.82)',
    border: 'rgba(88,131,191,0.22)',
    borderTop:    'rgba(255,255,255,0.90)',
    borderLeft:   'rgba(255,255,255,0.75)',
    borderBottom: 'rgba(88,131,191,0.32)',
    borderRight:  'rgba(88,131,191,0.18)',
    shadow: '#3d6aaa',
    shadowOpacity: 0.08,
  },
  gold: {
    bg:     C.goldS,
    border: C.goldBorder,
    borderTop:    'rgba(255,255,255,0.95)',
    borderLeft:   'rgba(255,255,255,0.7)',
    borderBottom: 'rgba(200,170,0,0.5)',
    borderRight:  'rgba(200,170,0,0.3)',
    shadow: '#c9b100',
    shadowOpacity: 0.20,
  },
  sage: {
    bg:     C.sageS,
    border: C.sageBorder,
    borderTop:    'rgba(255,255,255,0.90)',
    borderLeft:   'rgba(255,255,255,0.7)',
    borderBottom: 'rgba(88,131,191,0.38)',
    borderRight:  'rgba(88,131,191,0.22)',
    shadow: '#3d6aaa',
    shadowOpacity: 0.10,
  },
  blue: {
    bg:     '#4d7abf',
    border: 'rgba(255,255,255,0.35)',
    borderTop:    'rgba(255,255,255,0.6)',
    borderLeft:   'rgba(255,255,255,0.3)',
    borderBottom: 'rgba(20,45,100,0.55)',
    borderRight:  'rgba(20,45,100,0.28)',
    shadow: '#3d6aaa',
    shadowOpacity: 0.35,
  },
  rose: {
    bg:     'rgba(168,48,64,0.08)',
    border: 'rgba(168,48,64,0.28)',
    borderTop:    'rgba(255,255,255,0.90)',
    borderLeft:   'rgba(255,255,255,0.7)',
    borderBottom: 'rgba(168,48,64,0.35)',
    borderRight:  'rgba(168,48,64,0.18)',
    shadow: '#a83040',
    shadowOpacity: 0.12,
  },
};

export const GlassCard: React.FC<Props> = ({
  children, style, variant = 'glass',
  padding = 14, radius = R.lg, noShine = false,
}) => {
  const v = VARIANTS[variant];
  return (
    <View style={[
      {
        borderRadius: radius,
        borderWidth: 1.5,
        borderColor:       v.border,
        borderTopColor:    v.borderTop,
        borderLeftColor:   v.borderLeft,
        borderBottomColor: v.borderBottom,
        borderRightColor:  v.borderRight,
        overflow: 'hidden',
        backgroundColor: v.bg,
        shadowColor: v.shadow,
        shadowOffset: { width: 0, height: 5 },
        shadowOpacity: v.shadowOpacity,
        shadowRadius: 18,
        elevation: 5,
      },
      style,
    ]}>
      {!noShine && <View style={styles.shine} />}
      <View style={{ padding }}>{children}</View>
    </View>
  );
};

export const SurfaceCard: React.FC<Omit<Props, 'variant'>> = ({
  children, style, padding = 12, radius = R.md, noShine = false,
}) => (
  <GlassCard variant="surface" style={style} padding={padding} radius={radius} noShine={noShine}>
    {children}
  </GlassCard>
);

const styles = StyleSheet.create({
  shine: {
    position: 'absolute', top: 0, left: '8%', right: '8%', height: 1.5,
    backgroundColor: 'rgba(255,255,255,0.95)', zIndex: 6,
  },
});
