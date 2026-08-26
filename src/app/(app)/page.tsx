import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { accounts, balanceSnapshots, categories, merchantCategoryRules, transactions } from '@/db/schema';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { requireSession } from '@/lib/session';
import { formatCents } from '@/lib/format';
import { buildCategoryLookups, resolveTransactionCategory } from '@/lib/category-resolution';
import { getMerchantKey } from '@/lib/merchant-key';
import {
  calculateMonthSummary,
  calculateMonthlyTrends,
  calculateCategoryBreakdown,
} from '@/lib/dashboard-stats';
import { IncomeExpenseBarChart } from '@/components/dashboard/income-expense-chart';
import { CategoryPieChart } from '@/components/dashboard/category-pie-chart';
import { TransactionList } from '@/components/transactions/transaction-list';

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

  const account = allAccounts[0]; // Primary account focus

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonthKey = `${currentYear}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthKey = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`;

  const [allTransactions, categoryRows, ruleRows, latestSnapshots, recentRawTxs, allTransactionsForBadge] =
    await Promise.all([
      db.select().from(transactions).where(eq(transactions.accountId, account.id)),
      db.select().from(categories),
      db.select().from(merchantCategoryRules),
      db
        .select({ balanceCents: balanceSnapshots.balanceCents })
        .from(balanceSnapshots)
        .where(eq(balanceSnapshots.accountId, account.id))
        .orderBy(desc(balanceSnapshots.snapshotDate))
        .limit(1),
      db
        .select()
        .from(transactions)
        .where(eq(transactions.accountId, account.id))
        .orderBy(desc(transactions.bookingDate), desc(transactions.id))
        .limit(5),
      // Unscoped across all accounts — matches /categorize's query so the badge count
      // stays consistent with the page it links to.
      db
        .select({
          categoryOverrideId: transactions.categoryOverrideId,
          counterparty: transactions.counterparty,
          purpose: transactions.purpose,
        })
        .from(transactions),
    ]);

  const currentBalanceCents = latestSnapshots.length > 0 ? latestSnapshots[0].balanceCents : 0;
  const { categoriesById, rulesByMerchantKey } = buildCategoryLookups(categoryRows, ruleRows);

  const resolvedTxsWithCategory = allTransactions.map((tx) => {
    const resolved = resolveTransactionCategory(tx, rulesByMerchantKey, categoriesById);
    return {
      amountCents: tx.amountCents,
      bookingDate: tx.bookingDate,
      categoryId: resolved.categoryId,
      categoryName: resolved.categoryName,
    };
  });

  // Uncategorized badge count — unscoped across all accounts (see allTransactionsForBadge
  // above), mirroring /categorize's exact "uncategorized merchant" logic so the badge count
  // matches what that page shows.
  const uncategorizedMerchants = new Set<string>();
  for (const tx of allTransactionsForBadge) {
    if (resolveTransactionCategory(tx, rulesByMerchantKey, categoriesById).source === 'none') {
      const merchantKey = getMerchantKey(tx);
      // A merchant with any rule at all is already handled on /categorize's "categorized"
      // list, not its uncategorized one — keep the same exclusion here.
      if (rulesByMerchantKey.has(merchantKey)) continue;
      uncategorizedMerchants.add(merchantKey);
    }
  }

  // Calculate stats
  const currentMonthSummary = calculateMonthSummary(allTransactions, currentMonthKey);
  const lastMonthSummary = calculateMonthSummary(allTransactions, lastMonthKey);
  const monthlyTrends = calculateMonthlyTrends(allTransactions, currentYear);

  const currentMonthTxs = resolvedTxsWithCategory.filter((tx) =>
    tx.bookingDate.startsWith(currentMonthKey)
  );
  const categoryBreakdown = calculateCategoryBreakdown(currentMonthTxs);

  // Prepare recent transactions
  const recentTransactions = recentRawTxs.map((tx) => {
    const resolved = resolveTransactionCategory(tx, rulesByMerchantKey, categoriesById);
    const merchantKey = getMerchantKey(tx);
    return {
      ...tx,
      merchantKey,
      effectiveCategory: resolved.categoryId !== null ? { id: resolved.categoryId, name: resolved.categoryName! } : null,
    };
  });

  return (
    <div className="space-y-6">
      {/* Top Bar with Uncategorized Badge */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Übersicht</h1>
        {uncategorizedMerchants.size > 0 && (
          <Link
            href="/categorize"
            className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-600 hover:bg-amber-500/20 dark:text-amber-400"
          >
            {uncategorizedMerchants.size} Gegenpartei{uncategorizedMerchants.size === 1 ? '' : 'en'} unkategorisiert
          </Link>
        )}
      </div>

      {/* KPI Cards Row */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Dieser Monat</p>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-sm font-semibold text-positive">
              + {formatCents(currentMonthSummary.incomeCents, account.currency)}
            </span>
            <span className="text-sm font-semibold text-destructive">
              - {formatCents(currentMonthSummary.expenseCents, account.currency)}
            </span>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Vormonat</p>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-sm font-semibold text-positive">
              + {formatCents(lastMonthSummary.incomeCents, account.currency)}
            </span>
            <span className="text-sm font-semibold text-destructive">
              - {formatCents(lastMonthSummary.expenseCents, account.currency)}
            </span>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Aktueller Kontostand</p>
          <p className="mt-2 text-xl font-semibold text-foreground">
            {formatCents(currentBalanceCents, account.currency)}
          </p>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-4 text-sm font-medium text-foreground">Einnahmen vs. Ausgaben ({currentYear})</h2>
          <IncomeExpenseBarChart data={monthlyTrends} currency={account.currency} />
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-4 text-sm font-medium text-foreground">Kategorien im aktuellen Monat</h2>
          <CategoryPieChart data={categoryBreakdown} currency={account.currency} />
        </div>
      </div>

      {/* Recent Transactions List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-foreground">Letzte Buchungen</h2>
          <Link href={`/accounts/${account.id}`} className="text-xs text-muted-foreground hover:text-foreground">
            Alle anzeigen →
          </Link>
        </div>
        <TransactionList rows={recentTransactions} currency={account.currency} />
      </div>
    </div>
  );
}
