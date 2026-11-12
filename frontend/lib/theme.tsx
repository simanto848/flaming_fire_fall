"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

export type ThemeName = "light" | "calm";

export const THEME_STORAGE_KEY = "shunnoshikha-theme";

const VALID: ThemeName[] = ["light", "calm"];

type ThemeContextValue = {
  theme: ThemeName;
  setTheme: (t: ThemeName) => void;
};

const ThemeContext = createContext<ThemeContextValue>({ theme: "calm", setTheme: () => {} });

/**
 * The active theme lives on <html data-theme="…"> and is set before first
 * paint by an inline script in app/layout.tsx (localStorage-backed), so
 * there is no flash of the wrong theme.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>("calm");

  useEffect(() => {
    const attr = document.documentElement.getAttribute("data-theme") as ThemeName | null;
    if (attr && VALID.includes(attr)) setThemeState(attr);
  }, []);

  const setTheme = useCallback(
    (next: ThemeName) => {
      if (!VALID.includes(next) || next === theme) return;
      const root = document.documentElement;
      root.classList.add("theme-anim");
      root.setAttribute("data-theme", next);
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        /* storage unavailable — theme simply won't persist */
      }
      setThemeState(next);
      window.setTimeout(() => root.classList.remove("theme-anim"), 420);
    },
    [theme]
  );

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
