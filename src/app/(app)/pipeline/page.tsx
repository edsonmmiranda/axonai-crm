import Link from 'next/link';
import { ChevronRight, Kanban, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { KanbanBoard } from '@/components/pipeline/KanbanBoard';
import { PipelineHeader } from '@/components/pipeline/PipelineHeader';
import { getFunnelsAction } from '@/lib/actions/funnels';
import {
  getActiveLossReasonsAction,
  getPipelineDataAction,
} from '@/lib/actions/leads';

interface SearchParams {
  funnel?: string;
}

export default async function PipelinePage(props: {
  searchParams: Promise<SearchParams>;
}) {
  const searchParams = await props.searchParams;

  const funnelsRes = await getFunnelsAction({ isActive: true, pageSize: 100 });
  const funnels = funnelsRes.success && funnelsRes.data ? funnelsRes.data : [];

  if (funnels.length === 0) {
    return <EmptyFunnelsState error={funnelsRes.error} />;
  }

  const selectedFunnelId =
    searchParams.funnel && funnels.some((f) => f.id === searchParams.funnel)
      ? searchParams.funnel
      : funnels[0].id;

  const [pipelineRes, lossReasonsRes] = await Promise.all([
    getPipelineDataAction({ funnelId: selectedFunnelId }),
    getActiveLossReasonsAction(),
  ]);

  const pipeline = pipelineRes.success && pipelineRes.data ? pipelineRes.data : null;
  const lossReasons =
    lossReasonsRes.success && lossReasonsRes.data ? lossReasonsRes.data : [];

  const funnelOptions = funnels.map((f) => ({ id: f.id, name: f.name }));

  return (
    <div className="flex h-full flex-col gap-4">
      <PipelineHeader
        selectedFunnelId={selectedFunnelId}
        funnels={funnelOptions}
      />

      {pipeline ? (
        pipeline.stages.length === 0 ? (
          <EmptyStagesState funnelId={selectedFunnelId} />
        ) : (
          <KanbanBoard initialData={pipeline} lossReasons={lossReasons} />
        )
      ) : (
        <div className="flex flex-1 items-center justify-center p-10">
          <p className="text-sm text-feedback-danger-fg">
            {pipelineRes.error ?? 'Erro ao carregar pipeline.'}
          </p>
        </div>
      )}
    </div>
  );
}

function EmptyFunnelsState({ error }: { error?: string }) {
  return (
    <div className="mr-auto flex max-w-page flex-col gap-6 pb-10">
      <nav className="flex text-sm font-medium text-text-secondary" aria-label="breadcrumb">
        <ol className="flex items-center gap-2">
          <li>
            <Link
              href="/dashboard"
              className="rounded transition-colors hover:text-action-ghost-fg focus-visible:outline-none focus-visible:shadow-focus"
            >
              Home
            </Link>
          </li>
          <li aria-hidden="true">
            <ChevronRight className="size-4 text-text-muted" />
          </li>
          <li className="font-semibold text-text-primary">Pipeline</li>
        </ol>
      </nav>

      <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border bg-surface-raised p-12 text-center">
        <div className="flex size-12 items-center justify-center rounded-xl bg-action-primary/10 text-action-primary">
          <Kanban className="size-6" aria-hidden="true" />
        </div>
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-bold text-text-primary">Nenhum funil ativo</h2>
          <p className="max-w-md text-sm text-text-secondary">
            {error ??
              'Crie um funil com ao menos um estágio de entrada, um de ganho e um de perdido para visualizar o pipeline.'}
          </p>
        </div>
        <Button asChild>
          <Link href="/funnels/new">
            <Plus className="size-4" aria-hidden="true" />
            Criar funil
          </Link>
        </Button>
      </div>
    </div>
  );
}

function EmptyStagesState({ funnelId }: { funnelId: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <h3 className="text-lg font-semibold text-text-primary">
          Este funil não possui estágios
        </h3>
        <p className="max-w-md text-sm text-text-secondary">
          Configure os estágios do funil para começar a organizar leads em colunas.
        </p>
        <Button asChild variant="secondary">
          <Link href={`/funnels/${funnelId}/edit`}>Configurar funil</Link>
        </Button>
      </div>
    </div>
  );
}
