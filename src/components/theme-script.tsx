import { THEME_INIT_SCRIPT } from '@/lib/theme';

/**
 * Blocking inline script that sets documentElement's data-theme attribute
 * before first paint, so there's no flash of the wrong theme. Must be
 * rendered as early as possible in <body> (before {children}); the <html>
 * tag needs suppressHydrationWarning since this script mutates it outside
 * of React's render. See node_modules/next/dist/docs/01-app/02-guides/
 * preventing-flash-before-hydration.md.
 */
export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />;
}
