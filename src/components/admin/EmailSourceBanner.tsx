import Link from 'next/link';
import { AlertCircle, TriangleAlert } from 'lucide-react';

import { getEmailSourceStatus } from '@/lib/email/getEmailSourceStatus';

export async function EmailSourceBanner() {
  const status = await getEmailSourceStatus();

  if (status.platformSetting || status.envVar) return null;

  if (status.offlineFallback) {
    return (
      <div
        role="status"
        className="flex items-center gap-3 border-b border-feedback-warning-border bg-feedback-warning-bg px-6 py-3 text-sm text-feedback-warning-fg"
      >
        <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
        <p className="flex-1">
          Email não configurado — convites e resets gerarão link copiável.
        </p>
        <Link
          href="/admin/settings/integrations/email"
          className="font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus rounded"
        >
          Configurar agora
        </Link>
      </div>
    );
  }

  return (
    <div
      role="alert"
      className="flex items-center gap-3 border-b border-feedback-danger-border bg-feedback-danger-bg px-6 py-3 text-sm text-feedback-danger-fg"
    >
      <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
      <p className="flex-1">
        Email não configurado e fallback offline desativado — convites e resets vão falhar.
      </p>
      <Link
        href="/admin/settings/integrations/email"
        className="font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus rounded"
      >
        Configurar agora
      </Link>
    </div>
  );
}
