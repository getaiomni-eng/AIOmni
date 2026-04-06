import React, { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import Svg, {
  Circle, ClipPath, Defs, G, Line, Path, Polygon, Rect,
  Text as SvgText,
} from 'react-native-svg';
import { C } from '../constants/tokens';
import { AIOmniIris } from './AIOmniLogo';

const AnimatedPolygon = Animated.createAnimatedComponent(Polygon);
const AnimatedG       = Animated.createAnimatedComponent(G);
const AnimatedRect    = Animated.createAnimatedComponent(Rect);

const GOLD  = C.gold;
const BLUE  = C.sage;
const BD    = C.blueDeep;
const CREAM = C.bgTop;
const DARK  = C.oceanS;
const rand  = (a: number, b: number) => a + Math.random() * (b - a);
const ease  = (t: number) => t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3) / 2;

// ── Shared: stroke color cycle ────────────────────────────────
function useStrokeCycle(delay = 0) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const t = setTimeout(() => {
      Animated.loop(
        Animated.timing(a, { toValue: 1, duration: 6000, useNativeDriver: false })
      ).start();
    }, delay);
    return () => clearTimeout(t);
  }, []);
  return a.interpolate({
    inputRange:  [0,    0.33, 0.66, 1   ],
    outputRange: [GOLD, BD,   CREAM, GOLD],
  });
}

// ── Shared: two staggered pulse ring opacities ────────────────
function useHexPulse(dur = 4000, delay2 = 2000) {
  const p1 = useRef(new Animated.Value(0)).current;
  const p2 = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(Animated.timing(p1, { toValue: 1, duration: dur, useNativeDriver: false })).start();
    const t = setTimeout(() => {
      Animated.loop(Animated.timing(p2, { toValue: 1, duration: dur, useNativeDriver: false })).start();
    }, delay2);
    return () => clearTimeout(t);
  }, []);
  return [
    p1.interpolate({ inputRange: [0, 0.08, 0.65, 1], outputRange: [0, 0.9, 0.4, 0] }),
    p2.interpolate({ inputRange: [0, 0.08, 0.65, 1], outputRange: [0, 0.9, 0.4, 0] }),
  ] as const;
}

// ══════════════════════════════════════════════════════════════
// HOME — 3-hex formation
// ══════════════════════════════════════════════════════════════
function HomeIcon({ size }: { size: number }) {
  const stroke     = useStrokeCycle(0);
  const [op1, op2] = useHexPulse(4000, 2000);
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <AnimatedPolygon points="32,4 39,8.5 39,17.5 32,22 25,17.5 25,8.5"
        fill="rgba(254,226,41,0.25)" stroke={stroke as any} strokeWidth={2.2} strokeLinejoin="round"/>
      <AnimatedPolygon points="32,4 39,8.5 39,17.5 32,22 25,17.5 25,8.5"
        fill="none" stroke={GOLD} strokeWidth={1.8} strokeLinejoin="round" opacity={op1 as any}/>
      <AnimatedPolygon points="32,4 39,8.5 39,17.5 32,22 25,17.5 25,8.5"
        fill="none" stroke={GOLD} strokeWidth={1.8} strokeLinejoin="round" opacity={op2 as any}/>
      <Polygon points="16,34 23,38.5 23,47.5 16,52 9,47.5 9,38.5"
        fill="rgba(88,131,191,0.12)" stroke={BLUE} strokeWidth={1.8} strokeLinejoin="round"/>
      <Polygon points="48,34 55,38.5 55,47.5 48,52 41,47.5 41,38.5"
        fill="rgba(88,131,191,0.12)" stroke={BLUE} strokeWidth={1.8} strokeLinejoin="round"/>
      <Line x1="32" y1="22" x2="16" y2="34" stroke="rgba(61,106,170,0.45)" strokeWidth={1.4}/>
      <Line x1="32" y1="22" x2="48" y2="34" stroke="rgba(61,106,170,0.45)" strokeWidth={1.4}/>
      <Line x1="23" y1="43" x2="41" y2="43" stroke="rgba(61,106,170,0.3)"  strokeWidth={1.1}/>
    </Svg>
  );
}

