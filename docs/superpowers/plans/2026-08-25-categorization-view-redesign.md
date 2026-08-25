# Kategorisierungs-Ansicht Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace both the "Unkategorisiert"-Übersicht and the per-transaction `CategoryBadge` popover with a single `/categorize` view where each Gegenpartei-group is collapsible, lazy-loads its individual transactions on first expand, and lets the user create both "Nur diese Buchung" and "Verwendungszweck enthält" rules directly from the visible purpose text.

**Architecture:** `/categorize`'s server component keeps computing merchant groups and counts as today, but each group is now rendered by a new client component `MerchantGroup` that lazily fetches its transactions (via a new server action `getMerchantTransactions`) on first expand and caches them in local state. Each transaction renders through a new `TransactionDetailRow`, which reuses the existing `CategoryPicker` for both the override and purpose-rule pickers. `TransactionList` (dashboard + account page) drops `CategoryBadge` entirely in favor of a link to `/categorize?merchant=<key>#group-<key>`, which the server component resolves into a pre-expanded, pre-fetched group.

**Tech Stack:** Next.js App Router, React Server + Client Components, Drizzle ORM / better-sqlite3, Vitest (`*.test.ts`, real temp-SQLite `freshDb()` pattern — no component-rendering test infra in this repo).

**Spec:** `docs/superpowers/specs/2026-08-25-categorization-view-redesign-design.md`

## Global Constraints

- No DB schema changes — `merchantCategoryRules.purposeContains` and `applyMerchantRule` already exist and are reused unchanged.
- All UI copy in German, matching existing conventions in this codebase.
- `getMerchantTransactions` (the `'use server'` wrapper) belongs in `src/app/(app)/actions/categories.ts`; the pure query function `getMerchantTransactionsForKey` belongs in `src/app/(app)/actions/category-mutations.ts` — mirrors the existing mutation/wrapper split.
- `setMerchantRule` and `setTransactionOverride` are reused unchanged; `setMerchantRule`'s purpose row now gets called with freely-edited user text instead of only an existing rule's text.
- No new test-rendering framework is introduced. New logic (`getMerchantTransactionsForKey`) gets a `*.test.ts` per the existing `freshDb()`/`seedTransaction()` pattern; new UI composition is verified via `npm run lint`, `npm test`, `npm run build`, and a manual browser check — this repo has zero `.test.tsx` files and no `@testing-library` dependency.
- Icons and in-view search/filter are explicitly out of scope.
- A group header (Gegenparteiname + Buchungsanzahl + "Alle Buchungen dieser Gegenpartei"-Regelformular) stays visible even while the group is collapsed — only the individual-transaction list is hidden/lazy-loaded.

---

## File Structure

- **Modify** `src/app/(app)/actions/category-mutations.ts` — add `MerchantTransactionRow` interface + `getMerchantTransactionsForKey(merchantKey)` pure query function.
- **Modify** `src/app/(app)/actions/category-mutations.test.ts` — tests for the new function.
- **Modify** `src/app/(app)/actions/categories.ts` — add `getMerchantTransactions(merchantKey)` `'use server'` wrapper.
- **Create** `src/app/(app)/categorize/transaction-detail-row.tsx` — renders one transaction's date/amount/purpose/status plus its two rule rows ("Nur diese Buchung", "Verwendungszweck enthält").
- **Create** `src/app/(app)/categorize/merchant-group.tsx` — collapsible group: always-visible header (name, count, `MerchantCategoryForm`) + lazy-loaded, cached transaction list.
- **Modify** `src/app/(app)/categorize/page.tsx` — read `searchParams.merchant`, compute per-section counts, prefetch the deep-linked merchant's transactions server-side, render `MerchantGroup` for both sections instead of the flat `<li>` + `MerchantCategoryForm` layout.
- **Modify** `src/components/transactions/transaction-list.tsx` — drop `CategoryBadge` usage and the now-unused row fields; render a `Link` to `/categorize?merchant=...#group-...` instead.
- **Delete** `src/components/transactions/category-badge.tsx` — superseded by `TransactionDetailRow`.
- **Modify** `src/app/(app)/page.tsx` — simplify `recentTransactions` mapping (drop `overrideCategoryId`/`merchantRuleCategoryId`/`merchantRulePurposeContains`, drop now-unused `findGoverningMerchantRule` import, drop `categories` prop passed to `TransactionList`).
- **Modify** `src/app/(app)/accounts/[id]/page.tsx` — same simplification as above.

---

### Task 1: `getMerchantTransactionsForKey` pure query function + test

