import Link from 'next/link';
import { db } from '@/db/client';
import { categories, merchantCategoryRules, transactions } from '@/db/schema';
import { requireSession } from '@/lib/session';
import { buildCategoryLookups, resolveTransactionCategory } from '@/lib/category-resolution';
import { getMerchantKey } from '@/lib/merchant-key';
import { getMerchantTransactionsForKey } from '../actions/category-mutations';
import { MerchantGroup } from './merchant-group';

export const dynamic = 'force-dynamic';

export default async function CategorizePage({
  searchParams,
}: {
  searchParams: Promise<{ merchant?: string }>;
}) {
  await requireSession();
  const { merchant: deepLinkMerchant } = await searchParams;

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
  const totalCountByMerchant = new Map<string, number>();
  for (const tx of allTransactions) {
    const key = getMerchantKey(tx);
    totalCountByMerchant.set(key, (totalCountByMerchant.get(key) ?? 0) + 1);
    if (resolveTransactionCategory(tx, rulesByMerchantKey, categoriesById).source === 'none') {
      // A merchant with any rule at all belongs in the "already categorized" section below,
      // even if that rule doesn't cover every one of its transactions — a merchant appears
      // in exactly one section, never both.
      if (rulesByMerchantKey.has(key)) continue;
      uncategorizedCountByMerchant.set(key, (uncategorizedCountByMerchant.get(key) ?? 0) + 1);
    }
  }

  const merchantGroups = [...uncategorizedCountByMerchant.entries()]
    .map(([merchantKey, txCount]) => ({ merchantKey, txCount }))
    .sort((a, b) => b.txCount - a.txCount);

  const categorizedMerchantKeys = [...rulesByMerchantKey.keys()].sort((a, b) => a.localeCompare(b));

  const deepLinkTransactions =
    deepLinkMerchant !== undefined ? await getMerchantTransactionsForKey(deepLinkMerchant) : null;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Zurück
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-foreground">Unkategorisiert</h1>
          <Link href="/categories" className="text-sm text-muted-foreground hover:text-foreground">
            Kategorien verwalten
          </Link>
        </div>
      </div>

      {merchantGroups.length === 0 ? (
        <p className="rounded-lg border border-border bg-card px-4 py-8 text-center text-muted-foreground">
          Alle Gegenparteien sind kategorisiert.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {merchantGroups.map((group) => (
            <MerchantGroup
              key={group.merchantKey}
              merchantKey={group.merchantKey}
              txCount={group.txCount}
              categories={categoryRows}
              initiallyOpen={group.merchantKey === deepLinkMerchant}
              initialTransactions={group.merchantKey === deepLinkMerchant ? deepLinkTransactions : null}
            />
          ))}
        </ul>
      )}

      {categorizedMerchantKeys.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-foreground">Bereits kategorisierte Gegenparteien</h2>
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-card">
            {categorizedMerchantKeys.map((merchantKey) => (
              <MerchantGroup
                key={merchantKey}
                merchantKey={merchantKey}
                txCount={totalCountByMerchant.get(merchantKey) ?? 0}
                categories={categoryRows}
                existingRules={rulesByMerchantKey.get(merchantKey)!}
                initiallyOpen={merchantKey === deepLinkMerchant}
                initialTransactions={merchantKey === deepLinkMerchant ? deepLinkTransactions : null}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
