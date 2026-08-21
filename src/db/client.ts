import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import * as authSchema from './auth-schema';

const sqlite = new Database(process.env.DATABASE_PATH ?? './data/fafnir.db');
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema: { ...schema, ...authSchema } });