**Files:**
- Modify: `src/app/(app)/actions/category-mutations.ts`
- Test: `src/app/(app)/actions/category-mutations.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface MerchantTransactionRow {
    id: number;
    bookingDate: string;
    amountCents: number;
    currency: string;
    purpose: string | null;
    effectiveCategory: { id: number; name: string } | null;
    overrideCategoryId: number | null;
    exactPurposeRuleCategoryId: number | null;
  }
  export async function getMerchantTransactionsForKey(merchantKey: string): Promise<MerchantTransactionRow[]>
  ```
  Rows are sorted newest-first (`bookingDate` desc, `id` desc as tiebreak). `exactPurposeRuleCategoryId` is the `categoryId` of an existing purpose-scoped rule for this merchant whose `purposeContains` exactly equals this transaction's full `purpose` text, or `null` — used later (Task 3) to prefill the "Verwendungszweck enthält" picker so re-saving an untouched field updates that rule instead of creating a duplicate.

- [ ] **Step 1: Write the failing tests**

Add to `src/app/(app)/actions/category-mutations.test.ts`, after the existing `describe('deleteCategory', ...)` block (before the final closing of the file):

```ts
describe('getMerchantTransactionsForKey', () => {
  test("returns only this merchant's transactions, newest first, with resolved category", async () => {
    const { db, schema, getMerchantTransactionsForKey } = await freshDb();

    const [category] = await db.insert(schema.categories).values({ name: 'Lebensmittel' }).returning();
    await seedTransaction(db, schema, {
      bookingDate: '2026-08-10',
      externalHash: 'hash-1',
      categoryOverrideId: category.id,
    });
    await seedTransaction(db, schema, {
      bookingDate: '2026-08-20',
      externalHash: 'hash-2',
    });
    await seedTransaction(db, schema, {
      counterparty: 'Aldi Süd',
      bookingDate: '2026-08-15',
      externalHash: 'hash-3',
    });

    const rows = await getMerchantTransactionsForKey('Rewe Markt GmbH');

    expect(rows.map((r) => r.bookingDate)).toEqual(['2026-08-20', '2026-08-10']);
    expect(rows[1].effectiveCategory).toEqual({ id: category.id, name: 'Lebensmittel' });
    expect(rows[1].overrideCategoryId).toBe(category.id);
    expect(rows[0].effectiveCategory).toBeNull();
    expect(rows[0].overrideCategoryId).toBeNull();
  });

  test('includes the account currency for each transaction', async () => {
    const { db, schema, getMerchantTransactionsForKey } = await freshDb();
    const [usdAccount] = await db
      .insert(schema.accounts)
      .values({ name: 'US-Konto', currency: 'USD', createdAt: new Date() })
      .returning();
    await db.insert(schema.transactions).values({
      accountId: usdAccount.id,
      bookingDate: '2026-08-12',
      amountCents: -500,
      counterparty: 'REWE Markt GmbH',
      purpose: null,
      externalHash: 'hash-usd',
    });

    const rows = await getMerchantTransactionsForKey('Rewe Markt GmbH');

    expect(rows).toHaveLength(1);
    expect(rows[0].currency).toBe('USD');
  });

  test("sets exactPurposeRuleCategoryId only when a rule's purposeContains exactly equals the full purpose", async () => {
    const { db, schema, getMerchantTransactionsForKey } = await freshDb();
    const [category] = await db.insert(schema.categories).values({ name: 'Onlineshopping' }).returning();
    await db.insert(schema.merchantCategoryRules).values({
      merchantKey: 'Amazon',
      purposeContains: 'AMAZON MKTPLC DE',
      categoryId: category.id,
    });
    await seedTransaction(db, schema, {
      counterparty: 'Amazon',
      purpose: 'AMAZON MKTPLC DE',
      externalHash: 'hash-1',
    });
    await seedTransaction(db, schema, {
      counterparty: 'Amazon',
      purpose: 'AMAZON MKTPLC DE 1234',
      externalHash: 'hash-2',
    });

    const rows = await getMerchantTransactionsForKey('Amazon');
    const exact = rows.find((r) => r.purpose === 'AMAZON MKTPLC DE');
    const partial = rows.find((r) => r.purpose === 'AMAZON MKTPLC DE 1234');

    expect(exact?.exactPurposeRuleCategoryId).toBe(category.id);
    expect(partial?.exactPurposeRuleCategoryId).toBeNull();
    // The purpose-scoped rule still governs the longer, non-exact-matching purpose too.
    expect(partial?.effectiveCategory).toEqual({ id: category.id, name: 'Onlineshopping' });
  });

  test('returns an empty array for a merchant key with no transactions', async () => {
    const { getMerchantTransactionsForKey } = await freshDb();

    const rows = await getMerchantTransactionsForKey('Nobody GmbH');

    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- category-mutations.test.ts`
Expected: FAIL — `getMerchantTransactionsForKey is not a function` (or similar), since the export doesn't exist yet.

