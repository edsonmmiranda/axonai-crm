'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Kanban, Plus, Settings2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface FunnelOption {
  id: string;
  name: string;
}

interface PipelineHeaderProps {
  selectedFunnelId: string;
  funnels: FunnelOption[];
}

export function PipelineHeader({ selectedFunnelId, funnels }: PipelineHeaderProps) {
  const router = useRouter();

  const handleChange = (next: string) => {
    if (next === selectedFunnelId) return;
    router.push(`/pipeline?funnel=${next}`);
  };

  return (
    <header className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface-raised p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-action-primary/10 text-action-primary">
          <Kanban className="size-5" aria-hidden="true" />
        </div>
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold leading-tight tracking-tight text-text-primary">
            Pipeline de Vendas
          </h1>
          <div className="w-64">
            <Select value={selectedFunnelId} onValueChange={handleChange}>
              <SelectTrigger
                aria-label="Selecionar funil"
                className="h-8 text-sm"
              >
                <SelectValue placeholder="Selecione um funil" />
              </SelectTrigger>
              <SelectContent>
                {funnels.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button asChild variant="secondary" size="sm">
          <Link href={`/funnels/${selectedFunnelId}/edit`}>
            <Settings2 className="size-4" aria-hidden="true" />
            Configurar funil
          </Link>
        </Button>
        <Button asChild size="sm">
          <Link href="/leads/new">
            <Plus className="size-4" aria-hidden="true" />
            Novo lead
          </Link>
        </Button>
      </div>
    </header>
  );
}
