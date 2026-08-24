# Kategorien verwalten (umbenennen, löschen) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user rename and delete existing categories from a new `/categories` page, with deletion blocked (and usage counts shown) whenever a category is still referenced by transactions or merchant rules.

**Architecture:** Two new pure-DB functions (`renameCategory`, `deleteCategory`, plus a shared `countCategoryUsage` helper) alongside the existing `applyMerchantRule`/`applyTransactionOverride` in `category-mutations.ts`; two new `'use server'` wrappers in `actions/categories.ts` following the exact `ActionResult` pattern already used there; one new server-rendered page plus one client row component, wired into the existing nav and into `/categorize`.

**Tech Stack:** Next.js App Router (Server Components + Server Actions), Drizzle ORM over better-sqlite3 (`foreign_keys = ON`), Vitest, Tailwind utility classes matching the existing design tokens (`text-foreground`, `text-muted-foreground`, `text-destructive`, `border-border`, `bg-card`, `bg-primary`).

**Spec:** `docs/superpowers/specs/2026-08-24-category-management-design.md`

## Global Constraints

- All server actions call `requireSession()` before touching the DB (see `src/lib/session.ts`, used by every existing action in `actions/categories.ts`).
- Mutations return `Promise<void>` and `throw` on failure; the `'use server'` wrapper layer catches and converts to `ActionResult = { ok: true } | { ok: false; error: string }` — never let a raw exception cross the Server Action boundary (matches `setMerchantRule`/`setTransactionOverride`).
- All user-facing error strings are in German, matching existing copy (e.g. `„…" überschneidet sich mit der bestehenden Regel „…" für diese Gegenpartei.`).
- Deletion must re-check usage **server-side** at the moment of deletion, not trust a count computed when the page was rendered (protects against a race where a rule/override was added after page load).
- No schema changes — `categories`, `transactions.categoryOverrideId`, `merchantCategoryRules.categoryId` are unchanged (see `src/db/schema.ts:11-51`).
- No category creation on the new page — creation stays exclusively in `CategoryPicker` (`src/components/category-picker.tsx`).
- No merge/reassign-on-delete — deletion is blocked outright while in use (spec §Ziel, explicitly out of scope).

---

### Task 1: `countCategoryUsage`, `renameCategory`, `deleteCategory` in `category-mutations.ts`

**Files:**
- Modify: `src/app/(app)/actions/category-mutations.ts`
- Test: `src/app/(app)/actions/category-mutations.test.ts`

**Interfaces:**
- Consumes: `db` from `@/db/client`, `categories`/`transactions`/`merchantCategoryRules` from `@/db/schema` (all already imported in this file), `eq`/`count` from `drizzle-orm` (`and`, `eq`, `isNull` already imported — add `count`).
- Produces (used by Task 2 and Task 3):
  - `countCategoryUsage(categoryId: number): Promise<{ transactionCount: number; ruleCount: number }>`
  - `renameCategory(categoryId: number, name: string): Promise<void>` — throws `Error` with a German message on empty name or name collision.
  - `deleteCategory(categoryId: number): Promise<void>` — throws `Error` with a German message (including current counts) when still in use.

- [ ] **Step 1: Write the failing tests**

Append to `src/app/(app)/actions/category-mutations.test.ts`, right before the final closing of the file (after the existing `describe('applyTransactionOverride', ...)` block):

