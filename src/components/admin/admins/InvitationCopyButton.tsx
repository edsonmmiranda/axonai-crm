'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

interface Props {
  link: string;
}

export function InvitationCopyButton({ link }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success('Link copiado para a área de transferência.');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Não foi possível copiar o link.');
    }
  }

  return (
    <Button type="button" variant="secondary" size="sm" onClick={handleCopy}>
      {copied ? (
        <>
          <Check className="size-3.5" aria-hidden="true" />
          Copiado
        </>
      ) : (
        <>
          <Copy className="size-3.5" aria-hidden="true" />
          Copiar link
        </>
      )}
    </Button>
  );
}
