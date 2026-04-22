// app/components/HeatIcon.tsx
// ═══════════════════════════════════════════════════════════════════════════
// HEAT ICON — Spectrum C Arc (v2)
// ═══════════════════════════════════════════════════════════════════════════
//
// The Heat indicator IS the AIOmni logo. Every time a player is hot, the
// user sees another Spectrum C — the same mark that's in the AIOMNI
// wordmark, the AI Coach tab, and THE O. One brand glyph, worn everywhere
// the product signals intelligence.
//
// ─── VISUAL LANGUAGE ────────────────────────────────────────────────────────
//   Arc length encodes heat intensity:
//     FROZEN   0-20   — 15% arc, muted aqua
//     COLD    20-40   — 25% arc, aqua
//     COOLING 40-55   — 45% arc, green
//     WARM    55-70   — 60% arc, amber
//     HOT     70-85   — 75% arc, amber+flame
//     SCORCHING 85+   — 85% arc, full spectrum (matches the actual logo)
//
//   Color gradient stops match intensity — cold stays in aqua/green territory,
//   scorching hits the full logo spectrum (flame→amber→chartreuse→green→aqua).
//
//   Gap always faces down (at 6 o'clock) matching the AIOmniLogo component.
//   This ensures every Heat impression visually rhymes with the brand mark.
//
// ─── API (unchanged from v1) ────────────────────────────────────────────────
//   Same props interface as the flame version it replaces. All call sites
//   in rankings.tsx and league.tsx continue to work without modification.
//
//   Props:
//     score: 0-100
//     direction?: 'up' | 'down' | 'flat' — subtle chevron next to arc
//     size: pixels (width = height)
//     showScore?: boolean — draws numeric score inside the ring
//     compact?: boolean — hides pedestal if we had one; currently no-op
// ═══════════════════════════════════════════════════════════════════════════

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Stop,
  Path,
  G,
} from 'react-native-svg';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export type HeatDirection = 'up' | 'down' | 'flat';

interface HeatIconProps {
  score: number;
  direction?: HeatDirection;
  size?: number;
  showScore?: boolean;
  compact?: boolean;
}

// ─── TIER CONFIG ────────────────────────────────────────────────────────────
// Arc length (0–1) encodes how far around the circle the stroke travels.
// Colors stops define the gradient — scorching matches the full logo.
// All gaps face down (6 o'clock) using stroke-dashoffset math.

interface HeatTier {
  arcFraction: number;        // 0.15 = 15% of circumference lit
  gradientStops: [string, string, string]; // 0%, 50%, 100%
  glowOpacity: number;
  pulseEnabled: boolean;
}

function getHeatTier(score: number): HeatTier {
  if (score >= 85) return {
    arcFraction: 0.85,  // matches the AIOmni logo exactly — scorching IS the logo
    gradientStops: ['#ff5714', '#ffb800', '#e4ff1a'],
    glowOpacity: 0.6,
    pulseEnabled: true,
  };
  if (score >= 70) return {
    arcFraction: 0.75,
    gradientStops: ['#ffb800', '#e4ff1a', '#ff5714'],
    glowOpacity: 0.45,
    pulseEnabled: true,
  };
  if (score >= 55) return {
    arcFraction: 0.60,
    gradientStops: ['#6eeb83', '#e4ff1a', '#ffb800'],
    glowOpacity: 0.3,
    pulseEnabled: false,
  };
  if (score >= 40) return {
    arcFraction: 0.45,
    gradientStops: ['#1be7ff', '#6eeb83', '#e4ff1a'],
    glowOpacity: 0.2,
    pulseEnabled: false,
  };
  if (score >= 20) return {
    arcFraction: 0.25,
    gradientStops: ['#1be7ff', '#1be7ff', '#6eeb83'],
    glowOpacity: 0.15,
    pulseEnabled: false,
  };
  return {
    arcFraction: 0.15,
    gradientStops: ['#7a9eaa', '#1be7ff', '#1be7ff'],
    glowOpacity: 0.1,
    pulseEnabled: false,
  };
}

// ─── COMPONENT ──────────────────────────────────────────────────────────────

