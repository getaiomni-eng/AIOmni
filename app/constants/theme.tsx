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
