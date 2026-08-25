import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function NotFound() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm font-medium text-muted-foreground">404</p>
      <h1 className="text-xl font-semibold text-foreground">Seite nicht gefunden</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Die aufgerufene Seite existiert nicht oder wurde verschoben.
      </p>
      <Link href="/" className={cn(buttonVariants(), 'mt-2')}>
        Zurück zur Startseite
      </Link>
    </div>
  );
}
