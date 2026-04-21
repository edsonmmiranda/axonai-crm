'use client';

import { useMemo, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { toast } from 'sonner';

import {
  moveLeadAction,
  type LossReasonOption,
  type PipelineData,
  type PipelineLead,
  type PipelineStage,
} from '@/lib/actions/leads';

import { KanbanColumn } from './KanbanColumn';
import { LossReasonModal } from './LossReasonModal';

interface KanbanBoardProps {
  initialData: PipelineData;
  lossReasons: LossReasonOption[];
}

interface PendingLossMove {
  leadId: string;
  fromStageId: string;
  toStageId: string;
  toIndex: number;
  snapshot: PipelineStage[];
}

function findStageOfLead(
  stages: PipelineStage[],
  leadId: string,
): { stage: PipelineStage; index: number } | null {
  for (const stage of stages) {
    const idx = stage.leads.findIndex((l) => l.id === leadId);
    if (idx >= 0) return { stage, index: idx };
  }
  return null;
}

function resolveDestination(
  stages: PipelineStage[],
  overId: string,
  activeLeadId: string,
): { stageId: string; index: number } | null {
  if (overId.startsWith('column:')) {
    const stageId = overId.slice('column:'.length);
    const stage = stages.find((s) => s.id === stageId);
    if (!stage) return null;
    const filtered = stage.leads.filter((l) => l.id !== activeLeadId);
    return { stageId, index: filtered.length };
  }
  for (const stage of stages) {
    const idx = stage.leads.findIndex((l) => l.id === overId);
    if (idx >= 0) return { stageId: stage.id, index: idx };
  }
  return null;
}

function applyLocalMove(
  stages: PipelineStage[],
  leadId: string,
  toStageId: string,
  toIndex: number,
): PipelineStage[] {
  const source = findStageOfLead(stages, leadId);
  if (!source) return stages;

  const lead = source.stage.leads[source.index];

  if (source.stage.id === toStageId) {
    const newLeads = arrayMove(source.stage.leads, source.index, toIndex);
    return stages.map((s) =>
      s.id === source.stage.id ? { ...s, leads: newLeads } : s,
    );
  }

  return stages.map((s) => {
    if (s.id === source.stage.id) {
      return {
        ...s,
        leads: s.leads.filter((l) => l.id !== leadId),
        leads_total: Math.max(0, s.leads_total - 1),
      };
    }
    if (s.id === toStageId) {
      const before = s.leads.slice(0, toIndex);
      const after = s.leads.slice(toIndex);
      return {
        ...s,
        leads: [...before, lead, ...after],
        leads_total: s.leads_total + 1,
      };
    }
    return s;
  });
}

export function KanbanBoard({ initialData, lossReasons }: KanbanBoardProps) {
  const [stages, setStages] = useState<PipelineStage[]>(initialData.stages);
  const [activeLead, setActiveLead] = useState<PipelineLead | null>(null);
  const [pendingLoss, setPendingLoss] = useState<PendingLossMove | null>(null);
  const [submittingLoss, setSubmittingLoss] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const columnIds = useMemo(() => stages.map((s) => `column:${s.id}`), [stages]);

  const handleDragStart = (event: DragStartEvent) => {
    const leadId = String(event.active.id);
    const found = findStageOfLead(stages, leadId);
    setActiveLead(found ? found.stage.leads[found.index] : null);
  };

  const handleDragCancel = () => {
    setActiveLead(null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveLead(null);
    const { active, over } = event;
    if (!over) return;

    const leadId = String(active.id);
    const overId = String(over.id);

    const dest = resolveDestination(stages, overId, leadId);
    if (!dest) return;

    const source = findStageOfLead(stages, leadId);
    if (!source) return;

    if (source.stage.id === dest.stageId && source.index === dest.index) {
      return;
    }

    const toStage = stages.find((s) => s.id === dest.stageId);
    if (!toStage) return;

    if (toStage.stage_role === 'lost') {
      setPendingLoss({
        leadId,
        fromStageId: source.stage.id,
        toStageId: dest.stageId,
        toIndex: dest.index,
        snapshot: stages,
      });
      return;
    }

    const snapshot = stages;
    const optimistic = applyLocalMove(stages, leadId, dest.stageId, dest.index);
    setStages(optimistic);

    const res = await moveLeadAction({
      leadId,
      toStageId: dest.stageId,
      toIndex: dest.index,
    });

    if (!res.success) {
      setStages(snapshot);
      toast.error(res.error ?? 'Não foi possível mover o lead.');
      return;
    }

    if (toStage.stage_role === 'won') {
      toast.success('Lead marcado como ganho.');
    }
  };

  const handleConfirmLoss = async (reasonId: string, notes: string | null) => {
    if (!pendingLoss) return;
    setSubmittingLoss(true);

    const { leadId, toStageId, toIndex, snapshot } = pendingLoss;
    const optimistic = applyLocalMove(snapshot, leadId, toStageId, toIndex);
    setStages(optimistic);

    const res = await moveLeadAction({
      leadId,
      toStageId,
      toIndex,
      lossReasonId: reasonId,
      lossNotes: notes,
    });

    setSubmittingLoss(false);

    if (!res.success) {
      setStages(snapshot);
      toast.error(res.error ?? 'Não foi possível mover o lead.');
      setPendingLoss(null);
      return;
    }

    toast.success('Lead marcado como perdido.');
    setPendingLoss(null);
  };

  const handleCancelLoss = () => {
    if (submittingLoss) return;
    setPendingLoss(null);
  };

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div
          className="flex-1 overflow-x-auto overflow-y-hidden"
          data-column-ids={columnIds.join(',')}
        >
          <div className="flex h-full min-w-max gap-4 pb-2">
            {stages.map((stage) => (
              <KanbanColumn
                key={stage.id}
                stage={stage}
                isDragActive={activeLead !== null}
              />
            ))}
          </div>
        </div>
      </DndContext>

      <LossReasonModal
        open={pendingLoss !== null}
        lossReasons={lossReasons}
        onConfirm={handleConfirmLoss}
        onCancel={handleCancelLoss}
        submitting={submittingLoss}
      />
    </>
  );
}
