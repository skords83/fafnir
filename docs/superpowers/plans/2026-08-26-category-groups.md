# Oberkategorien (Kategorie-Gruppen) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let categories optionally belong to one parent category (Oberkategorie), so the dashboard can show spending grouped into blocks like "Wohnen" instead of many small line items — display/analytics only, no change to how transactions get categorized.

**Architecture:** One new nullable `parentCategoryId` column on `categories`, a single-level self-reference. A new `setCategoryParent` server action (with three validation guards) lets users assign/clear it from the existing `/categories` page, which now renders categories grouped under their parent. A new pure function `groupBreakdownByParent` post-processes the dashboard's existing per-category breakdown into per-parent buckets; the dashboard pie chart gets a two-option toggle to switch between the two precomputed arrays. Rule/override resolution (`category-resolution.ts`, `/categorize`) is untouched.

**Tech Stack:** Next.js (App Router, server actions), Drizzle ORM + SQLite (better-sqlite3), Vitest, React (client components for interactive bits), Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-26-category-groups-design.md`

## Global Constraints

- No change to rule/override resolution logic or to `/categorize` (spec: "Nicht Teil dieser Anweisung").
- No third nesting level, ever — enforced server-side in `setCategoryParent`, not just in the UI.
- No new "create category" form on `/categories` — categories are still only created implicitly via the `/categorize` rule picker.
- All user-facing strings are German, matching existing copy style (see `category-mutations.ts` error messages for tone).
- Style: existing Tailwind utility classes, dark-mode-aware tokens (`text-foreground`, `text-muted-foreground`, `border-border`, `bg-card`, etc.) — no new design system.

---

### Task 1: Schema migration — `parentCategoryId` column

**Files:**
- Modify: `src/db/schema.ts`
- Create: `drizzle/000X_<generated_name>.sql` (via `npm run db:generate`, not hand-written)

**Interfaces:**
- Produces: `categories.parentCategoryId: number | null` on every row returned by `db.select().from(categories)` — every later task relies on this field existing on the Drizzle-inferred row type.

- [ ] **Step 1: Add the column to the schema**

Edit `src/db/schema.ts` — add `AnySQLiteColumn` to the import and add the new column to `categories`:

```ts
import { sqliteTable, text, integer, uniqueIndex, index, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

export const accounts = sqliteTable('accounts', {
  // ...unchanged...
});

export const categories = sqliteTable('categories', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  parentCategoryId: integer('parent_category_id').references((): AnySQLiteColumn => categories.id),
}, (t) => ({
  uniqueName: uniqueIndex('uniq_category_name').on(t.name),
}));
```

Leave every other table in the file untouched.

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`

Expected: a new file appears under `drizzle/`, e.g. `drizzle/0005_<name>.sql`, containing an `ALTER TABLE categories ADD parent_category_id integer REFERENCES categories(id);` statement (exact wording may vary slightly by drizzle-kit version — the important part is the added column and FK).

- [ ] **Step 3: Apply the migration to the dev database**

Run: `npm run db:migrate:runtime`

