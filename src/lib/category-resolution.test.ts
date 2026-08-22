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
