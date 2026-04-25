'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, Loader2 } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function AdminMfaChallengeForm() {
  const router = useRouter();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void initChallenge();
  }, []);

  async function initChallenge() {
    setIsLoading(true);
    setError(null);
    const supabase = createClient();

    const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
    if (listError || !factors?.totp?.length) {
      setError('Nenhum fator MFA encontrado. Configure o MFA antes de continuar.');
      setIsLoading(false);
      return;
    }

    const activeFactor = factors.totp.find((f) => f.status === 'verified') ?? factors.totp[0];
    setFactorId(activeFactor.id);

    const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
      factorId: activeFactor.id,
    });

    setIsLoading(false);

    if (challengeError) {
      setError(`Erro ao iniciar verificação MFA: ${challengeError.message}`);
      return;
    }

    setChallengeId(challengeData.id);
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId || !challengeId) return;
    setError(null);
    setIsSubmitting(true);

    const supabase = createClient();
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId,
      code,
    });

    setIsSubmitting(false);

    if (verifyError) {
      setCode('');
      // Renew challenge on error (Supabase invalidates after failure)
      void initChallenge();
      if (
        verifyError.message.includes('rate') ||
        verifyError.message.includes('limit') ||
        verifyError.message.includes('too many')
      ) {
        setError('Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.');
      } else {
        setError('Código inválido ou expirado.');
      }
      return;
    }

    router.refresh();
    router.push('/admin/dashboard');
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <Loader2 className="size-8 animate-spin text-text-muted" />
        <p className="text-sm text-text-secondary">Iniciando verificação…</p>
      </div>
    );
  }

  if (!factorId) {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-feedback-danger-border bg-feedback-danger-bg px-4 py-3 text-sm text-feedback-danger-fg">
          {error ?? 'Nenhum fator MFA encontrado.'}
        </div>
        <a href="/admin/mfa-enroll" className="text-sm text-text-link hover:underline text-center">
          Configurar MFA agora
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={handleVerify} className="flex flex-col gap-5">
      <p className="text-sm text-text-secondary">
        Abra seu app autenticador e digite o código atual de 6 dígitos:
      </p>

      {error && (
        <div className="rounded-lg border border-feedback-danger-border bg-feedback-danger-bg px-4 py-3 text-sm text-feedback-danger-fg">
          {error}
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="challenge-code" className="text-sm font-medium text-text-primary">
          Código TOTP
        </Label>
        <Input
          id="challenge-code"
          name="code"
          type="text"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          placeholder="000000"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          required
          autoComplete="one-time-code"
          autoFocus
          className="text-center text-xl tracking-[0.5em] font-mono"
          disabled={isSubmitting}
        />
      </div>

      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={isSubmitting || code.length !== 6}
      >
        {isSubmitting ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <>
            <ShieldCheck className="size-5" />
            Verificar e acessar
          </>
        )}
      </Button>

      <p className="text-center text-xs text-text-muted">
        Problemas com o autenticador? Contate outro platform admin owner para assistência.
      </p>
    </form>
  );
}
