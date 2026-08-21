import { db } from '@/db/client';
import { accounts } from '@/db/schema';
import { ImportForm } from './import-form';
import { requireSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function ImportPage() {
  await requireSession();

  const allAccounts = await db.select({ id: accounts.id, name: accounts.name }).from(accounts);

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-xl font-semibold text-foreground">CSV-Import</h1>
      <ImportForm accounts={allAccounts} />
    </div>
  );
}
