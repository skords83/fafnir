'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/session';
import { applyMerchantRule, applyTransactionOverride, type CategoryTarget } from './category-mutations';

export type { CategoryTarget };

export type ActionResult = { ok: true } | { ok: false; error: string };

function revalidateCategorizedPages() {
  revalidatePath('/');
  revalidatePath('/accounts/[id]', 'page');
  revalidatePath('/categorize');
}

export async function setMerchantRule(
  merchantKey: string,
  purposeContains: string | null,
  target: CategoryTarget
): Promise<ActionResult> {
  await requireSession();
  try {
    await applyMerchantRule(merchantKey, purposeContains, target);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Fehler beim Speichern.' };
  }
  revalidateCategorizedPages();
  return { ok: true };
}

export async function setTransactionOverride(transactionId: number, target: CategoryTarget): Promise<ActionResult> {
  await requireSession();
  try {
    await applyTransactionOverride(transactionId, target);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Fehler beim Speichern.' };
  }
  revalidateCategorizedPages();
  return { ok: true };
}
