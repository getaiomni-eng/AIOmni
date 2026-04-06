// AIOmniIcons.tsx
// Full custom SVG icon set for AIOmni — replaces every emoji in the app
// All icons use the V6 design system colors
// Usage: <Icon name="target" size={20} color={C.gold} />

import React from 'react';
import Svg, {
  Path, Circle, Rect, Line, Polyline, Polygon,
  G, Defs, ClipPath, LinearGradient as SvgGradient, Stop,
} from 'react-native-svg';

interface IconProps {
  size?: number;
  color?: string;
  strokeWidth?: number;
}

// ─── INDIVIDUAL ICONS ──────────────────────────────────────────

// Target / Start/Sit (replaces 🎯)
export const TargetIcon = ({ size = 24, color = '#3d6aaa', strokeWidth = 2 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={strokeWidth}/>
    <Circle cx="12" cy="12" r="5" stroke={color} strokeWidth={strokeWidth}/>
    <Circle cx="12" cy="12" r="1.5" fill={color}/>
    <Line x1="12" y1="3" x2="12" y2="6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"/>
    <Line x1="12" y1="18" x2="12" y2="21" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"/>
    <Line x1="3" y1="12" x2="6" y2="12" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"/>
    <Line x1="18" y1="12" x2="21" y2="12" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"/>
  </Svg>
);

// Live / Signal (replaces 📡)
export const LiveSignalIcon = ({ size = 24, color = '#fee229', strokeWidth = 2 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M5 12.5C5 9.46 7.24 7 12 7s7 2.46 7 5.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"/>
    <Path d="M2 12.5C2 7.81 6.48 4 12 4s10 3.81 10 8.5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"/>
    <Circle cx="12" cy="17" r="2" fill={color}/>
    <Line x1="12" y1="15" x2="12" y2="13" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"/>
  </Svg>
);

// Trending Up / Best Waiver (replaces 📈)
export const TrendingUpIcon = ({ size = 24, color = '#3d6aaa', strokeWidth = 2 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Polyline points="3,17 9,11 13,15 21,7" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"/>
    <Polyline points="15,7 21,7 21,13" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"/>
  </Svg>
);

// Swap / Trade Value (replaces ⇄)
export const SwapIcon = ({ size = 24, color = '#3d6aaa', strokeWidth = 2 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M7 4l-4 4 4 4" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"/>
    <Path d="M3 8h14" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"/>
    <Path d="M17 20l4-4-4-4" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"/>
    <Path d="M21 16H7" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"/>
  </Svg>
);

// Bar Chart / Matchup / Rankings (replaces 📊)
export const BarChartIcon = ({ size = 24, color = '#3d6aaa', strokeWidth = 2 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Rect x="4" y="14" width="4" height="7" rx="1" stroke={color} strokeWidth={strokeWidth}/>
    <Rect x="10" y="9" width="4" height="12" rx="1" stroke={color} strokeWidth={strokeWidth}/>
    <Rect x="16" y="4" width="4" height="17" rx="1" stroke={color} strokeWidth={strokeWidth}/>
    <Line x1="2" y1="21" x2="22" y2="21" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"/>
  </Svg>
);

// Calendar / Redraft (replaces 📅)
export const CalendarIcon = ({ size = 24, color = '#3d6aaa', strokeWidth = 2 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Rect x="3" y="4" width="18" height="18" rx="2" stroke={color} strokeWidth={strokeWidth}/>
    <Line x1="3" y1="9" x2="21" y2="9" stroke={color} strokeWidth={strokeWidth}/>
    <Line x1="8" y1="2" x2="8" y2="6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"/>
    <Line x1="16" y1="2" x2="16" y2="6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"/>
    <Rect x="7" y="13" width="3" height="3" rx="0.5" fill={color}/>
    <Rect x="13" y="13" width="3" height="3" rx="0.5" fill={color}/>
  </Svg>
);

// Crown / Dynasty (replaces 👑)
export const CrownIcon = ({ size = 24, color = '#fee229', strokeWidth = 2 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M3 17l3-8 4.5 5L12 7l1.5 7 4.5-5 3 8H3z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round"/>
    <Line x1="3" y1="21" x2="21" y2="21" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"/>
    <Circle cx="12" cy="7" r="1.5" fill={color}/>
    <Circle cx="4" cy="11" r="1" fill={color}/>
    <Circle cx="20" cy="11" r="1" fill={color}/>
  </Svg>
);

// Fire / Hot / Trending (replaces 🔥)
export const FireIcon = ({ size = 24, color = '#b87820', strokeWidth = 2 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M12 2C12 2 7 8 7 13a5 5 0 0010 0c0-3-2-5.5-2-5.5s-.5 2-2 2.5C14 8.5 12 2 12 2z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round"/>
    <Path d="M12 17a2 2 0 01-2-2c0-1.5 2-3 2-3s2 1.5 2 3a2 2 0 01-2 2z" fill={color}/>
  </Svg>
);

// Lightning / Live game (replaces ⚡)
export const LightningIcon = ({ size = 24, color = '#fee229', strokeWidth = 2 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M13 2L4.5 13.5H12L11 22L19.5 10.5H12L13 2z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" fill="none"/>
  </Svg>
);

// Person / Account (replaces 👤)
export const PersonIcon = ({ size = 24, color = '#3d6aaa', strokeWidth = 2 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx="12" cy="8" r="4" stroke={color} strokeWidth={strokeWidth}/>
    <Path d="M4 20c0-4 3.58-7 8-7s8 3 8 7" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"/>
  </Svg>
);

// Bell / Notifications (replaces 🔔)
export const BellIcon = ({ size = 24, color = '#3d6aaa', strokeWidth = 2 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round"/>
    <Path d="M13.73 21a2 2 0 01-3.46 0" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"/>
  </Svg>
);

// Lock / Privacy (replaces 🔒)
export const LockIcon = ({ size = 24, color = '#3d6aaa', strokeWidth = 2 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Rect x="5" y="11" width="14" height="11" rx="2" stroke={color} strokeWidth={strokeWidth}/>
    <Path d="M8 11V7a4 4 0 018 0v4" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"/>
    <Circle cx="12" cy="16" r="1.5" fill={color}/>
  </Svg>
);

// Key / Auth / Create account (replaces 🔑)
export const KeyIcon = ({ size = 24, color = '#fee229', strokeWidth = 2 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx="8" cy="12" r="4" stroke={color} strokeWidth={strokeWidth}/>
    <Path d="M12 12h9M17 12v3" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"/>
  </Svg>
);

// Check / Connected (replaces ✓)
export const CheckIcon = ({ size = 24, color = '#1e8c42', strokeWidth = 2.5 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Polyline points="4,12 9,17 20,7" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"/>
  </Svg>
);

// X / Close / Decline
export const XIcon = ({ size = 24, color = '#a83040', strokeWidth = 2.5 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Line x1="6" y1="6" x2="18" y2="18" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"/>
    <Line x1="18" y1="6" x2="6" y2="18" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"/>
  </Svg>
);

// Arrow Right / Chevron
export const ChevronRightIcon = ({ size = 24, color = '#3d6aaa', strokeWidth = 2 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Polyline points="9,6 15,12 9,18" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"/>
  </Svg>
);

// Arrow Up / Send
export const SendIcon = ({ size = 24, color = '#1a1f2e', strokeWidth = 2 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Line x1="12" y1="19" x2="12" y2="5" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"/>
    <Polyline points="5,12 12,5 19,12" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"/>
  </Svg>
);

// Gear / Settings
export const GearIcon = ({ size = 24, color = '#3d6aaa', strokeWidth = 2 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx="12" cy="12" r="3" stroke={color} strokeWidth={strokeWidth}/>
    <Path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"/>
  </Svg>
);

// Drag Handle / Reorder
export const DragHandleIcon = ({ size = 24, color = '#6b7491', strokeWidth = 2 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Line x1="4" y1="8" x2="20" y2="8" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"/>
    <Line x1="4" y1="12" x2="20" y2="12" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"/>
    <Line x1="4" y1="16" x2="20" y2="16" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"/>
  </Svg>
);

// Plus / Add
export const PlusIcon = ({ size = 24, color = '#3d6aaa', strokeWidth = 2 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Line x1="12" y1="5" x2="12" y2="19" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"/>
    <Line x1="5" y1="12" x2="19" y2="12" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"/>
  </Svg>
);

// Trash / Delete
export const TrashIcon = ({ size = 24, color = '#a83040', strokeWidth = 2 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Polyline points="3,6 5,6 21,6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"/>
    <Path d="M19 6l-1 14H6L5 6" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round"/>
    <Path d="M10 11v6M14 11v6" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"/>
    <Path d="M9 6V4h6v2" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round"/>
  </Svg>
);

// Trophy / Rank
export const TrophyIcon = ({ size = 24, color = '#fee229', strokeWidth = 2 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M8 21h8M12 17v4M6 3H3v5c0 2.2 1.8 4 4 4M18 3h3v5c0 2.2-1.8 4-4 4" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"/>
    <Path d="M7 3h10v7a5 5 0 01-10 0V3z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round"/>
    <Line x1="6" y1="21" x2="18" y2="21" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"/>
  </Svg>
);

// Star / Favorite
export const StarIcon = ({ size = 24, color = '#fee229', strokeWidth = 2 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round"/>
  </Svg>
);

// Injury / Alert
export const AlertIcon = ({ size = 24, color = '#b87820', strokeWidth = 2 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round"/>
    <Line x1="12" y1="9" x2="12" y2="13" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"/>
    <Circle cx="12" cy="17" r="0.8" fill={color}/>
  </Svg>
);

// Usage / Prompt counter
export const UsageIcon = ({ size = 24, color = '#3d6aaa', strokeWidth = 2 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={strokeWidth}/>
    <Path d="M12 7v5l3 3" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"/>
  </Svg>
);

// Waiver Wire / Radar
export const RadarIcon = ({ size = 24, color = '#3d6aaa', strokeWidth = 2 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={strokeWidth}/>
    <Circle cx="12" cy="12" r="5" stroke={color} strokeWidth={strokeWidth}/>
    <Circle cx="12" cy="12" r="1.5" fill={color}/>
    <Line x1="12" y1="3" x2="12" y2="7" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"/>
  </Svg>
);

// AI / Brain
export const BrainIcon = ({ size = 24, color = '#3d6aaa', strokeWidth = 2 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M12 5C9 5 6 7 6 10c0 1.5.6 2.8 1.5 3.8C6.5 14.8 6 16 6 17h12c0-1-.5-2.2-1.5-3.2C17.4 12.8 18 11.5 18 10c0-3-3-5-6-5z" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round"/>
    <Line x1="9" y1="17" x2="9" y2="21" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"/>
    <Line x1="15" y1="17" x2="15" y2="21" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"/>
    <Line x1="9" y1="19" x2="15" y2="19" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"/>
    <Circle cx="9.5" cy="10" r="1" fill={color}/>
    <Circle cx="14.5" cy="10" r="1" fill={color}/>
  </Svg>
);

// Football / Platform fallback
export const FootballIcon = ({ size = 24, color = '#3d6aaa', strokeWidth = 2 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M12 2C8 2 4 6 4 12s4 10 8 10 8-4 8-10S16 2 12 2z" stroke={color} strokeWidth={strokeWidth}/>
    <Path d="M12 2C12 2 8 6 8 12s4 10 4 10" stroke={color} strokeWidth={strokeWidth}/>
    <Line x1="4" y1="12" x2="20" y2="12" stroke={color} strokeWidth={strokeWidth}/>
    <Line x1="6" y1="7" x2="18" y2="7" stroke={color} strokeWidth={strokeWidth}/>
    <Line x1="6" y1="17" x2="18" y2="17" stroke={color} strokeWidth={strokeWidth}/>
  </Svg>
);

// ─── MASTER ICON COMPONENT ─────────────────────────────────────

type IconName = 
  | 'target' | 'live' | 'trending' | 'swap' | 'barchart'
  | 'calendar' | 'crown' | 'fire' | 'lightning' | 'person'
  | 'bell' | 'lock' | 'key' | 'check' | 'x' | 'chevron'
  | 'send' | 'gear' | 'drag' | 'plus' | 'trash' | 'trophy'
  | 'star' | 'alert' | 'usage' | 'radar' | 'brain' | 'football';

interface AIOmniIconProps extends IconProps {
  name: IconName;
}

export const Icon = ({ name, size = 24, color = '#3d6aaa', strokeWidth = 2 }: AIOmniIconProps) => {
  const props = { size, color, strokeWidth };
  switch (name) {
    case 'target':    return <TargetIcon {...props} />;
    case 'live':      return <LiveSignalIcon {...props} />;
    case 'trending':  return <TrendingUpIcon {...props} />;
    case 'swap':      return <SwapIcon {...props} />;
    case 'barchart':  return <BarChartIcon {...props} />;
    case 'calendar':  return <CalendarIcon {...props} />;
    case 'crown':     return <CrownIcon {...props} />;
    case 'fire':      return <FireIcon {...props} />;
    case 'lightning': return <LightningIcon {...props} />;
    case 'person':    return <PersonIcon {...props} />;
    case 'bell':      return <BellIcon {...props} />;
    case 'lock':      return <LockIcon {...props} />;
    case 'key':       return <KeyIcon {...props} />;
    case 'check':     return <CheckIcon {...props} />;
    case 'x':         return <XIcon {...props} />;
    case 'chevron':   return <ChevronRightIcon {...props} />;
    case 'send':      return <SendIcon {...props} />;
    case 'gear':      return <GearIcon {...props} />;
    case 'drag':      return <DragHandleIcon {...props} />;
    case 'plus':      return <PlusIcon {...props} />;
    case 'trash':     return <TrashIcon {...props} />;
    case 'trophy':    return <TrophyIcon {...props} />;
    case 'star':      return <StarIcon {...props} />;
    case 'alert':     return <AlertIcon {...props} />;
    case 'usage':     return <UsageIcon {...props} />;
    case 'radar':     return <RadarIcon {...props} />;
    case 'brain':     return <BrainIcon {...props} />;
    case 'football':  return <FootballIcon {...props} />;
    default:          return null;
  }
};

export default Icon;

/*
EMOJI → ICON REPLACEMENT MAP:
🎯  → <Icon name="target" color={C.gold} />
📡  → <Icon name="live" color={C.gold} />
📈  → <Icon name="trending" color={C.blueDeep} />
⇄   → <Icon name="swap" color={C.blueDeep} />
📊  → <Icon name="barchart" color={C.blueDeep} />
📅  → <Icon name="calendar" color={C.blueDeep} />
👑  → <Icon name="crown" color={C.gold} />
🔥  → <Icon name="fire" color={C.amber} />
⚡  → <Icon name="lightning" color={C.gold} />
👤  → <Icon name="person" color={C.blueDeep} />
🔔  → <Icon name="bell" color={C.blueDeep} />
🔒  → <Icon name="lock" color={C.blueDeep} />
🔑  → <Icon name="key" color={C.gold} />
✓   → <Icon name="check" color={C.mint} />
✕   → <Icon name="x" color={C.rose} />
›   → <Icon name="chevron" color={C.dim2} />
↑   → <Icon name="send" color={C.ink} />
⚙   → <Icon name="gear" color={C.dim2} />
≡   → <Icon name="drag" color={C.dim2} />
+   → <Icon name="plus" color={C.blueDeep} />
🗑  → <Icon name="trash" color={C.rose} />
🏆  → <Icon name="trophy" color={C.gold} />
⭐  → <Icon name="star" color={C.gold} />
⚠️  → <Icon name="alert" color={C.amber} />
🤖  → <OrbAvatar size={32} /> (already done)
🏈  → <Icon name="football" color={C.blueDeep} />
*/
