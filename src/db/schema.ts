import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

export const accounts = sqliteTable('accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  iban: text('iban'),
  currency: text('currency').notNull().default('EUR'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const categories = sqliteTable('categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Drizzle self-referencing FK requires this to break circular type inference
  parentId: integer('parent_id').references((): any => categories.id),
});

export const importBatches = sqliteTable('import_batches', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id').notNull().references(() => accounts.id),
  filename: text('filename').notNull(),
  importedAt: integer('imported_at', { mode: 'timestamp' }).notNull(),
  newCount: integer('new_count').notNull().default(0),
  duplicateCount: integer('duplicate_count').notNull().default(0),
});

export const transactions = sqliteTable('transactions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id').notNull().references(() => accounts.id),
  bookingDate: text('booking_date').notNull(), // ISO yyyy-mm-dd, aus "Buchungstag"
  valueDate: text('value_date'), // aus "Wert", nur informativ
  amountCents: integer('amount_cents').notNull(),
  counterparty: text('counterparty'), // Begünstigter/Auftraggeber, ggf. Abweichender Empfänger
  purpose: text('purpose'),
  categoryId: integer('category_id').references(() => categories.id),
  categoryIsManual: integer('category_is_manual', { mode: 'boolean' }).notNull().default(false),
  importBatchId: integer('import_batch_id').references(() => importBatches.id),
  externalHash: text('external_hash').notNull(),
  isManualEntry: integer('is_manual_entry', { mode: 'boolean' }).notNull().default(false),
}, (t) => ({
  uniqueHash: uniqueIndex('uniq_account_hash').on(t.accountId, t.externalHash),
  byDate: index('idx_booking_date').on(t.bookingDate),
  byCategory: index('idx_category').on(t.categoryId),
}));

export const categorizationRules = sqliteTable('categorization_rules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  categoryId: integer('category_id').notNull().references(() => categories.id),
  matchField: text('match_field').notNull(), // 'counterparty' | 'purpose'
  matchType: text('match_type').notNull(), // 'contains' | 'regex' | 'exact'
  matchValue: text('match_value').notNull(),
  priority: integer('priority').notNull().default(0),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
});

export const balanceSnapshots = sqliteTable('balance_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id').notNull().references(() => accounts.id),
  snapshotDate: text('snapshot_date').notNull(), // aus der datierten "Kontostand"-Zeile
  balanceCents: integer('balance_cents').notNull(),
  source: text('source').notNull(), // 'csv-import' | 'manual'
});