// ══════════════════════════════════════════════════════════════
// COACH — aperture O, same blink engine as v26 logo
// ══════════════════════════════════════════════════════════════
function CoachIcon({ size }: { size: number }) {
  return <AIOmniIris width={size} />;
}

// ══════════════════════════════════════════════════════════════
// RANKINGS — breathing bar chart in hex
// ══════════════════════════════════════════════════════════════
function RankingsIcon({ size }: { size: number }) {
  const stroke     = useStrokeCycle(2000);
  const [op1, op2] = useHexPulse(5000, 2500);
  const b1 = useRef(new Animated.Value(0)).current;
  const b2 = useRef(new Animated.Value(0)).current;
  const b3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = (v: Animated.Value, delay: number) => {
      const t = setTimeout(() => {
        Animated.loop(Animated.sequence([
          Animated.timing(v, { toValue: 1, duration: 1500, useNativeDriver: false }),
          Animated.timing(v, { toValue: 0, duration: 1500, useNativeDriver: false }),
        ])).start();
      }, delay);
      return t;
    };
    const t1 = loop(b1, 0);
    const t2 = loop(b2, 150);
    const t3 = loop(b3, 300);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  const b1h = b1.interpolate({ inputRange:[0,1], outputRange:[14,8]  });
  const b1y = b1.interpolate({ inputRange:[0,1], outputRange:[38,44] });
  const b2h = b2.interpolate({ inputRange:[0,1], outputRange:[28,22] });
  const b2y = b2.interpolate({ inputRange:[0,1], outputRange:[24,30] });
  const b3h = b3.interpolate({ inputRange:[0,1], outputRange:[22,14] });
  const b3y = b3.interpolate({ inputRange:[0,1], outputRange:[30,38] });

  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Defs><ClipPath id="hexRT"><Polygon points="32,4 56,18 56,46 32,60 8,46 8,18"/></ClipPath></Defs>
      <AnimatedPolygon points="32,4 56,18 56,46 32,60 8,46 8,18"
        fill={DARK} stroke={stroke as any} strokeWidth={2.2} strokeLinejoin="round"/>
      <AnimatedPolygon points="32,4 56,18 56,46 32,60 8,46 8,18"
        fill="none" stroke={GOLD} strokeWidth={1.5} strokeLinejoin="round" opacity={op1 as any}/>
      <AnimatedPolygon points="32,4 56,18 56,46 32,60 8,46 8,18"
        fill="none" stroke={GOLD} strokeWidth={1.5} strokeLinejoin="round" opacity={op2 as any}/>
      <G clipPath="url(#hexRT)">
        <AnimatedRect x={15} y={b1y as any} width={10} height={b1h as any} rx={2} fill={GOLD}/>
        <AnimatedRect x={27} y={b2y as any} width={10} height={b2h as any} rx={2} fill={GOLD}/>
        <Polygon points="32,20 35,22 35,26 32,28 29,26 29,22" fill={BD}/>
        <AnimatedRect x={39} y={b3y as any} width={10} height={b3h as any} rx={2} fill={BLUE}/>
      </G>
    </Svg>
  );
}

