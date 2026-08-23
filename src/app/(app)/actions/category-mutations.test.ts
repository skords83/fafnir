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

  test('setting a rule with a specific purpose substring creates a purpose-scoped rule', async () => {
    const { db, schema, applyMerchantRule } = await freshDb();
    const [foodCategory] = await db.insert(schema.categories).values({ name: 'Lebensmittel' }).returning();

    await applyMerchantRule('Rewe Markt GmbH', 'groceries', { type: 'category', categoryId: foodCategory.id });

    const rules = await db.select().from(schema.merchantCategoryRules);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toEqual(expect.objectContaining({
      merchantKey: 'Rewe Markt GmbH',
      purposeContains: 'groceries',
      categoryId: foodCategory.id,
    }));
  });

  test('different purpose substrings for the same merchant create separate rules', async () => {
    const { db, schema, applyMerchantRule } = await freshDb();
    const [foodCategory] = await db.insert(schema.categories).values({ name: 'Lebensmittel' }).returning();
    const [gasCategory] = await db.insert(schema.categories).values({ name: 'Benzin' }).returning();

    await applyMerchantRule('Shell', 'fuel', { type: 'category', categoryId: gasCategory.id });
    await applyMerchantRule('Shell', 'car wash', { type: 'category', categoryId: foodCategory.id });

    const rules = await db.select().from(schema.merchantCategoryRules);
    expect(rules).toHaveLength(2);
    expect(rules).toContainEqual(expect.objectContaining({
      merchantKey: 'Shell',
      purposeContains: 'fuel',
      categoryId: gasCategory.id,
    }));
    expect(rules).toContainEqual(expect.objectContaining({
      merchantKey: 'Shell',
      purposeContains: 'car wash',
      categoryId: foodCategory.id,
    }));
  });

  test('updating a purpose-specific rule replaces only that rule', async () => {
    const { db, schema, applyMerchantRule } = await freshDb();
    const [category1] = await db.insert(schema.categories).values({ name: 'Category1' }).returning();
    const [category2] = await db.insert(schema.categories).values({ name: 'Category2' }).returning();

    await applyMerchantRule('Merchant', 'purpose1', { type: 'category', categoryId: category1.id });
    await applyMerchantRule('Merchant', 'purpose1', { type: 'category', categoryId: category2.id });

    const rules = await db.select().from(schema.merchantCategoryRules);
    expect(rules).toHaveLength(1);
    expect(rules[0].categoryId).toBe(category2.id);
    expect(rules[0].purposeContains).toBe('purpose1');
  });

  test('merchant can have both a fallback rule (null purpose) and purpose-specific rules', async () => {
    const { db, schema, applyMerchantRule } = await freshDb();
    const [category1] = await db.insert(schema.categories).values({ name: 'Category1' }).returning();
    const [category2] = await db.insert(schema.categories).values({ name: 'Category2' }).returning();
    const [category3] = await db.insert(schema.categories).values({ name: 'Category3' }).returning();

    await applyMerchantRule('Merchant', null, { type: 'category', categoryId: category1.id });
    await applyMerchantRule('Merchant', 'purpose1', { type: 'category', categoryId: category2.id });
    await applyMerchantRule('Merchant', 'purpose2', { type: 'category', categoryId: category3.id });

    const rules = await db.select().from(schema.merchantCategoryRules);
    expect(rules).toHaveLength(3);
    expect(rules.some((r) => r.purposeContains === null && r.categoryId === category1.id)).toBe(true);
    expect(rules.some((r) => r.purposeContains === 'purpose1' && r.categoryId === category2.id)).toBe(true);
    expect(rules.some((r) => r.purposeContains === 'purpose2' && r.categoryId === category3.id)).toBe(true);
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
