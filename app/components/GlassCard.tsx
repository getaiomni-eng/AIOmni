import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { C, R } from '../constants/tokens';

interface Props {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  variant?: 'glass' | 'surface' | 'gold' | 'sage' | 'rose';
  padding?: number;
  radius?: number;
  blur?: number;
  noShine?: boolean;
}

// Cream theme variants — blue borders, warm fills
const VARIANTS = {
  glass:   { bg: 'rgba(255,255,255,0.90)', border: 'rgba(88,131,191,0.32)' },
  surface: { bg: 'rgba(255,255,255,0.82)', border: 'rgba(88,131,191,0.22)' },
  gold:    { bg: C.goldS,                  border: C.goldBorder             },
  sage:    { bg: C.sageS,                  border: C.sageBorder             },
  rose:    { bg: 'rgba(168,48,64,0.08)',    border: 'rgba(168,48,64,0.25)'  },
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
        borderColor: v.border,
        overflow: 'hidden',
        backgroundColor: v.bg,
        // Bevel shadow — blue-tinted, not black
        shadowColor: '#3d6aaa',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.10,
        shadowRadius: 14,
        elevation: 4,
      },
      style,
    ]}>
      {/* Bevel highlight — bright top edge */}
      {!noShine && <View style={[styles.shine, { borderRadius: radius }]} />}
      {/* Bottom bevel — darker edge */}
      {!noShine && <View style={[styles.shineBottom, { borderRadius: radius }]} />}
      <View style={{ padding }}>
        {children}
      </View>
    </View>
  );
};

export const SurfaceCard: React.FC<Omit<Props, 'blur' | 'variant'>> = ({
  children, style, padding = 12, radius = R.md, noShine = false,
}) => (
  <View style={[
    {
      backgroundColor: 'rgba(255,255,255,0.82)',
      borderRadius: radius,
      borderWidth: 1.5,
      borderColor: 'rgba(88,131,191,0.22)',
      overflow: 'hidden',
      shadowColor: '#3d6aaa',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.08,
      shadowRadius: 8,
      elevation: 3,
    },
    style,
  ]}>
    {!noShine && <View style={[styles.shine, { borderRadius: radius }]} />}
    <View style={{ padding }}>{children}</View>
  </View>
);

const styles = StyleSheet.create({
  shine: {
    position: 'absolute', top: 0, left: '8%', right: '8%', height: 1.5,
    backgroundColor: 'rgba(255,255,255,0.95)', zIndex: 6,
  },
  shineBottom: {
    position: 'absolute', bottom: 0, left: 0, right: 0, height: 1.5,
    backgroundColor: 'rgba(88,131,191,0.20)', zIndex: 6,
  },
});