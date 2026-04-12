// AIOmni Design Tokens v7
// Palette #6: Electric Aqua · Light Green · Neon Chartreuse · Amber Flame · Tiger Flame
// Fonts: Audiowide (headings/scores/nav) + Space Grotesk (body/data)
// Dark mode default, light mode toggle

// ─── PALETTE ───────────────────────────────────────────────
export const palette = {
  aqua:       '#1be7ff',
  green:      '#6eeb83',
  chartreuse: '#e4ff1a',
  amber:      '#ffb800',
  flame:      '#ff5714',
} as const;

// ─── THEME TOKENS ──────────────────────────────────────────
export const dark = {
  bg:          '#0a1214',
  surface:     '#0f1c22',
  card:        '#12252e',
  text:        '#f0f4f5',
  textSub:     '#7a9eaa',
  textMuted:   '#4a6a76',
  border:      '#1a3542',
  borderLight: '#14282f',
  navBg:       '#0c1618',
  inputBg:     '#0f1e25',
} as const;

export const light = {
  bg:          '#f0f5f6',
  surface:     '#e8eff1',
  card:        '#ffffff',
  text:        '#0a1a20',
  textSub:     '#3a6070',
  textMuted:   '#8aa4ae',
  border:      '#d4dfe3',
  borderLight: '#e4ecef',
  navBg:       '#ffffff',
  inputBg:     '#e8f0f2',
} as const;

// ─── BACKWARD COMPAT — C object maps to dark theme ────────
// This lets old code using C.xxx keep working during migration
export const C = {
  // Backgrounds
  bgTop:       dark.bg,
  bgBot:       dark.bg,
  phone:       dark.bg,
  phone2:      dark.surface,

  // Surfaces
  glass:       dark.card,
  glassBorder: dark.border,
  glassShine:  dark.borderLight,
  surface:     dark.surface,
  surfBorder:  dark.border,
  surfShine:   dark.borderLight,

  // Text
  ink:         dark.text,
  ink2:        dark.textSub,
  dim:         dark.textSub,
  dim2:        dark.textMuted,

  // Brand — map old gold/blue to new palette
  gold:        palette.aqua,
  goldBright:  palette.aqua,
  goldS:       palette.aqua + '22',
  goldG:       palette.aqua + '40',
  goldBorder:  palette.aqua + '50',

  sage:        palette.green,
  sageS:       palette.green + '18',
  sageG:       palette.green + '22',
  sageBorder:  palette.green + '28',

  blueDeep:    palette.aqua,
  blueLight:   palette.aqua,

  mint:        palette.green,
  mintS:       palette.green + '18',

  // Position colors
  qb: '#a78bfa', qbBg: 'rgba(167,139,250,0.15)',
  rb: palette.green, rbBg: palette.green + '15',
  wr: palette.aqua, wrBg: palette.aqua + '15',
  te: palette.amber, teBg: palette.amber + '15',
  k:  dark.textMuted, kBg: dark.textMuted + '15',

  // Signal colors
  amber:  palette.amber,  amberS: palette.amber + '18',
  mauve:  '#a78bfa',       mauveS: 'rgba(167,139,250,0.15)',
  ocean:  palette.aqua,   oceanS: palette.aqua + '15',
  rose:   palette.flame,  roseS:  palette.flame + '15',
} as const;

// ─── BEVEL — now flat cards ────────────────────────────────
export const BEVEL = {
  card: {
    backgroundColor: dark.card,
    borderWidth: 1,
    borderColor: dark.border,
    borderRadius: 14,
  },
  blueCard: {
    backgroundColor: dark.surface,
    borderWidth: 1,
    borderColor: dark.border,
    borderRadius: 14,
  },
  goldCard: {
    backgroundColor: palette.aqua + '10',
    borderWidth: 1,
    borderColor: palette.aqua + '25',
    borderRadius: 14,
  },
  shine: {
    // No shine in v7 — keep the key so old references don't crash
    position: 'absolute' as const,
    top: 0, left: 0, right: 0, height: 0,
    backgroundColor: 'transparent',
  },
  tabBar: {
    backgroundColor: dark.navBg,
    borderTopWidth: 1,
    borderTopColor: dark.border,
  },
} as const;

