# Dashboard Redesign (ezBookkeeping Style) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Fafnir's main dashboard (`/`) into an ezBookkeeping-inspired financial overview for a single main account, featuring monthly comparison KPI tiles, an Income vs. Expense monthly bar chart, a monthly category breakdown pie chart, and a quick list of recent transactions.

**Architecture:** Build pure helper functions for SQL aggregations in `src/lib/dashboard-stats.ts` (directly tested with Vitest against an in-memory SQLite database), create reusable client chart components using Recharts (`IncomeExpenseBarChart`, `CategoryPieChart`), and update the Server Component `src/app/(app)/page.tsx` to display the new layout while reusing existing category resolution logic (`buildCategoryLookups`, `resolveTransactionCategory`).

**Tech Stack:** Next.js 16 (App Router), Drizzle ORM + better-sqlite3, Recharts 3.10, Tailwind CSS v4, Vitest 4.

---

## Global Constraints

- **Single Account Focus:** Optimized for a single primary bank account, while gracefully handling account data.
- **German UI Copy:** All UI texts, tooltips, and labels must be in German (e.g. `Dieser Monat`, `Vormonat`, `Einnahmen`, `Ausgaben`, `Einnahmen vs. Ausgaben`).
- **No N+1 Queries:** Load `categories` and `merchant_category_rules` in bulk once, then resolve categories in-memory using `resolveTransactionCategory()`.
- **Pure Functions & TDD:** All data aggregation logic must live in `src/lib/dashboard-stats.ts` and be fully unit-tested with Vitest.

---

## Task 1: Aggregation Helpers & Calculations (`src/lib/dashboard-stats.ts`)

**Files:**
- Create: `src/lib/dashboard-stats.ts`
- Test: `src/lib/dashboard-stats.test.ts`

**Interfaces:**
```ts
export interface MonthSummary {
  incomeCents: number;
  expenseCents: number;
}

export interface MonthlyTrendPoint {
  month: string; // e.g., 'Jan', 'Feb', 'Aug'
  monthKey: string; // 'YYYY-MM'
  incomeCents: number;
  expenseCents: number;
}

export interface CategoryBreakdownPoint {
  categoryId: number | null;
  categoryName: string;
  amountCents: number;
  percentage: number;
}
```

- [ ] **Step 1: Write failing unit tests for aggregation functions**

Create `src/lib/dashboard-stats.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import {
  calculateMonthSummary,
  calculateMonthlyTrends,
  calculateCategoryBreakdown,
} from './dashboard-stats';

describe('calculateMonthSummary', () => {
  test('correctly sums income and expenses for a given month', () => {
    const txs = [
      { amountCents: 250000, bookingDate: '2026-08-01' },
      { amountCents: -4217, bookingDate: '2026-08-03' },
      { amountCents: -1500, bookingDate: '2026-08-10' },
      { amountCents: -5000, bookingDate: '2026-07-28' }, // Other month
    ];

    const result = calculateMonthSummary(txs, '2026-08');
    expect(result).toEqual({
      incomeCents: 250000,
      expenseCents: 5717, // positive absolute value for expenses
    });
  });
});

describe('calculateMonthlyTrends', () => {
  test('groups transactions by month over a 12-month period', () => {
    const txs = [
      { amountCents: 10000, bookingDate: '2026-01-15' },
      { amountCents: -3000, bookingDate: '2026-01-20' },
      { amountCents: -5000, bookingDate: '2026-08-05' },
    ];

    const trends = calculateMonthlyTrends(txs, 2026);
    expect(trends).toHaveLength(12);
    expect(trends[0]).toEqual({
      month: 'Jan',
      monthKey: '2026-01',
      incomeCents: 10000,
      expenseCents: 3000,
    });
    expect(trends[7]).toEqual({
      month: 'Aug',
      monthKey: '2026-08',
      incomeCents: 0,
      expenseCents: 5000,
    });
  });
});

describe('calculateCategoryBreakdown', () => {
  test('aggregates expense transactions by resolved category', () => {
    const items = [
      { amountCents: -4000, categoryName: 'Lebensmittel', categoryId: 1 },
      { amountCents: -1000, categoryName: 'Lebensmittel', categoryId: 1 },
      { amountCents: -5000, categoryName: 'Freizeit', categoryId: 2 },
      { amountCents: 200000, categoryName: 'Gehalt', categoryId: 3 }, // Income (ignored)
    ];

    const breakdown = calculateCategoryBreakdown(items);
    expect(breakdown).toHaveLength(2);
    expect(breakdown[0]).toEqual({
      categoryId: 2,
      categoryName: 'Freizeit',
      amountCents: 5000,
      percentage: 50,
    });
    expect(breakdown[1]).toEqual({
      categoryId: 1,
      categoryName: 'Lebensmittel',
      amountCents: 5000,
      percentage: 50,
    });
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

```bash
pnpm test dashboard-stats -- --run
```

- [ ] **Step 3: Implement calculation helpers**

Create `src/lib/dashboard-stats.ts`:

```ts
export interface MonthSummary {
  incomeCents: number;
  expenseCents: number;
}

