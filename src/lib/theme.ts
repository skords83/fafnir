export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'fafnir-theme';
export const THEME_CHANGE_EVENT = 'fafnir:theme-change';

function isTheme(value: string | null): value is Theme {
  return value === 'light' || value === 'dark';
}

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** The user's stored override, if they've ever toggled the theme manually. */
export function getStoredTheme(): Theme | null {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return isTheme(stored) ? stored : null;
}

/** Stored override if present, otherwise whatever the OS currently prefers. */
export function getEffectiveTheme(): Theme {
  return getStoredTheme() ?? (systemPrefersDark() ? 'dark' : 'light');
}

/** Applies a theme to the document without touching localStorage. */
export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
}

/**
 * Persists an explicit user choice, applies it, and notifies same-tab
 * listeners (e.g. chart components reading the effective theme) — the
 * browser's `storage` event only fires in *other* tabs, not this one.
 */
export function setStoredTheme(theme: Theme): void {
  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  applyTheme(theme);
  document.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT));
}

/**
 * Source string for the blocking inline script that sets data-theme before
 * first paint (see ThemeScript). Kept in sync with getEffectiveTheme()
 * above by hand, since the script runs before any of our JS is parsed.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var s=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY
)});var t=s==='light'||s==='dark'?s:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;
