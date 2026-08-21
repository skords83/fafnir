import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { nextCookies } from 'better-auth/next-js';
import { db } from './db/client';
import * as authSchema from './db/auth-schema';

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
