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
