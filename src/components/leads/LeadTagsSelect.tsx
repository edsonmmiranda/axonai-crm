'use client';

import { X } from 'lucide-react';

import { TagBadge } from '@/components/tags/TagBadge';
import type { TagColor } from '@/lib/tags/constants';
import type { TagOption } from '@/lib/actions/leads';

interface LeadTagsSelectProps {
  tags: TagOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

const selectClasses =
  'block w-full rounded-lg border border-field-border bg-field py-2 pl-3 pr-8 text-sm text-field-fg transition-all hover:border-field-border-hover focus-visible:border-field-border-focus focus-visible:outline-none focus-visible:shadow-focus';

export function LeadTagsSelect({ tags, selectedIds, onChange }: LeadTagsSelectProps) {
  function handleAdd(tagId: string) {
    if (!tagId || selectedIds.includes(tagId)) return;
    onChange([...selectedIds, tagId]);
  }

  function handleRemove(tagId: string) {
    onChange(selectedIds.filter((id) => id !== tagId));
  }

  const availableTags = tags.filter((t) => !selectedIds.includes(t.id));
  const selectedTags = selectedIds
    .map((id) => tags.find((t) => t.id === id))
    .filter(Boolean) as TagOption[];

  return (
    <div className="flex flex-col gap-2">
      <select
        value=""
        onChange={(e) => handleAdd(e.target.value)}
        className={selectClasses}
      >
        <option value="">Adicionar tag...</option>
        {availableTags.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>

      {selectedTags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selectedTags.map((tag) => (
            <span key={tag.id} className="inline-flex items-center gap-1">
              <TagBadge name={tag.name} color={tag.color as TagColor} />
              <button
                type="button"
                onClick={() => handleRemove(tag.id)}
                className="rounded-full p-0.5 text-text-secondary transition-colors hover:bg-surface-sunken hover:text-text-primary focus-visible:outline-none focus-visible:shadow-focus"
                aria-label={`Remover tag ${tag.name}`}
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