export interface MonthlyTrendPoint {
  month: string;
  monthKey: string;
  incomeCents: number;
  expenseCents: number;
}

export interface CategoryBreakdownPoint {
  categoryId: number | null;
  categoryName: string;
  amountCents: number;
  percentage: number;
}

const GERMAN_MONTH_NAMES = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

export function calculateMonthSummary(
  transactions: { amountCents: number; bookingDate: string }[],
  yearMonth: string // 'YYYY-MM'
): MonthSummary {
  let incomeCents = 0;
  let expenseCents = 0;

  for (const tx of transactions) {
    if (tx.bookingDate.startsWith(yearMonth)) {
      if (tx.amountCents > 0) {
        incomeCents += tx.amountCents;
      } else if (tx.amountCents < 0) {
        expenseCents += Math.abs(tx.amountCents);
      }
    }
  }

  return { incomeCents, expenseCents };
}

export function calculateMonthlyTrends(
  transactions: { amountCents: number; bookingDate: string }[],
  year: number
): MonthlyTrendPoint[] {
  const points: MonthlyTrendPoint[] = Array.from({ length: 12 }, (_, i) => {
    const monthNum = String(i + 1).padStart(2, '0');
    return {
      month: GERMAN_MONTH_NAMES[i],
      monthKey: `${year}-${monthNum}`,
      incomeCents: 0,
      expenseCents: 0,
    };
  });

  const monthMap = new Map(points.map((p) => [p.monthKey, p]));

  for (const tx of transactions) {
    const yearMonth = tx.bookingDate.slice(0, 7);
    const point = monthMap.get(yearMonth);
    if (point) {
      if (tx.amountCents > 0) {
        point.incomeCents += tx.amountCents;
      } else if (tx.amountCents < 0) {
        point.expenseCents += Math.abs(tx.amountCents);
      }
    }
  }

  return points;
}

export function calculateCategoryBreakdown(
  items: { amountCents: number; categoryName: string | null; categoryId: number | null }[]
): CategoryBreakdownPoint[] {
  const categoryTotals = new Map<string, { categoryId: number | null; categoryName: string; amountCents: number }>();
  let totalExpenses = 0;

  for (const item of items) {
    if (item.amountCents < 0) {
      const absAmount = Math.abs(item.amountCents);
      totalExpenses += absAmount;

      const name = item.categoryName ?? 'Unkategorisiert';
      const key = `${item.categoryId ?? 'null'}:${name}`;

      const existing = categoryTotals.get(key) ?? { categoryId: item.categoryId, categoryName: name, amountCents: 0 };
      existing.amountCents += absAmount;
      categoryTotals.set(key, existing);
    }
  }

  if (totalExpenses === 0) return [];

  const result: CategoryBreakdownPoint[] = [];
  for (const entry of categoryTotals.values()) {
    result.push({
      ...entry,
      percentage: Math.round((entry.amountCents / totalExpenses) * 100),
    });
  }

  return result.sort((a, b) => b.amountCents - a.amountCents);
}
```

- [ ] **Step 4: Confirm tests pass**

```bash
pnpm test dashboard-stats -- --run
```

- [ ] **Step 5: Commit Task 1**

```bash
git add src/lib/dashboard-stats.ts src/lib/dashboard-stats.test.ts
git commit -m "Add dashboard stats calculation helpers with unit tests"
```

---

## Task 2: Chart Components (Recharts)

**Files:**
- Create: `src/components/dashboard/income-expense-chart.tsx`
- Create: `src/components/dashboard/category-pie-chart.tsx`

- [ ] **Step 1: Create `IncomeExpenseBarChart`**

Create `src/components/dashboard/income-expense-chart.tsx`:

```tsx
'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { formatCents } from '@/lib/format';
import type { MonthlyTrendPoint } from '@/lib/dashboard-stats';

