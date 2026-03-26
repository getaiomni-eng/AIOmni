// ─────────────────────────────────────────────────
//  AIOmni Design Tokens v2
//  Sage-Slate × Frosted Glass × Gold
// ─────────────────────────────────────────────────

export const C = {
  // ── Backgrounds ──────────────────────────────
  bgTop:       '#8fa8a8',   // page gradient top
  bgBot:       '#4e6868',   // page gradient bottom
  phone:       '#5c7878',   // phone/screen bg
  phone2:      '#4e6868',   // darker phone bg

  // ── Glass surfaces ────────────────────────────
  glass:       'rgba(255,255,255,0.14)',
  glassBorder: 'rgba(255,255,255,0.22)',
  glassShine:  'rgba(255,255,255,0.30)',
  surface:     'rgba(255,255,255,0.12)',
  surfBorder:  'rgba(255,255,255,0.15)',
  surfShine:   'rgba(255,255,255,0.20)',

  // ── Type ──────────────────────────────────────
  ink:         '#ffffff',
  ink2:        '#e8f0ec',
  dim:         'rgba(255,255,255,0.80)',
  dim2:        'rgba(255,255,255,0.65)',

  // ── Gold (primary accent) ─────────────────────
  gold:        '#b8891a',
  goldS:       'rgba(184,137,26,0.20)',
  goldG:       'rgba(184,137,26,0.45)',
  goldBorder:  'rgba(184,137,26,0.35)',

  // ── Sage (wins / positive) ────────────────────
  sage:        '#2d7a5e',
  sageS:       'rgba(45,122,94,0.20)',
  sageG:       'rgba(45,122,94,0.40)',
  sageBorder:  'rgba(45,122,94,0.30)',

  // ── Mint (secondary) ──────────────────────────
  mint:        '#7ec8b8',
  mintS:       'rgba(126,200,184,0.18)',

  // ── Position pills ────────────────────────────
  qb:          '#b8a8e8',   qbBg: 'rgba(184,168,232,0.20)',
  rb:          '#2d7a5e',   rbBg: 'rgba(130,196,148,0.18)',
  wr:          '#7ec8e8',   wrBg: 'rgba(126,200,232,0.18)',
  te:          '#e8b078',   teBg: 'rgba(232,176,120,0.18)',
  k:           'rgba(255,255,255,0.55)', kBg: 'rgba(255,255,255,0.10)',

  // ── Semantic ──────────────────────────────────
  amber:       '#e09050',   amberS: 'rgba(224,144,80,0.18)',
  mauve:       '#a090d0',   mauveS: 'rgba(160,144,208,0.18)',
  ocean:       '#5898c8',   oceanS: 'rgba(88,152,200,0.18)',
  rose:        '#7a1f2e',   roseS:  'rgba(122,31,46,0.25)',
} as const;

export const F = {
  outfit:    'Outfit',
  bold:      'Outfit-Bold',
  semibold:  'Outfit-SemiBold',
  extrabold: 'Outfit-ExtraBold',
  black:     'Outfit-Black',
  mono:      'DMMono-Regular',
  monoBold:  'DMMono-Medium',
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

// Shadow helpers
export const shadow = {
  glass: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 6,
  },
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.10,
    shadowRadius: 12,
    elevation: 3,
  },
  glow: (color: string, radius = 14, opacity = 0.55) => ({
    shadowColor: color,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: opacity,
    shadowRadius: radius,
    elevation: 8,
  }),
} as const;

// Position config lookup
export const POS: Record<string, { color: string; bg: string }> = {
  QB:  { color: C.qb,   bg: C.qbBg  },
  RB:  { color: C.rb,   bg: C.rbBg  },
  WR:  { color: C.wr,   bg: C.wrBg  },
  TE:  { color: C.te,   bg: C.teBg  },
  K:   { color: C.k,    bg: C.kBg   },
  FLX: { color: C.rb,   bg: C.rbBg  },
  BN:  { color: C.dim2, bg: 'rgba(255,255,255,0.07)' },
  DEF: { color: C.mauve,bg: C.mauveS },
};
