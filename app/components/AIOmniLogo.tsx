// AIOmni Logo v7 — Spectrum C Mark
// Static in-app, gap facing down, 15% gap
// Usage:
//   <AIOmniLogo size={40} />           — just the mark
//   <AIOmniWordmark fontSize={22} />   — full AI●MNI wordmark
//   <AIOmniIris width={32} />          — backward compat alias for mark

import React from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

interface LogoProps {
  size?: number;
}

export function AIOmniLogo({ size = 40, width }: LogoProps & { width?: number }) {
  // Support old `width` prop for backward compat
  const s = width ?? size;
  const r = s * 0.38;
  const sw = s * 0.09;
  const circ = 2 * Math.PI * r;
  const arc = circ * 0.85;
  const gap = circ * 0.15;
  const offset = circ * 0.625; // centers gap at bottom

  return (
    <Svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}>
      <Defs>
        <LinearGradient id="specGrad" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor="#1be7ff" />
          <Stop offset="25%" stopColor="#6eeb83" />
          <Stop offset="50%" stopColor="#e4ff1a" />
          <Stop offset="75%" stopColor="#ffb800" />
          <Stop offset="100%" stopColor="#ff5714" />
        </LinearGradient>
      </Defs>
      <Circle
        cx={s / 2}
        cy={s / 2}
        r={r}
        fill="none"
        stroke="url(#specGrad)"
        strokeWidth={sw}
        strokeLinecap="round"
        strokeDasharray={`${arc} ${gap}`}
        strokeDashoffset={offset}
      />
    </Svg>
  );
}

// Backward compat — old code imports AIOmniIris
export function AIOmniIris({ width = 32 }: { width?: number }) {
  return <AIOmniLogo size={width} />;
}

// Full wordmark: AI [Spectrum C] MNI
interface WordmarkProps {
  fontSize?: number;
  color?: string;
  mniOpacity?: number;
}

export function AIOmniWordmark({ fontSize = 22, color = '#f0f4f5', mniOpacity = 0.45 }: WordmarkProps) {
  const oSize = fontSize * 1.15;
  const overlap = oSize * 0.18;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Text style={{
        fontFamily: 'Audiowide_400Regular',
        fontSize,
        color,
        zIndex: 2,
        letterSpacing: 0.5,
      }}>AI</Text>
      <View style={{
        width: oSize,
        height: oSize,
        marginLeft: -overlap,
        marginRight: -overlap,
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 1,
      }}>
        <AIOmniLogo size={oSize} />
      </View>
      <Text style={{
        fontFamily: 'Audiowide_400Regular',
        fontSize,
        color,
        opacity: mniOpacity,
        zIndex: 2,
        letterSpacing: 0.5,
      }}>MNI</Text>
    </View>
  );
}

export default AIOmniLogo;