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

  test('when two disjoint purpose-scoped rules both match, the longer purposeContains wins', () => {
    // Deliberately insert the *shorter* rule first: a naive insertion-order scan would
    // return the 'Hort' rule (categoryId 2) here, so this only passes if buildCategoryLookups
    // actually reorders by purposeContains length rather than preserving row order.
    const disjointRules = [
      { merchantKey: 'Rudolf Steiner Schulverein Hamburg- Wandsbek e.V.', purposeContains: 'Hort', categoryId: 2 },
      { merchantKey: 'Rudolf Steiner Schulverein Hamburg- Wandsbek e.V.', purposeContains: 'Schulgeld', categoryId: 1 },
    ];
    const { categoriesById, rulesByMerchantKey } = buildCategoryLookups(categories, disjointRules);
    const tx = {
      categoryOverrideId: null,
      counterparty: 'Rudolf Steiner Schulverein Hamburg- Wandsbek e.V.',
      purpose: 'Schulgeld und Hort Oktober',
    };

    expect(resolveTransactionCategory(tx, rulesByMerchantKey, categoriesById)).toEqual({
      categoryId: 1,
      categoryName: 'Lebensmittel',
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