```typescript
describe('countCategoryUsage', () => {
  test('counts transaction overrides and merchant rules independently', async () => {
    const { db, schema, countCategoryUsage } = await freshDb();
    const [category] = await db.insert(schema.categories).values({ name: 'Lebensmittel' }).returning();
    await seedTransaction(db, schema, { categoryOverrideId: category.id, externalHash: 'hash-a' });
    await seedTransaction(db, schema, { categoryOverrideId: category.id, externalHash: 'hash-b' });
    await db.insert(schema.merchantCategoryRules).values({ merchantKey: 'REWE Markt GmbH', categoryId: category.id });

    const usage = await countCategoryUsage(category.id);

    expect(usage).toEqual({ transactionCount: 2, ruleCount: 1 });
  });

  test('returns zero counts for an unused category', async () => {
    const { db, schema, countCategoryUsage } = await freshDb();
    const [category] = await db.insert(schema.categories).values({ name: 'Sonstiges' }).returning();

    const usage = await countCategoryUsage(category.id);

    expect(usage).toEqual({ transactionCount: 0, ruleCount: 0 });
  });
});

describe('renameCategory', () => {
  test('renaming a category updates its name', async () => {
    const { db, schema, renameCategory } = await freshDb();
    const [category] = await db.insert(schema.categories).values({ name: 'Lebensmittel' }).returning();

    await renameCategory(category.id, 'Essen & Trinken');

    const [updated] = await db.select().from(schema.categories).where(eq(schema.categories.id, category.id));
    expect(updated.name).toBe('Essen & Trinken');
  });

  test('renaming to an empty or whitespace-only name throws', async () => {
    const { db, schema, renameCategory } = await freshDb();
    const [category] = await db.insert(schema.categories).values({ name: 'Lebensmittel' }).returning();

    await expect(renameCategory(category.id, '   ')).rejects.toThrow(/darf nicht leer sein/);

    const [unchanged] = await db.select().from(schema.categories).where(eq(schema.categories.id, category.id));
    expect(unchanged.name).toBe('Lebensmittel');
  });

  test('renaming to a name already used by another category throws a friendly error', async () => {
    const { db, schema, renameCategory } = await freshDb();
    const [a] = await db.insert(schema.categories).values({ name: 'Lebensmittel' }).returning();
    await db.insert(schema.categories).values({ name: 'Gehalt' });

    await expect(renameCategory(a.id, 'Gehalt')).rejects.toThrow(/gibt bereits eine Kategorie/);

    const [unchanged] = await db.select().from(schema.categories).where(eq(schema.categories.id, a.id));
    expect(unchanged.name).toBe('Lebensmittel');
  });

  test('renaming a category to its own current name is a no-op that does not throw', async () => {
    const { db, schema, renameCategory } = await freshDb();
    const [category] = await db.insert(schema.categories).values({ name: 'Lebensmittel' }).returning();

    await expect(renameCategory(category.id, 'Lebensmittel')).resolves.toBeUndefined();
  });
});

describe('deleteCategory', () => {
  test('deleting an unused category removes it', async () => {
    const { db, schema, deleteCategory } = await freshDb();
    const [category] = await db.insert(schema.categories).values({ name: 'Sonstiges' }).returning();

    await deleteCategory(category.id);

    const remaining = await db.select().from(schema.categories);
    expect(remaining).toHaveLength(0);
  });

  test('deleting a category referenced by a transaction override throws and leaves it intact', async () => {
    const { db, schema, deleteCategory } = await freshDb();
    const [category] = await db.insert(schema.categories).values({ name: 'Lebensmittel' }).returning();
    await seedTransaction(db, schema, { categoryOverrideId: category.id });

    await expect(deleteCategory(category.id)).rejects.toThrow(/1 Buchung/);

    const remaining = await db.select().from(schema.categories);
    expect(remaining).toHaveLength(1);
  });

  test('deleting a category referenced by a merchant rule throws and leaves it intact', async () => {
    const { db, schema, deleteCategory } = await freshDb();
    const [category] = await db.insert(schema.categories).values({ name: 'Lebensmittel' }).returning();
    await db.insert(schema.merchantCategoryRules).values({ merchantKey: 'REWE Markt GmbH', categoryId: category.id });

    await expect(deleteCategory(category.id)).rejects.toThrow(/1 Regel/);

    const remaining = await db.select().from(schema.categories);
    expect(remaining).toHaveLength(1);
  });

  test('the error message reports both counts when both are in use', async () => {
    const { db, schema, deleteCategory } = await freshDb();
    const [category] = await db.insert(schema.categories).values({ name: 'Lebensmittel' }).returning();
    await seedTransaction(db, schema, { categoryOverrideId: category.id });
    await db.insert(schema.merchantCategoryRules).values({ merchantKey: 'REWE Markt GmbH', categoryId: category.id });

    await expect(deleteCategory(category.id)).rejects.toThrow(/1 Buchung.*1 Regel|1 Regel.*1 Buchung/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- category-mutations`
Expected: FAIL — `countCategoryUsage`, `renameCategory`, `deleteCategory` are not exported from `./category-mutations`.

- [ ] **Step 3: Implement the three functions**

In `src/app/(app)/actions/category-mutations.ts`, change the import line to add `count`:

```typescript
import { and, count, eq, isNull } from 'drizzle-orm';
```

Then append these three functions at the end of the file (after `applyTransactionOverride`):

