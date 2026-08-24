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
 * Resolves a transaction's effective category, pure and in-memory:
 * 1. an explicit per-transaction override wins,
 * 2. otherwise the merchant's purpose-scoped rules (exact substring match against `tx.purpose`),
 * 3. otherwise the merchant's fallback rule (null purposeContains),
 * 4. otherwise the transaction is uncategorized.
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

  const governingRule = findGoverningMerchantRule(tx, rulesByMerchantKey);
  if (governingRule !== null) {
    const category = categoriesById.get(governingRule.categoryId);
    return { categoryId: governingRule.categoryId, categoryName: category?.name ?? null, source: 'rule' };
  }

  return { categoryId: null, categoryName: null, source: 'none' };
}

/**
 * Finds the governing merchant rule for a transaction:
 * - purpose-scoped rules (substring match) win over the fallback rule,
 * - among purpose-scoped rules, `buildCategoryLookups` orders them longest-`purposeContains`-first,
 *   so the most specific matching rule is returned; two independently-typed rules with disjoint
 *   substrings (neither contains the other) can still both textually match one transaction's
 *   purpose, in which case the longer one governs by convention, not because overlap was ruled out,
 * - the fallback rule (null purposeContains) is tried if no purpose-scoped rule matches,
 * - returns null if no rule applies.
 */
export function findGoverningMerchantRule(
  tx: { counterparty: string | null; purpose: string | null },
  rulesByMerchantKey: Map<string, MerchantRuleEntry[]>
): MerchantRuleEntry | null {
  const merchantKey = getMerchantKey(tx);
  const rulesForMerchant = rulesByMerchantKey.get(merchantKey);

  if (!rulesForMerchant) {
    return null;
  }

  // First, try to find a purpose-scoped rule that matches
  if (tx.purpose !== null) {
    for (const rule of rulesForMerchant) {
      if (rule.purposeContains !== null && tx.purpose.includes(rule.purposeContains)) {
        return rule;
      }
    }
  }

  // Fall back to the merchant's fallback rule (null purposeContains)
  for (const rule of rulesForMerchant) {
    if (rule.purposeContains === null) {
      return rule;
    }
  }

  return null;
}

/**
 * Converts the two small reference tables (`categories`, `merchant_category_rules`)
 * into lookup maps once per request, so `resolveTransactionCategory()` can run
 * per-transaction with no further queries.
 * Rules are grouped by merchant key (multiple rules per merchant are possible).
 */
export function buildCategoryLookups(
  categoryRows: CategoryRef[],
  ruleRows: { merchantKey: string; purposeContains: string | null; categoryId: number }[]
): { categoriesById: Map<number, CategoryRef>; rulesByMerchantKey: Map<string, MerchantRuleEntry[]> } {
  const categoriesById = new Map(categoryRows.map((c) => [c.id, c]));

  const rulesByMerchantKey = new Map<string, MerchantRuleEntry[]>();
  for (const row of ruleRows) {
    if (!rulesByMerchantKey.has(row.merchantKey)) {
      rulesByMerchantKey.set(row.merchantKey, []);
    }
    rulesByMerchantKey.get(row.merchantKey)!.push({ purposeContains: row.purposeContains, categoryId: row.categoryId });
  }

  // Deterministic, most-specific-wins ordering: longer purpose substrings are more
  // specific and are tried first; the fallback rule (null) always comes last. This
  // matters when two purpose-scoped rules are disjoint (neither substring contains the
  // other) but could both match one transaction's purpose text — without a stable order,
  // which one "wins" would depend on unspecified DB row order.
  for (const rules of rulesByMerchantKey.values()) {
    rules.sort((a, b) => {
      if (a.purposeContains === null) return 1;
      if (b.purposeContains === null) return -1;
      return b.purposeContains.length - a.purposeContains.length;
    });
  }

  return { categoriesById, rulesByMerchantKey };
}
