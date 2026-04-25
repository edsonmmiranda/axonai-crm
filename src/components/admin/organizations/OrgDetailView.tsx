'use client';

import { useState } from 'react';
import { Shield, Users, Calendar, Activity, Clock } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { OrganizationStatusBadge } from './OrganizationStatusBadge';
import { OrgSuspendDialog } from './OrgSuspendDialog';
import { OrgReactivateDialog } from './OrgReactivateDialog';
import type { OrgDetail } from '@/lib/actions/admin/organizations';
import type { PlatformAdminRole } from '@/lib/auth/platformAdmin';

interface Props {
  org: OrgDetail;
  adminRole: PlatformAdminRole;
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDateShort(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR');
}

export function OrgDetailView({ org, adminRole }: Props) {
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [reactivateOpen, setReactivateOpen] = useState(false);

  const isOwner = adminRole === 'owner';

  return (
    <div className="flex flex-col gap-6">
      {/* Banners de estado */}
      {org.isInternal && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-sunken px-4 py-3">
          <Shield className="size-5 text-text-muted shrink-0" />
          <p className="text-sm text-text-secondary">
            Organização interna da Axon — protegida contra ações destrutivas.
          </p>
        </div>
      )}
      {!org.isActive && !org.isInternal && (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-feedback-danger-border bg-feedback-danger-bg px-4 py-3">
          <p className="text-sm font-medium text-feedback-danger-fg">
            Esta organização está suspensa. Os usuários não têm acesso ao app.
          </p>
          {isOwner && (
            <Button size="sm" onClick={() => setReactivateOpen(true)}>Reativar</Button>
          )}
        </div>
      )}

      {/* Grade de cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-border bg-surface-raised p-4 shadow-sm">
          <div className="flex items-center gap-2 text-text-secondary mb-2">
            <Users className="size-4" />
            <span className="text-xs font-medium uppercase tracking-wide">Usuários</span>
          </div>
          <p className="text-2xl font-bold text-text-primary">{org.usersCount}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface-raised p-4 shadow-sm">
          <div className="flex items-center gap-2 text-text-secondary mb-2">
            <Calendar className="size-4" />
            <span className="text-xs font-medium uppercase tracking-wide">Criada em</span>
          </div>
          <p className="text-sm font-semibold text-text-primary">{formatDateShort(org.createdAt)}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface-raised p-4 shadow-sm">
          <div className="flex items-center gap-2 text-text-secondary mb-2">
            <Activity className="size-4" />
            <span className="text-xs font-medium uppercase tracking-wide">Última atividade</span>
          </div>
          <p className="text-sm font-semibold text-text-primary">{formatDate(org.lastActivityAt)}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface-raised p-4 shadow-sm">
          <div className="flex items-center gap-2 text-text-secondary mb-2">
            <Clock className="size-4" />
            <span className="text-xs font-medium uppercase tracking-wide">Trial até</span>
          </div>
          <p className="text-sm font-semibold text-text-primary">
            {org.subscription?.periodEnd ? formatDateShort(org.subscription.periodEnd) : 'Sem expiração'}
          </p>
        </div>
      </div>

      {/* Assinatura */}
      <div className="rounded-xl border border-border bg-surface-raised p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-text-primary mb-4">Assinatura</h3>
        {org.subscription ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4 text-sm">
            <div>
              <dt className="text-text-secondary">Plano</dt>
              <dd className="font-medium text-text-primary">{org.subscription.planName}</dd>
            </div>
            <div>
              <dt className="text-text-secondary">Status</dt>
              <dd><OrganizationStatusBadge status={org.subscription.status} /></dd>
            </div>
            <div>
              <dt className="text-text-secondary">Início</dt>
              <dd className="font-medium text-text-primary">{formatDateShort(org.subscription.periodStart)}</dd>
            </div>
            <div>
              <dt className="text-text-secondary">Fin do período</dt>
              <dd className="font-medium text-text-primary">
                {org.subscription.periodEnd ? formatDateShort(org.subscription.periodEnd) : '—'}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-text-muted">Sem assinatura registrada.</p>
        )}
      </div>

      {/* Metadados */}
      <div className="rounded-xl border border-border bg-surface-raised p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-text-primary mb-4">Metadados</h3>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="text-text-secondary">Nome</dt>
            <dd className="font-medium text-text-primary">{org.name}</dd>
          </div>
          <div>
            <dt className="text-text-secondary">Slug</dt>
            <dd className="font-mono text-text-primary">{org.slug}</dd>
          </div>
          <div>
            <dt className="text-text-secondary">Estado</dt>
            <dd><Badge variant={org.isActive ? 'role-owner' : 'status-expired'}>{org.isActive ? 'Ativa' : 'Suspensa'}</Badge></dd>
          </div>
          <div>
            <dt className="text-text-secondary">Tipo</dt>
            <dd>{org.isInternal ? <span className="inline-flex items-center gap-1 text-text-muted"><Shield className="size-3" />Interna</span> : 'Cliente'}</dd>
          </div>
        </dl>
      </div>

      {/* Audit log recente */}
      {org.recentAuditLog.length > 0 && (
        <div className="rounded-xl border border-border bg-surface-raised p-6 shadow-sm">
          <h3 className="text-sm font-semibold text-text-primary mb-4">Atividade recente</h3>
          <ul className="space-y-2">
            {org.recentAuditLog.map((entry) => (
              <li key={entry.id} className="flex items-start gap-3 text-sm">
                <span className="shrink-0 text-text-muted text-xs pt-0.5">{formatDate(entry.occurredAt)}</span>
                <div>
                  <span className="font-mono text-xs bg-surface-sunken px-1.5 py-0.5 rounded text-text-secondary">{entry.action}</span>
                  {entry.actorEmail && <span className="ml-2 text-text-secondary">por {entry.actorEmail}</span>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Ações (owner apenas, não interna, ativa) */}
      {isOwner && !org.isInternal && org.isActive && (
        <div className="rounded-xl border border-border bg-surface-raised p-6 shadow-sm">
          <h3 className="text-sm font-semibold text-text-primary mb-4">Ações</h3>
          <Button variant="danger" size="sm" onClick={() => setSuspendOpen(true)}>
            Suspender organização
          </Button>
        </div>
      )}

      {/* Dialogs */}
      {suspendOpen && (
        <OrgSuspendDialog
          orgId={org.id}
          orgSlug={org.slug}
          orgName={org.name}
          open={suspendOpen}
          onClose={() => setSuspendOpen(false)}
        />
      )}
      {reactivateOpen && (
        <OrgReactivateDialog
          orgId={org.id}
          orgSlug={org.slug}
          orgName={org.name}
          open={reactivateOpen}
          onClose={() => setReactivateOpen(false)}
        />
      )}
    </div>
  );
}
