'use client';

import { useEffect } from 'react';

export type ThemeMode = 'light' | 'dark' | 'bright';

const STORAGE_KEY = 'fos-theme';
const THEMES: ThemeMode[] = ['light', 'dark', 'bright'];

export function applyTheme(theme: ThemeMode) {
  const root = document.documentElement;
  root.classList.remove('dark', 'theme-bright');

  if (theme === 'dark') root.classList.add('dark');
  if (theme === 'bright') root.classList.add('theme-bright');

  root.dataset.theme = theme;
  localStorage.setItem(STORAGE_KEY, theme);
}

export function getStoredTheme(): ThemeMode {
  const stored = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
  return stored && THEMES.includes(stored) ? stored : 'light';
}

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    applyTheme(getStoredTheme());
  }, []);

  return children;
}
