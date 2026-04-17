import React, { createContext, useContext, useEffect, useState } from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { dark, light } from "./tokens";

type Mode = "auto" | "dark" | "light";
export type Theme = {
  bg: string;
  surface: string;
  card: string;
  text: string;
  textSub: string;
  textMuted: string;
  border: string;
  borderLight: string;
  navBg: string;
  inputBg: string;
};

const ThemeContext = createContext<{
  theme: Theme;
  isDark: boolean;
  mode: Mode;
  setMode: (m: Mode) => void;
}>({ theme: dark, isDark: true, mode: "auto", setMode: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<Mode>("auto");

  useEffect(() => {
    AsyncStorage.getItem("theme_mode").then(v => {
      if (v === "dark" || v === "light" || v === "auto") setModeState(v);
    });
  }, []);

  const setMode = (m: Mode) => {
    setModeState(m);
    AsyncStorage.setItem("theme_mode", m);
  };

  const isDark = mode === "auto" ? systemScheme !== "light" : mode === "dark";
  const theme = isDark ? dark : light;

  return (
    <ThemeContext.Provider value={{ theme, isDark, mode, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
