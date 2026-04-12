// components/TabIcon.tsx
// V7 Tab Icons — green/chartreuse/amber palette
// Coach uses Spectrum C (unchanged)

import React from 'react';
import Svg, {
  Circle, Defs,
  Line, LinearGradient,
  Path, Polygon, Rect, Stop, Text as SvgText
} from 'react-native-svg';

const GREEN     = '#6eeb83';
const CHARTREUSE = '#e4ff1a';
const AMBER     = '#ffb800';
const FLAME     = '#ff5714';
const AQUA      = '#1be7ff';
const MUTED     = '#7a9eaa';
const DARK_BG   = '#0a1214';

type IconName = 'home' | 'draft' | 'rankings' | 'trade' | 'coach';

interface Props {
  name: IconName;
  focused: boolean;
  size?: number;
}

export default function TabIcon({ name, focused, size = 26 }: Props) {
  switch (name) {
    case 'home':     return <HomeIcon focused={focused} size={size} />;
    case 'draft':    return <DraftIcon focused={focused} size={size} />;
    case 'rankings': return <RankingsIcon focused={focused} size={size} />;
    case 'trade':    return <TradeIcon focused={focused} size={size} />;
    case 'coach':    return <CoachIcon focused={focused} size={size} />;
    default:         return <HomeIcon focused={focused} size={size} />;
  }
}

// ─── HOME: 4-card grid ──────────────────────────────────────

function HomeIcon({ focused, size }: { focused: boolean; size: number }) {
  const primary = focused ? CHARTREUSE : GREEN;
  const secondary = focused ? GREEN : GREEN;
  const activeOpacity = focused ? 0.35 : 0.12;
  const inactiveOpacity = focused ? 0.15 : 0.08;

  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      {/* Top-left: active card */}
      <Rect x="6" y="6" width="24" height="24" rx={4}
        fill={primary} fillOpacity={activeOpacity}
        stroke={primary} strokeWidth={focused ? 1.5 : 1} strokeOpacity={focused ? 1 : 0.3} />
      {/* Top-right */}
      <Rect x="34" y="6" width="24" height="24" rx={4}
        fill={secondary} fillOpacity={inactiveOpacity}
        stroke={secondary} strokeWidth={1} strokeOpacity={focused ? 0.5 : 0.2} />
      {/* Bottom-left */}
      <Rect x="6" y="34" width="24" height="24" rx={4}
        fill={secondary} fillOpacity={inactiveOpacity}
        stroke={secondary} strokeWidth={1} strokeOpacity={focused ? 0.5 : 0.2} />
      {/* Bottom-right */}
      <Rect x="34" y="34" width="24" height="24" rx={4}
        fill={secondary} fillOpacity={inactiveOpacity}
        stroke={secondary} strokeWidth={1} strokeOpacity={focused ? 0.5 : 0.2} />
      {/* Score indicator on active card */}
      {focused && (
        <>
          <Line x1="18" y1="14" x2="18" y2="22" stroke={AMBER} strokeWidth={2} strokeLinecap="round" />
          <Line x1="13" y1="18" x2="23" y2="18" stroke={AMBER} strokeWidth={1.5} strokeLinecap="round" opacity={0.5} />
        </>
      )}
    </Svg>
  );
}

// ─── DRAFT: clipboard + pick rows + pointer + check ─────────

function DraftIcon({ focused, size }: { focused: boolean; size: number }) {
  const clipColor = focused ? AMBER : GREEN;
  const topRow = focused ? CHARTREUSE : GREEN;
  const rows = focused ? GREEN : GREEN;
  const checkColor = focused ? GREEN : GREEN;

  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      {/* Clipboard body */}
      <Rect x="14" y="14" width="36" height="42" rx={5}
        fill="none" stroke={clipColor} strokeWidth={focused ? 2.5 : 1.5}
        strokeOpacity={focused ? 1 : 0.2} />
      {/* Clip at top */}
      <Rect x="23" y="8" width="18" height="8" rx={3}
        fill={clipColor} fillOpacity={focused ? 0.5 : 0.15} />
      {/* Top pick row (highlighted) */}
      <Rect x="20" y="20" width="24" height="5" rx={2}
        fill={topRow} fillOpacity={focused ? 1 : 0.15} />
      {/* Pointer arrow */}
      <Polygon points="17,22.5 20,20 20,25"
        fill={topRow} fillOpacity={focused ? 1 : 0.15} />
      {/* Other rows */}
      <Rect x="20" y="28" width="20" height="4" rx={1.5}
        fill={rows} fillOpacity={focused ? 0.4 : 0.1} />
      <Rect x="20" y="35" width="22" height="4" rx={1.5}
        fill={rows} fillOpacity={focused ? 0.25 : 0.08} />
      {focused && (
        <Rect x="20" y="42" width="16" height="4" rx={1.5}
          fill={rows} fillOpacity={0.18} />
      )}
      {/* Check mark */}
      {focused && (
        <Path d="M34,48 L38,52 L46,42" fill="none"
          stroke={checkColor} strokeWidth={3}
          strokeLinecap="round" strokeLinejoin="round" />
      )}
    </Svg>
  );
}

