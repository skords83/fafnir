# Merchant-Based Expense Categorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every transaction shows a category — resolved automatically from a merchant rule or overridden per-transaction — without any AI/ML or keyword-based auto-suggestion.

**Architecture:** Replace the unused keyword-matching categorization scaffolding (`categorizationRules`, `transactions.categoryId/categoryIsManual`, `categories.parentId`) with a merchant-identity model: a merchant's identity is the same normalized title already shown in the UI (`deriveTransactionDisplay(tx).title`), a `merchant_category_rules` table maps that title to a category, and `transactions.categoryOverrideId` overrides the rule for one row. Resolution (`override → rule → none`) is a pure in-memory function; every page that shows categories bulk-loads `categories` + `merchant_category_rules` once and resolves in a loop — no per-row queries. Mutations follow the codebase's existing `runner`/`actions` split (see `src/app/(app)/import/import-runner.ts` + `actions.ts`): a plain, directly-testable core module holds the DB writes, a thin `'use server'` file adds the session check and `revalidatePath`.

**Tech Stack:** Next.js (App Router, Server Actions), Drizzle ORM (SQLite via better-sqlite3), Vitest (`environment: 'node'`, no jsdom/RTL — this codebase has no component-rendering tests; see Global Constraints), Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-22-merchant-based-categorization-design.md`

## Global Constraints

- UI copy is German throughout, matching the existing app (`Kategorie wählen`, `Unkategorisiert`, etc.). Code comments and commit messages are English, matching the existing codebase.
- No automatic category suggestions from keywords, amounts, or dates — only explicit user-set merchant rules and per-transaction overrides.
- No new UI primitive/component library — native `<select>`/`<form>`, the existing `Button` only where a component already uses it.
- Single-tenant: `categories` and `merchant_category_rules` are global tables with no `userId` column, consistent with the rest of the schema (`requireSession()` is a login gate only, per `src/lib/session.ts`).
- The expand/collapse state of a transaction row's category panel MUST be `useState`, never a native `<details open>` — a Server Action triggers `revalidatePath`, which re-renders the Server Component tree; a DOM-native `<details>` would risk collapsing on that re-render.
- `/accounts/[id]` and `/categorize` each bulk-load `categories` and `merchant_category_rules` **exactly once per request** and resolve every transaction's category in-memory via `resolveTransactionCategory()` — never a per-row query. (This is on top of whatever queries those pages already had before this feature, e.g. the existing pagination `count()` on `/accounts/[id]` — the "no N+1" guarantee is about categorization data specifically.)
- `CategoryTarget` (`{type:'category'}` | `{type:'newCategory'}` | `{type:'clear'}`) is the single mutation vocabulary for both `setMerchantRule` and `setTransactionOverride` — one target type, not separate set/clear signatures.
- No component-rendering tests: this codebase's Vitest config is `environment: 'node'` with no jsdom/testing-library installed, and no existing component (`account-card.tsx`, `transaction-list.tsx`) has a test file. New client components follow that precedent; only pure `lib/` functions and the DB-backed mutation core get tests.

---

## Task 1: Schema — additive migration

Adds the new categorization model alongside the old one, so this migration is pure addition (no drops, no renames) and `drizzle-kit generate` needs no interactive rename confirmation.

**Files:**
- Modify: `src/db/schema.ts`
- Generated: `drizzle/000X_*.sql` + `drizzle/meta/000X_snapshot.json` (via `pnpm db:generate`)

**Interfaces:**
- Produces: `categories` table gains a unique index on `name`. New `merchantCategoryRules` table (`id`, `merchantKey` unique, `categoryId` FK). `transactions` gains nullable `categoryOverrideId` FK. The old `categoryId`/`categoryIsManual`/`parentId`/`categorizationRules` stay untouched until Task 2.

- [ ] **Step 1: Edit `src/db/schema.ts`**

Add a unique index to `categories`, add the `merchantCategoryRules` table, and add `categoryOverrideId` to `transactions`. The full resulting file:

```ts
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
  categoryId: integer('category_id').references(() => categories.id),
  categoryIsManual: integer('category_is_manual', { mode: 'boolean' }).notNull().default(false),
  categoryOverrideId: integer('category_override_id').references(() => categories.id),
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
```

- [ ] **Step 2: Generate the migration**

```bash
printf 'n\n' | pnpm db:generate --name=add_merchant_category_rules
```

(The `printf 'n\n' |` is a safety net in case drizzle-kit's interactive prompt ever fires; it shouldn't here since this diff is pure addition.) Confirm a new `drizzle/000X_add_merchant_category_rules.sql` file was created and that it contains only `CREATE TABLE`/`CREATE UNIQUE INDEX`/`ALTER TABLE ... ADD COLUMN` statements — no `DROP`.

- [ ] **Step 3: Apply the migration to the real dev database and verify no data loss**

```bash
pnpm db:migrate:runtime
sqlite3 data/fafnir.db "select count(*) from transactions;"
```

Expected: `102` (unchanged from before the migration).

- [ ] **Step 4: Run the full check (typecheck + build + existing tests)**

```bash
pnpm test
pnpm build
```

Expected: all existing tests still pass, build succeeds (the schema still has every field the rest of the app currently references).

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "Add merchant_category_rules table and transactions.category_override_id"
```

---

## Task 2: Schema — remove legacy categorization scaffolding

Drops the unused keyword-matching model. Pure removal (nothing added in this step), so this generate pass also needs no interactive rename confirmation.

**Files:**
- Modify: `src/db/schema.ts`
- Generated: `drizzle/000X_*.sql` + `drizzle/meta/000X_snapshot.json`

**Interfaces:**
- Produces: final `categories` shape (`id`, `name`), final `transactions` shape (drops `categoryId`, `categoryIsManual`, keeps `categoryOverrideId`), `categorizationRules` table gone. This is the schema every later task builds against.

- [ ] **Step 1: Edit `src/db/schema.ts`**

Remove `categories.parentId` (and its eslint-disable comment), remove `transactions.categoryId` + `categoryIsManual` + the `byCategory` index, remove the `categorizationRules` table export entirely. The full resulting file:

```ts
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
```

- [ ] **Step 2: Generate the migration**

```bash
printf 'n\n' | pnpm db:generate --name=drop_legacy_categorization_scaffolding
```

Confirm the new SQL file contains `DROP TABLE categorization_rules` and drops of `category_id`, `category_is_manual`, `parent_id` — and that drizzle-kit did **not** ask an interactive "was X renamed to Y" question (if it did anyway, answer `n` for every column — they are unrelated fields, not renames).