- [ ] **Step 3: Implement `getMerchantTransactionsForKey`**

In `src/app/(app)/actions/category-mutations.ts`:

1. Change the top imports (currently `import { and, count, eq, isNull } from 'drizzle-orm';` and `import { categories, merchantCategoryRules, transactions } from '@/db/schema';`) to:

```ts
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/db/client';
import { accounts, categories, merchantCategoryRules, transactions } from '@/db/schema';
import { buildCategoryLookups, resolveTransactionCategory } from '@/lib/category-resolution';
import { getMerchantKey } from '@/lib/merchant-key';
```

(This keeps the existing `import { db } from '@/db/client';` line as-is — only the `drizzle-orm` and `@/db/schema` import lines change, and two new imports are added below them.)

2. Append at the end of the file (after `deleteCategory`):

```ts
export interface MerchantTransactionRow {
  id: number;
  bookingDate: string;
  amountCents: number;
  currency: string;
  purpose: string | null;
  effectiveCategory: { id: number; name: string } | null;
  overrideCategoryId: number | null;
  /** Category of an existing purpose-scoped rule whose purposeContains exactly equals
   *  this transaction's full purpose text, if any — prefills the "Verwendungszweck
   *  enthält" picker so re-saving the untouched field updates that rule instead of
   *  creating a duplicate. Null when no such exact-match rule exists (the common case). */
  exactPurposeRuleCategoryId: number | null;
}

/**
 * All transactions for one merchant (Gegenpartei), newest first, with their effective
 * category and per-row rule-picker prefill data. Powers `/categorize`'s per-group,
 * lazy-loaded transaction list (design spec §3).
 */
export async function getMerchantTransactionsForKey(merchantKey: string): Promise<MerchantTransactionRow[]> {
  const [categoryRows, ruleRows, allTransactions, accountRows] = await Promise.all([
    db.select().from(categories),
    db.select().from(merchantCategoryRules),
    db.select().from(transactions).orderBy(desc(transactions.bookingDate), desc(transactions.id)),
    db.select({ id: accounts.id, currency: accounts.currency }).from(accounts),
  ]);

  const { categoriesById, rulesByMerchantKey } = buildCategoryLookups(categoryRows, ruleRows);
  const rulesForMerchant = rulesByMerchantKey.get(merchantKey) ?? [];
  const currencyByAccountId = new Map(accountRows.map((a) => [a.id, a.currency]));

  return allTransactions
    .filter((tx) => getMerchantKey(tx) === merchantKey)
    .map((tx) => {
      const resolved = resolveTransactionCategory(tx, rulesByMerchantKey, categoriesById);
      const exactRule = tx.purpose !== null ? rulesForMerchant.find((r) => r.purposeContains === tx.purpose) : undefined;
      return {
        id: tx.id,
        bookingDate: tx.bookingDate,
        amountCents: tx.amountCents,
        currency: currencyByAccountId.get(tx.accountId) ?? 'EUR',
        purpose: tx.purpose,
        effectiveCategory: resolved.categoryId !== null ? { id: resolved.categoryId, name: resolved.categoryName! } : null,
        overrideCategoryId: tx.categoryOverrideId,
        exactPurposeRuleCategoryId: exactRule?.categoryId ?? null,
      };
    });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- category-mutations.test.ts`
Expected: PASS — all tests in the file, including the four new ones.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/actions/category-mutations.ts src/app/\(app\)/actions/category-mutations.test.ts
git commit -m "feat: add getMerchantTransactionsForKey query for categorize view redesign"
```

---

### Task 2: `getMerchantTransactions` server action

**Files:**
- Modify: `src/app/(app)/actions/categories.ts`

**Interfaces:**
- Consumes: `getMerchantTransactionsForKey(merchantKey: string): Promise<MerchantTransactionRow[]>` (Task 1, from `./category-mutations`).
- Produces: `getMerchantTransactions(merchantKey: string): Promise<MerchantTransactionRow[]>` — the `'use server'`-callable wrapper Client Components import. Re-exports `MerchantTransactionRow` as a type for consumers.

This is a pure read with no mutation, so unlike the other actions in this file it has no `ActionResult`/try-catch — it just requires a session and returns the rows (a thrown error surfaces to the caller like any other failed server-action call, which `MerchantGroup`'s `.catch()` in Task 4 handles).

- [ ] **Step 1: Add the wrapper**

In `src/app/(app)/actions/categories.ts`, change the import block from `./category-mutations`:

```ts
import {
  applyMerchantRule,
  applyTransactionOverride,
  deleteCategory as deleteCategoryMutation,
  getMerchantTransactionsForKey,
  renameCategory as renameCategoryMutation,
  type CategoryTarget,
  type MerchantTransactionRow,
} from './category-mutations';

