// app/components/HeatIcon.tsx
// Animated Heat badge — flame silhouette whose color, intensity, and
// flicker speed shift based on the 0-100 score.
// V7 palette only: aqua / green / amber / flame / chartreuse. No gold.

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import Svg, {
  Path,
  Defs,
  LinearGradient,
  RadialGradient,
  Stop,
  Circle,
  G,
} from 'react-native-svg';

const AnimatedG = Animated.createAnimatedComponent(G);

export type HeatDirection = 'up' | 'down' | 'flat';

interface HeatIconProps {
  /** 0-100 Heat score */
  score: number;
  /** Direction of momentum */
  direction?: HeatDirection;
  /** Size in pixels (width = height) */
  size?: number;
  /** Show the numeric score inside the icon */
  showScore?: boolean;
  /** Compact mode — just the flame, no pedestal */
  compact?: boolean;
}

/**
 * Heat color ramp — V7 palette.
 *
 *  Tier      Range   Core       Glow       Edge         Feel
 *  ────────────────────────────────────────────────────────────────
 *  FROZEN     0-20   #7a9eaa    #1be7ff    #0f1c22      muted aqua
 *  COLD      20-40   #1be7ff    #1be7ff    #0d5a6a      pure aqua
 *  COOLING   40-55   #6eeb83    #ffb800    #3d6020      green
 *  WARM      55-70   #ffb800    #ffb800    #7a4a0a      amber
 *  HOT       70-85   #ff5714    #ffb800    #7a2a08      flame
 *  SCORCHING 85-100  #e4ff1a    #ff5714    #ff5714      chartreuse + flame
 */
function getHeatColors(score: number): { core: string; glow: string; edge: string } {
  if (score >= 85) return { core: '#e4ff1a', glow: '#ff5714', edge: '#ff5714' };
  if (score >= 70) return { core: '#ff5714', glow: '#ffb800', edge: '#7a2a08' };
  if (score >= 55) return { core: '#ffb800', glow: '#ffb800', edge: '#7a4a0a' };
  if (score >= 40) return { core: '#6eeb83', glow: '#ffb800', edge: '#3d6020' };
  if (score >= 20) return { core: '#1be7ff', glow: '#1be7ff', edge: '#0d5a6a' };
  return { core: '#7a9eaa', glow: '#1be7ff', edge: '#0f1c22' };
}

