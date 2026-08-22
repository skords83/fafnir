import Link from 'next/link';
import { db } from '@/db/client';
import { categories, merchantCategoryRules, transactions } from '@/db/schema';
import { requireSession } from '@/lib/session';
import { buildCategoryLookups, resolveTransactionCategory } from '@/lib/category-resolution';
import { getMerchantKey } from '@/lib/merchant-key';
import { MerchantCategoryForm } from './merchant-category-form';

export const dynamic = 'force-dynamic';

export default async function CategorizePage() {
  await requireSession();

  const [allTransactions, categoryRows, ruleRows] = await Promise.all([
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

  const uncategorizedCountByMerchant = new Map<string, number>();
  for (const tx of allTransactions) {
    if (resolveTransactionCategory(tx, rulesByMerchantKey, categoriesById).source === 'none') {
      const key = getMerchantKey(tx);
      uncategorizedCountByMerchant.set(key, (uncategorizedCountByMerchant.get(key) ?? 0) + 1);
    }
  }

  const merchantGroups = [...uncategorizedCountByMerchant.entries()]
    .map(([merchantKey, txCount]) => ({ merchantKey, txCount }))
    .sort((a, b) => b.txCount - a.txCount);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Zurück
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-foreground">Unkategorisiert</h1>
      </div>

      {merchantGroups.length === 0 ? (
        <p className="rounded-lg border border-border bg-card px-4 py-8 text-center text-muted-foreground">
          Alle Gegenparteien sind kategorisiert.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {merchantGroups.map((group) => (
            <li key={group.merchantKey} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="font-medium text-foreground">{group.merchantKey}</p>
                <p className="text-xs text-muted-foreground">
                  {group.txCount} Buchung{group.txCount === 1 ? '' : 'en'}
                </p>
              </div>
              <MerchantCategoryForm merchantKey={group.merchantKey} categories={categoryRows} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
