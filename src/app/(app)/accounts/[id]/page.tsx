import Link from 'next/link';
import { notFound } from 'next/navigation';
import { count, desc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { accounts, categories, merchantCategoryRules, transactions } from '@/db/schema';
import { requireSession } from '@/lib/session';
import { paginate } from '@/lib/pagination';
import { buildCategoryLookups, findGoverningMerchantRule, resolveTransactionCategory } from '@/lib/category-resolution';
import { getMerchantKey } from '@/lib/merchant-key';
import { TransactionList } from '@/components/transactions/transaction-list';

export const dynamic = 'force-dynamic';

export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  await requireSession();

  const { id } = await params;
  const accountId = Number(id);
  if (!Number.isInteger(accountId)) {
    notFound();
  }

  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  if (!account) {
    notFound();
  }

  const { page: pageParam } = await searchParams;

  const [{ total }] = await db
    .select({ total: count() })
    .from(transactions)
    .where(eq(transactions.accountId, accountId));

  const { page, offset, pageSize, totalPages } = paginate(total, Number(pageParam));

  const [rawRows, categoryRows, ruleRows] = await Promise.all([
    db
      .select()
      .from(transactions)
      .where(eq(transactions.accountId, accountId))
      .orderBy(desc(transactions.bookingDate), desc(transactions.id))
      .limit(pageSize)
      .offset(offset),
    db.select().from(categories),
    db.select().from(merchantCategoryRules),
  ]);

  const { categoriesById, rulesByMerchantKey } = buildCategoryLookups(categoryRows, ruleRows);

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

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Zurück
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-foreground">{account.name}</h1>
      </div>

      <TransactionList rows={rows} currency={account.currency} categories={categoryRows} />

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          {page > 1 ? (
            <Link href={`/accounts/${accountId}?page=${page - 1}`} className="hover:text-foreground">
              ← Vorherige
            </Link>
          ) : (
            <span />
          )}
          <span>
            Seite {page} von {totalPages}
          </span>
          {page < totalPages ? (
            <Link href={`/accounts/${accountId}?page=${page + 1}`} className="hover:text-foreground">
              Nächste →
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}
    </div>
  );
}
