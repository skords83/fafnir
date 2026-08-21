import { db } from '@/db/client';
import { accounts } from '@/db/schema';
import { ImportForm } from './import-form';

export default async function ImportPage() {
  const allAccounts = await db.select({ id: accounts.id, name: accounts.name }).from(accounts);

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-xl font-semibold text-foreground">CSV-Import</h1>
      <ImportForm accounts={allAccounts} />
    </div>
  );
}
