'use client';

import { useEffect } from 'react';
import { useFieldArray, useFormContext } from 'react-hook-form';
import { ChevronDown, ChevronUp, GripVertical, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface StageField {
  id?: string;
  name: string;
  order_index: number;
}

interface FunnelStagesEditorProps {
  fieldName?: string;
}

/**
 * Inline stages editor for FunnelForm.
 * Expects the parent form to have a `stages` field array.
 */
export function FunnelStagesEditor({ fieldName = 'stages' }: FunnelStagesEditorProps) {
  const {
    register,
    control,
    formState: { errors },
  } = useFormContext();

  const { fields, append, remove, move } = useFieldArray({ control, name: fieldName });

  // Auto-add one stage if array is empty on mount
  useEffect(() => {
    if (fields.length === 0) {
      append({ name: '', order_index: 0 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stagesErrors = (errors as Record<string, unknown>)[fieldName];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-secondary">
          Defina os estágios do funil em ordem de progressão.
        </p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => append({ name: '', order_index: fields.length })}
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

      <div className="flex flex-col gap-2">
        {fields.map((field, index) => {
          const fieldErrors = Array.isArray(stagesErrors)
            ? (stagesErrors[index] as Record<string, { message?: string }> | undefined)
            : undefined;

          return (
            <div
              key={field.id}
              className="flex items-center gap-2 rounded-lg border border-border bg-surface-sunken px-3 py-2"
            >
              <span
                className="flex-shrink-0 text-text-muted"
                aria-hidden="true"
              >
                <GripVertical className="size-4" />
              </span>

              <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-action-primary text-xs font-bold text-action-primary-fg">
                {index + 1}
              </span>

              <div className="flex flex-1 flex-col gap-1">
                <Input
                  placeholder={`Ex.: ${index === 0 ? 'Novo Lead' : index === 1 ? 'Qualificação' : 'Proposta'}`}
                  aria-label={`Nome do estágio ${index + 1}`}
                  aria-invalid={fieldErrors?.name ? true : undefined}
                  {...register(`${fieldName}.${index}.name`)}
                />
                {fieldErrors?.name ? (
                  <p className="text-xs text-feedback-danger-fg">
                    {fieldErrors.name.message}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => index > 0 && move(index, index - 1)}
                  disabled={index === 0}
                  aria-label={`Mover estágio ${index + 1} para cima`}
                  className="rounded p-1 text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:shadow-focus"
                >
                  <ChevronUp className="size-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => index < fields.length - 1 && move(index, index + 1)}
                  disabled={index === fields.length - 1}
                  aria-label={`Mover estágio ${index + 1} para baixo`}
                  className="rounded p-1 text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:shadow-focus"
                >
                  <ChevronDown className="size-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => fields.length > 1 && remove(index)}
                  disabled={fields.length <= 1}
                  aria-label={`Remover estágio ${index + 1}`}
                  className="rounded p-1 text-feedback-danger-fg transition-colors hover:bg-feedback-danger-bg disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:shadow-focus"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {fields.length === 0 ? (
        <p className="text-sm text-feedback-danger-fg">
          Adicione ao menos um estágio para o funil.
        </p>
      ) : null}
    </div>
  );
}
