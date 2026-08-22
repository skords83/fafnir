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