```typescript
/**
 * Counts how many transactions have this category as their manual override,
 * and how many merchant rules assign this category — the two ways a category
 * can be "in use". Always queried fresh (never trust a client-supplied count),
 * since this backs the delete-blocking check as well as the usage display on
 * the categories page.
 */
export async function countCategoryUsage(
  categoryId: number
): Promise<{ transactionCount: number; ruleCount: number }> {
  const [{ value: transactionCount }] = await db
    .select({ value: count() })
    .from(transactions)
    .where(eq(transactions.categoryOverrideId, categoryId));
  const [{ value: ruleCount }] = await db
    .select({ value: count() })
    .from(merchantCategoryRules)
    .where(eq(merchantCategoryRules.categoryId, categoryId));
  return { transactionCount, ruleCount };
}

/** Renames a category. Throws a German-language error on an empty name or a name collision. */
export async function renameCategory(categoryId: number, name: string): Promise<void> {
  const trimmed = name.trim();
  if (trimmed === '') {
    throw new Error('Der Kategoriename darf nicht leer sein.');
  }
  try {
    await db.update(categories).set({ name: trimmed }).where(eq(categories.id, categoryId));
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new Error(`Es gibt bereits eine Kategorie namens „${trimmed}".`);
    }
    throw err;
  }
}

/**
 * Deletes a category. Re-checks usage immediately before deleting (see
 * `countCategoryUsage`) and throws a German-language error naming the current
 * counts instead of deleting — `categories` is referenced by a NOT NULL FK from
 * `merchantCategoryRules.categoryId`, so an in-use category can never be
 * deleted out from under a rule.
 */
