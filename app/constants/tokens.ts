//  AIOmni Design Tokens v6
//  Cream × Steel Blue × #FEE229 Gold  —  Light Theme
//  Fonts: Bungee (headings/scores) · Space Mono (everything else)

export const C = {
  bgTop:       '#ffffed',
  bgBot:       '#f0f0d0',
  phone:       '#ffffed',
  phone2:      '#f5f5d5',

  glass:       'rgba(255,255,255,0.90)',
  glassBorder: 'rgba(88,131,191,0.38)',
  glassShine:  'rgba(255,255,255,0.95)',
  surface:     'rgba(255,255,255,0.82)',
  surfBorder:  'rgba(88,131,191,0.22)',
  surfShine:   'rgba(255,255,255,0.90)',

  ink:         '#1a1f2e',
  ink2:        '#3a4255',
  dim:         'rgba(26,31,46,0.70)',
  dim2:        'rgba(26,31,46,0.42)',

  gold:        '#fee229',
  goldBright:  '#fee229',
  goldS:       'rgba(254,226,41,0.22)',
  goldG:       'rgba(254,226,41,0.40)',
  goldBorder:  'rgba(254,226,41,0.50)',

  sage:        '#5883bf',
  sageS:       'rgba(88,131,191,0.10)',
  sageG:       'rgba(88,131,191,0.22)',
  sageBorder:  'rgba(88,131,191,0.28)',

  blueDeep:    '#3d6aaa',
  blueLight:   '#7aa3d4',

  mint:        '#1e8c42',
  mintS:       'rgba(30,140,66,0.12)',

  qb: '#7b5ea7', qbBg: 'rgba(123,94,167,0.12)',
  rb: '#1e8c42', rbBg: 'rgba(30,140,66,0.12)',
  wr: '#2a7aaa', wrBg: 'rgba(42,122,170,0.12)',
  te: '#b85a1a', teBg: 'rgba(184,90,26,0.12)',
  k:  '#6b7491', kBg:  'rgba(107,116,145,0.10)',

  amber:  '#b87820', amberS: 'rgba(184,120,32,0.15)',
  mauve:  '#7b5ea7', mauveS: 'rgba(123,94,167,0.12)',
  ocean:  '#3d6aaa', oceanS: 'rgba(61,106,170,0.12)',
  rose:   '#a83040', roseS:  'rgba(168,48,64,0.12)',
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
  goldCard: {
    backgroundColor: 'rgba(254,226,41,0.15)',
    borderWidth: 1.5,
    borderColor: 'rgba(254,226,41,0.5)',
    borderTopColor: 'rgba(255,255,255,0.95)',
    borderLeftColor: 'rgba(254,226,41,0.35)',
    borderBottomColor: 'rgba(200,177,0,0.4)',
    borderRightColor: 'rgba(200,177,0,0.3)',
    borderRadius: 16,
    shadowColor: '#fee229',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 6,
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
// FONTS — Bungee (headings/scores) + Space Mono (everything else)
// Matches landing page at getaiomni.com
// ─────────────────────────────────────────────
export const F = {
  // Headings / display / scores
  bold:       'Bungee_400Regular',
  black:      'Bungee_400Regular',
  extrabold:  'Bungee_400Regular',
  score:      'Bungee_400Regular',
  bebas:      'Bungee_400Regular',

  // Body / everything else — Space Mono
  outfit:     'SpaceMono_400Regular',
  body:       'SpaceMono_400Regular',
  bodyBold:   'SpaceMono_700Bold',
  semibold:   'SpaceMono_700Bold',
  barlow:     'SpaceMono_400Regular',
  barlowMd:   'SpaceMono_400Regular',
  barlowSb:   'SpaceMono_700Bold',
  barlowBd:   'SpaceMono_700Bold',

  // Mono / data — also Space Mono
  mono:       'SpaceMono_400Regular',
  monoBold:   'SpaceMono_700Bold',
  spaceMono:   'SpaceMono_400Regular',
  spaceMonoBd: 'SpaceMono_700Bold',
} as const;

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

export const shadow = {
  glass:    { shadowColor: '#3d6aaa', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 20, elevation: 6 },
  card:     { shadowColor: '#3d6aaa', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.10, shadowRadius: 12, elevation: 3 },
  goldGlow: { shadowColor: '#fee229', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.5,  shadowRadius: 16, elevation: 8 },
  blueGlow: { shadowColor: '#3d6aaa', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4,  shadowRadius: 14, elevation: 8 },
  glow: (color: string, radius = 14, opacity = 0.45) => ({ shadowColor: color, shadowOffset: { width: 0, height: 0 }, shadowOpacity: opacity, shadowRadius: radius, elevation: 8 }),
} as const;

export const textShadow = {
  hero: { textShadowColor: 'rgba(61,106,170,0.12)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  body: { textShadowColor: 'transparent', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 0 },
  subtle: { textShadowColor: 'transparent', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 0 },
  gold: { textShadowColor: 'rgba(254,226,41,0.6)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 12 },
  blue: { textShadowColor: 'rgba(61,106,170,0.5)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 10 },
} as const;

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
