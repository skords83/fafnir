import { db } from '@/db/client';
import { accounts } from '@/db/schema';
import { ImportForm } from './import-form';

export const metadata = {
  title: 'CSV Import',
};

export default async function ImportPage() {
  const allAccounts = await db.select().from(accounts).orderBy(accounts.name);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">CSV Import</h1>
        <p className="text-gray-600 mt-2">Postbank-Exporte in Ihre Konten importieren.</p>
      </div>

      <div className="bg-white rounded-lg shadow-sm p-6">
        <ImportForm accounts={allAccounts} />
      </div>
    </div>
  );
}
