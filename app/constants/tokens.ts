//  AIOmni Design Tokens v5
//  Cream × Steel Blue × #FEE229 Gold  —  Light Theme
//  Fonts: BebasNeue (display) · Barlow (body) · SpaceMono (mono/data)
//  Replaces Colors.ts + old tokens.ts — single source of truth

// ─────────────────────────────────────────────
// COLORS
// ─────────────────────────────────────────────
export const C = {
  // Background — cream gradient
  bgTop:       '#ffffed',
  bgBot:       '#f0f0d0',
  phone:       '#ffffed',
  phone2:      '#f5f5d5',

  // Glass cards — cream with blue border + bevel
  glass:       'rgba(255,255,255,0.90)',
  glassBorder: 'rgba(88,131,191,0.38)',
  glassShine:  'rgba(255,255,255,0.95)',
  surface:     'rgba(255,255,255,0.82)',
  surfBorder:  'rgba(88,131,191,0.22)',
  surfShine:   'rgba(255,255,255,0.90)',

  // Text — dark ink on light background
  ink:         '#1a1f2e',
  ink2:        '#3a4255',
  dim:         'rgba(26,31,46,0.70)',
  dim2:        'rgba(26,31,46,0.42)',

  // Gold — brand accent
  gold:        '#fee229',
  goldBright:  '#fee229',
  goldS:       'rgba(254,226,41,0.22)',
  goldG:       'rgba(254,226,41,0.40)',
  goldBorder:  'rgba(254,226,41,0.50)',

  // Blue — primary UI color (replaces sage token names for back-compat)
  sage:        '#5883bf',
  sageS:       'rgba(88,131,191,0.10)',
  sageG:       'rgba(88,131,191,0.22)',
  sageBorder:  'rgba(88,131,191,0.28)',

  // Blue deep — accent, active states, borders
  blueDeep:    '#3d6aaa',
  blueLight:   '#7aa3d4',

  // Mint — wins, adds, success
  mint:        '#1e8c42',
  mintS:       'rgba(30,140,66,0.12)',

  // Position colors — adjusted for cream background
  qb:          '#7b5ea7',   qbBg:  'rgba(123,94,167,0.12)',
  rb:          '#1e8c42',   rbBg:  'rgba(30,140,66,0.12)',
  wr:          '#2a7aaa',   wrBg:  'rgba(42,122,170,0.12)',
  te:          '#b85a1a',   teBg:  'rgba(184,90,26,0.12)',
  k:           '#6b7491',   kBg:   'rgba(107,116,145,0.10)',

  amber:       '#b87820',   amberS: 'rgba(184,120,32,0.15)',
  mauve:       '#7b5ea7',   mauveS: 'rgba(123,94,167,0.12)',
  ocean:       '#3d6aaa',   oceanS: 'rgba(61,106,170,0.12)',
  rose:        '#a83040',   roseS:  'rgba(168,48,64,0.12)',
} as const;

export const BEVEL = {
  card: {
    backgroundColor: C.glass,
    borderWidth: 1.5,
    borderColor: C.glassBorder,
    borderTopColor: C.glassShine,
    borderLeftColor: C.surfShine,
    borderBottomColor: C.sageBorder,
    borderRightColor: C.sageBorder,
    borderRadius: 16,
    shadowColor: C.blueDeep,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.10,
    shadowRadius: 14,
    elevation: 4,
  },
  blueCard: {
    backgroundColor: C.oceanS,
    borderWidth: 1.5,
    borderColor: C.glassBorder,
    borderTopColor: C.glassShine,
    borderLeftColor: C.surfShine,
    borderBottomColor: C.sageBorder,
    borderRightColor: C.sageBorder,
    borderRadius: 16,
    shadowColor: C.blueDeep,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.10,
    shadowRadius: 14,
    elevation: 4,
  },
  shine: {
    position: 'absolute',
    top: 0,
    left: '8%',
    right: '8%',
    height: 1.5,
    backgroundColor: C.glassShine,
    zIndex: 6,
  },
  tabBar: {
    backgroundColor: C.bgTop,
    borderTopWidth: 1.5,
    borderTopColor: C.glassShine,
    borderLeftColor: C.surfShine,
    borderBottomColor: C.sageBorder,
    borderRightColor: C.sageBorder,
    shadowColor: C.blueDeep,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 12,
  },
} as const;

