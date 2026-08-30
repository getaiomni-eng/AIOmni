import React, { useMemo } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { C, R, BEVEL } from '../constants/tokens';
import { useTheme, type ThemeTokens } from '../constants/theme';

interface Props {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  variant?: 'glass' | 'surface' | 'gold' | 'sage' | 'blue' | 'rose';
  padding?: number;
  radius?: number;
  noShine?: boolean;
}

const makeVariants = (t: ThemeTokens) => ({
  glass: {
    bg:     t.card,
    border: t.border,
    borderTop:    t.borderLight,
    borderLeft:   t.borderLight,
    borderBottom: C.sageBorder,
    borderRight:  C.sageBorder,
    shadow: C.blueDeep,
    shadowOpacity: 0.12,
  },
  surface: {
    bg:     t.surface,
    border: t.border,
    borderTop:    t.borderLight,
    borderLeft:   t.borderLight,
    borderBottom: t.border,
    borderRight:  t.border,
    shadow: C.blueDeep,
    shadowOpacity: 0.08,
  },
  gold: {
    bg:     C.goldS,
    border: C.goldBorder,
    borderTop:    t.borderLight,
    borderLeft:   t.borderLight,
    borderBottom: C.goldG,
    borderRight:  C.goldBorder,
    shadow: C.gold,
    shadowOpacity: 0.20,
  },
  sage: {
    bg:     t.greenTint,
    border: C.sageBorder,
    borderTop:    t.borderLight,
    borderLeft:   t.borderLight,
    borderBottom: C.sageBorder,
    borderRight:  C.sageBorder,
    shadow: C.blueDeep,
    shadowOpacity: 0.10,
  },
  blue: {
    bg:     C.oceanS,
    border: C.blueDeep,
    borderTop:    t.borderLight,
    borderLeft:   t.borderLight,
    borderBottom: C.oceanS,
    borderRight:  C.oceanS,
    shadow: C.blueDeep,
    shadowOpacity: 0.18,
  },
  rose: {
    bg:     t.flameTint,
    border: C.rose,
    borderTop:    t.borderLight,
    borderLeft:   t.borderLight,
    borderBottom: C.roseS,
    borderRight:  C.roseS,
    shadow: C.rose,
    shadowOpacity: 0.12,
  },
}) as const;

export const GlassCard: React.FC<Props> = ({
  children, style, variant = 'glass',
  padding = 14, radius = R.lg, noShine = false,
}) => {
  const { t } = useTheme();
  const variants = useMemo(() => makeVariants(t), [t]);
  const v = variants[variant];
  return (
    <View style={[
      {
        ...BEVEL.card,
        borderRadius: radius,
        overflow: 'hidden',
        backgroundColor: v.bg,
        borderColor:       v.border,
        borderTopColor:    v.borderTop,
        borderLeftColor:   v.borderLeft,
        borderBottomColor: v.borderBottom,
        borderRightColor:  v.borderRight,
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
