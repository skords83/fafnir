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
