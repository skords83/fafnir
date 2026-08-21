import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { accounts, balanceSnapshots } from '@/db/schema';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AccountCard } from '@/components/dashboard/account-card';
import { requireSession } from '@/lib/session';

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

  const cards = await Promise.all(
    allAccounts.map(async (account) => {
      const history = await db
        .select({ date: balanceSnapshots.snapshotDate, balanceCents: balanceSnapshots.balanceCents })
        .from(balanceSnapshots)
        .where(eq(balanceSnapshots.accountId, account.id))
        .orderBy(asc(balanceSnapshots.snapshotDate));

      const currentBalanceCents = history.length > 0 ? history[history.length - 1].balanceCents : 0;

      return { account, history, currentBalanceCents };
    })
  );

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {cards.map(({ account, history, currentBalanceCents }) => (
        <AccountCard
          key={account.id}
          accountName={account.name}
          currency={account.currency}
          currentBalanceCents={currentBalanceCents}
          history={history}
        />
      ))}
    </div>
  );
}
