// app/components/GlowText.tsx
// Renders text with a stroke/outline effect — gold fill, blue outline
// React Native doesn't support text-stroke so we render offset copies

import React from 'react';
import { StyleSheet, Text, TextStyle, View } from 'react-native';

interface GlowTextProps {
  children: string | number;
  style?: TextStyle;
  fontSize?: number;
  color?: string;         // fill color (default gold)
  strokeColor?: string;   // outline color (default blue)
  strokeWidth?: number;   // outline thickness (default 1.5)
  glowColor?: string;     // outer glow shadow color
  glowRadius?: number;    // outer glow radius
}

const OFFSETS = [
  [-1, -1], [0, -1], [1, -1],
  [-1,  0],          [1,  0],
  [-1,  1], [0,  1], [1,  1],
];

export function GlowText({
  children,
  style,
  fontSize = 32,
  color = '#fee229',
  strokeColor = '#3d6aaa',
  strokeWidth = 1.5,
  glowColor = 'rgba(254,226,41,0.5)',
  glowRadius = 12,
}: GlowTextProps) {
  const baseStyle: TextStyle = {
    fontSize,
    fontFamily: 'Bungee_400Regular',
    letterSpacing: 1,
    ...style,
  };

  return (
    <View style={s.wrap}>
      {/* Outer glow layer */}
      <Text
        style={[
          baseStyle,
          {
            color: 'transparent',
            textShadowColor: glowColor,
            textShadowOffset: { width: 0, height: 0 },
            textShadowRadius: glowRadius,
            position: 'absolute',
          },
        ]}
      >
        {children}
      </Text>

      {/* Stroke layers — 8 offset copies in strokeColor */}
      {OFFSETS.map(([dx, dy], i) => (
        <Text
          key={i}
          style={[
            baseStyle,
            {
              color: strokeColor,
              position: 'absolute',
              left: dx * strokeWidth,
              top: dy * strokeWidth,
            },
          ]}
        >
          {children}
        </Text>
      ))}

      {/* Fill layer — on top */}
      <Text style={[baseStyle, { color }]}>{children}</Text>
    </View>
  );
}

// Gold score variant — most common usage
export function GoldScore({ children, fontSize = 32, style }: { children: string | number; fontSize?: number; style?: TextStyle }) {
  return (
    <GlowText
      fontSize={fontSize}
      color="#fee229"
      strokeColor="#3d6aaa"
      strokeWidth={2}
      glowColor="rgba(254,226,41,0.5)"
      glowRadius={14}
      style={style}
    >
      {children}
    </GlowText>
  );
}

// Blue score variant — opponent scores
export function BlueScore({ children, fontSize = 32, style }: { children: string | number; fontSize?: number; style?: TextStyle }) {
  return (
    <GlowText
      fontSize={fontSize}
      color="#5883bf"
      strokeColor="#1a1f2e"
      strokeWidth={1}
      glowColor="rgba(88,131,191,0.4)"
      glowRadius={10}
      style={style}
    >
      {children}
    </GlowText>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'relative' },
});

export default GlowText;

// Blue-on-gold variant — for blue card scores
export function CardScore({ children, fontSize = 22, style }: { children: string | number; fontSize?: number; style?: any }) {
  return (
    <GlowText
      fontSize={fontSize}
      color="#3d6aaa"
      strokeColor="#fee229"
      strokeWidth={2}
      glowColor="rgba(254,226,41,0.5)"
      glowRadius={14}
      style={style}
    >
      {children}
    </GlowText>
  );
}
