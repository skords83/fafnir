import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { nextCookies } from 'better-auth/next-js';
import { PHASE_PRODUCTION_BUILD } from 'next/constants';
import { db } from './db/client';
import * as authSchema from './db/auth-schema';

// `next build` also runs with NODE_ENV=production (it sets NEXT_PHASE to
// PHASE_PRODUCTION_BUILD while doing so, unlike an actual `next start`), and
// this module gets evaluated during build-time page-data collection. Only
// fail fast at real runtime startup, not at build time when no runtime
// secret is expected to be present yet.
if (
  process.env.NODE_ENV === 'production' &&
  process.env.NEXT_PHASE !== PHASE_PRODUCTION_BUILD &&
  !process.env.BETTER_AUTH_SECRET
) {
  throw new Error(
    'BETTER_AUTH_SECRET is not set. Better Auth silently falls back to a well-known ' +
      'default secret when this is missing, which makes session tokens forgeable. ' +
      'Generate one with `openssl rand -base64 32` and set it in the environment.'
  );
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'sqlite',
    schema: authSchema,
  }),
  emailAndPassword: {
    enabled: true,
  },
  plugins: [nextCookies()],
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
  secret: process.env.BETTER_AUTH_SECRET,
});