export function HeatIcon({
  score,
  direction = 'flat',
  size = 48,
  showScore = true,
}: HeatIconProps) {
  const tier = getHeatTier(score);
  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));

  // Geometry: viewbox 64 × 64 (same as AIOmniLogo for visual parity)
  const vb = 64;
  const cx = vb / 2;
  const cy = vb / 2;
  const r = vb * 0.35;                         // 22.4, matches logo
  const strokeWidth = Math.max(3, size * 0.12);
  const circ = 2 * Math.PI * r;
  const arcLen = circ * tier.arcFraction;
  const gapLen = circ - arcLen;

  // Place gap at bottom (6 o'clock). SVG arcs start at 3 o'clock going
  // clockwise — we offset by circ * 0.625 to center the gap at the bottom.
  // Same math used in AIOmniLogo for visual consistency.
  const dashOffset = circ * 0.625;

  // Pulse animation for HOT+SCORCHING — subtle breathing glow
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!tier.pulseEnabled) return;
    // Faster pulse at scorching
    const duration = score >= 85 ? 900 : 1400;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.06,
          duration,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [tier.pulseEnabled, score]);

  // Unique gradient id per score prevents collisions when multiple HeatIcons
  // render on the same screen (waiver list may have 40+ simultaneously).
  const gradId = `heatSpec-${clampedScore}-${direction}`;
  const glowId = `heatGlow-${clampedScore}-${direction}`;

  const scoreColor = score >= 70 ? '#0a1214' : '#f0f4f5';

  // Direction chevron — tiny, tucked outside the arc at top-right
  const renderDirection = () => {
    if (direction === 'flat') return null;
    const chevronColor = direction === 'up' ? tier.gradientStops[0] : '#7a9eaa';
    if (direction === 'up') {
      return (
        <Path
          d={`M ${vb * 0.74} ${vb * 0.28} L ${vb * 0.82} ${vb * 0.20} L ${vb * 0.90} ${vb * 0.28}`}
          stroke={chevronColor}
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      );
    }
    return (
      <Path
        d={`M ${vb * 0.74} ${vb * 0.20} L ${vb * 0.82} ${vb * 0.28} L ${vb * 0.90} ${vb * 0.20}`}
        stroke={chevronColor}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    );
  };

  return (
    <Animated.View
      style={[
        styles.wrap,
        { width: size, height: size, transform: [{ scale: pulseAnim }] },
      ]}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${vb} ${vb}`}>
        <Defs>
          {/* Main arc gradient — encodes heat intensity via color stops */}
          <LinearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor={tier.gradientStops[0]} />
            <Stop offset="50%" stopColor={tier.gradientStops[1]} />
            <Stop offset="100%" stopColor={tier.gradientStops[2]} />
          </LinearGradient>
          {/* Soft glow behind the arc */}
          <LinearGradient id={glowId} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor={tier.gradientStops[0]} stopOpacity={tier.glowOpacity} />
            <Stop offset="100%" stopColor={tier.gradientStops[2]} stopOpacity={tier.glowOpacity} />
          </LinearGradient>
        </Defs>

        {/* Glow aura — wider, softer stroke behind the main arc */}
        <Circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={`url(#${glowId})`}
          strokeWidth={strokeWidth + 4}
          strokeLinecap="round"
          strokeDasharray={`${arcLen} ${gapLen}`}
          strokeDashoffset={dashOffset}
        />

        {/* Main Spectrum C arc */}
        <Circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${arcLen} ${gapLen}`}
          strokeDashoffset={dashOffset}
        />

        {renderDirection()}
      </Svg>

      {showScore && (
        <View style={styles.scoreOverlay} pointerEvents="none">
          <Text
            style={[
              styles.scoreText,
              { fontSize: size * 0.32, color: scoreColor },
            ]}
          >
            {clampedScore}
          </Text>
        </View>
      )}
    </Animated.View>
  );
}

// ─── COMPACT BADGE (unchanged API) ──────────────────────────────────────────
// Preserved for any caller using HeatBadge. Renders icon + numeric score
// inline in a pill.

export function HeatBadge({
  score,
  direction = 'flat',
  size = 28,
}: {
  score: number;
  direction?: HeatDirection;
  size?: number;
}) {
  const tier = getHeatTier(score);
  return (
    <View style={[badgeStyles.wrap, { borderColor: tier.gradientStops[0] }]}>
      <HeatIcon score={score} direction={direction} size={size} showScore={false} />
      <Text style={[badgeStyles.score, { color: tier.gradientStops[1] }]}>
        {Math.round(score)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreText: {
    fontFamily: 'BebasNeue-Regular',
    letterSpacing: 0.3,
    textShadowColor: 'rgba(0,0,0,0.25)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 1,
  },
});

const badgeStyles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: 'rgba(10,18,20,0.6)',
  },
  score: {
    fontFamily: 'SpaceMono-Regular',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
