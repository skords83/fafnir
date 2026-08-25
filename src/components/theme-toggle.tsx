'use client';

import { useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { THEME_CHANGE_EVENT, getEffectiveTheme, setStoredTheme, type Theme } from '@/lib/theme';

function subscribe(callback: () => void) {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  query.addEventListener('change', callback);
  document.addEventListener(THEME_CHANGE_EVENT, callback);
  return () => {
    query.removeEventListener('change', callback);
    document.removeEventListener(THEME_CHANGE_EVENT, callback);
  };
}

// Server-rendered markup has no data-theme yet (ThemeScript sets it before
// hydration but after the initial HTML is sent), so this can't match the
// real client value — useSyncExternalStore is built for exactly that: it
// renders this snapshot during hydration, then immediately re-renders with
// getEffectiveTheme()'s real value, without a mismatch warning.
function getServerSnapshot(): Theme {
  return 'light';
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getEffectiveTheme, getServerSnapshot);
  const nextTheme = theme === 'dark' ? 'light' : 'dark';

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={nextTheme === 'light' ? 'Zu hellem Design wechseln' : 'Zu dunklem Design wechseln'}
      onClick={() => setStoredTheme(nextTheme)}
    >
      {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}
