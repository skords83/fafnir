'use client';

import { setMerchantRule } from '@/app/(app)/actions/categories';
import { CategoryPicker } from '@/components/category-picker';

export function MerchantCategoryForm({
  merchantKey,
  categories,
}: {
  merchantKey: string;
  categories: { id: number; name: string }[];
}) {
  return (
    <CategoryPicker
      categories={categories}
      selectedCategoryId={null}
      showClear={false}
      clearLabel="Kategorie entfernen"
      onSubmit={(target) => setMerchantRule(merchantKey, target)}
    />
  );
}
