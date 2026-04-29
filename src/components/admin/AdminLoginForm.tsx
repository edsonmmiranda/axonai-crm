'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, Lock, Eye, EyeOff, ArrowRight, Loader2 } from 'lucide-react';

import { signInAdminAction } from '@/lib/actions/admin/admin-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function AdminLoginForm() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    const formData = new FormData(e.currentTarget);
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;

    const res = await signInAdminAction({ email, password });

    if (!res.success || !res.data) {
      setIsLoading(false);
      setError(res.error ?? 'Erro ao fazer login. Tente novamente.');
      return;
    }

    router.refresh();
    router.push(res.data.redirectTo);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {error && (
        <div className="rounded-lg border border-feedback-danger-border bg-feedback-danger-bg px-4 py-3 text-sm text-feedback-danger-fg">
          {error}
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="email" className="text-sm font-medium text-text-primary">
          E-mail
        </Label>
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-text-secondary">
            <Mail className="size-5" />
          </div>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="admin@axonai.com.br"
            required
            autoComplete="email"
            className="pl-10"
            disabled={isLoading}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password" className="text-sm font-medium text-text-primary">
          Senha
        </Label>
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-text-secondary">
            <Lock className="size-5" />
          </div>
          <Input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            placeholder="••••••••"
            required
            autoComplete="current-password"
            className="pl-10 pr-10"
            disabled={isLoading}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute inset-y-0 right-0 pr-3 flex items-center text-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:shadow-focus rounded"
            aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
          >
            {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
          </button>
        </div>
      </div>

      <Button type="submit" size="lg" className="w-full mt-2" disabled={isLoading}>
        {isLoading ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <>
            <span>Acessar Área Admin</span>
            <ArrowRight className="size-5" />
          </>
        )}
      </Button>
    </form>
  );
}
