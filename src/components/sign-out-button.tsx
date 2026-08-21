'use client';

import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';

export function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    await authClient.signOut();
    router.push('/login');
  }

  return (
    <Button onClick={handleSignOut} variant="ghost" size="sm">
      Abmelden
    </Button>
  );
}
