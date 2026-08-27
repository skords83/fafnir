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

  const parentOptions = sorted
    .filter((category) => category.parentCategoryId === null)
    .map(({ id, name }) => ({ id, name }));

  const childrenByParentId = new Map<number, typeof rowsWithUsage>();
  const ungrouped: typeof rowsWithUsage = [];
  for (const row of rowsWithUsage) {
    const parentId = row.category.parentCategoryId;
    if (parentId == null) {
      ungrouped.push(row);
    } else {
      if (!childrenByParentId.has(parentId)) {
        childrenByParentId.set(parentId, []);
      }
      childrenByParentId.get(parentId)!.push(row);
    }
  }
  const hasChildrenIds = new Set(childrenByParentId.keys());
  const groups = sorted
    .filter((category) => childrenByParentId.has(category.id))
    .map((category) => ({ parent: category, children: childrenByParentId.get(category.id)! }));

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
        <div className="space-y-6">
          {groups.map(({ parent, children }) => (
            <div key={parent.id}>
              <h2 className="mb-2 text-sm font-semibold text-foreground">{parent.name}</h2>
              <ul className="divide-y divide-border rounded-lg border border-border bg-card">
                {children.map(({ category, usage }) => (
                  <CategoryRow
                    key={category.id}
                    category={category}
                    usage={usage}
                    parentOptions={parentOptions}
                    hasChildren={hasChildrenIds.has(category.id)}
                  />
                ))}
              </ul>
            </div>
          ))}

          <div>
            {groups.length > 0 && (
              <h2 className="mb-2 text-sm font-semibold text-foreground">Ohne Oberkategorie</h2>
            )}
            <ul className="divide-y divide-border rounded-lg border border-border bg-card">
              {ungrouped.map(({ category, usage }) => (
                <CategoryRow
                  key={category.id}
                  category={category}
                  usage={usage}
                  parentOptions={parentOptions}
                  hasChildren={hasChildrenIds.has(category.id)}
                />
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
