export const Colors = {
  // AIOmni brand
  y:          '#D4FF00',
  yHot:       '#eeff55',
  yGlow:      'rgba(212,255,0,0.12)',
  yGlowHi:    'rgba(212,255,0,0.28)',
  yGlowXl:    'rgba(212,255,0,0.50)',

  // Backgrounds
  void:       '#03030a',
  background: '#0a0a0a',
  surface:    'rgba(8,8,22,0.92)',
  surfaceHi:  'rgba(12,12,28,0.97)',

  // Borders
  border:     'rgba(212,255,0,0.10)',
  borderHi:   'rgba(212,255,0,0.30)',

  // Text
  white:      '#ffffff',
  offW:       '#c0d0e0',
  dim:        'rgba(255,255,255,0.25)',
  dimLo:      'rgba(255,255,255,0.12)',

  // Surfaces
  ghost:      'rgba(255,255,255,0.05)',
  ghost2:     'rgba(255,255,255,0.08)',

  // Signal colors
  red:        '#ff2255',
  redG:       'rgba(255,34,85,0.15)',
  green:      '#00ffaa',
  greenG:     'rgba(0,255,170,0.13)',
  amber:      '#ffaa00',
  amberG:     'rgba(255,170,0,0.13)',

  // Position accents
  purple:     '#cc77ff',
  cyan:       '#33ddff',
  pink:       '#ff88bb',
  slate:      '#aabbcc',
};

export const PosColors: Record<string, string> = {
  QB: '#cc77ff',
  RB: '#00ffaa',
  WR: '#33ddff',
  TE: '#D4FF00',
  K:  '#ff88bb',
  DST:'#aabbcc',
};

export const StatusColors: Record<string, string | null> = {
  Active:       null,
  Questionable: '#ffaa00',
  Doubtful:     '#ff2255',
  Out:          '#ff2255',
};