export function IncomeExpenseBarChart({ data }: { data: MonthlyTrendPoint[] }) {
  const chartData = data.map((d) => ({
    month: d.month,
    Einnahmen: d.incomeCents / 100,
    Ausgaben: d.expenseCents / 100,
  }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <XAxis dataKey="month" tickLine={false} axisLine={false} className="text-xs text-muted-foreground" />
          <YAxis tickLine={false} axisLine={false} className="text-xs text-muted-foreground" />
          <Tooltip
            formatter={(value: number) => formatCents(Math.round(value * 100), 'EUR')}
            contentStyle={{ backgroundColor: 'hsl(var(--background))', borderColor: 'hsl(var(--border))', borderRadius: '0.5rem' }}
          />
          <Legend wrapperStyle={{ paddingTop: '10px' }} />
          <Bar dataKey="Einnahmen" fill="#10b981" radius={[4, 4, 0, 0]} />
          <Bar dataKey="Ausgaben" fill="#ef4444" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 2: Create `CategoryPieChart`**

Create `src/components/dashboard/category-pie-chart.tsx`:

```tsx
'use client';

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { formatCents } from '@/lib/format';
import type { CategoryBreakdownPoint } from '@/lib/dashboard-stats';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#64748b'];

export function CategoryPieChart({ data }: { data: CategoryBreakdownPoint[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        Keine Ausgaben in diesem Monat.
      </div>
    );
  }

  const chartData = data.map((item) => ({
    name: item.categoryName,
    value: item.amountCents / 100,
  }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={50}
            outerRadius={80}
            paddingAngle={2}
            dataKey="value"
          >
            {chartData.map((_, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value: number) => formatCents(Math.round(value * 100), 'EUR')}
            contentStyle={{ backgroundColor: 'hsl(var(--background))', borderColor: 'hsl(var(--border))', borderRadius: '0.5rem' }}
          />
          <Legend wrapperStyle={{ paddingTop: '10px' }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 3: Commit Task 2**

```bash
git add src/components/dashboard/income-expense-chart.tsx src/components/dashboard/category-pie-chart.tsx
git commit -m "Add IncomeExpenseBarChart and CategoryPieChart components"
```

---

## Task 3: Assemble ezBookkeeping Dashboard (`src/app/(app)/page.tsx`)

**Files:**
- Modify: `src/app/(app)/page.tsx`

- [ ] **Step 1: Rewrite Dashboard Server Component**

Update `src/app/(app)/page.tsx`:

```tsx
import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { accounts, balanceSnapshots, categories, merchantCategoryRules, transactions } from '@/db/schema';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { requireSession } from '@/lib/session';
import { formatCents } from '@/lib/format';
import { buildCategoryLookups, findGoverningMerchantRule, resolveTransactionCategory } from '@/lib/category-resolution';
import { getMerchantKey } from '@/lib/merchant-key';
import {
  calculateMonthSummary,
  calculateMonthlyTrends,
  calculateCategoryBreakdown,
} from '@/lib/dashboard-stats';
import { IncomeExpenseBarChart } from '@/components/dashboard/income-expense-chart';
import { CategoryPieChart } from '@/components/dashboard/category-pie-chart';
import { TransactionList } from '@/components/transactions/transaction-list';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  await requireSession();

  const allAccounts = await db.select().from(accounts);

  if (allAccounts.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-background p-8 text-center">
        <p className="text-foreground">Noch keine Konten.</p>
        <Link href="/import" className={cn(buttonVariants(), 'mt-4')}>
          CSV importieren
        </Link>
      </div>
    );
  }

  const account = allAccounts[0]; // Primary account focus

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonthKey = `${currentYear}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthKey = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`;

  const [allTransactions, categoryRows, ruleRows, latestSnapshots, recentRawTxs] = await Promise.all([
    db.select().from(transactions).where(eq(transactions.accountId, account.id)),
    db.select().from(categories),
    db.select().from(merchantCategoryRules),
    db
      .select({ balanceCents: balanceSnapshots.balanceCents })
      .from(balanceSnapshots)
      .where(eq(balanceSnapshots.accountId, account.id))
      .orderBy(desc(balanceSnapshots.snapshotDate))
      .limit(1),
    db
      .select()
      .from(transactions)
      .where(eq(transactions.accountId, account.id))
      .orderBy(desc(transactions.bookingDate), desc(transactions.id))
      .limit(5),
  ]);

  const currentBalanceCents = latestSnapshots.length > 0 ? latestSnapshots[0].balanceCents : 0;
  const { categoriesById, rulesByMerchantKey } = buildCategoryLookups(categoryRows, ruleRows);

  // Uncategorized check
  const uncategorizedMerchants = new Set<string>();
  const resolvedTxsWithCategory = allTransactions.map((tx) => {
    const resolved = resolveTransactionCategory(tx, rulesByMerchantKey, categoriesById);
    const merchantKey = getMerchantKey(tx);
    if (resolved.source === 'none') {
      uncategorizedMerchants.add(merchantKey);
    }
    return {
      amountCents: tx.amountCents,
      bookingDate: tx.bookingDate,
      categoryId: resolved.categoryId,
      categoryName: resolved.categoryName,
    };
  });

  // Calculate stats
  const currentMonthSummary = calculateMonthSummary(allTransactions, currentMonthKey);
  const lastMonthSummary = calculateMonthSummary(allTransactions, lastMonthKey);
  const monthlyTrends = calculateMonthlyTrends(allTransactions, currentYear);

  const currentMonthTxs = resolvedTxsWithCategory.filter((tx) =>
    tx.bookingDate.startsWith(currentMonthKey)
  );
  const categoryBreakdown = calculateCategoryBreakdown(currentMonthTxs);

  // Prepare recent transactions
  const recentTransactions = recentRawTxs.map((tx) => {
    const resolved = resolveTransactionCategory(tx, rulesByMerchantKey, categoriesById);
    const merchantKey = getMerchantKey(tx);
    const governingRule = findGoverningMerchantRule(tx, rulesByMerchantKey);
    return {
      ...tx,
      merchantKey,
      effectiveCategory: resolved.categoryId !== null ? { id: resolved.categoryId, name: resolved.categoryName! } : null,
      overrideCategoryId: tx.categoryOverrideId,
      merchantRuleCategoryId: governingRule?.categoryId ?? null,
      merchantRulePurposeContains: governingRule?.purposeContains ?? null,
    };
  });

  return (
    <div className="space-y-6">
      {/* Top Bar with Uncategorized Badge */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Übersicht</h1>
        {uncategorizedMerchants.size > 0 && (
          <Link
            href="/categorize"
            className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-600 hover:bg-amber-500/20 dark:text-amber-400"
          >
            {uncategorizedMerchants.size} Gegenpartei{uncategorizedMerchants.size === 1 ? '' : 'en'} unkategorisiert
          </Link>
        )}
      </div>

      {/* KPI Cards Row */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Dieser Monat</p>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-sm font-semibold text-positive">
              + {formatCents(currentMonthSummary.incomeCents, account.currency)}
            </span>
            <span className="text-sm font-semibold text-destructive">
              - {formatCents(currentMonthSummary.expenseCents, account.currency)}
            </span>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Vormonat</p>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-sm font-semibold text-positive">
              + {formatCents(lastMonthSummary.incomeCents, account.currency)}
            </span>
            <span className="text-sm font-semibold text-destructive">
              - {formatCents(lastMonthSummary.expenseCents, account.currency)}
            </span>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Aktueller Kontostand</p>
          <p className="mt-2 text-xl font-semibold text-foreground">
            {formatCents(currentBalanceCents, account.currency)}
          </p>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-4 text-sm font-medium text-foreground">Einnahmen vs. Ausgaben ({currentYear})</h2>
          <IncomeExpenseBarChart data={monthlyTrends} />
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-4 text-sm font-medium text-foreground">Kategorien im aktuellen Monat</h2>
          <CategoryPieChart data={categoryBreakdown} />
        </div>
      </div>

      {/* Recent Transactions List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-foreground">Letzte Buchungen</h2>
          <Link href={`/accounts/${account.id}`} className="text-xs text-muted-foreground hover:text-foreground">
            Alle anzeigen →
          </Link>
        </div>
        <TransactionList rows={recentTransactions} currency={account.currency} categories={categoryRows} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify Build and Tests**

```bash
pnpm test
pnpm build
```

- [ ] **Step 3: Commit Task 3**

```bash
git add src/app/\(app\)/page.tsx
git commit -m "Redesign dashboard to ezBookkeeping style with charts and KPI tiles"
```
