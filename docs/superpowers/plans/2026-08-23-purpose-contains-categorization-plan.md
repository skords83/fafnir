# purposeContains — Verwendungszweck-Verfeinerung für Gegenpartei-Regeln — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a merchant category rule be scoped to transactions whose `purpose` contains a
user-entered substring, so one counterparty with several distinct booking types (e.g. an
employer paying both salary and school fees for the same school) can be split into
independently-categorized rules instead of collapsing to a single merchant-wide category.

**Architecture:** Extend the existing two-table resolution model
(`merchantCategoryRules` + per-transaction `categoryOverrideId`) with a nullable
`purposeContains` column and a composite unique index. Resolution order becomes:
override → purpose-scoped rule (substring match against `tx.purpose`) → merchant fallback
rule (`purposeContains IS NULL`) → uncategorized. No automatic matching engine is
reintroduced — `purposeContains` is only ever typed in by the user on a rule they create by
hand, exactly like the existing merchant key.

**Tech Stack:** Next.js (App Router, server actions), Drizzle ORM (SQLite/better-sqlite3),
Vitest, TypeScript. Follows the patterns already merged in
`src/lib/category-resolution.ts`, `src/app/(app)/actions/category-mutations.ts`, and
`src/components/category-picker.tsx`.

**Spec:** `docs/superpowers/specs/2026-08-22-merchant-based-categorization-design.md`
(this plan implements only the "Offene Punkte für den Implementierungsplan" /
`purposeContains` section; sections 1–6 of that spec are already implemented and merged).

## Global Constraints

- No automatic category suggestions from keyword lists, no AI/ML categorization, no
  amount/date-based rules, no hardcoded category list in code, no changes to
  dashboard/trend calculation (spec, "Ziel" section).
- `resolveTransactionCategory()` and its purpose-matching extension use no amount/date/other
  heuristic — only override, purpose-scoped rule, fallback rule (spec §2, §B2).
- `purposeContains` is a manual refinement of a rule the user creates themselves — never an
  automatic matcher/categorizer of unknown transactions (spec §B2 "Entscheidung").
- No N+1 queries: `categories` and `merchant_category_rules` are each loaded once per page
  into in-memory maps; resolution runs purely in-memory per transaction (spec §2
  "Performance").