// ══════════════════════════════════════════════════════════════
// TRADE — sliding arrows + T badge
// ══════════════════════════════════════════════════════════════
function TradeIcon({ size }: { size: number }) {
  const stroke     = useStrokeCycle(1500);
  const [op1, op2] = useHexPulse(5000, 2000);
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(slide, { toValue:  3, duration: 900, useNativeDriver: false }),
      Animated.timing(slide, { toValue: -3, duration: 900, useNativeDriver: false }),
      Animated.timing(slide, { toValue:  0, duration: 900, useNativeDriver: false }),
    ])).start();
  }, []);

  const txR = slide.interpolate({ inputRange: [-3, 3], outputRange: ['translate(-3,0)', 'translate(3,0)'] });
  const txL = slide.interpolate({ inputRange: [-3, 3], outputRange: ['translate(3,0)',  'translate(-3,0)'] });

  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Defs><ClipPath id="hexTT"><Polygon points="32,4 56,18 56,46 32,60 8,46 8,18"/></ClipPath></Defs>
      <AnimatedPolygon points="32,4 56,18 56,46 32,60 8,46 8,18"
        fill={DARK} stroke={stroke as any} strokeWidth={2.2} strokeLinejoin="round"/>
      <AnimatedPolygon points="32,4 56,18 56,46 32,60 8,46 8,18"
        fill="none" stroke={GOLD} strokeWidth={1.5} strokeLinejoin="round" opacity={op1 as any}/>
      <AnimatedPolygon points="32,4 56,18 56,46 32,60 8,46 8,18"
        fill="none" stroke={GOLD} strokeWidth={1.5} strokeLinejoin="round" opacity={op2 as any}/>
      <G clipPath="url(#hexTT)">
        <AnimatedG transform={txR as any}>
          <Line x1="13" y1="27" x2="42" y2="27" stroke={GOLD} strokeWidth={3.5} strokeLinecap="round"/>
          <Polygon points="42,22 51,27 42,32" fill={GOLD}/>
        </AnimatedG>
        <AnimatedG transform={txL as any}>
          <Line x1="51" y1="38" x2="22" y2="38" stroke={BLUE} strokeWidth={3.5} strokeLinecap="round"/>
          <Polygon points="22,33 13,38 22,43" fill={BLUE}/>
        </AnimatedG>
      </G>
      <Circle cx="32" cy="32" r="8" fill={BD} stroke={BLUE} strokeWidth={1.5}/>
      <SvgText x="32" y="36.5" textAnchor="middle"
        fontFamily="SpaceMono_700Bold" fontWeight="700"
        fontSize={10} fill={GOLD}>T</SvgText>
    </Svg>
  );
}

// ══════════════════════════════════════════════════════════════
// WAIVER — radar sweep inside hex (rotating translucent wedge)
// ══════════════════════════════════════════════════════════════
function WaiverIcon({ size }: { size: number }) {
  const stroke = useStrokeCycle(1000);
  const [op1, op2] = useHexPulse(4800, 2200);
  const rot = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(rot, { toValue: 1, duration: 2400, useNativeDriver: false })
    ).start();
  }, []);

  const rotDeg = rot.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Defs>
        <ClipPath id="hexW"><Polygon points="32,4 56,18 56,46 32,60 8,46 8,18"/></ClipPath>
      </Defs>
      <AnimatedPolygon points="32,4 56,18 56,46 32,60 8,46 8,18"
        fill={DARK} stroke={stroke as any} strokeWidth={2.2} strokeLinejoin="round"/>
      <AnimatedPolygon points="32,4 56,18 56,46 32,60 8,46 8,18"
        fill="none" stroke={GOLD} strokeWidth={1.5} strokeLinejoin="round" opacity={op1 as any}/>
      <AnimatedPolygon points="32,4 56,18 56,46 32,60 8,46 8,18"
        fill="none" stroke={GOLD} strokeWidth={1.5} strokeLinejoin="round" opacity={op2 as any}/>

      <G clipPath="url(#hexW)">
        <AnimatedG transform={rotDeg as any} origin="32,32">
          <Path d="M32 32 L56 20 A32 32 0 0 1 56 44 Z" fill={`${C.goldG || 'rgba(254,226,41,0.18)'}`} opacity={0.75}/>
        </AnimatedG>
        <Circle cx="32" cy="32" r="10" fill={BD} stroke={BLUE} strokeWidth={1.5}/>
      </G>
    </Svg>
  );
}

// ══════════════════════════════════════════════════════════════
// EXPORT
// ══════════════════════════════════════════════════════════════
export default function TabIcon({
  name,
  focused = false,
  size = 26,
}: {
  name: string;
  focused?: boolean;
  size?: number;
}) {
  return (
    <View style={{ opacity: focused ? 1 : 0.38 }}>
      {name === 'home'     && <HomeIcon     size={size}/>}
      {name === 'coach'    && <CoachIcon    size={size}/>}
      {name === 'waiver'   && <WaiverIcon   size={size}/>}
      {name === 'rankings' && <RankingsIcon size={size}/>}
      {name === 'trade'    && <TradeIcon    size={size}/>}
      {!['home','coach','waiver','rankings','trade'].includes(name) && <HomeIcon size={size}/>} 
    </View>
  );
}
