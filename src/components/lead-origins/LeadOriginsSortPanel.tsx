'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  LEAD_ORIGIN_SORT_KEYS,
  type LeadOriginSortDir,
  type LeadOriginSortKey,
  type LeadOriginSortRule,
} from '@/lib/lead-origins/constants';

import { parseSortParam, serializeSortParam, SORT_COLUMN_LABELS } from './sort-utils';

const ADD_PLACEHOLDER = '__add__';

export function LeadOriginsSortPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const rules = parseSortParam(searchParams.get('sort'));
  const [open, setOpen] = useState(rules.length > 0);
  const [pendingKey, setPendingKey] = useState<string>(ADD_PLACEHOLDER);
  const [pendingDir, setPendingDir] = useState<LeadOriginSortDir>('asc');

  const availableKeys = LEAD_ORIGIN_SORT_KEYS.filter(
    (k) => !rules.some((r) => r.key === k),
  );

  function commit(next: LeadOriginSortRule[]) {
    const params = new URLSearchParams(searchParams.toString());
    const serialized = serializeSortParam(next);
    if (serialized) params.set('sort', serialized);
    else params.delete('sort');
    params.delete('page');
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `/leads/origins?${qs}` : '/leads/origins');
    });
  }

  function togglePillDir(key: LeadOriginSortKey) {
    const next = rules.map((r) =>
      r.key === key ? { ...r, dir: r.dir === 'asc' ? 'desc' : 'asc' } : r,
    ) as LeadOriginSortRule[];
    commit(next);
  }

  function removeRule(key: LeadOriginSortKey) {
    commit(rules.filter((r) => r.key !== key));
  }

  function clearAll() {
    commit([]);
  }

  function addRule() {
    if (pendingKey === ADD_PLACEHOLDER) return;
    if (!LEAD_ORIGIN_SORT_KEYS.includes(pendingKey as LeadOriginSortKey)) return;
    const key = pendingKey as LeadOriginSortKey;
    if (rules.some((r) => r.key === key)) return;
    commit([...rules, { key, dir: pendingDir }]);
    setPendingKey(ADD_PLACEHOLDER);
    setPendingDir('asc');
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface-raised shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="origins-sort-body"
        className="flex w-full items-center justify-between px-4 py-3 transition-colors hover:bg-surface-sunken/50 focus-visible:outline-none focus-visible:shadow-focus"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
          <ArrowUpDown className="size-4 text-text-secondary" aria-hidden="true" />
          <span>Ordenação</span>
          {rules.length > 0 ? (
            <span className="inline-flex size-5 items-center justify-center rounded-full bg-action-primary text-xs font-bold text-action-primary-fg">
              {rules.length}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {!open && rules.length > 0 ? (
            <div className="hidden items-center gap-1.5 sm:flex">
              {rules.map((rule) => {
                const DirIcon = rule.dir === 'asc' ? ArrowUp : ArrowDown;
                return (
                  <span
                    key={rule.key}
                    className="inline-flex items-center gap-1 rounded-full border border-action-primary/20 bg-action-primary/10 px-2 py-0.5 text-xs font-medium text-action-primary"
                  >
                    {SORT_COLUMN_LABELS[rule.key]}
                    <DirIcon className="size-3" aria-hidden="true" />
                  </span>
                );
              })}
            </div>
          ) : null}
          <ChevronDown
            className={cn(
              'size-4 text-text-muted transition-transform duration-200',
              open && 'rotate-180',
            )}
            aria-hidden="true"
          />
        </div>
      </button>

      {open ? (
        <div
          id="origins-sort-body"
          className="flex flex-col gap-3 border-t border-border-subtle px-4 pb-4 pt-3"
        >
          <div className="flex items-center justify-between gap-3">
            {rules.length === 0 ? (
              <span className="text-sm italic text-text-muted">
                Clique nos títulos das colunas para ordenar ou adicione abaixo
              </span>
            ) : (
              <span className="text-xs font-medium text-text-secondary">
                {rules.length} regra{rules.length > 1 ? 's' : ''} ativa
                {rules.length > 1 ? 's' : ''}
              </span>
            )}
            {rules.length > 0 ? (
              <button
                type="button"
                onClick={clearAll}
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-feedback-danger-fg transition-colors hover:bg-feedback-danger-bg focus-visible:outline-none focus-visible:shadow-focus"
              >
                <X className="size-3.5" aria-hidden="true" />
                Limpar ordenação
              </button>
            ) : null}
          </div>

          {rules.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              {rules.map((rule, idx) => {
                const DirIcon = rule.dir === 'asc' ? ArrowUp : ArrowDown;
                return (
                  <span
                    key={rule.key}
                    className="inline-flex items-center gap-1 rounded-full border border-action-primary/30 bg-action-primary/10 py-1 pl-1 pr-1 text-xs font-medium text-action-primary"
                  >
                    {rules.length > 1 ? (
                      <span className="inline-flex size-4 items-center justify-center rounded-full bg-action-primary text-xs font-bold text-action-primary-fg">
                        {idx + 1}
                      </span>
                    ) : null}
                    <span className="px-1">{SORT_COLUMN_LABELS[rule.key]}</span>
                    <button
                      type="button"
                      onClick={() => togglePillDir(rule.key)}
                      aria-label={`Inverter direção de ${SORT_COLUMN_LABELS[rule.key]}`}
                      className="rounded-full p-0.5 transition-colors hover:bg-action-primary/20 focus-visible:outline-none focus-visible:shadow-focus"
                    >
                      <DirIcon className="size-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeRule(rule.key)}
                      aria-label={`Remover ordenação por ${SORT_COLUMN_LABELS[rule.key]}`}
                      className="rounded-full p-0.5 transition-colors hover:bg-feedback-danger-bg hover:text-feedback-danger-fg focus-visible:outline-none focus-visible:shadow-focus"
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </button>
                  </span>
                );
              })}
            </div>
          ) : null}

          {availableKeys.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-3">
              <div className="w-full sm:w-52">
                <Select value={pendingKey} onValueChange={setPendingKey}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Adicionar coluna..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ADD_PLACEHOLDER} disabled>
                      Adicionar coluna...
                    </SelectItem>
                    {availableKeys.map((k) => (
                      <SelectItem key={k} value={k}>
                        {SORT_COLUMN_LABELS[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-full sm:w-48">
                <Select
                  value={pendingDir}
                  onValueChange={(v) => setPendingDir(v as LeadOriginSortDir)}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="asc">Ascendente (A→Z)</SelectItem>
                    <SelectItem value="desc">Descendente (Z→A)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                size="sm"
                onClick={addRule}
                disabled={pendingKey === ADD_PLACEHOLDER}
              >
                <Plus className="size-3.5" aria-hidden="true" />
                Adicionar
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
