'use client';

import { useEffect } from 'react';
import { useFieldArray, useFormContext, Controller } from 'react-hook-form';
import { ChevronDown, ChevronUp, GripVertical, LogIn, Plus, Trash2, Trophy, XCircle } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export type StageRole = 'entry' | 'won' | 'lost' | null;

export interface StageField {
  id?: string;
  name: string;
  order_index: number;
  stage_role: StageRole;
}

const ROLE_CONFIG = {
  entry: {
    label: 'Entrada',
    Icon: LogIn,
    className: 'text-feedback-info-fg',
  },
  won: {
    label: 'Ganho',
    Icon: Trophy,
    className: 'text-feedback-success-fg',
  },
  lost: {
    label: 'Perdido',
    Icon: XCircle,
    className: 'text-feedback-danger-fg',
  },
} as const;

interface SortableStageRowProps {
  fieldId: string;
  index: number;
  fieldName: string;
  totalFields: number;
  usedRoles: Set<string>;
  fieldErrors: Record<string, { message?: string }> | undefined;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  registerField: ReturnType<typeof useFormContext>['register'];
  control: ReturnType<typeof useFormContext>['control'];
}

function SortableStageRow({
  fieldId,
  index,
  fieldName,
  totalFields,
  usedRoles,
  fieldErrors,
  onMoveUp,
  onMoveDown,
  onRemove,
  registerField,
  control,
}: SortableStageRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: fieldId,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-start gap-2 rounded-lg border bg-surface-sunken px-3 py-2 ${
        isDragging ? 'border-action-primary opacity-75 shadow-md' : 'border-border'
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Arrastar estágio ${index + 1}`}
        className="mt-2.5 flex-shrink-0 cursor-grab touch-none text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:shadow-focus active:cursor-grabbing"
      >
        <GripVertical className="size-4" aria-hidden="true" />
      </button>

      <Controller
        control={control}
        name={`${fieldName}.${index}.stage_role`}
        render={({ field }) => {
          const currentRole = field.value as StageRole;
          const RoleIcon = currentRole ? ROLE_CONFIG[currentRole].Icon : null;
          const roleClass = currentRole ? ROLE_CONFIG[currentRole].className : '';

          return (
            <div className="mt-1.5 flex flex-shrink-0 items-center gap-1.5">
              {RoleIcon ? (
                <RoleIcon className={`size-4 flex-shrink-0 ${roleClass}`} aria-hidden="true" />
              ) : (
                <span className="size-4 flex-shrink-0" />
              )}
              <Select
                value={field.value ?? 'neutral'}
                onValueChange={(val) => field.onChange(val === 'neutral' ? null : val)}
              >
                <SelectTrigger className="h-8 w-28 text-xs" aria-label={`Papel do estágio ${index + 1}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="neutral">— Neutro —</SelectItem>
                  {(['entry', 'won', 'lost'] as const).map((role) => {
                    const cfg = ROLE_CONFIG[role];
                    const isUsedElsewhere = usedRoles.has(role) && currentRole !== role;
                    return (
                      <SelectItem key={role} value={role} disabled={isUsedElsewhere}>
                        <span className="flex items-center gap-1.5">
                          <cfg.Icon className={`size-3.5 ${cfg.className}`} aria-hidden="true" />
                          {cfg.label}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          );
        }}
      />

      <div className="flex flex-1 flex-col gap-1 pt-1">
        <Input
          placeholder={`Ex.: ${index === 0 ? 'Novo Lead' : index === 1 ? 'Qualificação' : 'Proposta'}`}
          aria-label={`Nome do estágio ${index + 1}`}
          aria-invalid={fieldErrors?.name ? true : undefined}
          {...registerField(`${fieldName}.${index}.name`)}
        />
        {fieldErrors?.name ? (
          <p className="text-xs text-feedback-danger-fg">{fieldErrors.name.message}</p>
        ) : null}
      </div>

      <div className="mt-1 flex flex-shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onMoveUp}
          disabled={index === 0}
          aria-label={`Mover estágio ${index + 1} para cima`}
          className="rounded p-1 text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:shadow-focus"
        >
          <ChevronUp className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onMoveDown}
          disabled={index === totalFields - 1}
          aria-label={`Mover estágio ${index + 1} para baixo`}
          className="rounded p-1 text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:shadow-focus"
        >
          <ChevronDown className="size-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onRemove}
          disabled={totalFields <= 1}
          aria-label={`Remover estágio ${index + 1}`}
          className="rounded p-1 text-feedback-danger-fg transition-colors hover:bg-feedback-danger-bg disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:shadow-focus"
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

interface FunnelStagesEditorProps {
  fieldName?: string;
}

export function FunnelStagesEditor({ fieldName = 'stages' }: FunnelStagesEditorProps) {
  const {
    register,
    control,
    watch,
    formState: { errors },
  } = useFormContext();

  const { fields, append, remove, move } = useFieldArray({ control, name: fieldName });

  useEffect(() => {
    if (fields.length === 0) {
      append({ name: '', order_index: 0, stage_role: null });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = fields.findIndex((f) => f.id === active.id);
    const newIndex = fields.findIndex((f) => f.id === over.id);
    if (oldIndex !== -1 && newIndex !== -1) {
      const _ = arrayMove(fields, oldIndex, newIndex);
      void _;
      move(oldIndex, newIndex);
    }
  }

  const stagesErrors = (errors as Record<string, unknown>)[fieldName];

  // Collect which roles are already assigned (for disabling options)
  const watchedStages = watch(fieldName) as { stage_role?: StageRole }[];
  const usedRoles = new Set(
    (watchedStages ?? []).map((s) => s.stage_role).filter(Boolean) as string[]
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-secondary">
          Defina os estágios e marque os papéis de Entrada, Ganho e Perdido.
        </p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => append({ name: '', order_index: fields.length, stage_role: null })}
        >
          <Plus className="size-4" aria-hidden="true" />
          Adicionar estágio
        </Button>
      </div>

      {typeof stagesErrors === 'object' &&
      stagesErrors !== null &&
      'message' in stagesErrors ? (
        <p className="text-xs text-feedback-danger-fg">
          {String((stagesErrors as { message: string }).message)}
        </p>
      ) : null}

      {/* Role validation errors from superRefine */}
      {Array.isArray(stagesErrors) ? null : (
        typeof stagesErrors === 'object' && stagesErrors !== null && !('message' in stagesErrors) ? (
          Object.values(stagesErrors as Record<string, { message?: string }>)
            .filter((e) => e?.message)
            .map((e, i) => (
              <p key={i} className="text-xs text-feedback-danger-fg">{e.message}</p>
            ))
        ) : null
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-2">
            {fields.map((field, index) => {
              const fieldErrors = Array.isArray(stagesErrors)
                ? (stagesErrors[index] as Record<string, { message?: string }> | undefined)
                : undefined;

              return (
                <SortableStageRow
                  key={field.id}
                  fieldId={field.id}
                  index={index}
                  fieldName={fieldName}
                  totalFields={fields.length}
                  usedRoles={usedRoles}
                  fieldErrors={fieldErrors}
                  onMoveUp={() => index > 0 && move(index, index - 1)}
                  onMoveDown={() => index < fields.length - 1 && move(index, index + 1)}
                  onRemove={() => fields.length > 1 && remove(index)}
                  registerField={register}
                  control={control}
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

      {fields.length === 0 ? (
        <p className="text-sm text-feedback-danger-fg">
          Adicione ao menos um estágio para o funil.
        </p>
      ) : null}
    </div>
  );
}
