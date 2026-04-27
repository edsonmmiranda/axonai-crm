import { FileText } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { LegalPolicyCreateDialog } from './LegalPolicyCreateDialog';
import type { ActiveLegalPolicyEntry } from '@/lib/actions/admin/legal-policies.schemas';
import type { LegalPolicyKind } from '@/lib/actions/admin/legal-policies.schemas';

const KIND_LABELS: Record<LegalPolicyKind, string> = {
  terms:   'Termos de Uso',
  privacy: 'Política de Privacidade',
  dpa:     'DPA',
  cookies: 'Política de Cookies',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function isScheduled(effectiveAt: string): boolean {
  return new Date(effectiveAt) > new Date();
}

interface Props {
  policies: ActiveLegalPolicyEntry[];
  canMutate: boolean;
}

export function LegalPoliciesView({ policies, canMutate }: Props) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {policies.map(({ kind, activeVersion }) => (
        <div
          key={kind}
          className="flex flex-col gap-3 rounded-xl border border-border bg-surface-raised p-5 shadow-sm"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <FileText className="size-4 text-text-secondary" />
              <h3 className="text-sm font-semibold text-text-primary">{KIND_LABELS[kind]}</h3>
            </div>
            {activeVersion ? (
              isScheduled(activeVersion.effectiveAt) ? (
                <Badge variant="status-pending">Programada</Badge>
              ) : (
                <Badge variant="role-owner">v{activeVersion.version} · Vigente</Badge>
              )
            ) : (
              <Badge variant="status-inactive">Nunca configurada</Badge>
            )}
          </div>

          {activeVersion ? (
            <div className="flex flex-col gap-1">
              <p className="text-xs text-text-secondary">{activeVersion.summary}</p>
              <p className="text-xs text-text-muted">
                {isScheduled(activeVersion.effectiveAt)
                  ? `Programada para ${formatDate(activeVersion.effectiveAt)}`
                  : `Vigente desde ${formatDate(activeVersion.effectiveAt)}`}
              </p>
            </div>
          ) : (
            <p className="text-xs text-text-muted">
              Nenhuma versão foi criada para este tipo de política.
            </p>
          )}

          {canMutate && <LegalPolicyCreateDialog kind={kind} />}
        </div>
      ))}
    </div>
  );
}
