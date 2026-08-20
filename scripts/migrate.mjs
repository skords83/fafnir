// Applies pending Drizzle migrations against the SQLite file at DATABASE_PATH.
// Runs at container boot (see Dockerfile CMD) — deliberately uses only
// runtime dependencies (drizzle-orm, better-sqlite3), not the drizzle-kit
// CLI, which is a devDependency and isn't shipped in the production image.

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

const dbPath = process.env.DATABASE_PATH ?? './data/fafnir.db';

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

const db = drizzle(sqlite);
migrate(db, { migrationsFolder: './drizzle' });

console.log(`[migrate] applied migrations to ${dbPath}`);
sqlite.close();
