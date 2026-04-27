'use client';

import { useTransition, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { refreshDashboardMetricsAction } from '@/lib/actions/admin/platform-metrics';

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'agora mesmo';
  if (mins < 60) return `há ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `há ${hrs}h`;
  return `há ${Math.floor(hrs / 24)}d`;
}

interface Props {
  refreshedAt: string;
  canRefresh: boolean;
}

export function RefreshNowButton({ refreshedAt, canRefresh }: Props) {
  const [pending, startTransition] = useTransition();
  const [lastClickAt, setLastClickAt] = useState(0);
  const [localRefreshedAt, setLocalRefreshedAt] = useState(refreshedAt);

  function handleRefresh() {
    const now = Date.now();
    if (now - lastClickAt < 5000) return; // 5s debounce client-side
    setLastClickAt(now);
    startTransition(async () => {
      const result = await refreshDashboardMetricsAction();
      if (result.success && result.data) {
        setLocalRefreshedAt(result.data.refreshedAt);
        toast.success('Métricas atualizadas.');
      } else {
        toast.error(result.error ?? 'Erro ao atualizar.');
      }
    });
  }

  return (
    <div className="flex items-center gap-3">
      <p
        className="text-text-muted text-xs"
        aria-live="polite"
        aria-atomic="true"
      >
        Atualizado {timeAgo(localRefreshedAt)}
      </p>
      {canRefresh && (
        <Button
          variant="secondary"
          size="sm"
          onClick={handleRefresh}
          disabled={pending}
          aria-label="Atualizar métricas agora"
        >
          <RefreshCw className={`size-3.5 ${pending ? 'animate-spin' : ''}`} />
          Atualizar
        </Button>
      )}
    </div>
  );
}
