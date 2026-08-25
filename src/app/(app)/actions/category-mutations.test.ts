import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

let tempDir: string;

async function freshDb() {
  const { db } = await import('@/db/client');
  const schema = await import('@/db/schema');
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  migrate(db, { migrationsFolder: './drizzle' });
  const mutations = await import('./category-mutations');
  return { db, schema, ...mutations };
}

async function seedTransaction(
  db: Awaited<ReturnType<typeof freshDb>>['db'],
  schema: Awaited<ReturnType<typeof freshDb>>['schema'],
  overrides: Partial<typeof schema.transactions.$inferInsert> = {}
) {
  const [account] = await db
    .insert(schema.accounts)
    .values({ name: 'Girokonto', currency: 'EUR', createdAt: new Date() })
    .returning();
  const [tx] = await db
    .insert(schema.transactions)
    .values({
      accountId: account.id,
      bookingDate: '2026-08-20',
      amountCents: -1000,
      counterparty: 'REWE Markt GmbH',
      purpose: null,
      externalHash: 'hash-1',
      ...overrides,
    })
    .returning();
  return tx;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'fafnir-category-test-'));
  process.env.DATABASE_PATH = join(tempDir, 'test.db');
  vi.resetModules();
});

afterEach(() => {
  delete process.env.DATABASE_PATH;
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe('applyMerchantRule', () => {
  test('assigning a new category name creates both the category and the rule', async () => {
    const { db, schema, applyMerchantRule } = await freshDb();

    await applyMerchantRule('Rewe Markt GmbH', null, { type: 'newCategory', name: 'Lebensmittel' });

    const [category] = await db.select().from(schema.categories);
    expect(category.name).toBe('Lebensmittel');

    const [rule] = await db.select().from(schema.merchantCategoryRules);
    expect(rule).toEqual(expect.objectContaining({ merchantKey: 'Rewe Markt GmbH', categoryId: category.id }));
  });

  test('assigning a category name that already exists reuses it instead of erroring', async () => {
    const { db, schema, applyMerchantRule } = await freshDb();
    await applyMerchantRule('Rewe Markt GmbH', null, { type: 'newCategory', name: 'Lebensmittel' });
    const [existing] = await db.select().from(schema.categories);

    await applyMerchantRule('Amazon Payments Europe S.C.A.', null, { type: 'newCategory', name: 'Lebensmittel' });

    const allCategories = await db.select().from(schema.categories);
    expect(allCategories).toHaveLength(1);

    const rules = await db.select().from(schema.merchantCategoryRules);
    expect(rules).toHaveLength(2);
    expect(rules.every((r) => r.categoryId === existing.id)).toBe(true);
  });

  test('setting a rule twice for the same merchant updates it instead of duplicating it', async () => {
    const { db, schema, applyMerchantRule } = await freshDb();
    const [foodCategory] = await db.insert(schema.categories).values({ name: 'Lebensmittel' }).returning();
    const [otherCategory] = await db.insert(schema.categories).values({ name: 'Sonstiges' }).returning();

    await applyMerchantRule('Rewe Markt GmbH', null, { type: 'category', categoryId: foodCategory.id });
    await applyMerchantRule('Rewe Markt GmbH', null, { type: 'category', categoryId: otherCategory.id });

    const rules = await db.select().from(schema.merchantCategoryRules);
    expect(rules).toHaveLength(1);
    expect(rules[0].categoryId).toBe(otherCategory.id);
  });

  test('clearing a rule deletes it, leaving affected transactions to fall back to uncategorized', async () => {
    const { db, schema, applyMerchantRule } = await freshDb();
    const [category] = await db.insert(schema.categories).values({ name: 'Lebensmittel' }).returning();
    await applyMerchantRule('Rewe Markt GmbH', null, { type: 'category', categoryId: category.id });

    await applyMerchantRule('Rewe Markt GmbH', null, { type: 'clear' });

    const rules = await db.select().from(schema.merchantCategoryRules);
    expect(rules).toHaveLength(0);
  });

});

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

describe('applyTransactionOverride', () => {
  test('setting an override updates only that transaction', async () => {
    const { db, schema, applyTransactionOverride } = await freshDb();
    const tx = await seedTransaction(db, schema);
    const [category] = await db.insert(schema.categories).values({ name: 'Sonstiges' }).returning();

    await applyTransactionOverride(tx.id, { type: 'category', categoryId: category.id });

    const [updated] = await db.select().from(schema.transactions).where(eq(schema.transactions.id, tx.id));
    expect(updated.categoryOverrideId).toBe(category.id);
  });

  test('clearing an override resets it to null, falling back to the merchant rule', async () => {
    const { db, schema, applyTransactionOverride } = await freshDb();
    const [category] = await db.insert(schema.categories).values({ name: 'Sonstiges' }).returning();
    const tx = await seedTransaction(db, schema, { categoryOverrideId: category.id });

    await applyTransactionOverride(tx.id, { type: 'clear' });

    const [updated] = await db.select().from(schema.transactions).where(eq(schema.transactions.id, tx.id));
    expect(updated.categoryOverrideId).toBeNull();
  });

  test('assigning a brand-new category name on an override creates the category', async () => {
    const { db, schema, applyTransactionOverride } = await freshDb();
    const tx = await seedTransaction(db, schema);

    await applyTransactionOverride(tx.id, { type: 'newCategory', name: 'Ausnahme' });

    const [category] = await db.select().from(schema.categories);
    expect(category.name).toBe('Ausnahme');
    const [updated] = await db.select().from(schema.transactions).where(eq(schema.transactions.id, tx.id));
    expect(updated.categoryOverrideId).toBe(category.id);
  });
});

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

  test('renaming a category that was deleted in the meantime throws a friendly error', async () => {
    const { db, schema, deleteCategory, renameCategory } = await freshDb();
    const [category] = await db.insert(schema.categories).values({ name: 'Lebensmittel' }).returning();

    await deleteCategory(category.id);

    await expect(renameCategory(category.id, 'Essen & Trinken')).rejects.toThrow(/existiert nicht mehr/);
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

describe('getMerchantTransactionsForKey', () => {
  test('returns transactions sorted by bookingDate descending', async () => {
    const { db, schema, getMerchantTransactionsForKey } = await freshDb();
    await seedTransaction(db, schema, { counterparty: 'Amazon EU S.a.r.L.', bookingDate: '2026-08-10', externalHash: 'hash-1' });
    await seedTransaction(db, schema, { counterparty: 'Amazon EU S.a.r.L.', bookingDate: '2026-08-20', externalHash: 'hash-2' });
    await seedTransaction(db, schema, { counterparty: 'Aldi Sued Dienstleistungs-SE', bookingDate: '2026-08-15', externalHash: 'hash-3' });

    const result = await getMerchantTransactionsForKey('Amazon EU S.a.r.L.');

    expect(result).toHaveLength(2);
    expect(result[0].bookingDate).toBe('2026-08-20');
    expect(result[1].bookingDate).toBe('2026-08-10');
  });

  test('includes effectiveCategory null when there is no rule for the merchant', async () => {
    const { db, schema, getMerchantTransactionsForKey } = await freshDb();
    const tx = await seedTransaction(db, schema, { counterparty: 'Amazon EU S.a.r.L.' });

    const [result] = await getMerchantTransactionsForKey('Amazon EU S.a.r.L.');

    expect(result.effectiveCategory).toBeNull();
  });

  test("sets exactPurposeRuleCategoryId only when a rule's purposeContains exactly equals the full purpose", async () => {
    const { db, schema, getMerchantTransactionsForKey } = await freshDb();
    const [category] = await db.insert(schema.categories).values({ name: 'Onlineshopping' }).returning();
    await db.insert(schema.merchantCategoryRules).values({
      merchantKey: 'Amazon',
      purposeContains: 'AMAZON MKTPLC DE',
      categoryId: category.id,
    });
    await seedTransaction(db, schema, {
      counterparty: 'Amazon',
      purpose: 'AMAZON MKTPLC DE',
      externalHash: 'hash-1',
    });
    await seedTransaction(db, schema, {
      counterparty: 'Amazon',
      purpose: 'AMAZON MKTPLC DE 1234',
      externalHash: 'hash-2',
    });

    const rows = await getMerchantTransactionsForKey('Amazon');
    const exact = rows.find((r) => r.purpose === 'AMAZON MKTPLC DE');
    const partial = rows.find((r) => r.purpose === 'AMAZON MKTPLC DE 1234');

    expect(exact?.exactPurposeRuleCategoryId).toBe(category.id);
    expect(partial?.exactPurposeRuleCategoryId).toBeNull();
  });
});
