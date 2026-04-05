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
    bg:     C.glass,
    border: C.glassBorder,
    borderTop:    C.glassShine,
    borderLeft:   C.surfShine,
    borderBottom: C.sageBorder,
    borderRight:  C.sageBorder,
    shadow: C.blueDeep,
    shadowOpacity: 0.12,
  },
  surface: {
    bg:     C.surface,
    border: C.surfBorder,
    borderTop:    C.surfShine,
    borderLeft:   C.surfShine,
    borderBottom: C.surfBorder,
    borderRight:  C.surfBorder,
    shadow: C.blueDeep,
    shadowOpacity: 0.08,
  },
  gold: {
    bg:     C.goldS,
    border: C.goldBorder,
    borderTop:    C.glassShine,
    borderLeft:   C.surfShine,
    borderBottom: C.goldG,
    borderRight:  C.goldBorder,
    shadow: C.gold,
    shadowOpacity: 0.20,
  },
  sage: {
    bg:     C.sageS,
    border: C.sageBorder,
    borderTop:    C.surfShine,
    borderLeft:   C.surfShine,
    borderBottom: C.sageBorder,
    borderRight:  C.sageBorder,
    shadow: C.blueDeep,
    shadowOpacity: 0.10,
  },
  blue: {
    bg:     C.oceanS,
    border: C.blueDeep,
    borderTop:    C.glassShine,
    borderLeft:   C.surfShine,
    borderBottom: C.oceanS,
    borderRight:  C.oceanS,
    shadow: C.blueDeep,
    shadowOpacity: 0.18,
  },
  rose: {
    bg:     C.roseS,
    border: C.rose,
    borderTop:    C.surfShine,
    borderLeft:   C.surfShine,
    borderBottom: C.roseS,
    borderRight:  C.roseS,
    shadow: C.rose,
    shadowOpacity: 0.12,
  },
} as const;

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