// ─── FONTS ─────────────────────────────────────────────────
export const F = {
  // Headings / display / scores — Audiowide
  bold:       'Audiowide_400Regular',
  black:      'Audiowide_400Regular',
  extrabold:  'Audiowide_400Regular',
  score:      'Audiowide_400Regular',
  bebas:      'Audiowide_400Regular',

  // Body / everything else — Space Grotesk
  outfit:     'SpaceGrotesk_400Regular',
  body:       'SpaceGrotesk_400Regular',
  bodyBold:   'SpaceGrotesk_700Bold',
  semibold:   'SpaceGrotesk_600SemiBold',
  barlow:     'SpaceGrotesk_400Regular',
  barlowMd:   'SpaceGrotesk_500Medium',
  barlowSb:   'SpaceGrotesk_600SemiBold',
  barlowBd:   'SpaceGrotesk_700Bold',

  // Mono / data — Space Grotesk (it has monospaced DNA)
  mono:       'SpaceGrotesk_400Regular',
  monoBold:   'SpaceGrotesk_700Bold',
  spaceMono:   'SpaceGrotesk_400Regular',
  spaceMonoBd: 'SpaceGrotesk_700Bold',
} as const;

// ─── SIZES / RADII / SPACING ──────────────────────────────
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

// ─── SHADOWS — simplified ──────────────────────────────────
export const shadow = {
  glass:    { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 12, elevation: 4 },
  card:     { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.10, shadowRadius: 8, elevation: 2 },
  goldGlow: { shadowColor: palette.aqua, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 4 },
  blueGlow: { shadowColor: palette.aqua, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.2, shadowRadius: 10, elevation: 4 },
  glow: (color: string, radius = 12, opacity = 0.3) => ({
    shadowColor: color, shadowOffset: { width: 0, height: 0 }, shadowOpacity: opacity, shadowRadius: radius, elevation: 4,
  }),
} as const;

export const textShadow = {
  hero:   { textShadowColor: 'transparent', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 0 },
  body:   { textShadowColor: 'transparent', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 0 },
  subtle: { textShadowColor: 'transparent', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 0 },
  gold:   { textShadowColor: 'transparent', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 0 },
  blue:   { textShadowColor: 'transparent', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 0 },
} as const;

export const POS: Record<string, { color: string; bg: string }> = {
  QB:  { color: C.qb,    bg: C.qbBg   },
  RB:  { color: C.rb,    bg: C.rbBg   },
  WR:  { color: C.wr,    bg: C.wrBg   },
  TE:  { color: C.te,    bg: C.teBg   },
  K:   { color: C.k,     bg: C.kBg    },
  FLX: { color: C.rb,    bg: C.rbBg   },
  BN:  { color: dark.textMuted, bg: dark.textMuted + '10' },
  DEF: { color: C.mauve, bg: C.mauveS },
};

// ─── OLD Colors export for any file still importing it ─────
export const Colors = {
  y:          palette.aqua,
  yHot:       palette.chartreuse,
  yGlow:      palette.aqua + '15',
  yGlowHi:    palette.aqua + '28',
  yGlowXl:    palette.aqua + '50',
  void:       dark.bg,
  background: dark.bg,
  surface:    dark.surface,
  surfaceHi:  dark.card,
  border:     dark.border,
  borderHi:   palette.aqua + '30',
  white:      dark.text,
  offW:       dark.textSub,
  dim:        dark.textMuted,
  dimLo:      dark.textMuted + '40',
  ghost:      'rgba(255,255,255,0.05)',
  ghost2:     'rgba(255,255,255,0.08)',
  red:        palette.flame,
  redG:       palette.flame + '18',
  green:      palette.green,
  greenG:     palette.green + '18',
  amber:      palette.amber,
  amberG:     palette.amber + '18',
  purple:     '#a78bfa',
  cyan:       palette.aqua,
  pink:       palette.flame,
  slate:      dark.textMuted,
};

export const PosColors: Record<string, string> = {
  QB: '#a78bfa',
  RB: palette.green,
  WR: palette.aqua,
  TE: palette.amber,
  K:  palette.flame,
  DST: dark.textMuted,
};

export const StatusColors: Record<string, string | null> = {
  Active:       null,
  Questionable: palette.amber,
  Doubtful:     palette.flame,
  Out:          palette.flame,
};