- [ ] **Step 3: Apply the migration to the real dev database and verify no data loss**

```bash
pnpm db:migrate:runtime
sqlite3 data/fafnir.db "select count(*) from transactions;"
sqlite3 data/fafnir.db ".schema transactions"
```

Expected: count is still `102`; the schema dump shows `category_override_id` and no `category_id`/`category_is_manual`.

- [ ] **Step 4: Fix any compile errors from the removed fields**

```bash
pnpm build
```

At this point in the plan nothing else references `categoryId`/`categoryIsManual`/`parentId`/`categorizationRules` (confirmed by grep during design), so this should succeed unchanged. If it doesn't, the error output names the file — fix the reference before proceeding.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "Drop unused keyword-based categorization scaffolding"
```

---

## Task 3: Merchant identity — `getMerchantKey()`

**Files:**
- Create: `src/lib/merchant-key.ts`
- Test: `src/lib/merchant-key.test.ts`

**Interfaces:**
- Consumes: `deriveTransactionDisplay(tx: {counterparty: string|null; purpose: string|null}): {title: string; context: string|null}` from `src/lib/transaction-display.ts` (existing).
- Produces: `getMerchantKey(tx: {counterparty: string|null; purpose: string|null}): string` — used by Task 4 (`resolveTransactionCategory`) and every page that groups/labels by merchant.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/merchant-key.test.ts
import { describe, expect, test } from 'vitest';
import { getMerchantKey } from './merchant-key';

describe('getMerchantKey', () => {
  test('uses the normalized counterparty when present', () => {
    const key = getMerchantKey({
      counterparty: 'REWE Markt GmbH',
      purpose: 'REWE SAGT DANKE. 41403508/Tonndorfer/Hamburg Tonndorf /DE 18-08-2026T18:43:20 Folgenr. 06 Verfalld. 1228',
    });
    expect(key).toBe('Rewe Markt GmbH');
  });

  test('recovers the merchant name from a card-terminal purpose when counterparty is blank', () => {
    const key = getMerchantKey({
      counterparty: null,
      purpose: 'REWE SAGT DANKE/Musterstr. 1/Musterstadt/DE 18-08-2026T18:43:20 Folgenr. 06 Verfalld. 1228',
    });
    expect(key).toBe('Rewe Sagt Danke');
  });

  test('is stable across different transactions from the same merchant', () => {
    const a = getMerchantKey({
      counterparty: 'AMAZON PAYMENTS EUROPE S.C.A.',
      purpose: '305-5775665-2150736 AMZN Mktp DE 1F69DDLVBGYT9H0N',
    });
    const b = getMerchantKey({
      counterparty: 'AMAZON PAYMENTS EUROPE S.C.A.',
      purpose: '305-5198200-2372354 AMZN Mktp DE 4L895LCURQT95Y3O',
    });
    expect(a).toBe(b);
    expect(a).toBe('Amazon Payments Europe S.C.A.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test merchant-key -- --run`
Expected: FAIL — `Cannot find module './merchant-key'`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/merchant-key.ts
import { deriveTransactionDisplay } from './transaction-display';

/**
 * The merchant identity a categorization rule attaches to: exactly the
 * normalized title the user already sees on the transaction row (the
 * counterparty, or a name recovered from a card-terminal purpose). No
 * separate normalization path — categorizing "by merchant" and displaying
 * "by merchant" use the same derived text.
 */