- Automatic detection of intermediary counterparties (Postbank/PayPal card-terminal
  bookings) is explicitly out of scope for this extension (spec §B2 "Ausdrücklich nicht
  Teil dieser Erweiterung").

---

### Task 1: Schema + mutation layer — `purposeContains` column and purpose-aware `applyMerchantRule`

**Files:**
- Modify: `src/db/schema.ts` (`merchantCategoryRules` table)
- Create: `drizzle/00XX_<generated_name>.sql` (via `drizzle-kit generate`, exact filename/name is timestamp-derived)
- Modify: `src/app/(app)/actions/category-mutations.ts`
- Modify: `src/app/(app)/actions/categories.ts`
- Test: `src/app/(app)/actions/category-mutations.test.ts`

**Interfaces:**
- Produces: `applyMerchantRule(merchantKey: string, purposeContains: string | null, target: CategoryTarget): Promise<void>` — replaces the current 2-arg signature. `purposeContains: null` is the merchant's fallback rule; a non-null value scopes the rule to purposes containing that substring, validated to not overlap any other purpose value already set for the same merchant (throws `Error` otherwise).
- Produces: `setMerchantRule(merchantKey: string, purposeContains: string | null, target: CategoryTarget): Promise<void>` (server action, same shape).
- `CategoryTarget` and `applyTransactionOverride` are unchanged.

This task bundles the schema change with the mutation-layer rewrite because the schema
change alone (dropping the single-column unique index in favor of a composite one) breaks
the currently-passing `applyMerchantRule` tests, which rely on `onConflictDoUpdate({ target:
merchantCategoryRules.merchantKey, ... })` matching a real unique constraint. They can only
stay green together.

- [ ] **Step 1: Update the schema**

Edit `src/db/schema.ts`, `merchantCategoryRules` table:

```ts
export const merchantCategoryRules = sqliteTable('merchant_category_rules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  merchantKey: text('merchant_key').notNull(),
  purposeContains: text('purpose_contains'),
  categoryId: integer('category_id').notNull().references(() => categories.id),
}, (t) => ({
  uniqueMerchantKeyPurpose: uniqueIndex('uniq_merchant_key_purpose').on(t.merchantKey, t.purposeContains),
}));
```

- [ ] **Step 2: Generate and inspect the migration**

Run: `npm run db:generate`

Expected: a new file under `drizzle/` containing roughly:

```sql
ALTER TABLE `merchant_category_rules` ADD `purpose_contains` text;--> statement-breakpoint
DROP INDEX `uniq_merchant_key`;--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_merchant_key_purpose` ON `merchant_category_rules` (`merchant_key`,`purpose_contains`);
```

Open the generated file and confirm it matches this shape before continuing. `drizzle/meta/_journal.json` and a new `drizzle/meta/00XX_snapshot.json` are updated automatically — include them in the commit.

- [ ] **Step 3: Apply the migration to the local dev database**

Run: `npm run db:migrate:runtime`

Expected: exits 0, no errors. This applies against `./data/fafnir.db` (the 102 real
imported test transactions), needed for Task 5's manual verification later.

- [ ] **Step 4: Update `category-mutations.ts` for purpose-aware rules**

Replace `src/app/(app)/actions/category-mutations.ts` with:

```ts
'use server';

import { and, eq, isNull } from 'drizzle-orm';
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

/**
 * A new (non-null) purposeContains must not be a substring of, or contain as a substring,
 * any other purposeContains already set for this merchant — in either direction. An exact
 * match is an update to that same rule, not an overlap. This keeps rule resolution
 * unambiguous without needing a tiebreak at resolution time (design spec, Fall B2).
 */
function assertNoOverlap(existingPurposeContains: (string | null)[], candidate: string): void {
  for (const existing of existingPurposeContains) {
    if (existing === null || existing === candidate) continue;
    if (existing.includes(candidate) || candidate.includes(existing)) {
      throw new Error(
        `„${candidate}“ überschneidet sich mit der bestehenden Regel „${existing}“ für diese Gegenpartei.`
      );
    }
  }
}

function ruleCondition(merchantKey: string, purposeContains: string | null) {
  return purposeContains === null
    ? and(eq(merchantCategoryRules.merchantKey, merchantKey), isNull(merchantCategoryRules.purposeContains))
    : and(eq(merchantCategoryRules.merchantKey, merchantKey), eq(merchantCategoryRules.purposeContains, purposeContains));
}

/**
 * Sets (or clears) the category rule for one merchant. `purposeContains: null` is the
 * merchant's fallback rule (applies unless a more specific purpose-scoped rule matches);
 * a non-null value scopes the rule to transactions whose purpose contains that substring.
 * At most one fallback rule per merchant is guaranteed by updating the existing null-row
 * in place instead of relying on the DB unique index, which treats every NULL as distinct.
 */
export async function applyMerchantRule(
  merchantKey: string,
  purposeContains: string | null,
  target: CategoryTarget
): Promise<void> {
  if (target.type === 'clear') {
    await db.delete(merchantCategoryRules).where(ruleCondition(merchantKey, purposeContains));
    return;
  }

  const categoryId = await resolveCategoryId(target);
  const existingRules = await db
    .select()
    .from(merchantCategoryRules)
    .where(eq(merchantCategoryRules.merchantKey, merchantKey));

  if (purposeContains !== null) {
    assertNoOverlap(existingRules.map((r) => r.purposeContains), purposeContains);
  }

  const existing = existingRules.find((r) => r.purposeContains === purposeContains);
  if (existing) {
    await db.update(merchantCategoryRules).set({ categoryId }).where(eq(merchantCategoryRules.id, existing.id));
  } else {
    await db.insert(merchantCategoryRules).values({ merchantKey, purposeContains, categoryId });
  }
}

/** Sets (or clears) the category override on exactly one transaction. */
export async function applyTransactionOverride(transactionId: number, target: CategoryTarget): Promise<void> {
  const categoryId = target.type === 'clear' ? null : await resolveCategoryId(target);
  await db.update(transactions).set({ categoryOverrideId: categoryId }).where(eq(transactions.id, transactionId));
}
```

Note: this file is a plain module (no `'use server'` export restrictions beyond what
Next.js requires for the directive at the top — keep the existing `'use server'` line as
in the current file).

- [ ] **Step 5: Update `categories.ts` to thread `purposeContains` through the server action**

Edit `src/app/(app)/actions/categories.ts`, `setMerchantRule`:

```ts
export async function setMerchantRule(
  merchantKey: string,
  purposeContains: string | null,
  target: CategoryTarget
): Promise<void> {
  await requireSession();
  await applyMerchantRule(merchantKey, purposeContains, target);
  revalidateCategorizedPages();
}
```

(`setTransactionOverride` is unchanged.)

- [ ] **Step 6: Update existing tests to the new signature**

In `src/app/(app)/actions/category-mutations.test.ts`, update every existing
`applyMerchantRule(...)` call to pass `null` as the second argument, e.g.:

```ts
await applyMerchantRule('Rewe Markt GmbH', null, { type: 'newCategory', name: 'Lebensmittel' });
```

Apply this to every existing `applyMerchantRule(...)` call site (7 call sites across the 4
tests: "creates both", "reuses it" (2 calls), "updates it instead of duplicating" (2
calls), and "clearing a rule deletes it" (2 calls)) in the
`describe('applyMerchantRule', ...)` block.

- [ ] **Step 7: Write the new failing tests for `purposeContains`**

Append to `src/app/(app)/actions/category-mutations.test.ts`, after the existing
`describe('applyMerchantRule', ...)` block:

```ts
describe('applyMerchantRule with purposeContains', () => {
  test('a purpose-specific rule and the merchant fallback rule coexist independently', async () => {
    const { db, schema, applyMerchantRule } = await freshDb();
    const [food] = await db.insert(schema.categories).values({ name: 'Lebensmittel' }).returning();
    const [salary] = await db.insert(schema.categories).values({ name: 'Gehalt' }).returning();

    await applyMerchantRule('Rudolf Steiner Schulverein Hamburg- Wandsbek e.V.', null, {
      type: 'category',
      categoryId: food.id,
    });
    await applyMerchantRule('Rudolf Steiner Schulverein Hamburg- Wandsbek e.V.', 'Gehalt', {
      type: 'category',
      categoryId: salary.id,
    });

    const rules = await db.select().from(schema.merchantCategoryRules);
    expect(rules).toHaveLength(2);
    expect(rules.find((r) => r.purposeContains === null)?.categoryId).toBe(food.id);
    expect(rules.find((r) => r.purposeContains === 'Gehalt')?.categoryId).toBe(salary.id);
  });

  test('assigning a purposeContains that overlaps an existing one for the same merchant throws', async () => {
    const { db, schema, applyMerchantRule } = await freshDb();
    const [category] = await db.insert(schema.categories).values({ name: 'Sonstiges' }).returning();
    await applyMerchantRule('Rudolf Steiner Schulverein Hamburg- Wandsbek e.V.', 'Schulgeld', {
      type: 'category',
      categoryId: category.id,
    });

    await expect(
      applyMerchantRule('Rudolf Steiner Schulverein Hamburg- Wandsbek e.V.', 'Schulgeld Klasse 3', {
        type: 'category',
        categoryId: category.id,
      })
    ).rejects.toThrow(/überschneidet sich/);

    const rules = await db.select().from(schema.merchantCategoryRules);
    expect(rules).toHaveLength(1);
  });

  test('re-assigning the exact same purposeContains updates that rule instead of throwing', async () => {
    const { db, schema, applyMerchantRule } = await freshDb();
    const [food] = await db.insert(schema.categories).values({ name: 'Lebensmittel' }).returning();
    const [other] = await db.insert(schema.categories).values({ name: 'Sonstiges' }).returning();
    await applyMerchantRule('Rudolf Steiner Schulverein Hamburg- Wandsbek e.V.', 'Hort', {
      type: 'category',
      categoryId: food.id,
    });

    await applyMerchantRule('Rudolf Steiner Schulverein Hamburg- Wandsbek e.V.', 'Hort', {
      type: 'category',
      categoryId: other.id,
    });

    const rules = await db.select().from(schema.merchantCategoryRules);
    expect(rules).toHaveLength(1);
    expect(rules[0].categoryId).toBe(other.id);
  });

  test('clearing a purpose-specific rule removes only that rule', async () => {
    const { db, schema, applyMerchantRule } = await freshDb();
    const [category] = await db.insert(schema.categories).values({ name: 'Lebensmittel' }).returning();
    await applyMerchantRule('Rudolf Steiner Schulverein Hamburg- Wandsbek e.V.', null, {
      type: 'category',
      categoryId: category.id,
    });
    await applyMerchantRule('Rudolf Steiner Schulverein Hamburg- Wandsbek e.V.', 'Hort', {
      type: 'category',
      categoryId: category.id,
    });

    await applyMerchantRule('Rudolf Steiner Schulverein Hamburg- Wandsbek e.V.', 'Hort', { type: 'clear' });

    const rules = await db.select().from(schema.merchantCategoryRules);
    expect(rules).toHaveLength(1);
    expect(rules[0].purposeContains).toBeNull();
  });
});
```

- [ ] **Step 8: Run the test file and confirm everything is green**

Run: `npx vitest run src/app/(app)/actions/category-mutations.test.ts`
Expected: all tests pass (existing ones updated in Step 6, new ones from Step 7).

- [ ] **Step 9: Commit**

```bash
git add src/db/schema.ts drizzle/ src/app/\(app\)/actions/category-mutations.ts src/app/\(app\)/actions/categories.ts src/app/\(app\)/actions/category-mutations.test.ts
git commit -m "feat: add purposeContains to merchant category rules"
```

---

### Task 2: Resolution logic — purpose-scoped rule matching

**Files:**
- Modify: `src/lib/category-resolution.ts`
- Test: `src/lib/category-resolution.test.ts`

**Interfaces:**
- Consumes: `getMerchantKey(tx)` from `src/lib/merchant-key.ts` (unchanged).
- Produces: `MerchantRuleEntry { purposeContains: string | null; categoryId: number }`.
- Produces: `findGoverningMerchantRule(tx, rulesByMerchantKey: Map<string, MerchantRuleEntry[]>): MerchantRuleEntry | null` — used later by Task 3 to know exactly which rule governs a given row.
- Produces: `resolveTransactionCategory(tx, rulesByMerchantKey: Map<string, MerchantRuleEntry[]>, categoriesById): ResolvedCategory` — same name/return type as before, `rulesByMerchantKey`'s value type changes from `number` to `MerchantRuleEntry[]`.
- Produces: `buildCategoryLookups(categoryRows, ruleRows: { merchantKey: string; purposeContains: string | null; categoryId: number }[])` — `ruleRows` gains the `purposeContains` field; return type's `rulesByMerchantKey` is now `Map<string, MerchantRuleEntry[]>`.

- [ ] **Step 1: Write the failing tests**

Replace the entire content of `src/lib/category-resolution.test.ts` — the `rules` fixture
needs the new field, and two new `describe` blocks are added. Full replacement:

```ts
import { describe, expect, test } from 'vitest';
import { buildCategoryLookups, findGoverningMerchantRule, resolveTransactionCategory } from './category-resolution';

const categories = [
  { id: 1, name: 'Lebensmittel' },
  { id: 2, name: 'Sonstiges' },
];
const rules = [{ merchantKey: 'Rewe Markt GmbH', purposeContains: null, categoryId: 1 }];

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
    const rulesForPurpose = [{ merchantKey: 'Rewe Sagt Danke', purposeContains: null, categoryId: 1 }];
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

describe('resolveTransactionCategory — purpose-scoped rules', () => {
  const purposeRules = [
    { merchantKey: 'Rudolf Steiner Schulverein Hamburg- Wandsbek e.V.', purposeContains: null, categoryId: 2 },
    { merchantKey: 'Rudolf Steiner Schulverein Hamburg- Wandsbek e.V.', purposeContains: 'Gehalt', categoryId: 1 },
  ];

  test('a purpose-specific rule wins over the merchant fallback rule when the purpose matches', () => {
    const { categoriesById, rulesByMerchantKey } = buildCategoryLookups(categories, purposeRules);
    const tx = {
      categoryOverrideId: null,
      counterparty: 'Rudolf Steiner Schulverein Hamburg- Wandsbek e.V.',
      purpose: 'Gehalt August 2026',
    };

    expect(resolveTransactionCategory(tx, rulesByMerchantKey, categoriesById)).toEqual({
      categoryId: 1,
      categoryName: 'Lebensmittel',
      source: 'rule',
    });
  });

  test('falls back to the merchant fallback rule when the purpose matches no purpose-specific rule', () => {
    const { categoriesById, rulesByMerchantKey } = buildCategoryLookups(categories, purposeRules);
    const tx = {
      categoryOverrideId: null,
      counterparty: 'Rudolf Steiner Schulverein Hamburg- Wandsbek e.V.',
      purpose: 'Schulgeld September 2026',
    };

    expect(resolveTransactionCategory(tx, rulesByMerchantKey, categoriesById)).toEqual({
      categoryId: 2,
      categoryName: 'Sonstiges',
      source: 'rule',
    });
  });

  test('resolves to none when only purpose-specific rules exist and none match, with no fallback rule', () => {
    const purposeOnlyRules = [
      { merchantKey: 'Rudolf Steiner Schulverein Hamburg- Wandsbek e.V.', purposeContains: 'Gehalt', categoryId: 1 },
    ];
    const { categoriesById, rulesByMerchantKey } = buildCategoryLookups(categories, purposeOnlyRules);
    const tx = {
      categoryOverrideId: null,
      counterparty: 'Rudolf Steiner Schulverein Hamburg- Wandsbek e.V.',
      purpose: 'Hort Oktober 2026',
    };

    expect(resolveTransactionCategory(tx, rulesByMerchantKey, categoriesById)).toEqual({
      categoryId: null,
      categoryName: null,
      source: 'none',
    });
  });
});

describe('findGoverningMerchantRule', () => {
  test('returns null when the merchant has no rules at all', () => {
    const { rulesByMerchantKey } = buildCategoryLookups(categories, []);
    const tx = { counterparty: 'Unbekannter Laden', purpose: null };
    expect(findGoverningMerchantRule(tx, rulesByMerchantKey)).toBeNull();
  });

  test('returns the matching purpose-scoped rule over the fallback rule', () => {
    const purposeRules = [
      { merchantKey: 'Rudolf Steiner Schulverein Hamburg- Wandsbek e.V.', purposeContains: null, categoryId: 2 },
      { merchantKey: 'Rudolf Steiner Schulverein Hamburg- Wandsbek e.V.', purposeContains: 'Gehalt', categoryId: 1 },
    ];
    const { rulesByMerchantKey } = buildCategoryLookups(categories, purposeRules);
    const tx = { counterparty: 'Rudolf Steiner Schulverein Hamburg- Wandsbek e.V.', purpose: 'Gehalt August 2026' };

    expect(findGoverningMerchantRule(tx, rulesByMerchantKey)).toEqual({ purposeContains: 'Gehalt', categoryId: 1 });
  });
});

describe('buildCategoryLookups', () => {
  test('indexes categories by id and groups rules by merchant key', () => {
    const { categoriesById, rulesByMerchantKey } = buildCategoryLookups(categories, rules);

    expect(categoriesById.get(1)).toEqual({ id: 1, name: 'Lebensmittel' });
    expect(rulesByMerchantKey.get('Rewe Markt GmbH')).toEqual([{ purposeContains: null, categoryId: 1 }]);
  });
});
```

- [ ] **Step 2: Run the test file and confirm it fails**

Run: `npx vitest run src/lib/category-resolution.test.ts`
Expected: FAIL — `findGoverningMerchantRule` is not exported, and the `rules`/`purposeRules`
fixtures no longer match the current `buildCategoryLookups(categoryRows, ruleRows: {
merchantKey, categoryId }[])` signature.

- [ ] **Step 3: Rewrite `category-resolution.ts`**

```ts
import { getMerchantKey } from './merchant-key';

export interface CategoryRef {
  id: number;
  name: string;
}

export interface MerchantRuleEntry {
  purposeContains: string | null;
  categoryId: number;
}

export interface ResolvedCategory {
  categoryId: number | null;
  categoryName: string | null;
  source: 'override' | 'rule' | 'none';
}

/**
 * Picks the merchant rule that governs this transaction: a purpose-scoped rule whose
 * `purposeContains` is a substring of the transaction's purpose wins over the merchant's
 * fallback rule (`purposeContains: null`). Returns null when no rule applies at all.
 */
export function findGoverningMerchantRule(
  tx: { counterparty: string | null; purpose: string | null },
  rulesByMerchantKey: Map<string, MerchantRuleEntry[]>
): MerchantRuleEntry | null {
  const rules = rulesByMerchantKey.get(getMerchantKey(tx));
  if (!rules) return null;

  const purpose = tx.purpose ?? '';
  const purposeMatch = rules.find((r) => r.purposeContains !== null && purpose.includes(r.purposeContains));
  return purposeMatch ?? rules.find((r) => r.purposeContains === null) ?? null;
}

/**
 * Resolves a transaction's effective category, pure and in-memory:
 * 1. an explicit per-transaction override wins,
 * 2. otherwise the governing merchant rule applies — a purpose-scoped rule first,
 *    then the merchant's fallback rule,
 * 3. otherwise the transaction is uncategorized.
 * No amount/date/keyword heuristics — only these explicit sources.
 */
export function resolveTransactionCategory(
  tx: { categoryOverrideId: number | null; counterparty: string | null; purpose: string | null },
  rulesByMerchantKey: Map<string, MerchantRuleEntry[]>,
  categoriesById: Map<number, CategoryRef>
): ResolvedCategory {
  if (tx.categoryOverrideId !== null) {
    const category = categoriesById.get(tx.categoryOverrideId);
    return { categoryId: tx.categoryOverrideId, categoryName: category?.name ?? null, source: 'override' };
  }

  const rule = findGoverningMerchantRule(tx, rulesByMerchantKey);
  if (rule) {
    const category = categoriesById.get(rule.categoryId);
    return { categoryId: rule.categoryId, categoryName: category?.name ?? null, source: 'rule' };
  }

  return { categoryId: null, categoryName: null, source: 'none' };
}

/**
 * Converts the two small reference tables (`categories`, `merchant_category_rules`)
 * into lookup maps once per request, so `resolveTransactionCategory()` can run
 * per-transaction with no further queries. Rules are grouped by merchant key since a
 * merchant can have several purpose-scoped rules plus one fallback rule.
 */
export function buildCategoryLookups(
  categoryRows: CategoryRef[],
  ruleRows: { merchantKey: string; purposeContains: string | null; categoryId: number }[]
): { categoriesById: Map<number, CategoryRef>; rulesByMerchantKey: Map<string, MerchantRuleEntry[]> } {
  const categoriesById = new Map(categoryRows.map((c) => [c.id, c]));
  const rulesByMerchantKey = new Map<string, MerchantRuleEntry[]>();
  for (const r of ruleRows) {
    const entry: MerchantRuleEntry = { purposeContains: r.purposeContains, categoryId: r.categoryId };
    const existing = rulesByMerchantKey.get(r.merchantKey);
    if (existing) {
      existing.push(entry);
    } else {
      rulesByMerchantKey.set(r.merchantKey, [entry]);
    }
  }
  return { categoriesById, rulesByMerchantKey };
}
```

- [ ] **Step 4: Run the test file and confirm it passes**

Run: `npx vitest run src/lib/category-resolution.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/category-resolution.ts src/lib/category-resolution.test.ts
git commit -m "feat: resolve purpose-scoped merchant rules ahead of the fallback rule"
```

---

### Task 3: Wire the resolved rule through the transaction list

**Files:**
- Modify: `src/app/(app)/accounts/[id]/page.tsx`
- Modify: `src/components/transactions/transaction-list.tsx` (`TransactionListRow`)
- Modify: `src/components/transactions/category-badge.tsx`

**Interfaces:**
- Consumes: `findGoverningMerchantRule`, `resolveTransactionCategory`, `buildCategoryLookups`, `MerchantRuleEntry` from Task 2.
- Consumes: `setMerchantRule(merchantKey, purposeContains, target)` from Task 1.
- Produces: `TransactionListRow.merchantRulePurposeContains: string | null` — new field, threaded into `CategoryBadge` so its "Alle Buchungen dieser Gegenpartei" picker edits the rule that actually governs this row (a purpose-scoped rule if one matched, otherwise the fallback rule) instead of always writing the fallback rule regardless of what's displayed.

No new unit tests are added in this task — there is no existing test coverage for these
three files (page/list/badge components), consistent with the rest of the codebase.
Verification is the production build plus the full existing suite (regression), followed
by manual verification against the real dev data in Task 5.

- [ ] **Step 1: Compute the governing rule per row in the account page**

Edit `src/app/(app)/accounts/[id]/page.tsx`:

```ts
import { buildCategoryLookups, findGoverningMerchantRule, resolveTransactionCategory } from '@/lib/category-resolution';
```

Replace the `rows` mapping:

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

- [ ] **Step 2: Add the field to `TransactionListRow`**

Edit `src/components/transactions/transaction-list.tsx`:

```ts
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
  merchantRulePurposeContains: string | null;
}
```

And pass it into `CategoryBadge` in `TransactionRow`:

```tsx
      <CategoryBadge
        transactionId={tx.id}
        merchantKey={tx.merchantKey}
        effectiveCategory={tx.effectiveCategory}
        overrideCategoryId={tx.overrideCategoryId}
        merchantRuleCategoryId={tx.merchantRuleCategoryId}
        merchantRulePurposeContains={tx.merchantRulePurposeContains}
        categories={categories}
      />
