import { ReactNode } from 'react';
import Link from 'next/link';
import { SignOutButton } from '@/components/sign-out-button';
import { ThemeToggle } from '@/components/theme-toggle';
import { ToastProvider } from '@/components/toast-provider';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <nav className="flex items-center gap-4">
          <Link href="/" className="font-semibold text-foreground">
            Fafnir
          </Link>
          <Link href="/import" className="text-sm text-muted-foreground hover:text-foreground">
            Import
          </Link>
          <Link href="/categories" className="text-sm text-muted-foreground hover:text-foreground">
            Kategorien
          </Link>
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <SignOutButton />
        </div>
      </header>
      <main className="flex-1 p-6">
        <ToastProvider>{children}</ToastProvider>
      </main>
    </div>
  );
}