// ─────────────────────────────────────────────
// FONTS
// Local TTFs in assets/fonts/
// BebasNeue  → display / headings
// Barlow     → body / prose
// SpaceMono  → mono / data / labels
// ─────────────────────────────────────────────
export const F = {
  // Display headings
  bold:        'BebasNeue_400Regular',
  black:       'BebasNeue_400Regular',
  extrabold:   'BebasNeue_400Regular',
  bebas:       'BebasNeue_400Regular',

  // Body text — Barlow
  outfit:      'Barlow_400Regular',
  semibold:    'Barlow_600SemiBold',
  barlow:      'Barlow_400Regular',
  barlowMd:    'Barlow_400Regular',
  barlowSb:    'Barlow_600SemiBold',
  barlowBd:    'Barlow_600SemiBold',

  // Mono / data — SpaceMono
  mono:        'SpaceMono_400Regular',
  monoBold:    'SpaceMono_700Bold',
  spaceMono:   'SpaceMono_400Regular',
  spaceMonoBd: 'SpaceMono_700Bold',
} as const;

// ─────────────────────────────────────────────
// SIZE  /  RADIUS  /  SPACING
// ─────────────────────────────────────────────
export const SZ = {
  xxs: 8, xs: 11, sm: 13, md: 15,
  base: 16, lg: 18, xl: 20,
  '2xl': 24, '3xl': 28, '4xl': 34, '5xl': 40, hero: 48,
} as const;

export const R = {
  xs: 8, sm: 10, md: 14, lg: 18, xl: 22, '2xl': 28, full: 999,
} as const;

export const SP = {
  1:4, 2:8, 3:12, 4:16, 5:20, 6:24, 8:32, 10:40, 12:48,
} as const;

// ─────────────────────────────────────────────
// SHADOWS  —  blue-tinted on cream
// ─────────────────────────────────────────────
export const shadow = {
  glass: {
    shadowColor: '#3d6aaa',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 6,
  },
  card: {
    shadowColor: '#3d6aaa',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.10,
    shadowRadius: 12,
    elevation: 3,
  },
  glow: (color: string, radius = 14, opacity = 0.45) => ({
    shadowColor: color,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: opacity,
    shadowRadius: radius,
    elevation: 8,
  }),
} as const;

// ─────────────────────────────────────────────
// TEXT SHADOWS  —  minimal on light background
// ─────────────────────────────────────────────
export const textShadow = {
  hero: {
    textShadowColor: 'rgba(61,106,170,0.12)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  body: {
    textShadowColor: 'transparent',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 0,
  },
  subtle: {
    textShadowColor: 'transparent',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 0,
  },
  gold: {
    textShadowColor: 'rgba(254,226,41,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
} as const;

// ─────────────────────────────────────────────
// POSITION MAP
// ─────────────────────────────────────────────
export const POS: Record<string, { color: string; bg: string }> = {
  QB:  { color: C.qb,    bg: C.qbBg   },
  RB:  { color: C.rb,    bg: C.rbBg   },
  WR:  { color: C.wr,    bg: C.wrBg   },
  TE:  { color: C.te,    bg: C.teBg   },
  K:   { color: C.k,     bg: C.kBg    },
  FLX: { color: C.rb,    bg: C.rbBg   },
  BN:  { color: C.dim2,  bg: 'rgba(26,31,46,0.06)' },
  DEF: { color: C.mauve, bg: C.mauveS },
};
