import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/db/client';
import { accounts, categories, merchantCategoryRules, transactions } from '@/db/schema';
import { buildCategoryLookups, resolveTransactionCategory } from '@/lib/category-resolution';
import { CATEGORY_HAS_CHILDREN_MESSAGE } from '@/lib/category-messages';
import { getMerchantKey } from '@/lib/merchant-key';

export type CategoryTarget =
  | { type: 'category'; categoryId: number }
  | { type: 'newCategory'; name: string }
  | { type: 'clear' };

type AssignTarget = Exclude<CategoryTarget, { type: 'clear' }>;

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
        `„${candidate}" überschneidet sich mit der bestehenden Regel „${existing}" für diese Gegenpartei.`
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

/**
 * Counts how many transactions have this category as their manual override, how many
 * merchant rules assign this category, and how many categories use it as their
 * Oberkategorie (parent) — the three ways a category can be "in use". Always queried
 * fresh (never trust a client-supplied count), since this backs the delete-blocking
 * check as well as the usage display on the categories page.
 */
export async function countCategoryUsage(
  categoryId: number
): Promise<{ transactionCount: number; ruleCount: number; childCount: number }> {
  const [{ value: transactionCount }] = await db
    .select({ value: count() })
    .from(transactions)
    .where(eq(transactions.categoryOverrideId, categoryId));
  const [{ value: ruleCount }] = await db
    .select({ value: count() })
    .from(merchantCategoryRules)
    .where(eq(merchantCategoryRules.categoryId, categoryId));
  const [{ value: childCount }] = await db
    .select({ value: count() })
    .from(categories)
    .where(eq(categories.parentCategoryId, categoryId));
  return { transactionCount, ruleCount, childCount };
}

/** Renames a category. Throws a German-language error on an empty name or a name collision. */
export async function renameCategory(categoryId: number, name: string): Promise<void> {
  const trimmed = name.trim();
  if (trimmed === '') {
    throw new Error('Der Kategoriename darf nicht leer sein.');
  }
  let updated: { id: number }[];
  try {
    updated = await db
      .update(categories)
      .set({ name: trimmed })
      .where(eq(categories.id, categoryId))
      .returning({ id: categories.id });
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new Error(`Es gibt bereits eine Kategorie namens „${trimmed}".`);
    }
    throw err;
  }
  if (updated.length === 0) {
    throw new Error('Diese Kategorie existiert nicht mehr.');
  }
}

/**
 * Deletes a category. Re-checks usage immediately before deleting (see
 * `countCategoryUsage`) and throws a German-language error naming the current
 * counts instead of deleting — `categories` is referenced by a NOT NULL FK from
 * `merchantCategoryRules.categoryId`, and by its own self-referencing `parentCategoryId`
 * FK from any category that uses it as an Oberkategorie, so an in-use category can never
 * be deleted out from under a rule or a child category.
 */
export async function deleteCategory(categoryId: number): Promise<void> {
  const { transactionCount, ruleCount, childCount } = await countCategoryUsage(categoryId);
  if (transactionCount > 0 || ruleCount > 0 || childCount > 0) {
    const parts: string[] = [];
    if (transactionCount > 0) {
      parts.push(`${transactionCount} Buchung${transactionCount === 1 ? '' : 'en'}`);
    }
    if (ruleCount > 0) {
      parts.push(`${ruleCount} Regel${ruleCount === 1 ? '' : 'n'}`);
    }
    if (childCount > 0) {
      parts.push(`${childCount} Kategorie${childCount === 1 ? '' : 'n'} als Oberkategorie`);
    }
    throw new Error(`Kategorie wird noch von ${parts.join(' und ')} verwendet.`);
  }
  try {
    await db.delete(categories).where(eq(categories.id, categoryId));
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      throw new Error('Kategorie wird noch verwendet und kann nicht gelöscht werden.');
    }
    throw err;
  }
}

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
    throw new Error(`„${parent.name}" hat selbst eine Oberkategorie und kann nicht als Oberkategorie verwendet werden.`);
  }
  const [existingChild] = await db.select().from(categories).where(eq(categories.parentCategoryId, categoryId));
  if (existingChild) {
    throw new Error(CATEGORY_HAS_CHILDREN_MESSAGE);
  }
  await db.update(categories).set({ parentCategoryId: parentId }).where(eq(categories.id, categoryId));
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
