'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/session';
import { applyMerchantRule, applyTransactionOverride, type CategoryTarget } from './category-mutations';

export type { CategoryTarget };

function revalidateCategorizedPages() {
  revalidatePath('/');
  revalidatePath('/accounts/[id]', 'page');
  revalidatePath('/categorize');
}

export async function setMerchantRule(merchantKey: string, target: CategoryTarget): Promise<void> {
  await requireSession();
  await applyMerchantRule(merchantKey, target);
  revalidateCategorizedPages();
}

export async function setTransactionOverride(transactionId: number, target: CategoryTarget): Promise<void> {
  await requireSession();
  await applyTransactionOverride(transactionId, target);
  revalidateCategorizedPages();
}
