import { LoginForm } from './login-form';

export default function LoginPage() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-2xl font-semibold text-foreground">Fafnir</h1>
        <LoginForm />
      </div>
    </main>
  );
}
