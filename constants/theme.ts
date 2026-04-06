import { Colors as ColorsFlat } from './Colors';

// Create a light/dark variant structure for theme hooks
export const Colors = {
  light: {
    text: ColorsFlat.white,
    background: ColorsFlat.background,
    tint: ColorsFlat.y,
    icon: ColorsFlat.y,
    tabIconDefault: 'rgba(255,255,255,0.3)',
    tabIconSelected: ColorsFlat.y,
  },
  dark: {
    text: ColorsFlat.white,
    background: ColorsFlat.void,
    tint: ColorsFlat.y,
    icon: ColorsFlat.y,
    tabIconDefault: 'rgba(255,255,255,0.3)',
    tabIconSelected: ColorsFlat.y,
  },
};

// Tab bar / navigation colors (Expo Router uses these)
export const NavColors = {
  light: {
    text:           ColorsFlat.white,
    background:     ColorsFlat.background,
    tint:           ColorsFlat.y,
    icon:           ColorsFlat.y,
    tabIconDefault: 'rgba(255,255,255,0.3)',
    tabIconSelected:ColorsFlat.y,
  },
  dark: {
    text:           ColorsFlat.white,
    background:     ColorsFlat.void,
    tint:           ColorsFlat.y,
    icon:           ColorsFlat.y,
    tabIconDefault: 'rgba(255,255,255,0.3)',
    tabIconSelected:ColorsFlat.y,
  },
};

// Main app theme — import this in your screens
export const Theme = {
  // Colors (shortcut — same as Colors.ts)
  ...ColorsFlat,

  // Spacing scale
  space: {
    xs:  4,
    sm:  8,
    md:  12,
    lg:  16,
    xl:  20,
    xxl: 28,
  },

  // Border radius
  radius: {
    sm: 2,
    md: 3,
    lg: 6,
  },

  // Animation durations (ms)
  dur: {
    fast:   150,
    normal: 250,
    slow:   400,
    pulse:  2800,
  },

  // Shadows
  shadowY: {
    shadowColor:  '#D4FF00',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius:  16,
    elevation: 8,
  },
  shadowCard: {
    shadowColor:  '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius:  8,
    elevation: 4,
  },
};

// Font families
export const Fonts = {
  display: 'BebasNeue_400Regular',
  mono:    'SpaceMono_400Regular',
  monoBold:'SpaceMono_700Bold',
  body:    'Barlow_400Regular',
  bodyMd:  'Barlow_500Medium',
  bodySb:  'Barlow_600SemiBold',
  bodyBd:  'Barlow_700Bold',
};