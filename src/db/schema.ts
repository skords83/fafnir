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
}, (t) => ({
  uniqueName: uniqueIndex('uniq_category_name').on(t.name),
}));

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
  categoryOverrideId: integer('category_override_id').references(() => categories.id),
  importBatchId: integer('import_batch_id').references(() => importBatches.id),
  externalHash: text('external_hash').notNull(),
  isManualEntry: integer('is_manual_entry', { mode: 'boolean' }).notNull().default(false),
}, (t) => ({
  uniqueHash: uniqueIndex('uniq_account_hash').on(t.accountId, t.externalHash),
  byDate: index('idx_booking_date').on(t.bookingDate),
}));

export const merchantCategoryRules = sqliteTable('merchant_category_rules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  merchantKey: text('merchant_key').notNull(),
  categoryId: integer('category_id').notNull().references(() => categories.id),
}, (t) => ({
  uniqueMerchantKey: uniqueIndex('uniq_merchant_key').on(t.merchantKey),
}));

export const balanceSnapshots = sqliteTable('balance_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  accountId: integer('account_id').notNull().references(() => accounts.id),
  snapshotDate: text('snapshot_date').notNull(), // aus der datierten "Kontostand"-Zeile
  balanceCents: integer('balance_cents').notNull(),
  source: text('source').notNull(), // 'csv-import' | 'manual'
});
