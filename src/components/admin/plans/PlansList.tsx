'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import Link from 'next/link';
import { Plus, Pencil, Archive, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PlanStatusBadge } from './PlanStatusBadge';
import { ArchivePlanDialog } from './ArchivePlanDialog';
import { DeletePlanDialog } from './DeletePlanDialog';
import { archivePlanAction } from '@/lib/actions/admin/plans';
import type { PlanListItem } from '@/lib/actions/admin/plans';
import type { PlatformAdminRole } from '@/lib/auth/platformAdmin';
import { useState } from 'react';

interface Props {
  plans: PlanListItem[];
  total: number;
  page: number;
  pageSize: number;
  search: string;
  showArchived: boolean;
  adminRole: PlatformAdminRole;
}

function formatBRL(cents: number) {
  if (cents === 0) return 'Grátis';
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatLimit(val: number | null) {
  return val === null ? '∞' : val.toLocaleString('pt-BR');
}

export function PlansList({ plans, total, page, pageSize, search, showArchived, adminRole }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [archiveDialogId, setArchiveDialogId] = useState<string | null>(null);
  const [deleteDialogPlan, setDeleteDialogPlan] = useState<PlanListItem | null>(null);
  const [isPending, startTransition] = useTransition();

  const isOwner = adminRole === 'owner';
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function pushParam(key: string, value: string | undefined) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value); else params.delete(key);
    params.set('page', '1');
    router.push(`/admin/plans?${params.toString()}`);
  }

  function handleArchive(id: string) {
    startTransition(async () => {
      const res = await archivePlanAction({ id });
      if (!res.success) {
        toast.error(res.error ?? 'Não foi possível arquivar o plano.');
        return;
      }
      toast.success('Plano arquivado.');
      setArchiveDialogId(null);
    });
  }

  if (plans.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <Toolbar search={search} showArchived={showArchived} onSearch={(v) => pushParam('search', v || undefined)} onToggleArchived={() => pushParam('archived', showArchived ? undefined : 'true')} isOwner={isOwner} />
        <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-surface-raised py-16 text-center">
          <p className="text-text-secondary text-sm">
            {search ? `Nenhum plano encontrado para "${search}".` : 'Nenhum plano cadastrado ainda.'}
          </p>
          {isOwner && !search && (
            <Link href="/admin/plans/new" className="mt-4">
              <Button variant="primary" size="sm">
                <Plus className="size-4" />
                Criar primeiro plano
              </Button>
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Toolbar
        search={search}
        showArchived={showArchived}
        onSearch={(v) => pushParam('search', v || undefined)}
        onToggleArchived={() => pushParam('archived', showArchived ? undefined : 'true')}
        isOwner={isOwner}
      />

      <div className="rounded-lg border border-border bg-surface-raised overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-sunken border-b border-border">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-text-secondary">Nome</th>
              <th className="text-left px-4 py-3 font-medium text-text-secondary">Mensal</th>
              <th className="text-left px-4 py-3 font-medium text-text-secondary">Anual</th>
              <th className="text-left px-4 py-3 font-medium text-text-secondary hidden md:table-cell">Usuários</th>
              <th className="text-left px-4 py-3 font-medium text-text-secondary hidden lg:table-cell">Leads</th>
              <th className="text-left px-4 py-3 font-medium text-text-secondary">Status</th>
              <th className="text-left px-4 py-3 font-medium text-text-secondary">Subs ativas</th>
              {isOwner && <th className="px-4 py-3" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {plans.map((plan) => (
              <tr key={plan.id} className="hover:bg-surface-sunken transition-colors">
                <td className="px-4 py-3 font-medium text-text-primary">{plan.name}</td>
                <td className="px-4 py-3 text-text-secondary">{formatBRL(plan.priceMonthly)}</td>
                <td className="px-4 py-3 text-text-secondary">{formatBRL(plan.priceYearly)}</td>
                <td className="px-4 py-3 text-text-secondary hidden md:table-cell">{formatLimit(plan.maxUsers)}</td>
                <td className="px-4 py-3 text-text-secondary hidden lg:table-cell">{formatLimit(plan.maxLeads)}</td>
                <td className="px-4 py-3">
                  <PlanStatusBadge isArchived={plan.isArchived} isPublic={plan.isPublic} />
                </td>
                <td className="px-4 py-3 text-text-secondary">{plan.activeSubscriptionsCount}</td>
                {isOwner && (
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      {!plan.isArchived && (
                        <Link href={`/admin/plans/${plan.id}/edit`}>
                          <Button variant="ghost" size="sm" className="size-8 p-0" title="Editar">
                            <Pencil className="size-4" />
                          </Button>
                        </Link>
                      )}
                      {!plan.isArchived && (
                        <Button variant="ghost" size="sm" className="size-8 p-0" title="Arquivar" onClick={() => setArchiveDialogId(plan.id)} disabled={isPending}>
                          <Archive className="size-4" />
                        </Button>
                      )}
                      {plan.activeSubscriptionsCount === 0 && (
                        <Button variant="ghost" size="sm" className="size-8 p-0" title="Excluir" onClick={() => setDeleteDialogPlan(plan)}>
                          <Trash2 className="size-4 text-feedback-danger-fg" />
                        </Button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-text-secondary">
          <span>{total} planos no total</span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => pushParam('page', String(page - 1))}>
              Anterior
            </Button>
            <span className="px-2">Página {page} de {totalPages}</span>
            <Button variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => pushParam('page', String(page + 1))}>
              Próxima
            </Button>
          </div>
        </div>
      )}

      <ArchivePlanDialog
        open={archiveDialogId !== null}
        onClose={() => setArchiveDialogId(null)}
        onConfirm={() => archiveDialogId && handleArchive(archiveDialogId)}
        isPending={isPending}
      />

      <DeletePlanDialog
        plan={deleteDialogPlan}
        onClose={() => setDeleteDialogPlan(null)}
      />
    </div>
  );
}

interface ToolbarProps {
  search: string;
  showArchived: boolean;
  onSearch: (v: string) => void;
  onToggleArchived: () => void;
  isOwner: boolean;
}

function Toolbar({ search, showArchived, onSearch, onToggleArchived, isOwner }: ToolbarProps) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <Input
        placeholder="Buscar planos..."
        defaultValue={search}
        onChange={(e) => {
          const handler = setTimeout(() => onSearch(e.target.value), 400);
          return () => clearTimeout(handler);
        }}
        className="max-w-xs"
      />
      <Button variant="ghost" size="sm" onClick={onToggleArchived}>
        {showArchived ? 'Ocultar arquivados' : 'Mostrar arquivados'}
      </Button>
      {isOwner && (
        <Link href="/admin/plans/new" className="ml-auto">
          <Button variant="primary" size="sm">
            <Plus className="size-4" />
            Novo plano
          </Button>
        </Link>
      )}
    </div>
  );
}