export function HeatIcon({
  score,
  direction = 'flat',
  size = 48,
  showScore = true,
  compact = false,
}: HeatIconProps) {
  const colors = getHeatColors(score);
  const intensity = Math.min(1, Math.max(0, score / 100));

  const flicker = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Flicker speeds up as heat climbs: 900ms cold → 500ms scorching
    const flickerSpeed = 900 - intensity * 400;
    const flickerAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(flicker, {
          toValue: 1,
          duration: flickerSpeed,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(flicker, {
          toValue: 0,
          duration: flickerSpeed,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );

    const pulseAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.08,
          duration: 1400,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );

    flickerAnim.start();
    if (intensity > 0.4) pulseAnim.start();

    return () => {
      flickerAnim.stop();
      pulseAnim.stop();
    };
  }, [intensity]);

  const translateY = flicker.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -1.5],
  });

  const scale = flicker.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.04],
  });

  const vb = 64;
  // Score text color: dark on bright flames, light on cold ones
  const scoreColor = score >= 55 ? '#0a1214' : '#f0f4f5';

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Svg width={size} height={size} viewBox={`0 0 ${vb} ${vb}`}>
        <Defs>
          <LinearGradient id={`heatCore-${score}`} x1="0.5" y1="1" x2="0.5" y2="0">
            <Stop offset="0" stopColor={colors.core} stopOpacity="1" />
            <Stop offset="0.6" stopColor={colors.glow} stopOpacity="0.9" />
            <Stop offset="1" stopColor={colors.edge} stopOpacity="0.4" />
          </LinearGradient>

          <RadialGradient id={`heatHalo-${score}`} cx="0.5" cy="0.65" r="0.6">
            <Stop offset="0" stopColor={colors.glow} stopOpacity={intensity * 0.5} />
            <Stop offset="1" stopColor={colors.glow} stopOpacity="0" />
          </RadialGradient>

          <RadialGradient id={`heatInner-${score}`} cx="0.5" cy="0.75" r="0.25">
            <Stop offset="0" stopColor="#ffffff" stopOpacity={intensity * 0.8} />
            <Stop offset="1" stopColor={colors.core} stopOpacity="0" />
          </RadialGradient>
        </Defs>

        {/* Halo — static background */}
        <Circle cx={vb / 2} cy={vb * 0.6} r={vb * 0.45} fill={`url(#heatHalo-${score})`} />

        {/* Animated flame group */}
        <AnimatedG translateY={translateY} scale={scale}>
          {/* Outer flame silhouette */}
          <Path
            d={`
              M ${vb / 2} 8
              C ${vb * 0.35} 18, ${vb * 0.22} 28, ${vb * 0.22} 40
              C ${vb * 0.22} 52, ${vb * 0.34} 58, ${vb / 2} 58
              C ${vb * 0.66} 58, ${vb * 0.78} 52, ${vb * 0.78} 40
              C ${vb * 0.78} 28, ${vb * 0.65} 18, ${vb / 2} 8
              Z
            `}
            fill={`url(#heatCore-${score})`}
            stroke={colors.edge}
            strokeWidth="1"
            strokeOpacity="0.6"
          />

          {/* Inner flame */}
          <Path
            d={`
              M ${vb / 2} 18
              C ${vb * 0.42} 24, ${vb * 0.34} 32, ${vb * 0.34} 42
              C ${vb * 0.34} 50, ${vb * 0.42} 54, ${vb / 2} 54
              C ${vb * 0.58} 54, ${vb * 0.66} 50, ${vb * 0.66} 42
              C ${vb * 0.66} 32, ${vb * 0.58} 24, ${vb / 2} 18
              Z
            `}
            fill={colors.glow}
            fillOpacity={0.5 + intensity * 0.4}
          />

          {/* Hot spot at base */}
          <Circle cx={vb / 2} cy={vb * 0.7} r={vb * 0.12} fill={`url(#heatInner-${score})`} />
        </AnimatedG>

        {/* Pedestal line (unless compact) */}
        {!compact && (
          <Path
            d={`M ${vb * 0.3} 60 L ${vb * 0.7} 60`}
            stroke={colors.edge}
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.4"
          />
        )}

        {/* Direction chevron */}
        {direction === 'up' && (
          <Path
            d={`M ${vb * 0.78} 16 L ${vb * 0.86} 10 L ${vb * 0.94} 16`}
            stroke={colors.core}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        )}
        {direction === 'down' && (
          <Path
            d={`M ${vb * 0.78} 10 L ${vb * 0.86} 16 L ${vb * 0.94} 10`}
            stroke="#7a9eaa"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        )}
      </Svg>

      {showScore && (
        <View style={styles.scoreOverlay} pointerEvents="none">
          <Text style={[styles.scoreText, { fontSize: size * 0.28, color: scoreColor }]}>
            {Math.round(score)}
          </Text>
        </View>
      )}
    </View>
  );
}

/** Compact inline badge for list rows — flame + score pill */
export function HeatBadge({
  score,
  direction = 'flat',
  size = 28,
}: {
  score: number;
  direction?: HeatDirection;
  size?: number;
}) {
  const colors = getHeatColors(score);
  return (
    <View style={[badgeStyles.wrap, { borderColor: colors.edge }]}>
      <HeatIcon score={score} direction={direction} size={size} showScore={false} compact />
      <Text style={[badgeStyles.score, { color: colors.core }]}>{Math.round(score)}</Text>
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
    letterSpacing: 0.5,
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
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
