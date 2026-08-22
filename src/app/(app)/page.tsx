import Link from 'next/link';
import { and, asc, eq, gte } from 'drizzle-orm';
import { db } from '@/db/client';
import { accounts, balanceSnapshots, categories, merchantCategoryRules, transactions } from '@/db/schema';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AccountCard } from '@/components/dashboard/account-card';
import { requireSession } from '@/lib/session';
import { computeMonthToDateTrend } from '@/lib/trend';
import { buildCategoryLookups, resolveTransactionCategory } from '@/lib/category-resolution';
import { getMerchantKey } from '@/lib/merchant-key';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  await requireSession();

  const allAccounts = await db.select().from(accounts);

  if (allAccounts.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-background p-8 text-center">
        <p className="text-foreground">Noch keine Konten.</p>
        <Link href="/import" className={cn(buttonVariants(), 'mt-4')}>
          CSV importieren
        </Link>
      </div>
    );
  }

  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  const cards = await Promise.all(
    allAccounts.map(async (account) => {
      const history = await db
        .select({ date: balanceSnapshots.snapshotDate, balanceCents: balanceSnapshots.balanceCents })
        .from(balanceSnapshots)
        .where(eq(balanceSnapshots.accountId, account.id))
        .orderBy(asc(balanceSnapshots.snapshotDate));

      const currentBalanceCents = history.length > 0 ? history[history.length - 1].balanceCents : 0;

      const monthToDateTransactions = await db
        .select({ bookingDate: transactions.bookingDate, amountCents: transactions.amountCents })
        .from(transactions)
        .where(and(eq(transactions.accountId, account.id), gte(transactions.bookingDate, monthStart)));

      const trend = computeMonthToDateTrend(currentBalanceCents, monthToDateTransactions, now);

      return { account, history, currentBalanceCents, trend };
    })
  );

  const [allTransactionsForCategorization, categoryRows, ruleRows] = await Promise.all([
    db
      .select({
        categoryOverrideId: transactions.categoryOverrideId,
        counterparty: transactions.counterparty,
        purpose: transactions.purpose,
      })
      .from(transactions),
    db.select().from(categories),
    db.select().from(merchantCategoryRules),
  ]);

  const { categoriesById, rulesByMerchantKey } = buildCategoryLookups(categoryRows, ruleRows);

  const uncategorizedMerchants = new Set<string>();
  for (const tx of allTransactionsForCategorization) {
    if (resolveTransactionCategory(tx, rulesByMerchantKey, categoriesById).source === 'none') {
      uncategorizedMerchants.add(getMerchantKey(tx));
    }
  }

  return (
    <div className="space-y-4">
      {uncategorizedMerchants.size > 0 && (
        <Link
          href="/categorize"
          className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {uncategorizedMerchants.size} Gegenpartei{uncategorizedMerchants.size === 1 ? '' : 'en'} unkategorisiert
        </Link>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map(({ account, history, currentBalanceCents, trend }) => (
          <Link key={account.id} href={`/accounts/${account.id}`} className="block">
            <AccountCard
              accountName={account.name}
              currency={account.currency}
              currentBalanceCents={currentBalanceCents}
              history={history}
              trend={trend}
            />
          </Link>
        ))}
      </div>
    </div>
  );
}
