// app/constants/theme.tsx
//
// Runtime theming. The v7 token file has carried a complete `light`
// palette since day one; the Settings "Dark Mode" switch was decorative.
// This wires them together: ThemeProvider persists the choice, useTheme()
// hands components the active token set, and the light-only accent
// shades come from the approved light-mode mockups (2026-08-27) — raw
// palette hues (#1be7ff aqua etc.) stay for FILLS, the darkened
// derivatives are for TEXT on light grounds where the electric versions
// fail contrast.
//
// Migration contract for screens: replace `dark.X` and hardcoded dark
// hexes with `t.X` from useTheme(); StyleSheet.create blocks that use
// theme values become makeStyles(t) + useMemo. Default is dark — light
// is opt-in, so an unmigrated screen just stays dark and nothing breaks.

import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { dark, light, palette } from './tokens';

const STORAGE_KEY = 'theme_mode_v1';

// Accent roles that differ per ground. Dark keeps the electric palette;
// light uses AA-contrast derivatives (mockup decisions, see roadmap).
const darkAccents = {
  accentText:     palette.aqua,
  successText:    palette.green,
  warnText:       palette.amber,
  dangerText:     palette.flame,
  chartreuseText: palette.chartreuse,
  aquaTint:       palette.aqua + '18',
  greenTint:      palette.green + '18',
  amberTint:      palette.amber + '18',
  flameTint:      palette.flame + '15',
} as const;

const lightAccents = {
  accentText:     '#0a97b0',
  successText:    '#157029',
  warnText:       '#8a6100',
  dangerText:     '#c23a06',
  chartreuseText: '#7a8c00',
  aquaTint:       '#d7f8fd',
  greenTint:      '#dff8e3',
  amberTint:      '#fff1cc',
  flameTint:      '#ffe4d9',
} as const;

export const darkTheme = { ...dark, ...darkAccents, isDark: true as const };
export const lightTheme = { ...light, ...lightAccents, isDark: false as const };

export type ThemeTokens = typeof darkTheme | typeof lightTheme;

// Data-driven colors (news-source tags, platform brands, position chips)
// arrive as raw palette hexes from services at runtime, so no static
// migration can catch them. On a dark ground the electric values are
// correct; on white they measure ~1.5:1 and are effectively invisible.
// Use this for such a color when it is TEXT — fills keep the electric
// value in both themes.
const LIGHT_TEXT_EQUIV: Record<string, string> = {
  [palette.aqua]:       lightAccents.accentText,
  [palette.green]:      lightAccents.successText,
  [palette.chartreuse]: lightAccents.chartreuseText,
  [palette.amber]:      lightAccents.warnText,
  [palette.flame]:      lightAccents.dangerText,
};

// WCAG relative luminance for a #rrggbb string.
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  if (h.length !== 6) return 1;
  const ch = [0, 2, 4].map(i => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

const contrastOnWhite = (hex: string) => 1.05 / (luminance(hex) + 0.05);

// Scale a color toward black until it clears the contrast floor. Keeps hue
// and relative channel balance, so a brand color stays recognizable.
function darkenToContrast(hex: string, target = 3.2): string {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  let [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  for (let i = 0; i < 24 && contrastOnWhite(`#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`) < target; i++) {
    r = Math.round(r * 0.9); g = Math.round(g * 0.9); b = Math.round(b * 0.9);
  }
  return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

// minContrast is measured against WHITE. The default (3) suits text on the
// page or a card. Text sitting on a TINT of its own color needs more —
// pass ~4.5, since the tint lifts the effective background well above the
// card ground (a 15%-alpha aqua tint left #0a97b0 at 2.29:1).
export function readableText(
  t: ThemeTokens,
  color: string | undefined,
  minContrast = 3,
): string | undefined {
  if (!color || t.isDark) return color;
  const known = LIGHT_TEXT_EQUIV[color.toLowerCase()];
  const base = known ?? color;
  if (!base.startsWith('#')) return base;        // rgba()/named — leave alone
  return contrastOnWhite(base) >= minContrast ? base : darkenToContrast(base, minContrast);
}

type ThemeCtx = {
  t: ThemeTokens;
  isDark: boolean;
  setMode: (mode: 'dark' | 'light') => void;
};

const Ctx = createContext<ThemeCtx>({ t: darkTheme, isDark: true, setMode: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then(v => { if (v === 'light') setIsDark(false); })
      .catch(() => {});
  }, []);

  const value = useMemo<ThemeCtx>(() => ({
    t: isDark ? darkTheme : lightTheme,
    isDark,
    setMode: (mode) => {
      setIsDark(mode === 'dark');
      AsyncStorage.setItem(STORAGE_KEY, mode).catch(() => {});
    },
  }), [isDark]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// Safe outside a provider (returns dark) so components can migrate
// incrementally and tests/tools that render screens bare don't crash.
export function useTheme(): ThemeCtx {
  return useContext(Ctx);
}