Expected: exits with no error. (`npm run db:migrate` runs the drizzle-kit variant; either is fine for local dev — use whichever the project's existing dev workflow uses. Check `DEPLOY.md` if unsure which one applies to the running dev DB.)

- [ ] **Step 4: Verify the app still builds and tests still pass**

Run: `npm run lint && npm test`

Expected: PASS — this step only adds a column, no behavior changed yet, so the full existing suite (including `category-mutations.test.ts`, which runs its own migrations against a fresh temp DB per test) must be green.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "Add parentCategoryId column to categories

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Carry `parentCategoryId` through `CategoryRef`

**Files:**
- Modify: `src/lib/category-resolution.ts`
- Test: `src/lib/category-resolution.test.ts`

**Interfaces:**
- Consumes: `categories.parentCategoryId` from Task 1.
- Produces: `CategoryRef { id: number; name: string; parentCategoryId?: number | null }` — Task 7 (dashboard page) relies on `categoriesById: Map<number, CategoryRef>` (returned by `buildCategoryLookups`, already computed in `page.tsx`) carrying this field so `groupBreakdownByParent` (Task 4) can read it without a second query.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/category-resolution.test.ts`, inside the existing `describe('buildCategoryLookups', ...)` block (find it — it already has at least one test):

```ts
  test('carries parentCategoryId through into categoriesById', () => {
    const categories = [
      { id: 1, name: 'Gas', parentCategoryId: 2 },
      { id: 2, name: 'Wohnen', parentCategoryId: null },
    ];

    const { categoriesById } = buildCategoryLookups(categories, []);

    expect(categoriesById.get(1)?.parentCategoryId).toBe(2);
    expect(categoriesById.get(2)?.parentCategoryId).toBeNull();
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/category-resolution.test.ts -t "carries parentCategoryId"`

Expected: FAIL — TypeScript error or `parentCategoryId` is `undefined` on the retrieved object, since `CategoryRef` doesn't have the field yet.

- [ ] **Step 3: Extend `CategoryRef`**

In `src/lib/category-resolution.ts`, change:

```ts
export interface CategoryRef {
  id: number;
  name: string;
}
```

to:

```ts
export interface CategoryRef {
  id: number;
  name: string;
  /** Optional so existing test fixtures and any caller that only has {id, name} keep compiling. */
  parentCategoryId?: number | null;
}
```

No other line in this file changes — `resolveTransactionCategory`, `findGoverningMerchantRule`, and `buildCategoryLookups` all pass `CategoryRef` objects through unchanged; they never read `parentCategoryId`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/category-resolution.test.ts`

Expected: PASS — the new test plus every pre-existing test in the file.

- [ ] **Step 5: Commit**

```bash
git add src/lib/category-resolution.ts src/lib/category-resolution.test.ts
git commit -m "Carry parentCategoryId through CategoryRef

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `setCategoryParent` mutation + server action

**Files:**
- Modify: `src/app/(app)/actions/category-mutations.ts`
- Modify: `src/app/(app)/actions/categories.ts`
- Test: `src/app/(app)/actions/category-mutations.test.ts`

**Interfaces:**
- Consumes: `categories.parentCategoryId` (Task 1); the `freshDb()` / `seedTransaction()` test helpers already in `category-mutations.test.ts` (do not redefine them).
- Produces:
  - `setCategoryParent(categoryId: number, parentId: number | null): Promise<void>` in `category-mutations.ts` — throws a German-language `Error` on any guard violation, resolves on success.
  - `setCategoryParent(categoryId: number, parentId: number | null): Promise<ActionResult>` (the `'use server'` wrapper) in `actions/categories.ts` — Task 5 (`CategoryRow`) imports this one, not the mutation directly.

- [ ] **Step 1: Write the failing tests**

Add to `src/app/(app)/actions/category-mutations.test.ts`, as a new `describe` block after the existing `describe('deleteCategory', ...)` block (before `describe('getMerchantTransactionsForKey', ...)`):

```ts
describe('setCategoryParent', () => {
  test('assigns a parent to a category that has none yet', async () => {
    const { db, schema, setCategoryParent } = await freshDb();
    const [child] = await db.insert(schema.categories).values({ name: 'Gas' }).returning();
    const [parent] = await db.insert(schema.categories).values({ name: 'Wohnen' }).returning();

    await setCategoryParent(child.id, parent.id);

    const [updated] = await db.select().from(schema.categories).where(eq(schema.categories.id, child.id));
    expect(updated.parentCategoryId).toBe(parent.id);
  });

  test('clearing a parent with null is always allowed', async () => {
    const { db, schema, setCategoryParent } = await freshDb();
    const [parent] = await db.insert(schema.categories).values({ name: 'Wohnen' }).returning();
    const [child] = await db.insert(schema.categories).values({ name: 'Gas', parentCategoryId: parent.id }).returning();

    await setCategoryParent(child.id, null);

    const [updated] = await db.select().from(schema.categories).where(eq(schema.categories.id, child.id));
    expect(updated.parentCategoryId).toBeNull();
  });

  test('rejects a category being its own parent', async () => {
    const { db, schema, setCategoryParent } = await freshDb();
    const [category] = await db.insert(schema.categories).values({ name: 'Wohnen' }).returning();

    await expect(setCategoryParent(category.id, category.id)).rejects.toThrow(/eigene Oberkategorie/);

    const [unchanged] = await db.select().from(schema.categories).where(eq(schema.categories.id, category.id));
    expect(unchanged.parentCategoryId).toBeNull();
  });

  test('rejects assigning a parent that itself already has a parent', async () => {
    const { db, schema, setCategoryParent } = await freshDb();
    const [grandparent] = await db.insert(schema.categories).values({ name: 'Fixkosten' }).returning();
    const [parent] = await db.insert(schema.categories).values({ name: 'Wohnen', parentCategoryId: grandparent.id }).returning();
    const [child] = await db.insert(schema.categories).values({ name: 'Gas' }).returning();

    await expect(setCategoryParent(child.id, parent.id)).rejects.toThrow(/hat selbst eine Oberkategorie/);

    const [unchanged] = await db.select().from(schema.categories).where(eq(schema.categories.id, child.id));
    expect(unchanged.parentCategoryId).toBeNull();
  });

  test('rejects giving a parent to a category that is itself used as a parent', async () => {
    const { db, schema, setCategoryParent } = await freshDb();
    const [wohnen] = await db.insert(schema.categories).values({ name: 'Wohnen' }).returning();
    await db.insert(schema.categories).values({ name: 'Gas', parentCategoryId: wohnen.id });
    const [fixkosten] = await db.insert(schema.categories).values({ name: 'Fixkosten' }).returning();

    await expect(setCategoryParent(wohnen.id, fixkosten.id)).rejects.toThrow(/selbst Oberkategorie anderer Kategorien/);

    const [unchanged] = await db.select().from(schema.categories).where(eq(schema.categories.id, wohnen.id));
    expect(unchanged.parentCategoryId).toBeNull();
  });

  test('allows assigning a second child to a parent that already has one', async () => {
    const { db, schema, setCategoryParent } = await freshDb();
    const [wohnen] = await db.insert(schema.categories).values({ name: 'Wohnen' }).returning();
    await db.insert(schema.categories).values({ name: 'Gas', parentCategoryId: wohnen.id });
    const [wasser] = await db.insert(schema.categories).values({ name: 'Wasser' }).returning();

    await setCategoryParent(wasser.id, wohnen.id);

    const [updated] = await db.select().from(schema.categories).where(eq(schema.categories.id, wasser.id));
    expect(updated.parentCategoryId).toBe(wohnen.id);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/\(app\)/actions/category-mutations.test.ts -t "setCategoryParent"`

Expected: FAIL — `setCategoryParent` is not exported from `./category-mutations` yet.

- [ ] **Step 3: Implement the mutation**

In `src/app/(app)/actions/category-mutations.ts`, add this function (after `deleteCategory`, before `getMerchantTransactionsForKey`):

```ts
/**
 * Sets (or clears) a category's Oberkategorie (parent). `parentId: null` always clears it.
 * A non-null `parentId` is rejected when it would create a third nesting level: the
 * category can't be its own parent, the target parent must not itself have a parent, and
 * the category being edited must not itself already be used as a parent by another
 * category (design spec, Oberkategorien-Anweisung §Datenmodell).
 */
export async function setCategoryParent(categoryId: number, parentId: number | null): Promise<void> {
  if (parentId === null) {
    await db.update(categories).set({ parentCategoryId: null }).where(eq(categories.id, categoryId));
    return;
  }
  if (parentId === categoryId) {
    throw new Error('Eine Kategorie kann nicht ihre eigene Oberkategorie sein.');
  }
  const [parent] = await db.select().from(categories).where(eq(categories.id, parentId));
  if (!parent) {
    throw new Error('Diese Oberkategorie existiert nicht mehr.');
  }
  if (parent.parentCategoryId !== null) {
    throw new Error(`„${parent.name}“ hat selbst eine Oberkategorie und kann nicht als Oberkategorie verwendet werden.`);
  }
  const [existingChild] = await db.select().from(categories).where(eq(categories.parentCategoryId, categoryId));
  if (existingChild) {
    throw new Error('Diese Kategorie ist selbst Oberkategorie anderer Kategorien und kann keine eigene Oberkategorie erhalten.');
  }
  await db.update(categories).set({ parentCategoryId: parentId }).where(eq(categories.id, categoryId));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/\(app\)/actions/category-mutations.test.ts`

Expected: PASS — all tests in the file, including the six new ones.

- [ ] **Step 5: Add the `'use server'` wrapper**

In `src/app/(app)/actions/categories.ts`:

1. Add `setCategoryParent as setCategoryParentMutation` to the import from `./category-mutations`.
2. Add this exported function after `deleteCategory`:

```ts
export async function setCategoryParent(categoryId: number, parentId: number | null): Promise<ActionResult> {
  await requireSession();
  try {
    await setCategoryParentMutation(categoryId, parentId);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Fehler beim Speichern.' };
  }
  revalidateCategorizedPages();
  return { ok: true };
}
```

- [ ] **Step 6: Verify the wrapper compiles and the full suite is still green**

Run: `npm run lint && npm test`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/actions/category-mutations.ts" "src/app/(app)/actions/category-mutations.test.ts" "src/app/(app)/actions/categories.ts"
git commit -m "Add setCategoryParent mutation and server action

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: `groupBreakdownByParent`

**Files:**
- Modify: `src/lib/dashboard-stats.ts`
- Test: `src/lib/dashboard-stats.test.ts`

**Interfaces:**
- Consumes: `CategoryBreakdownPoint` (already defined in this file); `CategoryRef` from Task 2 (`{ id, name, parentCategoryId? }`).
- Produces: `groupBreakdownByParent(points: CategoryBreakdownPoint[], categoriesById: Map<number, { name: string; parentCategoryId?: number | null }>): CategoryBreakdownPoint[]` — Task 7 (`page.tsx`) calls this directly on the array `calculateCategoryBreakdown` already produces.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/dashboard-stats.test.ts`:

1. Add `groupBreakdownByParent` to the existing import from `./dashboard-stats`.
2. Add a new `describe` block at the end of the file:

```ts
describe('groupBreakdownByParent', () => {
  test('sums multiple children into one parent bucket', () => {
    const points = [
      { categoryId: 1, categoryName: 'Gas', amountCents: 3000, percentage: 60 },
      { categoryId: 2, categoryName: 'Wasser', amountCents: 2000, percentage: 40 },
    ];
    const categoriesById = new Map([
      [1, { name: 'Gas', parentCategoryId: 3 }],
      [2, { name: 'Wasser', parentCategoryId: 3 }],
      [3, { name: 'Wohnen', parentCategoryId: null }],
    ]);

    const grouped = groupBreakdownByParent(points, categoriesById);

    expect(grouped).toEqual([
      { categoryId: 3, categoryName: 'Wohnen', amountCents: 5000, percentage: 100 },
    ]);
  });

  test('leaves ungrouped categories as their own posten', () => {
    const points = [
      { categoryId: 1, categoryName: 'Freizeit', amountCents: 4000, percentage: 50 },
      { categoryId: 2, categoryName: 'Gehalt-Rueckzahlung', amountCents: 4000, percentage: 50 },
    ];
    const categoriesById = new Map([
      [1, { name: 'Freizeit', parentCategoryId: null }],
      [2, { name: 'Gehalt-Rueckzahlung', parentCategoryId: null }],
    ]);

    const grouped = groupBreakdownByParent(points, categoriesById);

    expect(grouped).toHaveLength(2);
    expect(grouped.find((g) => g.categoryId === 1)).toEqual({
      categoryId: 1,
      categoryName: 'Freizeit',
      amountCents: 4000,
      percentage: 50,
    });
  });

  test('passes an Unkategorisiert (null categoryId) bucket through unchanged', () => {
    const points = [
      { categoryId: null, categoryName: 'Unkategorisiert', amountCents: 1000, percentage: 100 },
    ];
    const categoriesById = new Map<number, { name: string; parentCategoryId?: number | null }>();

    const grouped = groupBreakdownByParent(points, categoriesById);

    expect(grouped).toEqual([
      { categoryId: null, categoryName: 'Unkategorisiert', amountCents: 1000, percentage: 100 },
    ]);
  });

  test('mixes a grouped block with an ungrouped category and re-sums percentages', () => {
    const points = [
      { categoryId: 1, categoryName: 'Gas', amountCents: 3000, percentage: 30 },
      { categoryId: 2, categoryName: 'Freizeit', amountCents: 7000, percentage: 70 },
    ];
    const categoriesById = new Map([
      [1, { name: 'Gas', parentCategoryId: 3 }],
      [2, { name: 'Freizeit', parentCategoryId: null }],
      [3, { name: 'Wohnen', parentCategoryId: null }],
    ]);

    const grouped = groupBreakdownByParent(points, categoriesById);

    expect(grouped).toHaveLength(2);
    const total = grouped.reduce((sum, g) => sum + g.percentage, 0);
    expect(total).toBe(100);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/dashboard-stats.test.ts -t "groupBreakdownByParent"`

Expected: FAIL — `groupBreakdownByParent` is not exported yet.

- [ ] **Step 3: Implement the function**

Add to `src/lib/dashboard-stats.ts`, after `calculateCategoryBreakdown`:

```ts
/**
 * Re-buckets an already-computed category breakdown by parent category: every point
 * whose category has a `parentCategoryId` is folded into that parent's bucket (summed,
 * percentages recomputed); everything else (ungrouped categories, the null-categoryId
 * "Unkategorisiert" bucket) passes through unchanged. Pure post-processing — never
 * queries the database itself, so it stays a cheap second view over data the caller
 * already has.
 */
export function groupBreakdownByParent(
  points: CategoryBreakdownPoint[],
  categoriesById: Map<number, { name: string; parentCategoryId?: number | null }>
): CategoryBreakdownPoint[] {
  const buckets = new Map<string, { categoryId: number | null; name: string; amount: number }>();

  for (const point of points) {
    const category = point.categoryId !== null ? categoriesById.get(point.categoryId) : undefined;
    const parentId = category?.parentCategoryId ?? null;
    const bucketCategoryId = parentId ?? point.categoryId;
    const bucketName = parentId !== null ? (categoriesById.get(parentId)?.name ?? point.categoryName) : point.categoryName;
    const mapKey = `${bucketCategoryId ?? 'null'}:${bucketName}`;

    if (!buckets.has(mapKey)) {
      buckets.set(mapKey, { categoryId: bucketCategoryId, name: bucketName, amount: 0 });
    }
    buckets.get(mapKey)!.amount += point.amountCents;
  }

  const totalExpenses = Array.from(buckets.values()).reduce((sum, b) => sum + b.amount, 0);

  const result: CategoryBreakdownPoint[] = Array.from(buckets.values()).map(({ categoryId, name, amount }) => ({
    categoryId,
    categoryName: name,
    amountCents: amount,
    percentage: totalExpenses > 0 ? Math.round((amount / totalExpenses) * 100) : 0,
  }));

  result.sort((a, b) => {
    if (b.amountCents !== a.amountCents) {
      return b.amountCents - a.amountCents;
    }
    const aId = a.categoryId ?? -1;
    const bId = b.categoryId ?? -1;
    return bId - aId;
  });
  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/dashboard-stats.test.ts`

Expected: PASS — all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard-stats.ts src/lib/dashboard-stats.test.ts
git commit -m "Add groupBreakdownByParent for dashboard category grouping

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: `CategoryRow` — Oberkategorie select

**Files:**
- Modify: `src/app/(app)/categories/category-row.tsx`

**Interfaces:**
- Consumes: `setCategoryParent` server action from Task 3 (`ActionResult` return type, same as `renameCategory`/`deleteCategory`).
- Produces: `CategoryRow` now takes two new required props, `parentOptions` and `hasChildren` — Task 6 (`CategoriesPage`) must pass both on every `<CategoryRow />` it renders, and the `category` prop's type gains `parentCategoryId: number | null`.

- [ ] **Step 1: Update imports and props**

In `src/app/(app)/categories/category-row.tsx`, change the import and the component signature:

```tsx
'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { deleteCategory, renameCategory, setCategoryParent } from '@/app/(app)/actions/categories';

export interface CategoryUsage {
  transactionCount: number;
  ruleCount: number;
}

export function CategoryRow({
  category,
  usage,
  parentOptions,
  hasChildren,
}: {
  category: { id: number; name: string; parentCategoryId: number | null };
  usage: CategoryUsage;
  parentOptions: { id: number; name: string }[];
  hasChildren: boolean;
}) {
```

- [ ] **Step 2: Add parent-assignment state and handler**

Add these alongside the existing `useState`/`useTransition` declarations (after `const [isPending, startTransition] = useTransition();`):

```tsx
  const [parentError, setParentError] = useState<string | null>(null);

  function handleParentChange(value: string) {
    setParentError(null);
    const parentId = value === '' ? null : Number(value);
    startTransition(async () => {
      const result = await setCategoryParent(category.id, parentId);
      if (!result.ok) {
        setParentError(result.error);
      }
    });
  }
```

- [ ] **Step 3: Render the select**

Add this block inside the returned `<li>`, after the closing `</form>` of the rename form and before the usage `<div>`:

```tsx
      <div className="flex flex-col gap-1">
        <select
          value={category.parentCategoryId ?? ''}
          onChange={(event) => handleParentChange(event.target.value)}
          disabled={isPending || hasChildren}
          title={
            hasChildren
              ? 'Diese Kategorie ist selbst Oberkategorie anderer Kategorien und kann keine eigene Oberkategorie erhalten.'
              : undefined
          }
          aria-label={`Oberkategorie von „${category.name}“`}
          className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground disabled:opacity-50"
        >
          <option value="">Keine Oberkategorie</option>
          {parentOptions
            .filter((option) => option.id !== category.id)
            .map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
        </select>
        {parentError && <p className="text-xs text-destructive">{parentError}</p>}
      </div>
```

- [ ] **Step 4: Verify it compiles**

Run: `npm run lint`

Expected: PASS. (No automated test for this component — the project has no `.test.tsx` files; the existing convention is lint + build + manual browser check for UI components. Manual verification happens in Task 6, once `CategoriesPage` actually passes the new props in.)

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/categories/category-row.tsx"
git commit -m "Add Oberkategorie select to CategoryRow

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: `CategoriesPage` — grouped list

**Files:**
- Modify: `src/app/(app)/categories/page.tsx`

**Interfaces:**
- Consumes: `CategoryRow` with `parentOptions`/`hasChildren` props from Task 5; `categories.parentCategoryId` from Task 1.

- [ ] **Step 1: Rewrite the page to group rows by parent**

Replace the full contents of `src/app/(app)/categories/page.tsx` with:

```tsx
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

  const parentOptions = sorted.map(({ id, name }) => ({ id, name }));

  const childrenByParentId = new Map<number, typeof rowsWithUsage>();
  const ungrouped: typeof rowsWithUsage = [];
  for (const row of rowsWithUsage) {
    const parentId = row.category.parentCategoryId;
    if (parentId === null) {
      ungrouped.push(row);
    } else {
      if (!childrenByParentId.has(parentId)) {
        childrenByParentId.set(parentId, []);
      }
      childrenByParentId.get(parentId)!.push(row);
    }
  }
  const hasChildrenIds = new Set(childrenByParentId.keys());
  const groups = sorted
    .filter((category) => childrenByParentId.has(category.id))
    .map((category) => ({ parent: category, children: childrenByParentId.get(category.id)! }));

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
        <div className="space-y-6">
          {groups.map(({ parent, children }) => (
            <div key={parent.id}>
              <h2 className="mb-2 text-sm font-semibold text-foreground">{parent.name}</h2>
              <ul className="divide-y divide-border rounded-lg border border-border bg-card">
                {children.map(({ category, usage }) => (
                  <CategoryRow
                    key={category.id}
                    category={category}
                    usage={usage}
                    parentOptions={parentOptions}
                    hasChildren={hasChildrenIds.has(category.id)}
                  />
                ))}
              </ul>
            </div>
          ))}

          <div>
            {groups.length > 0 && (
              <h2 className="mb-2 text-sm font-semibold text-foreground">Ohne Oberkategorie</h2>
            )}
            {ungrouped.length === 0 ? (
              <p className="text-sm text-muted-foreground">Keine.</p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border bg-card">
                {ungrouped.map(({ category, usage }) => (
                  <CategoryRow
                    key={category.id}
                    category={category}
                    usage={usage}
                    parentOptions={parentOptions}
                    hasChildren={hasChildrenIds.has(category.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

Note: `parentOptions` here is passed as *every* category (not pre-filtered to `parentCategoryId === null`) — that filtering is intentionally left to a later refinement in Step 2 below, to keep this step focused on the grouping/layout change first.

- [ ] **Step 2: Restrict `parentOptions` to categories without their own parent**

The select in `CategoryRow` must only offer categories that themselves have no parent (spec: "Auswahl zeigt nur bestehende Kategorien, die selbst keine Oberkategorie haben"). Change the `parentOptions` line from Step 1 to:

```tsx
  const parentOptions = sorted
    .filter((category) => category.parentCategoryId === null)
    .map(({ id, name }) => ({ id, name }));
```

- [ ] **Step 3: Verify it compiles and lints**

Run: `npm run lint`

Expected: PASS.

- [ ] **Step 4: Manual verification**

Run: `npm run dev` (if not already running), then in a browser:

1. Go to `/categories`.
2. Assign an existing category's Oberkategorie via its new select (e.g. set "Gas"'s Oberkategorie to "Wohnen" — create "Wohnen" first via the picker on `/categorize` if it doesn't exist, or via any other existing category with no parent).
3. Confirm the page now shows "Wohnen" as a heading with "Gas" listed underneath, and that "Gas" no longer appears in "Ohne Oberkategorie".
4. Confirm assigning a second category (e.g. "Wasser") to the same "Wohnen" parent works — the select still lists "Wohnen" as an option even though it already has a child.
5. Confirm the select for "Wohnen" itself is disabled (it has children now) with the explanatory tooltip.
6. Set "Gas"'s Oberkategorie back to "Keine" and confirm it moves back to "Ohne Oberkategorie".

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/categories/page.tsx"
git commit -m "Group /categories list by Oberkategorie

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Dashboard page — compute and pass grouped breakdown

**Files:**
- Modify: `src/app/(app)/page.tsx`

**Interfaces:**
- Consumes: `groupBreakdownByParent` from Task 4; `categoriesById` (already computed via `buildCategoryLookups`, now carrying `parentCategoryId` per Task 2).
- Produces: `CategoryPieChart` now receives `dataByParent: CategoryBreakdownPoint[]` and `hasGroups: boolean` props in addition to the existing `data`/`currency` — Task 8 must accept both.

- [ ] **Step 1: Compute the grouped breakdown and the groups-exist flag**

In `src/app/(app)/page.tsx`:

1. Add `groupBreakdownByParent` to the import from `@/lib/dashboard-stats`.
2. Immediately after the existing line `const categoryBreakdown = calculateCategoryBreakdown(currentMonthTxs);`, add:

```tsx
  const categoryBreakdownByParent = groupBreakdownByParent(categoryBreakdown, categoriesById);
  const hasCategoryGroups = categoryRows.some((c) => c.parentCategoryId !== null);
```

- [ ] **Step 2: Pass the new props to `CategoryPieChart`**

Change:

```tsx
          <CategoryPieChart data={categoryBreakdown} currency={account.currency} />
```

to:

```tsx
          <CategoryPieChart
            data={categoryBreakdown}
            dataByParent={categoryBreakdownByParent}
            hasGroups={hasCategoryGroups}
            currency={account.currency}
          />
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run lint`

Expected: FAIL at this point is acceptable if `CategoryPieChart`'s prop types haven't been updated yet — Task 8 does that next. If Task 8 is done first in your working order, this should PASS; otherwise proceed to Task 8 before checking.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/page.tsx"
git commit -m "Compute grouped category breakdown on the dashboard page

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

(If Task 8 isn't done yet and lint fails on the prop mismatch, that's expected — Task 8 fixes it. Don't skip the commit; the two tasks are meant to be reviewed as adjacent, small changes.)

---

### Task 8: `CategoryPieChart` — Oberkategorie/Kategorie toggle

**Files:**
- Modify: `src/components/dashboard/category-pie-chart.tsx`

**Interfaces:**
- Consumes: `dataByParent`/`hasGroups` props from Task 7.

- [ ] **Step 1: Update props and add the mode toggle**

Replace the component's signature and the empty-state/render logic in `src/components/dashboard/category-pie-chart.tsx`. The full new component body (everything from `export function CategoryPieChart` to the closing `}`):

```tsx
export function CategoryPieChart({
  data,
  dataByParent,
  hasGroups,
  currency,
}: {
  data: CategoryBreakdownPoint[];
  dataByParent: CategoryBreakdownPoint[];
  hasGroups: boolean;
  currency: string;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [mode, setMode] = useState<'category' | 'parent'>('category');
  const prefersDark = usePrefersDarkMode();

  function selectMode(next: 'category' | 'parent') {
    setMode(next);
    setActiveIndex(null);
  }

  const activeData = mode === 'category' ? data : dataByParent;

  const modeToggle = hasGroups && (
    <div className="mb-2 flex justify-center gap-1">
      <button
        type="button"
        onClick={() => selectMode('category')}
        className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
          mode === 'category' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
        }`}
      >
        Kategorie
      </button>
      <button
        type="button"
        onClick={() => selectMode('parent')}
        className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
          mode === 'parent' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
        }`}
      >
        Oberkategorie
      </button>
    </div>
  );

  if (activeData.length === 0) {
    return (
      <div>
        {modeToggle}
        <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
          Keine Ausgaben in diesem Zeitraum
        </div>
      </div>
    );
  }

  const colors = prefersDark ? CATEGORY_COLORS_DARK : CATEGORY_COLORS_LIGHT;
  const otherColor = prefersDark ? OTHER_COLOR_DARK : OTHER_COLOR_LIGHT;
  const surfaceColor = prefersDark ? '#1a1a19' : '#fcfcfb';
  const slices = buildSlices(activeData, colors, otherColor);

  return (
    <div className="w-full">
      {modeToggle}
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              cx="50%"
              cy="50%"
              innerRadius={50}
              outerRadius={80}
              dataKey="value"
              onMouseEnter={(_, index) => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex(null)}
            >
              {slices.map((slice, index) => (
                <Cell
                  key={slice.name}
                  fill={slice.color}
                  stroke={surfaceColor}
                  strokeWidth={activeIndex === index ? 3 : 2}
                  fillOpacity={activeIndex === null || activeIndex === index ? 1 : 0.35}
                />
              ))}
            </Pie>
            <Tooltip
              formatter={(value) => {
                if (typeof value === 'number') {
                  return formatCents(Math.round(value * 100), currency);
                }
                return value;
              }}
              contentStyle={{
                backgroundColor: 'var(--color-popover)',
                borderColor: 'var(--color-border)',
                color: 'var(--color-popover-foreground)',
                borderRadius: '0.5rem',
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-2 flex flex-wrap justify-center gap-x-1 gap-y-1 px-2">
        {slices.map((slice, index) => (
          <li key={slice.name}>
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors"
              style={{
                backgroundColor: activeIndex === index ? 'var(--color-muted)' : 'transparent',
              }}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex(null)}
              onFocus={() => setActiveIndex(index)}
              onBlur={() => setActiveIndex(null)}
            >
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: slice.color }}
              />
              <span className="text-foreground">{slice.name}</span>
              <span className="text-muted-foreground">{slice.percentage}%</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

Everything above `export function CategoryPieChart` (imports, `subscribeToTheme`, `getIsDarkSnapshot`, `getIsDarkServerSnapshot`, `usePrefersDarkMode`) stays unchanged.

- [ ] **Step 2: Verify the whole app compiles and lints**

Run: `npm run lint && npm run build`

Expected: PASS — this is the point where Task 7's prop types and this component's prop types must finally match.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`

Expected: PASS — every unit test from Tasks 1–4, unaffected by this UI-only change.

- [ ] **Step 4: Manual verification**

With `npm run dev` running and at least one category from Task 6's manual test grouped under a parent:

1. Go to `/` (dashboard).
2. Confirm the "Kategorien im aktuellen Monat" card now shows a "Kategorie" / "Oberkategorie" toggle above the chart, defaulting to "Kategorie" (chart looks exactly as before).
3. Click "Oberkategorie" — confirm the grouped categories now appear as one summed slice/legend entry, and any ungrouped category from the current month's expenses still appears as its own slice.
4. Click back to "Kategorie" — confirm it returns to the original per-category view.
5. On an account/month with no `parentCategoryId` set on any category at all (or temporarily clear the one you set), confirm the toggle does not render at all.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/category-pie-chart.tsx
git commit -m "Add Oberkategorie/Kategorie toggle to dashboard pie chart

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Final Verification

- [ ] Run `npm run lint && npm test && npm run build` once more from a clean state — all must pass.
- [ ] Re-read the spec (`docs/superpowers/specs/2026-08-26-category-groups-design.md`) top to bottom and confirm every section has a corresponding completed task above.
- [ ] Manual smoke test end-to-end: assign two categories to a new Oberkategorie on `/categories`, confirm the dashboard toggle groups them correctly, then remove the assignment and confirm both views return to their pre-change state.
