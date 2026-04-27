// app/components/HeatIcon.tsx
// ═══════════════════════════════════════════════════════════════════════════
// HEAT ICON — 4 Distinct Buckets (v3)
// ═══════════════════════════════════════════════════════════════════════════
//
// Replaces the 7-tier continuous arc (v2) with 4 visually distinct
// buckets. The previous version's tiers were too close together to scan
// quickly on a waivers list — every "hot+" player looked the same.
//
// ─── VISUAL LANGUAGE ────────────────────────────────────────────────────────
//
//   COOL       0-25   — quarter arc          green
//   WARM      26-50   — half arc              green → gold
//   HOT       51-75   — three-quarter arc     gold → orange
//   SCORCHING 76-100  — full ring + pulse     gold → red, animated
//
//   Arc length jumps in clean visual quartiles. From across the screen,
//   Cool vs Warm vs Hot vs Scorching is unmistakable.
//
//   The Spectrum C aesthetic (gap at 6 o'clock matching the AIOmni logo)
//   is preserved for the partial arcs. Scorching closes the loop into a
//   full ring AND pulses — the "buy now" alarm bell.
//
// ─── API (unchanged from v2) ────────────────────────────────────────────────
//   Same props interface. All call sites continue to work.
// ═══════════════════════════════════════════════════════════════════════════

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Path } from 'react-native-svg';

type Tier = 'cool' | 'warm' | 'hot' | 'scorching';

interface TierSpec {
  arcFraction: number;
  gradientStops: { offset: string; color: string }[];
  animated: boolean;
}

const TIER_SPECS: Record<Tier, TierSpec> = {
  cool: {
    arcFraction: 0.25,
    gradientStops: [
      { offset: '0%',   color: '#6eeb83' },
      { offset: '100%', color: '#a3f2b1' },
    ],
    animated: false,
  },
  warm: {
    arcFraction: 0.5,
    gradientStops: [
      { offset: '0%',   color: '#a3f2b1' },
      { offset: '100%', color: '#fee229' },
    ],
    animated: false,
  },
  hot: {
    arcFraction: 0.75,
    gradientStops: [
      { offset: '0%',   color: '#fee229' },
      { offset: '100%', color: '#ff9c1a' },
    ],
    animated: false,
  },
  scorching: {
    arcFraction: 1.0,
    gradientStops: [
      { offset: '0%',   color: '#ffd700' },
      { offset: '50%',  color: '#ff5714' },
      { offset: '100%', color: '#ff2d00' },
    ],
    animated: true,
  },
};

function scoreToTier(score: number): Tier {
  if (score >= 76) return 'scorching';
  if (score >= 51) return 'hot';
  if (score >= 26) return 'warm';
  return 'cool';
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180.0;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function buildArcPath(cx: number, cy: number, r: number, fraction: number): string {
  if (fraction >= 0.999) {
    return `M ${cx - r}, ${cy} A ${r},${r} 0 1,1 ${cx + r},${cy} A ${r},${r} 0 1,1 ${cx - r},${cy} Z`;
  }
  const sweepDeg = fraction * 360;
  const startAngle = -sweepDeg / 2;
  const endAngle   = +sweepDeg / 2;
  const start = polarToCartesian(cx, cy, r, startAngle);
  const end   = polarToCartesian(cx, cy, r, endAngle);
  const largeArcFlag = sweepDeg > 180 ? 1 : 0;
  return `M ${start.x},${start.y} A ${r},${r} 0 ${largeArcFlag},1 ${end.x},${end.y}`;
}

export interface HeatIconProps {
  score: number;
  direction?: 'up' | 'down' | 'flat';
  size: number;
  showScore?: boolean;
  compact?: boolean;
}

export function HeatIcon({ score, size, showScore = false }: HeatIconProps) {
  const tier = scoreToTier(score);
  const spec = TIER_SPECS[tier];

  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!spec.animated) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [spec.animated, pulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1.0, 1.06] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.0] });

  const VIEWBOX = 40;
  const cx = VIEWBOX / 2;
  const cy = VIEWBOX / 2;
  const STROKE_WIDTH = 3.5;
  const r = (VIEWBOX / 2) - STROKE_WIDTH / 2 - 1;

  const arcPath = buildArcPath(cx, cy, r, spec.arcFraction);
  const gradientId = `heat-grad-${tier}`;

  return (
    <Animated.View
      style={[
        styles.wrap,
        { width: size, height: size },
        spec.animated && { transform: [{ scale }], opacity },
      ]}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}>
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            {spec.gradientStops.map((s, i) => (
              <Stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={1} />
            ))}
          </LinearGradient>
        </Defs>
        <Path
          d={arcPath}
          stroke={`url(#${gradientId})`}
          strokeWidth={STROKE_WIDTH}
          fill="none"
          strokeLinecap="round"
        />
      </Svg>
      {showScore && (
        <View style={styles.scoreOverlay} pointerEvents="none">
          <Text style={[styles.scoreText, { fontSize: Math.max(8, size * 0.28) }]}>
            {Math.round(score)}
          </Text>
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreText: {
    fontFamily: 'SpaceMono_400Regular',
    color: '#f0f4f5',
    fontWeight: '600',
  },
});

export default HeatIcon;
