import Link from 'next/link';
import { notFound } from 'next/navigation';
import { count, desc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { accounts, transactions } from '@/db/schema';
import { requireSession } from '@/lib/session';
import { formatCents } from '@/lib/format';
import { paginate } from '@/lib/pagination';

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

  const rows = await db
    .select()
    .from(transactions)
    .where(eq(transactions.accountId, accountId))
    .orderBy(desc(transactions.bookingDate), desc(transactions.id))
    .limit(pageSize)
    .offset(offset);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Zurück
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-foreground">{account.name}</h1>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-4 py-2 font-medium">Datum</th>
              <th className="px-4 py-2 font-medium">Gegenpartei</th>
              <th className="px-4 py-2 font-medium">Verwendungszweck</th>
              <th className="px-4 py-2 text-right font-medium">Betrag</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                  Keine Buchungen.
                </td>
              </tr>
            )}
            {rows.map((tx) => (
              <tr key={tx.id} className="border-b border-border last:border-0">
                <td className="whitespace-nowrap px-4 py-2 text-foreground">{tx.bookingDate}</td>
                <td className="px-4 py-2 text-foreground">{tx.counterparty ?? '—'}</td>
                <td className="px-4 py-2 text-foreground">{tx.purpose ?? '—'}</td>
                <td className="whitespace-nowrap px-4 py-2 text-right text-foreground">
                  {formatCents(tx.amountCents, account.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