// ─── RANKINGS: podium bars ──────────────────────────────────

function RankingsIcon({ focused, size }: { focused: boolean; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      {/* Bar 3 (left, shortest) */}
      <Rect x="8" y="36" width="14" height="22" rx={3}
        fill={GREEN} fillOpacity={focused ? 0.4 : 0.15} />
      {/* Bar 1 (center, tallest) */}
      <Rect x="25" y="16" width="14" height="42" rx={3}
        fill={CHARTREUSE} fillOpacity={focused ? 0.6 : 0.2} />
      {/* Bar 2 (right, medium) */}
      <Rect x="42" y="28" width="14" height="30" rx={3}
        fill={AMBER} fillOpacity={focused ? 0.4 : 0.15} />
      {/* Rank numbers (only when focused) */}
      {focused && (
        <>
          <SvgText x="15" y="32" textAnchor="middle"
            fill={GREEN} fontSize={9} fontWeight="700"
            fontFamily="SpaceGrotesk_700Bold">3</SvgText>
          <SvgText x="32" y="12" textAnchor="middle"
            fill={CHARTREUSE} fontSize={10} fontWeight="700"
            fontFamily="SpaceGrotesk_700Bold">1</SvgText>
          <SvgText x="49" y="24" textAnchor="middle"
            fill={AMBER} fontSize={9} fontWeight="700"
            fontFamily="SpaceGrotesk_700Bold">2</SvgText>
        </>
      )}
    </Svg>
  );
}

// ─── TRADE: crossing arrows ─────────────────────────────────

function TradeIcon({ focused, size }: { focused: boolean; size: number }) {
  const topColor = focused ? GREEN : GREEN;
  const botColor = focused ? AMBER : AMBER;
  const dotColor = focused ? CHARTREUSE : GREEN;

  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      {/* Top arrow (left to right) */}
      <Line x1="10" y1="22" x2="48" y2="22"
        stroke={topColor} strokeWidth={focused ? 2.5 : 2}
        strokeLinecap="round" strokeOpacity={focused ? 1 : 0.2} />
      <Polygon points="44,16 54,22 44,28"
        fill={topColor} fillOpacity={focused ? 1 : 0.2} />
      {focused && (
        <Circle cx="10" cy="22" r={3.5}
          fill={dotColor} fillOpacity={0.5} />
      )}
      {/* Bottom arrow (right to left) */}
      <Line x1="54" y1="42" x2="16" y2="42"
        stroke={botColor} strokeWidth={focused ? 2.5 : 2}
        strokeLinecap="round" strokeOpacity={focused ? 1 : 0.2} />
      <Polygon points="20,36 10,42 20,48"
        fill={botColor} fillOpacity={focused ? 1 : 0.2} />
      {focused && (
        <Circle cx="54" cy="42" r={3.5}
          fill={dotColor} fillOpacity={0.5} />
      )}
    </Svg>
  );
}

// ─── AI COACH: Spectrum C (unchanged) ───────────────────────

function CoachIcon({ focused, size }: { focused: boolean; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Defs>
        <LinearGradient id="spectrumC" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor={FLAME} />
          <Stop offset="25%" stopColor={AMBER} />
          <Stop offset="50%" stopColor={CHARTREUSE} />
          <Stop offset="75%" stopColor={GREEN} />
          <Stop offset="100%" stopColor={AQUA} />
        </LinearGradient>
      </Defs>
      <Circle cx="32" cy="32" r="22" fill="none"
        stroke={focused ? 'url(#spectrumC)' : MUTED}
        strokeWidth={focused ? 4 : 3}
        strokeLinecap="round"
        strokeDasharray="125 14"
        strokeOpacity={focused ? 1 : 0.3}
      />
    </Svg>
  );
}