export function getMerchantKey(tx: { counterparty: string | null; purpose: string | null }): string {
  return deriveTransactionDisplay(tx).title;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test merchant-key -- --run`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/merchant-key.ts src/lib/merchant-key.test.ts
git commit -m "Add getMerchantKey() as the shared merchant identity for categorization"
```

---

## Task 4: Category resolution — `resolveTransactionCategory()` + bulk-load helper

**Files:**
- Create: `src/lib/category-resolution.ts`
- Test: `src/lib/category-resolution.test.ts`

**Interfaces:**
- Consumes: `getMerchantKey()` from Task 3.
- Produces:
  - `interface CategoryRef { id: number; name: string }`
  - `interface ResolvedCategory { categoryId: number | null; categoryName: string | null; source: 'override' | 'rule' | 'none' }`
  - `resolveTransactionCategory(tx: {categoryOverrideId: number|null; counterparty: string|null; purpose: string|null}, rulesByMerchantKey: Map<string, number>, categoriesById: Map<number, CategoryRef>): ResolvedCategory`
  - `buildCategoryLookups(categoryRows: CategoryRef[], ruleRows: {merchantKey: string; categoryId: number}[]): {categoriesById: Map<number, CategoryRef>; rulesByMerchantKey: Map<string, number>}`

  Used by Task 9 (`/accounts/[id]`), Task 10 (`/categorize`), and Task 11 (dashboard badge).

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/category-resolution.test.ts
import { describe, expect, test } from 'vitest';
import { buildCategoryLookups, resolveTransactionCategory } from './category-resolution';

const categories = [
  { id: 1, name: 'Lebensmittel' },
  { id: 2, name: 'Sonstiges' },
];
const rules = [{ merchantKey: 'Rewe Markt GmbH', categoryId: 1 }];

describe('resolveTransactionCategory', () => {
  test('an override wins over a merchant rule', () => {
    const { categoriesById, rulesByMerchantKey } = buildCategoryLookups(categories, rules);
    const tx = { categoryOverrideId: 2, counterparty: 'REWE Markt GmbH', purpose: null };

    expect(resolveTransactionCategory(tx, rulesByMerchantKey, categoriesById)).toEqual({
      categoryId: 2,
      categoryName: 'Sonstiges',
      source: 'override',
    });
  });

  test('falls back to the merchant rule when there is no override', () => {
    const { categoriesById, rulesByMerchantKey } = buildCategoryLookups(categories, rules);
    const tx = { categoryOverrideId: null, counterparty: 'REWE Markt GmbH', purpose: null };

    expect(resolveTransactionCategory(tx, rulesByMerchantKey, categoriesById)).toEqual({
      categoryId: 1,
      categoryName: 'Lebensmittel',
      source: 'rule',
    });
  });

  test('resolves to none when neither an override nor a rule applies', () => {
    const { categoriesById, rulesByMerchantKey } = buildCategoryLookups(categories, rules);
    const tx = { categoryOverrideId: null, counterparty: 'Unbekannter Laden', purpose: null };

    expect(resolveTransactionCategory(tx, rulesByMerchantKey, categoriesById)).toEqual({
      categoryId: null,
      categoryName: null,
      source: 'none',
    });
  });

  test('derives the merchant key from a card-terminal purpose to match the rule when counterparty is blank', () => {
    const rulesForPurpose = [{ merchantKey: 'Rewe Sagt Danke', categoryId: 1 }];
    const { categoriesById, rulesByMerchantKey } = buildCategoryLookups(categories, rulesForPurpose);
    const tx = {
      categoryOverrideId: null,
      counterparty: null,
      purpose: 'REWE SAGT DANKE/Musterstr. 1/Musterstadt/DE 18-08-2026T18:43:20 Folgenr. 06 Verfalld. 1228',
    };

    expect(resolveTransactionCategory(tx, rulesByMerchantKey, categoriesById)).toEqual({
      categoryId: 1,
      categoryName: 'Lebensmittel',
      source: 'rule',
    });
  });
});

describe('buildCategoryLookups', () => {
  test('indexes categories by id and rules by merchant key', () => {
    const { categoriesById, rulesByMerchantKey } = buildCategoryLookups(categories, rules);

    expect(categoriesById.get(1)).toEqual({ id: 1, name: 'Lebensmittel' });
    expect(rulesByMerchantKey.get('Rewe Markt GmbH')).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test category-resolution -- --run`
Expected: FAIL — `Cannot find module './category-resolution'`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/category-resolution.ts
import { getMerchantKey } from './merchant-key';

export interface CategoryRef {
  id: number;
  name: string;
}

export interface ResolvedCategory {
  categoryId: number | null;
  categoryName: string | null;
  source: 'override' | 'rule' | 'none';
}

/**
 * Resolves a transaction's effective category, pure and in-memory:
 * 1. an explicit per-transaction override wins,
 * 2. otherwise a merchant rule for this transaction's merchant key applies,
 * 3. otherwise the transaction is uncategorized.
 * No amount/date/keyword heuristics — only these two explicit sources.
 */
export function resolveTransactionCategory(
  tx: { categoryOverrideId: number | null; counterparty: string | null; purpose: string | null },
  rulesByMerchantKey: Map<string, number>,
  categoriesById: Map<number, CategoryRef>
): ResolvedCategory {
  if (tx.categoryOverrideId !== null) {
    const category = categoriesById.get(tx.categoryOverrideId);
    return { categoryId: tx.categoryOverrideId, categoryName: category?.name ?? null, source: 'override' };
  }

  const ruleCategoryId = rulesByMerchantKey.get(getMerchantKey(tx));
  if (ruleCategoryId !== undefined) {
    const category = categoriesById.get(ruleCategoryId);
    return { categoryId: ruleCategoryId, categoryName: category?.name ?? null, source: 'rule' };
  }

  return { categoryId: null, categoryName: null, source: 'none' };
}

/**
 * Converts the two small reference tables (`categories`, `merchant_category_rules`)
 * into lookup maps once per request, so `resolveTransactionCategory()` can run
 * per-transaction with no further queries.
 */
export function buildCategoryLookups(
  categoryRows: CategoryRef[],
  ruleRows: { merchantKey: string; categoryId: number }[]
): { categoriesById: Map<number, CategoryRef>; rulesByMerchantKey: Map<string, number> } {
  const categoriesById = new Map(categoryRows.map((c) => [c.id, c]));
  const rulesByMerchantKey = new Map(ruleRows.map((r) => [r.merchantKey, r.categoryId]));
  return { categoriesById, rulesByMerchantKey };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test category-resolution -- --run`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/category-resolution.ts src/lib/category-resolution.test.ts
git commit -m "Add resolveTransactionCategory() and buildCategoryLookups()"
```

---

## Task 5: Mutation core — `category-mutations.ts`

Mirrors the existing `import-runner.ts`/`actions.ts` split: this module holds the DB writes and is directly testable against a real temp SQLite DB, with no session dependency.

**Files:**
- Create: `src/app/(app)/actions/category-mutations.ts`
- Test: `src/app/(app)/actions/category-mutations.test.ts`

**Interfaces:**
- Consumes: `db` from `@/db/client`, `categories`/`merchantCategoryRules`/`transactions` from `@/db/schema`.
- Produces:
  - `type CategoryTarget = {type:'category';categoryId:number} | {type:'newCategory';name:string} | {type:'clear'}`
  - `applyMerchantRule(merchantKey: string, target: CategoryTarget): Promise<void>`
  - `applyTransactionOverride(transactionId: number, target: CategoryTarget): Promise<void>`

  Used by Task 6 (`'use server'` wrapper) and, via re-export, by every client component that needs the `CategoryTarget` type (Task 7).

- [ ] **Step 1: Write the failing tests**

```ts
// src/app/(app)/actions/category-mutations.test.ts
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

let tempDir: string;

async function freshDb() {
  const { db } = await import('@/db/client');
  const schema = await import('@/db/schema');
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  migrate(db, { migrationsFolder: './drizzle' });
  const mutations = await import('./category-mutations');
  return { db, schema, ...mutations };
}

async function seedTransaction(
  db: Awaited<ReturnType<typeof freshDb>>['db'],
  schema: Awaited<ReturnType<typeof freshDb>>['schema'],
  overrides: Partial<typeof schema.transactions.$inferInsert> = {}
) {
  const [account] = await db
    .insert(schema.accounts)
    .values({ name: 'Girokonto', currency: 'EUR', createdAt: new Date() })
    .returning();
  const [tx] = await db
    .insert(schema.transactions)
    .values({
      accountId: account.id,
      bookingDate: '2026-08-20',
      amountCents: -1000,
      counterparty: 'REWE Markt GmbH',
      purpose: null,
      externalHash: 'hash-1',
      ...overrides,
    })
    .returning();
  return tx;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'fafnir-category-test-'));
  process.env.DATABASE_PATH = join(tempDir, 'test.db');
  vi.resetModules();
});

afterEach(() => {
  delete process.env.DATABASE_PATH;
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe('applyMerchantRule', () => {
  test('assigning a new category name creates both the category and the rule', async () => {
    const { db, schema, applyMerchantRule } = await freshDb();

    await applyMerchantRule('Rewe Markt GmbH', { type: 'newCategory', name: 'Lebensmittel' });

    const [category] = await db.select().from(schema.categories);
    expect(category.name).toBe('Lebensmittel');

    const [rule] = await db.select().from(schema.merchantCategoryRules);
    expect(rule).toEqual(expect.objectContaining({ merchantKey: 'Rewe Markt GmbH', categoryId: category.id }));
  });

  test('assigning a category name that already exists reuses it instead of erroring', async () => {
    const { db, schema, applyMerchantRule } = await freshDb();
    await applyMerchantRule('Rewe Markt GmbH', { type: 'newCategory', name: 'Lebensmittel' });
    const [existing] = await db.select().from(schema.categories);

    await applyMerchantRule('Amazon Payments Europe S.C.A.', { type: 'newCategory', name: 'Lebensmittel' });

    const allCategories = await db.select().from(schema.categories);
    expect(allCategories).toHaveLength(1);

    const rules = await db.select().from(schema.merchantCategoryRules);
    expect(rules).toHaveLength(2);
    expect(rules.every((r) => r.categoryId === existing.id)).toBe(true);
  });

  test('setting a rule twice for the same merchant updates it instead of duplicating it', async () => {
    const { db, schema, applyMerchantRule } = await freshDb();
    const [foodCategory] = await db.insert(schema.categories).values({ name: 'Lebensmittel' }).returning();
    const [otherCategory] = await db.insert(schema.categories).values({ name: 'Sonstiges' }).returning();

    await applyMerchantRule('Rewe Markt GmbH', { type: 'category', categoryId: foodCategory.id });
    await applyMerchantRule('Rewe Markt GmbH', { type: 'category', categoryId: otherCategory.id });

    const rules = await db.select().from(schema.merchantCategoryRules);
    expect(rules).toHaveLength(1);
    expect(rules[0].categoryId).toBe(otherCategory.id);
  });

  test('clearing a rule deletes it, leaving affected transactions to fall back to uncategorized', async () => {
    const { db, schema, applyMerchantRule } = await freshDb();
    const [category] = await db.insert(schema.categories).values({ name: 'Lebensmittel' }).returning();
    await applyMerchantRule('Rewe Markt GmbH', { type: 'category', categoryId: category.id });

    await applyMerchantRule('Rewe Markt GmbH', { type: 'clear' });

    const rules = await db.select().from(schema.merchantCategoryRules);
    expect(rules).toHaveLength(0);
  });
});

describe('applyTransactionOverride', () => {
  test('setting an override updates only that transaction', async () => {
    const { db, schema, applyTransactionOverride } = await freshDb();
    const tx = await seedTransaction(db, schema);
    const [category] = await db.insert(schema.categories).values({ name: 'Sonstiges' }).returning();

    await applyTransactionOverride(tx.id, { type: 'category', categoryId: category.id });

    const [updated] = await db.select().from(schema.transactions).where(eq(schema.transactions.id, tx.id));
    expect(updated.categoryOverrideId).toBe(category.id);
  });

  test('clearing an override resets it to null, falling back to the merchant rule', async () => {
    const { db, schema, applyTransactionOverride } = await freshDb();
    const [category] = await db.insert(schema.categories).values({ name: 'Sonstiges' }).returning();
    const tx = await seedTransaction(db, schema, { categoryOverrideId: category.id });

    await applyTransactionOverride(tx.id, { type: 'clear' });

    const [updated] = await db.select().from(schema.transactions).where(eq(schema.transactions.id, tx.id));
    expect(updated.categoryOverrideId).toBeNull();
  });

  test('assigning a brand-new category name on an override creates the category', async () => {
    const { db, schema, applyTransactionOverride } = await freshDb();
    const tx = await seedTransaction(db, schema);

    await applyTransactionOverride(tx.id, { type: 'newCategory', name: 'Ausnahme' });

    const [category] = await db.select().from(schema.categories);
    expect(category.name).toBe('Ausnahme');
    const [updated] = await db.select().from(schema.transactions).where(eq(schema.transactions.id, tx.id));
    expect(updated.categoryOverrideId).toBe(category.id);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test category-mutations -- --run`
Expected: FAIL — `Cannot find module './category-mutations'`

- [ ] **Step 3: Write the implementation**

```ts
// src/app/(app)/actions/category-mutations.ts
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { categories, merchantCategoryRules, transactions } from '@/db/schema';

export type CategoryTarget =
  | { type: 'category'; categoryId: number }
  | { type: 'newCategory'; name: string }
  | { type: 'clear' };

type AssignTarget = Exclude<CategoryTarget, { type: 'clear' }>;

/**
 * Resolves an assign-type target to a concrete category id: an existing id is
 * used as-is; a new name is inserted, or — on a name collision with the
 * unique index on `categories.name` — the existing category with that name
 * is reused instead of throwing.
 */
async function resolveCategoryId(target: AssignTarget): Promise<number> {
  if (target.type === 'category') {
    return target.categoryId;
  }
  const name = target.name.trim();
  await db.insert(categories).values({ name }).onConflictDoNothing();
  const [category] = await db.select().from(categories).where(eq(categories.name, name));
  return category.id;
}

/** Sets (or clears) the category rule applied to every transaction from this merchant. */
export async function applyMerchantRule(merchantKey: string, target: CategoryTarget): Promise<void> {
  if (target.type === 'clear') {
    await db.delete(merchantCategoryRules).where(eq(merchantCategoryRules.merchantKey, merchantKey));
    return;
  }
  const categoryId = await resolveCategoryId(target);
  await db
    .insert(merchantCategoryRules)
    .values({ merchantKey, categoryId })
    .onConflictDoUpdate({ target: merchantCategoryRules.merchantKey, set: { categoryId } });
}

/** Sets (or clears) the category override on exactly one transaction. */
export async function applyTransactionOverride(transactionId: number, target: CategoryTarget): Promise<void> {
  const categoryId = target.type === 'clear' ? null : await resolveCategoryId(target);
  await db.update(transactions).set({ categoryOverrideId: categoryId }).where(eq(transactions.id, transactionId));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test category-mutations -- --run`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/actions/category-mutations.ts" "src/app/(app)/actions/category-mutations.test.ts"
git commit -m "Add category-mutations core: applyMerchantRule, applyTransactionOverride"
```

---

## Task 6: Server Actions — `categories.ts`

Thin `'use server'` wrapper: session check + delegate to Task 5's core + revalidate. No dedicated test file, matching the existing `import/actions.ts` (also untested directly — only its `import-runner.ts` core is).

**Files:**
- Create: `src/app/(app)/actions/categories.ts`

**Interfaces:**
- Consumes: `requireSession()` from `@/lib/session`, `applyMerchantRule`/`applyTransactionOverride`/`CategoryTarget` from `./category-mutations` (Task 5).
- Produces: `setMerchantRule(merchantKey: string, target: CategoryTarget): Promise<void>`, `setTransactionOverride(transactionId: number, target: CategoryTarget): Promise<void>` — called directly (not via `<form action>`) from Task 7/8/10's client components.

- [ ] **Step 1: Write the implementation**

```ts
// src/app/(app)/actions/categories.ts
'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/session';
import { applyMerchantRule, applyTransactionOverride, type CategoryTarget } from './category-mutations';

export type { CategoryTarget };

function revalidateCategorizedPages() {
  revalidatePath('/');
  revalidatePath('/accounts/[id]', 'page');
  revalidatePath('/categorize');
}

export async function setMerchantRule(merchantKey: string, target: CategoryTarget): Promise<void> {
  await requireSession();
  await applyMerchantRule(merchantKey, target);
  revalidateCategorizedPages();
}

export async function setTransactionOverride(transactionId: number, target: CategoryTarget): Promise<void> {
  await requireSession();
  await applyTransactionOverride(transactionId, target);
  revalidateCategorizedPages();
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm build`
Expected: succeeds (nothing calls these yet, but the file itself must type-check — `requireSession()` redirects rather than throws when there's no session, matching the pattern in every other server action in this codebase).

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/actions/categories.ts"
git commit -m "Add setMerchantRule/setTransactionOverride server actions"
```

---

## Task 7: Shared `CategoryPicker` component

The `<select>` + "new category" + optional "clear" UI building block, reused by the transaction row panel (Task 8) and the `/categorize` page (Task 10).

**Files:**
- Create: `src/components/category-picker.tsx`

**Interfaces:**
- Consumes: `CategoryTarget` type from `@/app/(app)/actions/category-mutations` (Task 5).
- Produces: `<CategoryPicker categories selectedCategoryId showClear clearLabel onSubmit />` — used by Task 8 (`CategoryBadge`, two instances per expanded row) and Task 10 (`MerchantCategoryForm`).

- [ ] **Step 1: Write the implementation**

```tsx
// src/components/category-picker.tsx
'use client';

import { useState, useTransition, type FormEvent } from 'react';
import type { CategoryTarget } from '@/app/(app)/actions/category-mutations';

const NEW_CATEGORY_VALUE = '__new__';

export interface CategoryPickerProps {
  categories: { id: number; name: string }[];
  /** Prefills the select; null shows the disabled placeholder ("Kategorie wählen"). */
  selectedCategoryId: number | null;
  /** Whether the clear button is rendered at all — callers decide per their own semantics. */
  showClear: boolean;
  clearLabel: string;
  onSubmit: (target: CategoryTarget) => Promise<void>;
}

export function CategoryPicker({ categories, selectedCategoryId, showClear, clearLabel, onSubmit }: CategoryPickerProps) {
  const [selection, setSelection] = useState(selectedCategoryId !== null ? String(selectedCategoryId) : '');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isPending, startTransition] = useTransition();

  const isNew = selection === NEW_CATEGORY_VALUE;
  const canSubmit = isNew ? newCategoryName.trim() !== '' : selection !== '';

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    const target: CategoryTarget = isNew
      ? { type: 'newCategory', name: newCategoryName.trim() }
      : { type: 'category', categoryId: Number(selection) };
    startTransition(async () => {
      await onSubmit(target);
    });
  }

  function handleClear() {
    startTransition(async () => {
      await onSubmit({ type: 'clear' });
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Kategorie"
        value={selection}
        onChange={(event) => setSelection(event.target.value)}
        disabled={isPending}
        className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
      >
        <option value="" disabled>
          Kategorie wählen
        </option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
        <option value={NEW_CATEGORY_VALUE}>+ Neue Kategorie anlegen</option>
      </select>

      {isNew && (
        <input
          type="text"
          value={newCategoryName}
          onChange={(event) => setNewCategoryName(event.target.value)}
          placeholder="Name der Kategorie"
          disabled={isPending}
          className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
        />
      )}

      <button
        type="submit"
        disabled={isPending || !canSubmit}
        className="rounded-md bg-primary px-2 py-1 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        Speichern
      </button>

      {showClear && (
        <button
          type="button"
          onClick={handleClear}
          disabled={isPending}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          {clearLabel}
        </button>
      )}
    </form>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm build`
Expected: succeeds (component isn't used anywhere yet, but must type-check standalone).

- [ ] **Step 3: Commit**

```bash
git add src/components/category-picker.tsx
git commit -m "Add shared CategoryPicker component"
```

---

## Task 8: Category badge on the transaction list

Adds the per-row category badge with the inline expand panel (both assignment forms), per spec section 4.

**Files:**
- Create: `src/components/transactions/category-badge.tsx`
- Modify: `src/components/transactions/transaction-list.tsx`

**Interfaces:**
- Consumes: `CategoryPicker` (Task 7), `setMerchantRule`/`setTransactionOverride` (Task 6).
- Produces: `TransactionListRow` gains `merchantKey: string`, `effectiveCategory: {id:number;name:string}|null`, `overrideCategoryId: number|null`, `merchantRuleCategoryId: number|null`. `TransactionList` gains a required `categories: {id:number;name:string}[]` prop. Both are consumed by Task 9 (`/accounts/[id]`).

- [ ] **Step 1: Create `CategoryBadge`**

```tsx
// src/components/transactions/category-badge.tsx
'use client';

import { useState } from 'react';
import { setMerchantRule, setTransactionOverride } from '@/app/(app)/actions/categories';
import { CategoryPicker } from '@/components/category-picker';

export interface CategoryBadgeProps {
  transactionId: number;
  merchantKey: string;
  effectiveCategory: { id: number; name: string } | null;
  /** This transaction's own override id, independent of any merchant rule — gates the "nur diese Buchung" clear button. */
  overrideCategoryId: number | null;
  /** The merchant rule's current category for this merchant, independent of this transaction's own override. */
  merchantRuleCategoryId: number | null;
  categories: { id: number; name: string }[];
}

export function CategoryBadge({
  transactionId,
  merchantKey,
  effectiveCategory,
  overrideCategoryId,
  merchantRuleCategoryId,
  categories,
}: CategoryBadgeProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        {effectiveCategory ? effectiveCategory.name : 'Unkategorisiert'}
      </button>

      {isOpen && (
        <div className="mt-2 space-y-3 rounded-md border border-border bg-background p-3">
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Nur diese Buchung</p>
            <CategoryPicker
              categories={categories}
              selectedCategoryId={overrideCategoryId}
              showClear={overrideCategoryId !== null}
              clearLabel="Standard (Gegenpartei-Regel verwenden)"
              onSubmit={(target) => setTransactionOverride(transactionId, target)}
            />
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Alle Buchungen dieser Gegenpartei</p>
            <CategoryPicker
              categories={categories}
              selectedCategoryId={merchantRuleCategoryId}
              showClear={merchantRuleCategoryId !== null}
              clearLabel="Kategorie entfernen"
              onSubmit={(target) => setMerchantRule(merchantKey, target)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `transaction-list.tsx`**

Full resulting file:

```tsx
// src/components/transactions/transaction-list.tsx
import { formatCents, formatDayHeading } from '@/lib/format';
import { deriveTransactionDisplay } from '@/lib/transaction-display';
import { groupTransactionsByDay } from '@/lib/transaction-grouping';
import { cn } from '@/lib/utils';
import { CategoryBadge } from './category-badge';

export interface TransactionListRow {
  id: number;
  bookingDate: string;
  counterparty: string | null;
  purpose: string | null;
  amountCents: number;
  merchantKey: string;
  effectiveCategory: { id: number; name: string } | null;
  overrideCategoryId: number | null;
  merchantRuleCategoryId: number | null;
}

function amountColorClass(amountCents: number): string {
  if (amountCents < 0) return 'text-destructive';
  if (amountCents > 0) return 'text-positive';
  return 'text-foreground';
}

function TransactionRow({
  tx,
  currency,
  categories,
}: {
  tx: TransactionListRow;
  currency: string;
  categories: { id: number; name: string }[];
}) {
  const { title, context } = deriveTransactionDisplay(tx);

  return (
    <li className="px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate font-medium text-foreground">{title}</span>
        <span className={cn('shrink-0 tabular-nums font-medium', amountColorClass(tx.amountCents))}>
          {formatCents(tx.amountCents, currency)}
        </span>
      </div>
      {context && <p className="mt-0.5 truncate text-xs text-muted-foreground">{context}</p>}
      <CategoryBadge
        transactionId={tx.id}
        merchantKey={tx.merchantKey}
        effectiveCategory={tx.effectiveCategory}
        overrideCategoryId={tx.overrideCategoryId}
        merchantRuleCategoryId={tx.merchantRuleCategoryId}
        categories={categories}
      />
    </li>
  );
}

export function TransactionList({
  rows,
  currency,
  categories,
}: {
  rows: TransactionListRow[];
  currency: string;
  categories: { id: number; name: string }[];
}) {
  if (rows.length === 0) {
    return <p className="rounded-lg border border-border bg-card px-4 py-8 text-center text-muted-foreground">Keine Buchungen.</p>;
  }

  const dayGroups = groupTransactionsByDay(rows);

  return (
    <div className="space-y-6">
      {dayGroups.map((group) => (
        <section key={group.date}>
          <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {formatDayHeading(group.date)}
          </h3>
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {group.featured.map((tx) => (
              <TransactionRow key={tx.id} tx={tx} currency={currency} categories={categories} />
            ))}
            {group.collapsed && (
              <li>
                <details>
                  <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm text-muted-foreground hover:text-foreground">
                    <span>{group.collapsed.transactions.length} weitere Buchungen</span>
                    <span className={cn('tabular-nums', amountColorClass(group.collapsed.totalCents))}>
                      {formatCents(group.collapsed.totalCents, currency)}
                    </span>
                  </summary>
                  <ul className="divide-y divide-border border-t border-border">
                    {group.collapsed.transactions.map((tx) => (
                      <TransactionRow key={tx.id} tx={tx} currency={currency} categories={categories} />
                    ))}
                  </ul>
                </details>
              </li>
            )}
          </ul>
        </section>
      ))}
    </div>
  );
}
```

Note: the outer `<details>` for the "N weitere Buchungen" day-collapse group is unrelated to the category panel's `isOpen` state (Global Constraints' `useState`-not-`<details>` rule is about the category panel specifically) — it stays as-is.

- [ ] **Step 3: Verify it compiles**

Run: `pnpm build`
Expected: fails — `Property 'categories' is missing` where `<TransactionList>` is used in `src/app/(app)/accounts/[id]/page.tsx` (fixed in Task 9), and `Property 'merchantKey' is missing` etc. on the rows it's given. This is expected at this point in the plan; Task 9 supplies both.

- [ ] **Step 4: Commit**

```bash
git add src/components/transactions/category-badge.tsx src/components/transactions/transaction-list.tsx
git commit -m "Add per-row category badge with inline assignment panel"
```

---

## Task 9: Wire categorization into `/accounts/[id]`

**Files:**
- Modify: `src/app/(app)/accounts/[id]/page.tsx`

**Interfaces:**
- Consumes: `buildCategoryLookups`/`resolveTransactionCategory` (Task 4), `getMerchantKey` (Task 3), the updated `TransactionList` (Task 8).

- [ ] **Step 1: Edit the page**

Full resulting file:

```tsx
// src/app/(app)/accounts/[id]/page.tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { count, desc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { accounts, categories, merchantCategoryRules, transactions } from '@/db/schema';
import { requireSession } from '@/lib/session';
import { paginate } from '@/lib/pagination';
import { buildCategoryLookups, resolveTransactionCategory } from '@/lib/category-resolution';
import { getMerchantKey } from '@/lib/merchant-key';
import { TransactionList } from '@/components/transactions/transaction-list';

export const dynamic = 'force-dynamic';

export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  await requireSession();

  const { id } = await params;
  const accountId = Number(id);
  if (!Number.isInteger(accountId)) {
    notFound();
  }

  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  if (!account) {
    notFound();
  }

  const { page: pageParam } = await searchParams;

  const [{ total }] = await db
    .select({ total: count() })
    .from(transactions)
    .where(eq(transactions.accountId, accountId));

  const { page, offset, pageSize, totalPages } = paginate(total, Number(pageParam));

  const [rawRows, categoryRows, ruleRows] = await Promise.all([
    db
      .select()
      .from(transactions)
      .where(eq(transactions.accountId, accountId))
      .orderBy(desc(transactions.bookingDate), desc(transactions.id))
      .limit(pageSize)
      .offset(offset),
    db.select().from(categories),
    db.select().from(merchantCategoryRules),
  ]);

  const { categoriesById, rulesByMerchantKey } = buildCategoryLookups(categoryRows, ruleRows);

  const rows = rawRows.map((tx) => {
    const resolved = resolveTransactionCategory(tx, rulesByMerchantKey, categoriesById);
    const merchantKey = getMerchantKey(tx);
    return {
      ...tx,
      merchantKey,
      effectiveCategory: resolved.categoryId !== null ? { id: resolved.categoryId, name: resolved.categoryName! } : null,
      overrideCategoryId: tx.categoryOverrideId,
      merchantRuleCategoryId: rulesByMerchantKey.get(merchantKey) ?? null,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Zurück
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-foreground">{account.name}</h1>
      </div>

      <TransactionList rows={rows} currency={account.currency} categories={categoryRows} />

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          {page > 1 ? (
            <Link href={`/accounts/${accountId}?page=${page - 1}`} className="hover:text-foreground">
              ← Vorherige
            </Link>
          ) : (
            <span />
          )}
          <span>
            Seite {page} von {totalPages}
          </span>
          {page < totalPages ? (
            <Link href={`/accounts/${accountId}?page=${page + 1}`} className="hover:text-foreground">
              Nächste →
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm build`
Expected: succeeds.

- [ ] **Step 3: Run the full test suite**

Run: `pnpm test`
Expected: all tests pass (nothing here has its own test — it's a Server Component composing already-tested pieces — but this confirms no regression elsewhere).

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/accounts/[id]/page.tsx"
git commit -m "Show resolved categories and assignment panel on the transaction list"
```

---

## Task 10: `/categorize` route

**Files:**
- Create: `src/app/(app)/categorize/page.tsx`
- Create: `src/app/(app)/categorize/merchant-category-form.tsx`

**Interfaces:**
- Consumes: `buildCategoryLookups`/`resolveTransactionCategory` (Task 4), `getMerchantKey` (Task 3), `CategoryPicker` (Task 7), `setMerchantRule` (Task 6).

- [ ] **Step 1: Create `MerchantCategoryForm`**

Every row on this page represents a merchant with no rule and no override on any of its transactions (source `'none'` for all of them, by construction — see Task 10 Step 2's filter) — there is never an existing rule to prefill or clear here.

```tsx
// src/app/(app)/categorize/merchant-category-form.tsx
'use client';

import { setMerchantRule } from '@/app/(app)/actions/categories';
import { CategoryPicker } from '@/components/category-picker';

export function MerchantCategoryForm({
  merchantKey,
  categories,
}: {
  merchantKey: string;
  categories: { id: number; name: string }[];
}) {
  return (
    <CategoryPicker
      categories={categories}
      selectedCategoryId={null}
      showClear={false}
      clearLabel="Kategorie entfernen"
      onSubmit={(target) => setMerchantRule(merchantKey, target)}
    />
  );
}
```

- [ ] **Step 2: Create the page**

```tsx
// src/app/(app)/categorize/page.tsx
import Link from 'next/link';
import { db } from '@/db/client';
import { categories, merchantCategoryRules, transactions } from '@/db/schema';
import { requireSession } from '@/lib/session';
import { buildCategoryLookups, resolveTransactionCategory } from '@/lib/category-resolution';
import { getMerchantKey } from '@/lib/merchant-key';
import { MerchantCategoryForm } from './merchant-category-form';

export const dynamic = 'force-dynamic';

export default async function CategorizePage() {
  await requireSession();

  const [allTransactions, categoryRows, ruleRows] = await Promise.all([
    db
      .select({
        categoryOverrideId: transactions.categoryOverrideId,
        counterparty: transactions.counterparty,
        purpose: transactions.purpose,
      })
      .from(transactions),
    db.select().from(categories),
    db.select().from(merchantCategoryRules),
  ]);

  const { categoriesById, rulesByMerchantKey } = buildCategoryLookups(categoryRows, ruleRows);

  const uncategorizedCountByMerchant = new Map<string, number>();
  for (const tx of allTransactions) {
    if (resolveTransactionCategory(tx, rulesByMerchantKey, categoriesById).source === 'none') {
      const key = getMerchantKey(tx);
      uncategorizedCountByMerchant.set(key, (uncategorizedCountByMerchant.get(key) ?? 0) + 1);
    }
  }

  const merchantGroups = [...uncategorizedCountByMerchant.entries()]
    .map(([merchantKey, txCount]) => ({ merchantKey, txCount }))
    .sort((a, b) => b.txCount - a.txCount);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Zurück
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-foreground">Unkategorisiert</h1>
      </div>

      {merchantGroups.length === 0 ? (
        <p className="rounded-lg border border-border bg-card px-4 py-8 text-center text-muted-foreground">
          Alle Gegenparteien sind kategorisiert.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {merchantGroups.map((group) => (
            <li key={group.merchantKey} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="font-medium text-foreground">{group.merchantKey}</p>
                <p className="text-xs text-muted-foreground">
                  {group.txCount} Buchung{group.txCount === 1 ? '' : 'en'}
                </p>
              </div>
              <MerchantCategoryForm merchantKey={group.merchantKey} categories={categoryRows} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify it compiles and the dev server serves the route**

```bash
pnpm build
```

Expected: succeeds, and the build output lists `/categorize` as a route.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/categorize/"
git commit -m "Add /categorize route grouping uncategorized transactions by merchant"
```

---

## Task 11: Dashboard "N Gegenparteien unkategorisiert" badge

**Files:**
- Modify: `src/app/(app)/page.tsx`

**Interfaces:**
- Consumes: `buildCategoryLookups`/`resolveTransactionCategory` (Task 4), `getMerchantKey` (Task 3).

- [ ] **Step 1: Edit the page**

Full resulting file:

```tsx
// src/app/(app)/page.tsx
import Link from 'next/link';
import { and, asc, eq, gte } from 'drizzle-orm';
import { db } from '@/db/client';
import { accounts, balanceSnapshots, categories, merchantCategoryRules, transactions } from '@/db/schema';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AccountCard } from '@/components/dashboard/account-card';
import { requireSession } from '@/lib/session';
import { computeMonthToDateTrend } from '@/lib/trend';
import { buildCategoryLookups, resolveTransactionCategory } from '@/lib/category-resolution';
import { getMerchantKey } from '@/lib/merchant-key';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  await requireSession();

  const allAccounts = await db.select().from(accounts);

  if (allAccounts.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-background p-8 text-center">
        <p className="text-foreground">Noch keine Konten.</p>
        <Link href="/import" className={cn(buttonVariants(), 'mt-4')}>
          CSV importieren
        </Link>
      </div>
    );
  }

  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  const cards = await Promise.all(
    allAccounts.map(async (account) => {
      const history = await db
        .select({ date: balanceSnapshots.snapshotDate, balanceCents: balanceSnapshots.balanceCents })
        .from(balanceSnapshots)
        .where(eq(balanceSnapshots.accountId, account.id))
        .orderBy(asc(balanceSnapshots.snapshotDate));

      const currentBalanceCents = history.length > 0 ? history[history.length - 1].balanceCents : 0;

      const monthToDateTransactions = await db
        .select({ bookingDate: transactions.bookingDate, amountCents: transactions.amountCents })
        .from(transactions)
        .where(and(eq(transactions.accountId, account.id), gte(transactions.bookingDate, monthStart)));

      const trend = computeMonthToDateTrend(currentBalanceCents, monthToDateTransactions, now);

      return { account, history, currentBalanceCents, trend };
    })
  );

  const [allTransactionsForCategorization, categoryRows, ruleRows] = await Promise.all([
    db
      .select({
        categoryOverrideId: transactions.categoryOverrideId,
        counterparty: transactions.counterparty,
        purpose: transactions.purpose,
      })
      .from(transactions),
    db.select().from(categories),
    db.select().from(merchantCategoryRules),
  ]);

  const { categoriesById, rulesByMerchantKey } = buildCategoryLookups(categoryRows, ruleRows);

  const uncategorizedMerchants = new Set<string>();
  for (const tx of allTransactionsForCategorization) {
    if (resolveTransactionCategory(tx, rulesByMerchantKey, categoriesById).source === 'none') {
      uncategorizedMerchants.add(getMerchantKey(tx));
    }
  }

  return (
    <div className="space-y-4">
      {uncategorizedMerchants.size > 0 && (
        <Link
          href="/categorize"
          className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {uncategorizedMerchants.size} Gegenpartei{uncategorizedMerchants.size === 1 ? '' : 'en'} unkategorisiert
        </Link>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map(({ account, history, currentBalanceCents, trend }) => (
          <Link key={account.id} href={`/accounts/${account.id}`} className="block">
            <AccountCard
              accountName={account.name}
              currency={account.currency}
              currentBalanceCents={currentBalanceCents}
              history={history}
              trend={trend}
            />
          </Link>
        ))}
      </div>
    </div>
  );
}
```

(The `<AccountCard .../>` props above match the existing `AccountCardProps` interface from `src/components/dashboard/account-card.tsx` — unchanged by this task.)

- [ ] **Step 2: Verify it compiles**

Run: `pnpm build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/page.tsx"
git commit -m "Show uncategorized-merchant count on the dashboard, linking to /categorize"
```

---

## Task 12: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Full automated check**

```bash
pnpm lint
pnpm test
pnpm build
```

Expected: all three succeed with zero errors/warnings.

- [ ] **Step 2: Migration data-integrity check on the real dev database**

Already done incrementally in Tasks 1–2, but re-confirm the end state in one pass:

```bash
sqlite3 data/fafnir.db "select count(*) from transactions;"
sqlite3 -header -column data/fafnir.db "select id, counterparty from transactions limit 3;"
```

Expected: `102`, and the sample rows show the same `counterparty` values as before this feature (no data mutated by the schema migration).

- [ ] **Step 3: Data-level acceptance check — merchant rule applies to all its transactions**

Directly exercises the acceptance criterion "Eine gesetzte Regel wirkt sofort auf alle bestehenden und künftigen Buchungen derselben Gegenpartei" against the real 102 rows, without depending on browser automation:

```bash
sqlite3 -header -column data/fafnir.db \
  "select id, counterparty from transactions where counterparty = 'REWE Markt GmbH';"
```

Note the returned `id`s (there should be more than one — REWE appears multiple times in the sample data). Then, with the dev server running (`pnpm dev` in the background) and logged in, open `/categorize`, assign "REWE Markt GmbH" to a new category (e.g. "Lebensmittel"), and re-run:

```bash
sqlite3 data/fafnir.db "select merchant_key, category_id from merchant_category_rules;"
sqlite3 -header -column data/fafnir.db "select id, counterparty, category_override_id from transactions where counterparty = 'REWE Markt GmbH';"
```

Expected: one `merchant_category_rules` row for `REWE Markt GmbH`; every one of that merchant's transactions still has `category_override_id = NULL` (the rule, not an override, is what resolves them) — then confirm in the browser that all of them show the "Lebensmittel" badge on `/accounts/[id]` and that "REWE Markt GmbH" no longer appears on `/categorize`.

- [ ] **Step 4: Data-level acceptance check — override affects only one transaction**

Exercises "Override lässt sich an einer einzelnen Transaktion setzen, ohne die Regel für die restliche Gegenpartei zu verändern." Pick one of the same REWE transaction ids from Step 3 (not all of them), and in the browser expand that single row's badge, use "Nur diese Buchung" to set a different category (e.g. "Sonstiges"). Then:

```bash
sqlite3 -header -column data/fafnir.db "select id, counterparty, category_override_id from transactions where counterparty = 'REWE Markt GmbH';"
```

Expected: exactly the one chosen `id` has a non-null `category_override_id`; every other REWE transaction still has `category_override_id = NULL` and still resolves via the merchant rule. In the browser, confirm only that one row shows "Sonstiges" while the rest still show "Lebensmittel".

- [ ] **Step 5: Visual check (if browser automation is available)**

Using the `run` skill (or `pnpm dev` + `claude-in-chrome`), screenshot `/`, `/accounts/[id]`, and `/categorize` in both the state before any assignment and after Steps 3–4, confirming: the dashboard badge count decreases as merchants get assigned; the transaction-list category badge and its expand panel render as designed; `/categorize` groups by merchant with a transaction count, not one row per transaction. If browser automation is unavailable, the SQL-level checks in Steps 3–4 plus a manual look at the running dev server are sufficient — do not block completion on it.

- [ ] **Step 6: Confirm all Akzeptanzkriterien from the spec**

Check off each item from `docs/superpowers/specs/2026-08-22-merchant-based-categorization-design.md`'s "Akzeptanzkriterien" section against Steps 1–5 above; all should now be satisfied.
