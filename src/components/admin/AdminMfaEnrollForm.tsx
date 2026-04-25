'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, Check, Loader2, ShieldCheck } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Step = 'loading' | 'qr' | 'verify' | 'error';

export function AdminMfaEnrollForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('loading');
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void startEnrollment();
  }, []);

  async function startEnrollment() {
    setStep('loading');
    setError(null);
    const supabase = createClient();

    const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: 'totp' });

    if (enrollError) {
      if (enrollError.message.includes('already') || enrollError.message.includes('existing')) {
        setError('Você já possui MFA configurado. Acesse a página de verificação para continuar.');
        setStep('error');
        return;
      }
      if (enrollError.message.includes('disabled') || enrollError.message.includes('not enabled')) {
        setError('MFA não está habilitado neste projeto. Contate o administrador da plataforma.');
        setStep('error');
        return;
      }
      setError(`Erro ao iniciar configuração de MFA: ${enrollError.message}`);
      setStep('error');
      return;
    }

    setFactorId(data.id);
    setQrCode(data.totp.qr_code);
    setSecret(data.totp.secret);
    setStep('qr');
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setError(null);
    setIsSubmitting(true);

    const supabase = createClient();

    let currentChallengeId = challengeId;
    if (!currentChallengeId) {
      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId,
      });
      if (challengeError) {
        setError('Erro ao criar desafio MFA. Tente novamente.');
        setIsSubmitting(false);
        return;
      }
      currentChallengeId = challengeData.id;
      setChallengeId(currentChallengeId);
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: currentChallengeId,
      code,
    });

    setIsSubmitting(false);

    if (verifyError) {
      setChallengeId(null);
      if (verifyError.message.includes('expired')) {
        setError('Desafio expirado. Reiniciando configuração...');
        setTimeout(() => startEnrollment(), 1500);
      } else {
        setError('Código incorreto. Verifique o app autenticador e tente novamente.');
      }
      setCode('');
      return;
    }

    router.refresh();
    router.push('/admin/dashboard');
  }

  async function copySecret() {
    if (!secret) return;
    await navigator.clipboard.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (step === 'loading') {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <Loader2 className="size-8 animate-spin text-text-muted" />
        <p className="text-sm text-text-secondary">Gerando QR Code…</p>
      </div>
    );
  }

  if (step === 'error') {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-feedback-danger-border bg-feedback-danger-bg px-4 py-3 text-sm text-feedback-danger-fg">
          {error}
        </div>
        <Button variant="secondary" onClick={startEnrollment}>
          Tentar novamente
        </Button>
        <a
          href="/admin/mfa-challenge"
          className="text-sm text-text-link hover:underline text-center"
        >
          Já tenho MFA configurado → verificar código
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {step === 'qr' && qrCode && (
        <>
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">
              Escaneie o QR code com seu app autenticador (Google Authenticator, Authy, etc.):
            </p>
            <div className="flex justify-center p-4 bg-surface-raised rounded-lg border border-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrCode}
                alt="QR Code MFA"
                className="size-48 sm:size-52 image-pixelated"
              />
            </div>
          </div>

          {secret && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-text-secondary uppercase tracking-wider">
                Chave manual (se não conseguir escanear)
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 text-xs bg-surface-sunken border border-border rounded-md text-text-primary font-mono break-all select-all">
                  {secret}
                </code>
                <button
                  type="button"
                  onClick={copySecret}
                  className="shrink-0 p-2 rounded-md border border-border bg-surface-raised text-text-secondary hover:text-text-primary hover:bg-surface-sunken transition-colors focus-visible:outline-none focus-visible:shadow-focus"
                  aria-label="Copiar chave"
                >
                  {copied ? <Check className="size-4 text-feedback-success-fg" /> : <Copy className="size-4" />}
                </button>
              </div>
              <p className="text-xs text-feedback-warning-fg">
                ⚠ Salve esta chave em local seguro — não será exibida novamente.
              </p>
            </div>
          )}

          <Button onClick={() => setStep('verify')} className="w-full">
            <ShieldCheck className="size-4" />
            Já escaneei — verificar código
          </Button>
        </>
      )}

      {step === 'verify' && (
        <form onSubmit={handleVerify} className="flex flex-col gap-5">
          <p className="text-sm text-text-secondary">
            Digite o código de 6 dígitos gerado pelo seu app autenticador:
          </p>

          {error && (
            <div className="rounded-lg border border-feedback-danger-border bg-feedback-danger-bg px-4 py-3 text-sm text-feedback-danger-fg">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="totp-code" className="text-sm font-medium text-text-primary">
              Código TOTP
            </Label>
            <Input
              id="totp-code"
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
              className="text-center text-xl tracking-[0.5em] font-mono"
              disabled={isSubmitting}
            />
          </div>

          <Button type="submit" size="lg" className="w-full" disabled={isSubmitting || code.length !== 6}>
            {isSubmitting ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <>
                <ShieldCheck className="size-5" />
                Confirmar e acessar
              </>
            )}
          </Button>

          <button
            type="button"
            onClick={() => setStep('qr')}
            className="text-sm text-text-link hover:underline text-center focus-visible:outline-none focus-visible:shadow-focus rounded"
          >
            ← Voltar ao QR code
          </button>
        </form>
      )}
    </div>
  );
}