```

- [ ] **Step 3: Consume it in `CategoryBadge`**

Edit `src/components/transactions/category-badge.tsx`:

```tsx
export interface CategoryBadgeProps {
  transactionId: number;
  merchantKey: string;
  effectiveCategory: { id: number; name: string } | null;
  overrideCategoryId: number | null;
  merchantRuleCategoryId: number | null;
  /** The purposeContains of whichever rule currently governs this transaction (null = the
   * merchant's fallback rule). Passed back into setMerchantRule so edits land on that
   * exact rule instead of always creating/updating the fallback rule. */
  merchantRulePurposeContains: string | null;
  categories: { id: number; name: string }[];
}

export function CategoryBadge({
  transactionId,
  merchantKey,
  effectiveCategory,
  overrideCategoryId,
  merchantRuleCategoryId,
  merchantRulePurposeContains,
  categories,
}: CategoryBadgeProps) {
```

And update its "Alle Buchungen dieser Gegenpartei" `CategoryPicker`:

```tsx
            <CategoryPicker
              categories={categories}
              selectedCategoryId={merchantRuleCategoryId}
              showClear={merchantRuleCategoryId !== null}
              clearLabel="Kategorie entfernen"
              onSubmit={(target) => setMerchantRule(merchantKey, merchantRulePurposeContains, target)}
            />
```

(The "Nur diese Buchung" `CategoryPicker` calling `setTransactionOverride` is unchanged.)

- [ ] **Step 4: Build and run the full suite**

Run: `npm run build && npm test`
Expected: build succeeds, all tests pass (no new tests in this task, so this is a pure
regression check — Task 1/2's tests must still be green, and the TypeScript compiler must
accept the new field threading end-to-end).

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/accounts/\[id\]/page.tsx src/components/transactions/transaction-list.tsx src/components/transactions/category-badge.tsx
git commit -m "feat: edit the transaction's actually-governing rule from the row badge"
```

---

### Task 4: `/categorize` UI — split a merchant rule by purpose

**Files:**
- Modify: `src/components/category-picker.tsx`
- Modify: `src/app/(app)/categorize/merchant-category-form.tsx`

**Interfaces:**
- Consumes: `setMerchantRule(merchantKey, purposeContains, target)` from Task 1.
- `CategoryPickerProps` is unchanged (no new props) — only its internal error handling changes.

`/categorize/page.tsx` itself needs no change: it already renders
`<MerchantCategoryForm merchantKey={group.merchantKey} categories={categoryRows} />`, and a
merchant only ever appears in that list when it has no rule (purpose-scoped or fallback)
matching the listed transactions — see spec §5. `applyMerchantRule` can throw an overlap
error (Task 1) once this task adds a UI path that lets a user type a `purposeContains`
value, so `CategoryPicker` needs to surface that error instead of leaving an unhandled
rejection.

- [ ] **Step 1: Add error surfacing to `CategoryPicker`**

Edit `src/components/category-picker.tsx` — add an `error` state, catch `onSubmit`
rejections, and render the message. Full replacement:

```tsx
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
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isNew = selection === NEW_CATEGORY_VALUE;
  const canSubmit = isNew ? newCategoryName.trim() !== '' : selection !== '';

  function submit(target: CategoryTarget) {
    setError(null);
    startTransition(async () => {
      try {
        await onSubmit(target);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Fehler beim Speichern.');
      }
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    const target: CategoryTarget = isNew
      ? { type: 'newCategory', name: newCategoryName.trim() }
      : { type: 'category', categoryId: Number(selection) };
    submit(target);
  }

  function handleClear() {
    submit({ type: 'clear' });
  }

  return (
    <div>
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
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Add purpose-scoped rule rows to `MerchantCategoryForm`**

Replace `src/app/(app)/categorize/merchant-category-form.tsx`:

```tsx
'use client';

import { useRef, useState } from 'react';
import { setMerchantRule } from '@/app/(app)/actions/categories';
import { CategoryPicker } from '@/components/category-picker';

export function MerchantCategoryForm({
  merchantKey,
  categories,
}: {
  merchantKey: string;
  categories: { id: number; name: string }[];
}) {
  const [purposeDraftIds, setPurposeDraftIds] = useState<number[]>([]);
  const nextDraftId = useRef(0);

  return (
    <div className="space-y-2">
      <CategoryPicker
        categories={categories}
        selectedCategoryId={null}
        showClear={false}
        clearLabel="Kategorie entfernen"
        onSubmit={(target) => setMerchantRule(merchantKey, null, target)}
      />

      {purposeDraftIds.map((id) => (
        <PurposeRuleRow
          key={id}
          merchantKey={merchantKey}
          categories={categories}
          onRemove={() => setPurposeDraftIds((ids) => ids.filter((draftId) => draftId !== id))}
        />
      ))}

      <button
        type="button"
        onClick={() => setPurposeDraftIds((ids) => [...ids, nextDraftId.current++])}
        className="text-xs text-muted-foreground hover:text-foreground"
      >
        + Regel für Verwendungszweck hinzufügen
      </button>
    </div>
  );
}

function PurposeRuleRow({
  merchantKey,
  categories,
  onRemove,
}: {
  merchantKey: string;
  categories: { id: number; name: string }[];
  onRemove: () => void;
}) {
  const [purposeContains, setPurposeContains] = useState('');

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
      <input
        type="text"
        value={purposeContains}
        onChange={(event) => setPurposeContains(event.target.value)}
        placeholder="Verwendungszweck enthält…"
        aria-label="Verwendungszweck enthält"
        className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
      />
      <CategoryPicker
        categories={categories}
        selectedCategoryId={null}
        showClear={false}
        clearLabel="Kategorie entfernen"
        onSubmit={async (target) => {
          const trimmed = purposeContains.trim();
          if (trimmed === '') {
            throw new Error('Verwendungszweck darf nicht leer sein.');
          }
          await setMerchantRule(merchantKey, trimmed, target);
        }}
      />
      <button type="button" onClick={onRemove} className="text-xs text-muted-foreground hover:text-foreground">
        Entfernen
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Build and run the full suite**

Run: `npm run build && npm test`
Expected: build succeeds, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/category-picker.tsx src/app/\(app\)/categorize/merchant-category-form.tsx
git commit -m "feat: split a merchant category rule by purpose from /categorize"
```

---

### Task 5: Verification against the real 102 imported transactions

**Files:** none (verification only).

This mirrors spec §6's "Manuelle Verifikation", scoped to the new capability, and closes
out the exact scenario the spec's §B2 background section names (Rudolf Steiner
Schulverein, Arbeitgeber, Vater — a counterparty with several distinct booking types
sharing one `merchantKey`).

- [ ] **Step 1: Run the full suite and linter one more time**

Run: `npm run lint && npm test && npm run build`
Expected: all three succeed with no errors.

- [ ] **Step 2: Start the dev server**

Run: `npm run dev` (leave running)

- [ ] **Step 3: Reproduce the spec's motivating case**

In the browser, go to `/categorize`. Find a merchant that has multiple distinct booking
types in its transactions (per the design doc's background: a merchant paying both salary
and school fees, or the equivalent in the local 102-row dataset — inspect the listed
`purpose` text of its grouped transactions to pick two distinguishing substrings).

- Assign the group's default `CategoryPicker` a category (this sets the fallback rule).
- Click "+ Regel für Verwendungszweck hinzufügen", enter a substring that's present in only
  one booking type's `purpose` (e.g. `Gehalt`), and assign it a **different** category.
- Reload `/categorize`: transactions matching that purpose substring should no longer be
  in the uncategorized list; other transactions from the same merchant not matching any
  purpose rule (and not yet covered by the fallback, if you only set the purpose rule)
  should still appear, or should show the fallback's category if you set both.

- [ ] **Step 4: Verify on the account page**

Go to the account page listing that merchant's transactions. Confirm:
- Transactions whose purpose contains the purpose-rule substring show the purpose rule's
  category badge.
- Other transactions from the same merchant show the fallback rule's category badge (or
  "Unkategorisiert" if no fallback was set).
- Click one such badge open: the "Alle Buchungen dieser Gegenpartei" picker is pre-filled
  with the category of whichever rule actually governs *that* row (purpose rule or
  fallback) — not always the fallback rule.

- [ ] **Step 5: Verify the overlap guard**

On `/categorize` (or by re-opening a badge), try adding a second purpose rule for the same
merchant whose substring overlaps an already-set one (e.g. `Gehalt` then `Gehalt August`).
Confirm an error message appears under that row's picker instead of silently creating a
conflicting rule, and that no duplicate/overlapping row was written (check via
`sqlite3 data/fafnir.db "select * from merchant_category_rules;"` if needed).

- [ ] **Step 6: Confirm no regression on migration**

Run: `sqlite3 data/fafnir.db "select count(*) from transactions;"`
Expected: `102` (or whatever the current row count is) — unchanged, confirming the schema
migration in Task 1 didn't drop or corrupt existing data.

No commit for this task — it is verification only. If any step surfaces a bug, fix it as
part of the task where the bug originates and re-run this task's steps from the top.
