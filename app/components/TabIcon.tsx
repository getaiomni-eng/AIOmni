// AIOmni Tab Icons v7
// Home · Rankings · Trade · AI Coach
// Active = colored, Inactive = dim
// AI Coach active = Spectrum C mark

import React from 'react';
import Svg, {
  Circle,
  Defs,
  Line,
  LinearGradient,
  Polyline,
  Rect,
  Stop,
} from 'react-native-svg';

const AQUA  = '#1be7ff';
const GREEN = '#6eeb83';
const AMBER = '#ffb800';
const FLAME = '#ff5714';

interface TabIconProps {
  name: string;
  focused?: boolean;
  size?: number;
}

function HomeIcon({ size, active }: { size: number; active: boolean }) {
  const c = active ? AQUA : '#4a6a76';
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="2" y="2" width="9" height="9" rx="2.5"
        fill={active ? AQUA + '20' : 'none'} stroke={c} strokeWidth={1.8} />
      {active && <Circle cx="6.5" cy="6.5" r="1.5" fill={AQUA} />}
      <Rect x="13" y="2" width="9" height="9" rx="2.5"
        fill="none" stroke={c} strokeWidth={1.8} opacity={0.5} />
      <Rect x="2" y="13" width="9" height="9" rx="2.5"
        fill="none" stroke={c} strokeWidth={1.8} opacity={0.5} />
      <Rect x="13" y="13" width="9" height="9" rx="2.5"
        fill="none" stroke={c} strokeWidth={1.8} opacity={0.3} />
    </Svg>
  );
}

function RankingsIcon({ size, active }: { size: number; active: boolean }) {
  const c = active ? AQUA : '#4a6a76';
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="2" y="14" width="5" height="8" rx="1.5"
        fill={active ? GREEN + '40' : 'none'} stroke={active ? GREEN : c} strokeWidth={1.8}
        opacity={active ? 1 : 0.5} />
      <Rect x="9.5" y="6" width="5" height="16" rx="1.5"
        fill={active ? AQUA + '20' : 'none'} stroke={c} strokeWidth={1.8} />
      <Rect x="17" y="10" width="5" height="12" rx="1.5"
        fill={active ? AMBER + '30' : 'none'} stroke={active ? AMBER : c} strokeWidth={1.8}
        opacity={active ? 1 : 0.5} />
    </Svg>
  );
}

function TradeIcon({ size, active }: { size: number; active: boolean }) {
  const c = active ? AQUA : '#4a6a76';
  const c2 = active ? FLAME : '#4a6a76';
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Line x1="3" y1="8" x2="17" y2="8" stroke={c} strokeWidth={2} strokeLinecap="round" />
      <Polyline points="14,5 18,8 14,11" fill="none" stroke={c}
        strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <Line x1="21" y1="16" x2="7" y2="16" stroke={c2} strokeWidth={2}
        strokeLinecap="round" opacity={active ? 1 : 0.5} />
      <Polyline points="10,13 6,16 10,19" fill="none" stroke={c2}
        strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
        opacity={active ? 1 : 0.5} />
    </Svg>
  );
}

function CoachIcon({ size, active }: { size: number; active: boolean }) {
  const r = size * 0.38;
  const sw = size * 0.09;
  const circ = 2 * Math.PI * r;
  const arc = circ * 0.85;
  const gap = circ * 0.15;
  const offset = circ * 0.625;

  if (active) {
    return (
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Defs>
          <LinearGradient id="tabSpecGrad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor="#1be7ff" />
            <Stop offset="25%" stopColor="#6eeb83" />
            <Stop offset="50%" stopColor="#e4ff1a" />
            <Stop offset="75%" stopColor="#ffb800" />
            <Stop offset="100%" stopColor="#ff5714" />
          </LinearGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke="url(#tabSpecGrad)" strokeWidth={sw} strokeLinecap="round"
          strokeDasharray={`${arc} ${gap}`} strokeDashoffset={offset} />
      </Svg>
    );
  }

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Circle cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke="#4a6a76" strokeWidth={sw} strokeLinecap="round"
        strokeDasharray={`${arc} ${gap}`} strokeDashoffset={offset} />
    </Svg>
  );
}

export default function TabIcon({ name, focused = false, size = 26 }: TabIconProps) {
  switch (name) {
    case 'home':     return <HomeIcon size={size} active={focused} />;
    case 'rankings': return <RankingsIcon size={size} active={focused} />;
    case 'trade':    return <TradeIcon size={size} active={focused} />;
    case 'coach':    return <CoachIcon size={size} active={focused} />;
    default:         return <HomeIcon size={size} active={focused} />;
  }
}