import React from 'react';
import { View, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { BlurView } from 'expo-blur';
import { C, R, shadow } from '../constants/tokens';

interface Props {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  variant?: 'glass' | 'surface' | 'gold' | 'sage' | 'rose';
  padding?: number;
  radius?: number;
  blur?: number;
  noShine?: boolean;
}

const VARIANTS = {
  glass:   { bg: C.glass,   border: C.glassBorder },
  surface: { bg: C.surface, border: C.surfBorder  },
  gold:    { bg: C.goldS,   border: C.goldBorder  },
  sage:    { bg: C.sageS,   border: C.sageBorder  },
  rose:    { bg: C.roseS,   border: 'rgba(200,120,120,0.28)' },
};

export const GlassCard: React.FC<Props> = ({
  children, style, variant = 'glass',
  padding = 14, radius = R.lg, blur = 60, noShine = false,
}) => {
  const v = VARIANTS[variant];
  return (
    <View style={[{ borderRadius: radius, borderWidth: 1, borderColor: v.border, overflow: 'hidden' }, shadow.glass, style]}>
      <BlurView intensity={blur} tint="light" style={StyleSheet.absoluteFillObject} />
      {!noShine && <View style={[styles.shine, { borderRadius: radius }]} />}
      <View style={[{ padding, backgroundColor: v.bg }, Array.isArray(style) ? {} : (style as any)]}>
        {children}
      </View>
    </View>
  );
};

export const SurfaceCard: React.FC<Omit<Props, 'blur' | 'variant'>> = ({
  children, style, padding = 12, radius = R.md, noShine = false,
}) => (
  <View style={[{ backgroundColor: C.surface, borderRadius: radius, borderWidth: 1, borderColor: C.surfBorder, overflow: 'hidden' }, shadow.card, style]}>
    {!noShine && <View style={[styles.shine, { borderRadius: radius }]} />}
    <View style={{ padding }}>{children}</View>
  </View>
);

const styles = StyleSheet.create({
  shine: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 1,
    backgroundColor: C.glassShine, zIndex: 1,
  },
});