export async function deleteCategory(categoryId: number): Promise<void> {
  const { transactionCount, ruleCount } = await countCategoryUsage(categoryId);
  if (transactionCount > 0 || ruleCount > 0) {
    const parts: string[] = [];
    if (transactionCount > 0) {
      parts.push(`${transactionCount} Buchung${transactionCount === 1 ? '' : 'en'}`);
    }
    if (ruleCount > 0) {
      parts.push(`${ruleCount} Regel${ruleCount === 1 ? '' : 'n'}`);
    }
    throw new Error(`Kategorie wird noch von ${parts.join(' und ')} verwendet.`);
  }
  await db.delete(categories).where(eq(categories.id, categoryId));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- category-mutations`
Expected: PASS — all tests in the file, including the new ones, green.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/actions/category-mutations.ts src/app/\(app\)/actions/category-mutations.test.ts
git commit -m "Add countCategoryUsage, renameCategory, deleteCategory mutations

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Server action wrappers in `actions/categories.ts`

**Files:**
- Modify: `src/app/(app)/actions/categories.ts`

**Interfaces:**
- Consumes: `renameCategory`, `deleteCategory` from `./category-mutations` (Task 1); `ActionResult`, `revalidateCategorizedPages` already defined in this file.
- Produces (used by Task 3): `renameCategory(categoryId: number, name: string): Promise<ActionResult>`, `deleteCategory(categoryId: number): Promise<ActionResult>`, both exported from `@/app/(app)/actions/categories`.

This task has no dedicated unit tests of its own — the existing `setMerchantRule`/`setTransactionOverride` wrappers in this same file follow the identical thin pass-through pattern and are likewise untested directly (their DB logic is fully covered by `category-mutations.test.ts`; `requireSession`/`revalidatePath` need a request context that isn't worth mocking here). Verified instead by Task 3's manual walkthrough and by `npm run build`.

- [ ] **Step 1: Extend `revalidateCategorizedPages` and add the two wrappers**

In `src/app/(app)/actions/categories.ts`, change the import line:

```typescript
import {
  applyMerchantRule,
  applyTransactionOverride,
  deleteCategory as deleteCategoryMutation,
  renameCategory as renameCategoryMutation,
  type CategoryTarget,
} from './category-mutations';
```

Update `revalidateCategorizedPages` to also revalidate the new page:

```typescript
function revalidateCategorizedPages() {
  revalidatePath('/');
  revalidatePath('/accounts/[id]', 'page');
  revalidatePath('/categorize');
  revalidatePath('/categories');
}
```

Append the two new exported actions at the end of the file:

```typescript
export async function renameCategory(categoryId: number, name: string): Promise<ActionResult> {
  await requireSession();
  try {
    await renameCategoryMutation(categoryId, name);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Fehler beim Speichern.' };
  }
  revalidateCategorizedPages();
  return { ok: true };
}

export async function deleteCategory(categoryId: number): Promise<ActionResult> {
  await requireSession();
  try {
    await deleteCategoryMutation(categoryId);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Fehler beim Löschen.' };
  }
  revalidateCategorizedPages();
  return { ok: true };
}
```

(The `as renameCategoryMutation`/`as deleteCategoryMutation` import aliases avoid a name collision with the exported wrapper functions of the same name in this file — the wrapper is the public API consumed by Task 3, the mutation is the internal DB call.)

- [ ] **Step 2: Run the existing test suite to confirm nothing broke**

Run: `npm test`
Expected: PASS — all existing tests still green (this file has no tests of its own, but a typo here would break the type-check in Step 3).

- [ ] **Step 3: Type-check**

Run: `npm run build`
Expected: Build succeeds with no TypeScript errors (the new page/component from Task 3 don't exist yet, so this only validates `categories.ts` itself compiles — a full green build happens at the end of Task 3).

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/actions/categories.ts
git commit -m "Add renameCategory and deleteCategory server actions

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `/categories` page, row component, and navigation

**Files:**
- Create: `src/app/(app)/categories/page.tsx`
- Create: `src/app/(app)/categories/category-row.tsx`
- Modify: `src/app/(app)/layout.tsx`
- Modify: `src/app/(app)/categorize/page.tsx`

**Interfaces:**
- Consumes: `db` from `@/db/client`; `categories` from `@/db/schema`; `requireSession` from `@/lib/session`; `countCategoryUsage` from `../actions/category-mutations` (Task 1, plain function, not a Server Action — importable directly into the Server Component like `categorize/page.tsx` already does with `buildCategoryLookups`); `renameCategory`, `deleteCategory` from `@/app/(app)/actions/categories` (Task 2, Server Actions, importable into the Client Component).
- Produces: the `/categories` route; `CategoryRow` (default export not needed — named export, client component, used only by `page.tsx`).

- [ ] **Step 1: Create the row component**

Create `src/app/(app)/categories/category-row.tsx`:

```typescript
'use client';

import { useState, useTransition } from 'react';
import { deleteCategory, renameCategory } from '@/app/(app)/actions/categories';

export interface CategoryUsage {
  transactionCount: number;
  ruleCount: number;
}

export function CategoryRow({
  category,
  usage,
}: {
  category: { id: number; name: string };
  usage: CategoryUsage;
}) {
  const [name, setName] = useState(category.name);
  const [persistedName, setPersistedName] = useState(category.name);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const trimmed = name.trim();
  const canRename = trimmed !== '' && trimmed !== persistedName;
  const isInUse = usage.transactionCount > 0 || usage.ruleCount > 0;

  function handleRename() {
    setRenameError(null);
    startTransition(async () => {
      const result = await renameCategory(category.id, trimmed);
      if (result.ok) {
        setPersistedName(trimmed);
      } else {
        setRenameError(result.error);
      }
    });
  }

  function handleDelete() {
    setDeleteError(null);
    startTransition(async () => {
      const result = await deleteCategory(category.id);
      if (!result.ok) {
        setDeleteError(result.error);
      }
    });
  }

  const usageParts = [
    usage.transactionCount > 0
      ? `${usage.transactionCount} Buchung${usage.transactionCount === 1 ? '' : 'en'}`
      : null,
    usage.ruleCount > 0 ? `${usage.ruleCount} Regel${usage.ruleCount === 1 ? '' : 'n'}` : null,
  ].filter((part): part is string => part !== null);

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={isPending}
          aria-label={`Name von Kategorie „${persistedName}"`}
          className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
        />
        <button
          type="button"
          onClick={handleRename}
          disabled={isPending || !canRename}
          className="rounded-md bg-primary px-2 py-1 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          Speichern
        </button>
        {renameError && <p className="text-xs text-destructive">{renameError}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-muted-foreground">
          {usageParts.length > 0 ? usageParts.join(' · ') : 'Nicht verwendet'}
        </p>
        <button
          type="button"
          onClick={handleDelete}
          disabled={isPending || isInUse}
          title={isInUse ? 'Kategorie ist noch in Gebrauch und kann nicht gelöscht werden.' : undefined}
          className="text-xs text-destructive hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
        >
          Löschen
        </button>
        {deleteError && <p className="text-xs text-destructive">{deleteError}</p>}
      </div>
    </li>
  );
}
```

- [ ] **Step 2: Create the page**

Create `src/app/(app)/categories/page.tsx`:

```typescript
import Link from 'next/link';
import { db } from '@/db/client';
import { categories } from '@/db/schema';
import { requireSession } from '@/lib/session';
import { countCategoryUsage } from '../actions/category-mutations';
import { CategoryRow } from './category-row';

export const dynamic = 'force-dynamic';

export default async function CategoriesPage() {
  await requireSession();

  const categoryRows = await db.select().from(categories);
  const sorted = [...categoryRows].sort((a, b) => a.name.localeCompare(b.name));
  const rowsWithUsage = await Promise.all(
    sorted.map(async (category) => ({
      category,
      usage: await countCategoryUsage(category.id),
    }))
  );

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Zurück
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-foreground">Kategorien</h1>
      </div>

      {rowsWithUsage.length === 0 ? (
        <p className="rounded-lg border border-border bg-card px-4 py-8 text-center text-muted-foreground">
          Noch keine Kategorien angelegt.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {rowsWithUsage.map(({ category, usage }) => (
            <CategoryRow key={category.id} category={category} usage={usage} />
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add the nav link**

In `src/app/(app)/layout.tsx`, add a link right after the existing `Import` link:

```typescript
          <Link href="/import" className="text-sm text-muted-foreground hover:text-foreground">
            Import
          </Link>
          <Link href="/categories" className="text-sm text-muted-foreground hover:text-foreground">
            Kategorien
          </Link>
```

- [ ] **Step 4: Add the link from `/categorize`**

In `src/app/(app)/categorize/page.tsx`, replace the header block:

```typescript
      <div>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Zurück
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-foreground">Unkategorisiert</h1>
      </div>
```

with:

```typescript
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
```

- [ ] **Step 5: Run the full test suite, lint, and build**

Run: `npm test`
Expected: PASS — all tests green, including the ones added in Task 1.

Run: `npm run lint`
Expected: No errors.

Run: `npm run build`
Expected: Build succeeds with no TypeScript errors, `/categories` listed among the built routes.

- [ ] **Step 6: Manual walkthrough**

Run: `npm run dev`, then in the browser:
1. Open `/` → confirm "Kategorien" appears in the nav next to "Import" → click it.
2. On `/categories`, confirm every existing category is listed alphabetically with its usage counts (or "Nicht verwendet").
3. Rename a category that is in use → save → confirm the new name persists and the "Löschen" button is still disabled for it.
4. Try renaming a category to a name that already exists on another category → confirm the inline German error appears and the name is unchanged.
5. Confirm an in-use category's "Löschen" button is disabled with a tooltip explaining why.
6. Create a throwaway category via any existing `CategoryPicker` (e.g. on `/categorize`) without assigning it anywhere → go to `/categories` → confirm it shows "Nicht verwendet" and its "Löschen" button is enabled → delete it → confirm it disappears from the list.
7. Open `/categorize` → confirm the "Kategorien verwalten" link is present and navigates to `/categories`.

- [ ] **Step 7: Commit**

```bash
git add src/app/\(app\)/categories src/app/\(app\)/layout.tsx src/app/\(app\)/categorize/page.tsx
git commit -m "Add /categories page for renaming and deleting categories

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Plan Self-Review

**Spec coverage:**
- §Ziel 1 (rename) → Task 1 (`renameCategory` mutation) + Task 3 (UI).
- §Ziel 2 (blocked delete with usage counts) → Task 1 (`countCategoryUsage`, `deleteCategory`) + Task 3 (UI disabled state + counts display).
- §Ziel 3 (nav + `/categorize` link) → Task 3 Steps 3–4.
- §2 Server Actions (`renameCategory`/`deleteCategory` in `actions/categories.ts`, `ActionResult` pattern) → Task 2.
- §3 Page/component split, server-side aggregation, alphabetical sort, "← Zurück" header → Task 3 (aggregation done via `count()`/`eq()` per category through the shared `countCategoryUsage`, rather than fetching every row and summing in JS — same outcome the spec calls for, using the `count()` precedent already established in `accounts/[id]/page.tsx`, which is more idiomatic here than a manual JS reduce).
- §5 Error handling (`ActionResult`, no raw exceptions across the action boundary) → Task 2.
- §6 Tests → Task 1 Step 1 covers every case listed in the spec (rename success, empty name, name collision; delete success, delete blocked by override, delete blocked by rule, counts in the message) plus two extra cases found useful while drafting (`countCategoryUsage` directly, renaming to the same name is a no-op).

**Placeholder scan:** No TBD/TODO; every step has runnable code or an exact command.

**Type consistency:** `countCategoryUsage` return shape (`{ transactionCount, ruleCount }`) is identical across Task 1 (definition), Task 3 page (`usage.transactionCount`/`usage.ruleCount` consumption), and Task 3 row component (`CategoryUsage` interface). `renameCategory`/`deleteCategory` signatures (`(categoryId: number, name?: string) => Promise<ActionResult>` at the action layer, `=> Promise<void>` at the mutation layer) match between Task 1, Task 2, and their call sites in Task 3.
