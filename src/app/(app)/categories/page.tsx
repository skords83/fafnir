import Link from 'next/link';
import { db } from '@/db/client';
import { categories } from '@/db/schema';
import { requireSession } from '@/lib/session';
import { countCategoryUsage } from '../actions/category-mutations';
import { CategoryRow } from './category-row';

export const dynamic = 'force-dynamic';

export default async function CategoriesPage() {
  await requireSession();

  const categoryRows = await db.select().from(categories);
  const sorted = [...categoryRows].sort((a, b) => a.name.localeCompare(b.name));
  const rowsWithUsage = await Promise.all(
    sorted.map(async (category) => ({
      category,
      usage: await countCategoryUsage(category.id),
    }))
  );

  // Build a map of which categories are parents (have children)
  const childrenByParent = new Map<number | null, number[]>();
  categoryRows.forEach((cat) => {
    if (!childrenByParent.has(cat.parent_id)) {
      childrenByParent.set(cat.parent_id, []);
    }
    childrenByParent.get(cat.parent_id)!.push(cat.id);
  });

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Zurück
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-foreground">Kategorien</h1>
      </div>

      {rowsWithUsage.length === 0 ? (
        <p className="rounded-lg border border-border bg-card px-4 py-8 text-center text-muted-foreground">
          Noch keine Kategorien angelegt.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {rowsWithUsage.map(({ category, usage }) => (
            <CategoryRow
              key={category.id}
              category={category}
              usage={usage}
              parentOptions={categoryRows
                .filter((c) => c.id !== category.id)
                .map((c) => ({ id: c.id, name: c.name }))}
              hasChildren={Boolean((childrenByParent.get(category.id) ?? []).length > 0)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