export type { CategoryTarget, MerchantTransactionRow };
```

(Replaces the existing `import { ... } from './category-mutations';` block and the existing `export type { CategoryTarget };` line.)

Then add, anywhere after `revalidateCategorizedPages` (e.g. directly below it, before `setMerchantRule`):

```ts
export async function getMerchantTransactions(merchantKey: string): Promise<MerchantTransactionRow[]> {
  await requireSession();
  return getMerchantTransactionsForKey(merchantKey);
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run build`
Expected: Build succeeds (this task only adds a thin wrapper around an already-tested function — no new logic to unit test; `next build`'s type-checking is this repo's substitute for a standalone `typecheck` script, per its existing convention).

- [ ] **Step 3: Commit**

```bash
git add src/app/\(app\)/actions/categories.ts
git commit -m "feat: add getMerchantTransactions server action"
```

---

### Task 3: `TransactionDetailRow` component

**Files:**
- Create: `src/app/(app)/categorize/transaction-detail-row.tsx`

**Interfaces:**
- Consumes: `MerchantTransactionRow` (Task 1/2), `CategoryPicker` (`@/components/category-picker`, unchanged), `setMerchantRule`/`setTransactionOverride` (`@/app/(app)/actions/categories`, unchanged), `formatCents`/`formatDayHeading` (`@/lib/format`, unchanged).
- Produces:
  ```ts
  export function TransactionDetailRow({
    tx,
    merchantKey,
    categories,
  }: {
    tx: MerchantTransactionRow;
    merchantKey: string;
    categories: { id: number; name: string }[];
  }): JSX.Element
  ```
  Renders one `<li>`: date + amount, full purpose text, status badge, then two rule rows ("Nur diese Buchung" via `overrideCategoryId`/`setTransactionOverride`; "Verwendungszweck enthält" via a locally-editable text input seeded from `tx.purpose`, `exactPurposeRuleCategoryId`, and `setMerchantRule`).

No standalone unit test — this is pure JSX composition with no exported logic beyond rendering (matches this repo's existing convention of not writing `.tsx` tests for presentational components like `merchant-category-form.tsx`). Verified via Task 9's build/lint pass and manual check.

- [ ] **Step 1: Create the component**

```tsx
'use client';

import { useState } from 'react';
import { setMerchantRule, setTransactionOverride } from '@/app/(app)/actions/categories';
import type { MerchantTransactionRow } from '@/app/(app)/actions/categories';
import { CategoryPicker } from '@/components/category-picker';
import { formatCents, formatDayHeading } from '@/lib/format';

export function TransactionDetailRow({
  tx,
  merchantKey,
  categories,
}: {
  tx: MerchantTransactionRow;
  merchantKey: string;
  categories: { id: number; name: string }[];
}) {
  const [purposeText, setPurposeText] = useState(tx.purpose ?? '');

  return (
    <li className="space-y-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm text-muted-foreground">{formatDayHeading(tx.bookingDate)}</span>
        <span className="text-sm font-medium tabular-nums text-foreground">
          {formatCents(tx.amountCents, tx.currency)}
        </span>
      </div>

      {tx.purpose && <p className="text-sm text-foreground">{tx.purpose}</p>}

      <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        {tx.effectiveCategory ? tx.effectiveCategory.name : 'Unkategorisiert'}
      </span>

      <div className="space-y-3 border-t border-border pt-2">
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Nur diese Buchung</p>
          <CategoryPicker
            categories={categories}
            selectedCategoryId={tx.overrideCategoryId}
            showClear={tx.overrideCategoryId !== null}
            clearLabel="Standard (Gegenpartei-Regel verwenden)"
            onSubmit={(target) => setTransactionOverride(tx.id, target)}
          />
        </div>

        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Verwendungszweck enthält</p>
          <input
            type="text"
            value={purposeText}
            onChange={(event) => setPurposeText(event.target.value)}
            aria-label="Verwendungszweck enthält"
            className="mb-2 w-64 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
          />
          <CategoryPicker
            categories={categories}
            selectedCategoryId={tx.exactPurposeRuleCategoryId}
            showClear={false}
            clearLabel="Kategorie entfernen"
            onSubmit={(target) => setMerchantRule(merchantKey, purposeText.trim(), target)}
          />
        </div>
      </div>
    </li>
  );
}
```

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: No errors on the new file.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(app\)/categorize/transaction-detail-row.tsx
git commit -m "feat: add TransactionDetailRow component"
```

---

### Task 4: `MerchantGroup` component (collapsible header + lazy-loaded body)

**Files:**
- Create: `src/app/(app)/categorize/merchant-group.tsx`

**Interfaces:**
- Consumes: `getMerchantTransactions` (Task 2), `MerchantTransactionRow` (Task 1/2), `TransactionDetailRow` (Task 3), `MerchantCategoryForm` (`./merchant-category-form`, unchanged), `MerchantRuleEntry` (`@/lib/category-resolution`, unchanged).
- Produces:
  ```ts
  export function MerchantGroup({
    merchantKey,
    txCount,
    categories,
    existingRules,
    initiallyOpen,
    initialTransactions,
  }: {
    merchantKey: string;
    txCount: number;
    categories: { id: number; name: string }[];
    existingRules?: MerchantRuleEntry[];
    initiallyOpen: boolean;
    initialTransactions: MerchantTransactionRow[] | null;
  }): JSX.Element
  ```
  Renders one `<li id="group-<encoded merchantKey>">`. Header (name, count, `MerchantCategoryForm`) is always visible. Body (transaction list) only renders when `isOpen`; transactions are fetched via `getMerchantTransactions` the first time the group opens with no `initialTransactions` already supplied, then cached in local state so re-toggling never re-fetches. The toggle button is intentionally separate from the `MerchantCategoryForm`'s interactive controls (a `<button>` cannot contain nested interactive elements like `<select>`/`<input>`), so it wraps only the chevron + name + count.

- [ ] **Step 1: Create the component**

```tsx
'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { getMerchantTransactions } from '@/app/(app)/actions/categories';
import type { MerchantTransactionRow } from '@/app/(app)/actions/categories';
import type { MerchantRuleEntry } from '@/lib/category-resolution';
import { cn } from '@/lib/utils';
import { MerchantCategoryForm } from './merchant-category-form';
import { TransactionDetailRow } from './transaction-detail-row';

export function MerchantGroup({
  merchantKey,
  txCount,
  categories,
  existingRules,
  initiallyOpen,
  initialTransactions,
}: {
  merchantKey: string;
  txCount: number;
  categories: { id: number; name: string }[];
  existingRules?: MerchantRuleEntry[];
  initiallyOpen: boolean;
  initialTransactions: MerchantTransactionRow[] | null;
}) {
  const [isOpen, setIsOpen] = useState(initiallyOpen);
  const [transactions, setTransactions] = useState<MerchantTransactionRow[] | null>(initialTransactions);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  function handleToggle() {
    const opening = !isOpen;
    setIsOpen(opening);
    if (opening && transactions === null && !isLoading) {
      setIsLoading(true);
      setLoadError(null);
      getMerchantTransactions(merchantKey)
        .then((rows) => setTransactions(rows))
        .catch((err) => setLoadError(err instanceof Error ? err.message : 'Fehler beim Laden der Buchungen.'))
        .finally(() => setIsLoading(false));
    }
  }

  return (
    <li id={`group-${encodeURIComponent(merchantKey)}`} className="px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={handleToggle} className="flex items-center gap-2 text-left">
          <ChevronDown
            className={cn('size-4 shrink-0 text-muted-foreground transition-transform duration-200', isOpen && 'rotate-180')}
            aria-hidden="true"
          />
          <span>
            <p className="font-medium text-foreground">{merchantKey}</p>
            <p className="text-xs text-muted-foreground">
              {txCount} Buchung{txCount === 1 ? '' : 'en'}
            </p>
          </span>
        </button>
        <MerchantCategoryForm merchantKey={merchantKey} categories={categories} existingRules={existingRules} />
      </div>

      {isOpen && (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          {isLoading && <p className="text-sm text-muted-foreground">Lädt…</p>}
          {loadError && <p className="text-sm text-destructive">{loadError}</p>}
          {transactions && (
            <ul className="space-y-2">
              {transactions.map((tx) => (
                <TransactionDetailRow key={tx.id} tx={tx} merchantKey={merchantKey} categories={categories} />
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
```

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: No errors on the new file.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(app\)/categorize/merchant-group.tsx
git commit -m "feat: add MerchantGroup collapsible lazy-loading component"
```

---

### Task 5: Rewrite `/categorize/page.tsx`

**Files:**
- Modify: `src/app/(app)/categorize/page.tsx`

**Interfaces:**
- Consumes: `getMerchantTransactionsForKey` (Task 1, called directly server-side — no need to go through the `'use server'` wrapper since the page already calls `requireSession()`), `MerchantGroup` (Task 4).

The uncategorized section keeps its existing count semantics unchanged (count of that merchant's still-unresolved transactions — the number the "Unkategorisiert" view has always shown and been reviewed against). The "already categorized" section, which today shows no count at all, gains one: total transactions for that merchant (there's no "uncategorized count" to show there, since by definition every one of its transactions is governed by some rule already).

- [ ] **Step 1: Replace the file contents**

```tsx
import Link from 'next/link';
import { db } from '@/db/client';
import { categories, merchantCategoryRules, transactions } from '@/db/schema';
import { requireSession } from '@/lib/session';
import { buildCategoryLookups, resolveTransactionCategory } from '@/lib/category-resolution';
import { getMerchantKey } from '@/lib/merchant-key';
import { getMerchantTransactionsForKey } from '../actions/category-mutations';
import { MerchantGroup } from './merchant-group';

export const dynamic = 'force-dynamic';

export default async function CategorizePage({
  searchParams,
}: {
  searchParams: Promise<{ merchant?: string }>;
}) {
  await requireSession();
  const { merchant: deepLinkMerchant } = await searchParams;

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
  const totalCountByMerchant = new Map<string, number>();
  for (const tx of allTransactions) {
    const key = getMerchantKey(tx);
    totalCountByMerchant.set(key, (totalCountByMerchant.get(key) ?? 0) + 1);
    if (resolveTransactionCategory(tx, rulesByMerchantKey, categoriesById).source === 'none') {
      // A merchant with any rule at all belongs in the "already categorized" section below,
      // even if that rule doesn't cover every one of its transactions — a merchant appears
      // in exactly one section, never both.
      if (rulesByMerchantKey.has(key)) continue;
      uncategorizedCountByMerchant.set(key, (uncategorizedCountByMerchant.get(key) ?? 0) + 1);
    }
  }

  const merchantGroups = [...uncategorizedCountByMerchant.entries()]
    .map(([merchantKey, txCount]) => ({ merchantKey, txCount }))
    .sort((a, b) => b.txCount - a.txCount);

  const categorizedMerchantKeys = [...rulesByMerchantKey.keys()].sort((a, b) => a.localeCompare(b));

  const deepLinkTransactions =
    deepLinkMerchant !== undefined ? await getMerchantTransactionsForKey(deepLinkMerchant) : null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Zurück
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-foreground">Unkategorisiert</h1>
          <Link href="/categories" className="text-sm text-muted-foreground hover:text-foreground">
            Kategorien verwalten
          </Link>
        </div>
      </div>

      {merchantGroups.length === 0 ? (
        <p className="rounded-lg border border-border bg-card px-4 py-8 text-center text-muted-foreground">
          Alle Gegenparteien sind kategorisiert.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {merchantGroups.map((group) => (
            <MerchantGroup
              key={group.merchantKey}
              merchantKey={group.merchantKey}
              txCount={group.txCount}
              categories={categoryRows}
              initiallyOpen={group.merchantKey === deepLinkMerchant}
              initialTransactions={group.merchantKey === deepLinkMerchant ? deepLinkTransactions : null}
            />
          ))}
        </ul>
      )}

      {categorizedMerchantKeys.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-foreground">Bereits kategorisierte Gegenparteien</h2>
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-card">
            {categorizedMerchantKeys.map((merchantKey) => (
              <MerchantGroup
                key={merchantKey}
                merchantKey={merchantKey}
                txCount={totalCountByMerchant.get(merchantKey) ?? 0}
                categories={categoryRows}
                existingRules={rulesByMerchantKey.get(merchantKey)!}
                initiallyOpen={merchantKey === deepLinkMerchant}
                initialTransactions={merchantKey === deepLinkMerchant ? deepLinkTransactions : null}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Lint + build**

Run: `npm run lint && npm run build`
Expected: Both succeed. (`getMerchantTransactionsForKey` is now used both server-side here and via the `getMerchantTransactions` wrapper client-side in `MerchantGroup` — both call sites should typecheck against the same `MerchantTransactionRow` shape.)

- [ ] **Step 3: Commit**

```bash
git add src/app/\(app\)/categorize/page.tsx
git commit -m "feat: rewrite /categorize with collapsible lazy-loaded merchant groups"
```

---

### Task 6: Migrate `TransactionList` off `CategoryBadge`; delete `CategoryBadge`

**Files:**
- Modify: `src/components/transactions/transaction-list.tsx`
- Delete: `src/components/transactions/category-badge.tsx`

**Interfaces:**
- Produces (breaking change from the current shape): `TransactionListRow` drops `overrideCategoryId`, `merchantRuleCategoryId`, `merchantRulePurposeContains`. `TransactionList`/`TransactionRow` drop the `categories` prop (no longer needed — nothing here renders `CategoryPicker` anymore).

- [ ] **Step 1: Rewrite `transaction-list.tsx`**

```tsx
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { formatCents, formatDayHeading } from '@/lib/format';
import { deriveTransactionDisplay } from '@/lib/transaction-display';
import { groupTransactionsByDay } from '@/lib/transaction-grouping';
import { cn } from '@/lib/utils';

export interface TransactionListRow {
  id: number;
  bookingDate: string;
  counterparty: string | null;
  purpose: string | null;
  amountCents: number;
  merchantKey: string;
  effectiveCategory: { id: number; name: string } | null;
}

function amountColorClass(amountCents: number): string {
  if (amountCents < 0) return 'text-destructive';
  if (amountCents > 0) return 'text-positive';
  return 'text-foreground';
}

function TransactionRow({ tx, currency }: { tx: TransactionListRow; currency: string }) {
  const { title, context } = deriveTransactionDisplay(tx);
  const categorizeHref = `/categorize?merchant=${encodeURIComponent(tx.merchantKey)}#group-${encodeURIComponent(tx.merchantKey)}`;

  return (
    <li className="px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate font-medium text-foreground">{title}</span>
        <span className={cn('shrink-0 tabular-nums font-medium', amountColorClass(tx.amountCents))}>
          {formatCents(tx.amountCents, currency)}
        </span>
      </div>
      {context && <p className="mt-0.5 truncate text-xs text-muted-foreground">{context}</p>}
      <Link
        href={categorizeHref}
        className="mt-1 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        {tx.effectiveCategory ? tx.effectiveCategory.name : 'Unkategorisiert'}
      </Link>
    </li>
  );
}

export function TransactionList({ rows, currency }: { rows: TransactionListRow[]; currency: string }) {
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
              <TransactionRow key={tx.id} tx={tx} currency={currency} />
            ))}
            {group.collapsed && (
              <li>
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm text-muted-foreground hover:text-foreground">
                    <span className="flex items-center gap-2">
                      <ChevronDown className="size-4 shrink-0 transition-transform duration-200 group-open:rotate-180" aria-hidden="true" />
                      {group.collapsed.transactions.length} weitere Buchungen
                    </span>
                    <span className={cn('tabular-nums', amountColorClass(group.collapsed.totalCents))}>
                      {formatCents(group.collapsed.totalCents, currency)}
                    </span>
                  </summary>
                  <ul className="divide-y divide-border border-t border-border">
                    {group.collapsed.transactions.map((tx) => (
                      <TransactionRow key={tx.id} tx={tx} currency={currency} />
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

- [ ] **Step 2: Delete `category-badge.tsx`**

```bash
rm "src/components/transactions/category-badge.tsx"
```

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: No errors in `transaction-list.tsx`. This step intentionally does not run `npm run build` yet — the dashboard and account pages (Tasks 7–8) still pass the old row shape and the now-removed `categories` prop, so the build fails until those are updated. That's expected and fixed next.

- [ ] **Step 4: Commit**

```bash
git add src/components/transactions/transaction-list.tsx
git rm src/components/transactions/category-badge.tsx
git commit -m "feat: replace CategoryBadge with a link to /categorize in TransactionList"
```

---

### Task 7: Simplify dashboard page (`src/app/(app)/page.tsx`)

**Files:**
- Modify: `src/app/(app)/page.tsx`

**Interfaces:**
- Consumes: `TransactionListRow` (Task 6) — `recentTransactions` must now match its narrowed shape, and `<TransactionList>` no longer takes a `categories` prop.

- [ ] **Step 1: Simplify the imports and `recentTransactions` mapping**

Change:

```ts
import { buildCategoryLookups, findGoverningMerchantRule, resolveTransactionCategory } from '@/lib/category-resolution';
```

to:

```ts
import { buildCategoryLookups, resolveTransactionCategory } from '@/lib/category-resolution';
```

(`resolveTransactionCategory` is still used both for `resolvedTxsWithCategory`/stats and for the uncategorized-badge loop further down — only `findGoverningMerchantRule` becomes unused.)

Change the `recentTransactions` mapping from:

```ts
  const recentTransactions = recentRawTxs.map((tx) => {
    const resolved = resolveTransactionCategory(tx, rulesByMerchantKey, categoriesById);
    const merchantKey = getMerchantKey(tx);
    const governingRule = findGoverningMerchantRule(tx, rulesByMerchantKey);
    return {
      ...tx,
      merchantKey,
      effectiveCategory: resolved.categoryId !== null ? { id: resolved.categoryId, name: resolved.categoryName! } : null,
      overrideCategoryId: tx.categoryOverrideId,
      merchantRuleCategoryId: governingRule?.categoryId ?? null,
      merchantRulePurposeContains: governingRule?.purposeContains ?? null,
    };
  });
```

to:

```ts
  const recentTransactions = recentRawTxs.map((tx) => {
    const resolved = resolveTransactionCategory(tx, rulesByMerchantKey, categoriesById);
    const merchantKey = getMerchantKey(tx);
    return {
      ...tx,
      merchantKey,
      effectiveCategory: resolved.categoryId !== null ? { id: resolved.categoryId, name: resolved.categoryName! } : null,
    };
  });
```

- [ ] **Step 2: Drop the `categories` prop from `<TransactionList>`**

Change:

```tsx
        <TransactionList rows={recentTransactions} currency={account.currency} categories={categoryRows} />
```

to:

```tsx
        <TransactionList rows={recentTransactions} currency={account.currency} />
```

(`categoryRows` itself stays — it's still fetched and used by `buildCategoryLookups` above.)

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: No errors, no unused-import warnings.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/page.tsx
git commit -m "refactor: simplify dashboard TransactionList wiring after CategoryBadge removal"
```

---

### Task 8: Simplify account page (`src/app/(app)/accounts/[id]/page.tsx`)

**Files:**
- Modify: `src/app/(app)/accounts/[id]/page.tsx`

**Interfaces:**
- Same as Task 7 — `rows` must match `TransactionListRow` (Task 6), `<TransactionList>` drops the `categories` prop.

- [ ] **Step 1: Simplify the imports and `rows` mapping**

Change:

```ts
import { buildCategoryLookups, findGoverningMerchantRule, resolveTransactionCategory } from '@/lib/category-resolution';
```

to:

```ts
import { buildCategoryLookups, resolveTransactionCategory } from '@/lib/category-resolution';
```

Change:

```ts
  const rows = rawRows.map((tx) => {
    const resolved = resolveTransactionCategory(tx, rulesByMerchantKey, categoriesById);
    const merchantKey = getMerchantKey(tx);
    const governingRule = findGoverningMerchantRule(tx, rulesByMerchantKey);
    return {
      ...tx,
      merchantKey,
      effectiveCategory: resolved.categoryId !== null ? { id: resolved.categoryId, name: resolved.categoryName! } : null,
      overrideCategoryId: tx.categoryOverrideId,
      merchantRuleCategoryId: governingRule?.categoryId ?? null,
      merchantRulePurposeContains: governingRule?.purposeContains ?? null,
    };
  });
```

to:

```ts
  const rows = rawRows.map((tx) => {
    const resolved = resolveTransactionCategory(tx, rulesByMerchantKey, categoriesById);
    const merchantKey = getMerchantKey(tx);
    return {
      ...tx,
      merchantKey,
      effectiveCategory: resolved.categoryId !== null ? { id: resolved.categoryId, name: resolved.categoryName! } : null,
    };
  });
```

- [ ] **Step 2: Drop the `categories` prop from `<TransactionList>`**

Change:

```tsx
      <TransactionList rows={rows} currency={account.currency} categories={categoryRows} />
```

to:

```tsx
      <TransactionList rows={rows} currency={account.currency} />
```

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: No errors, no unused-import warnings.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/accounts/\[id\]/page.tsx
git commit -m "refactor: simplify account page TransactionList wiring after CategoryBadge removal"
```

---

### Task 9: Full quality gate + manual verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full automated quality gate**

Run: `npm run lint && npm test && npm run build`
Expected: All three succeed with no errors. This is the point where every earlier task's individual lint/test/build checks are re-verified together — e.g. Task 6 intentionally left the build red until Tasks 7–8 landed; this is the first point in the plan where a full `npm run build` is expected to pass end-to-end.

- [ ] **Step 2: Manual browser walkthrough**

Start the dev server (`npm run dev`) and, in a browser:

1. Navigate to `/categorize`. Confirm every group in both sections renders collapsed (no transaction list visible), and each header shows a name, a Buchungsanzahl, and the "Alle Buchungen dieser Gegenpartei" picker — all while still collapsed.
2. Click a group header in the "Unkategorisiert" section. Confirm it expands, briefly shows "Lädt…", then shows every one of that merchant's transactions with date, amount, full purpose text, and status badge.
3. On one transaction, edit the "Verwendungszweck enthält" text field to a substring of its purpose, pick a category, and save. Confirm a success toast appears and the transaction's status badge (after the page revalidates) reflects the new category.
4. Collapse and re-expand the same group. Confirm no second "Lädt…" flash occurs (the fetched transactions are cached in local state).
5. Navigate to `/` (dashboard). Click the status-badge link on one of the "Letzte Buchungen" rows. Confirm it lands on `/categorize` with that transaction's Gegenpartei-group already expanded and scrolled into view, with its transactions already visible (no loading flash, since the deep-linked group's transactions were fetched server-side).
6. Repeat step 5 from `/accounts/<id>`.
7. Confirm no page anywhere still shows the old `CategoryBadge` popover-style click-to-expand-inline-picker interaction on a transaction row (only the link to `/categorize`).

- [ ] **Step 3: Fix any issues found, re-run Step 1, then final commit if anything changed**

If the manual walkthrough surfaces a bug, fix it in the relevant file from Tasks 1–8, re-run `npm run lint && npm test && npm run build`, and commit the fix separately with a message describing what was wrong (no fixed content to template here — the fix depends on what Step 2 actually finds).
