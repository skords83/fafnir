'use server';

import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/session';
import {
  applyMerchantRule,
  applyTransactionOverride,
  deleteCategory as deleteCategoryMutation,
  getMerchantTransactionsForKey,
  renameCategory as renameCategoryMutation,
  type CategoryTarget,
  type MerchantTransactionRow,
} from './category-mutations';

export type { CategoryTarget, MerchantTransactionRow };

export type ActionResult = { ok: true } | { ok: false; error: string };

function revalidateCategorizedPages() {
  revalidatePath('/');
  revalidatePath('/accounts/[id]', 'page');
  revalidatePath('/categorize');
  revalidatePath('/categories');
}

export async function getMerchantTransactions(merchantKey: string): Promise<MerchantTransactionRow[]> {
  await requireSession();
  return getMerchantTransactionsForKey(merchantKey);
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

export async function renameCategory(categoryId: number, name: string): Promise<ActionResult> {
  await requireSession();
  try {
    await renameCategoryMutation(categoryId, name);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Fehler beim Speichern.' };
  }
  revalidateCategorizedPages();
  return { ok: true };
}

export async function deleteCategory(categoryId: number): Promise<ActionResult> {
  await requireSession();
  try {
    await deleteCategoryMutation(categoryId);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Fehler beim Löschen.' };
  }
  revalidateCategorizedPages();
  return { ok: true };
}
