'use client';

import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { applyTheme, getStoredTheme, ThemeMode } from './ThemeProvider';

const modes: Array<{ value: ThemeMode; label: string; icon: typeof Sun }> = [
  { value: 'light', label: 'فاتح', icon: Sun },
  { value: 'dark', label: 'داكن', icon: Moon },
];

export default function ThemeSwitcher() {
  const [theme, setTheme] = useState<ThemeMode>('light');

  useEffect(() => {
    setTheme(getStoredTheme());
  }, []);

  function selectTheme(value: ThemeMode) {
    setTheme(value);
    applyTheme(value);
  }

  return (
    <div className="grid grid-cols-2 gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1 dark:border-blue-900/60 dark:bg-slate-950">
      {modes.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          onClick={() => selectTheme(value)}
          className={`grid h-9 place-items-center rounded-md text-xs font-bold ${
            theme === value
              ? 'bg-white text-indigo-700 shadow-sm dark:bg-slate-800 dark:text-indigo-300'
              : 'text-slate-500 hover:bg-white/70 dark:text-slate-400 dark:hover:bg-slate-800'
          }`}
          title={label}
          aria-label={label}
        >
          <Icon size={16} />
        </button>
      ))}
    </div>
  );
}
