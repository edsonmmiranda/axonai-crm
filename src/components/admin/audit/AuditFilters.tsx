'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, X, ChevronDown, Filter } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AUDIT_ACTION_REGISTRY,
  prefixOf,
} from '@/lib/audit/actionRegistry';
import { searchAuditActorsAction } from '@/lib/actions/admin/audit';
import { getOrganizationsAction } from '@/lib/actions/admin/organizations';

const selectClasses =
  'block rounded-lg border border-field-border bg-field py-2 pl-3 pr-8 text-sm text-field-fg transition-all hover:border-field-border-hover focus-visible:border-field-border-focus focus-visible:outline-none focus-visible:shadow-focus';

const inputClasses =
  'block w-full rounded-lg border border-field-border bg-field py-2 px-3 text-sm text-field-fg transition-all placeholder:text-field-placeholder hover:border-field-border-hover focus-visible:border-field-border-focus focus-visible:outline-none focus-visible:shadow-focus';

const triggerClasses =
  'inline-flex items-center justify-between gap-2 rounded-lg border border-field-border bg-field px-3 py-2 text-sm text-field-fg transition-all hover:border-field-border-hover focus-visible:border-field-border-focus focus-visible:outline-none focus-visible:shadow-focus';

const TARGET_TYPES = [
  'organization',
  'plan',
  'subscription',
  'platform_admin',
  'integration_credential',
  'settings',
  'feature_flag',
  'legal_policy',
  'login_admin',
  'metrics',
  'leads',
  'users',
  'products',
  'funnels',
  'categories',
  'tags',
] as const;

interface ActorOption {
  profileId: string;
  email:     string | null;
}

interface OrgOption {
  id:   string;
  name: string;
  slug: string;
}

interface Props {
  initialActorLabel?: string | null;
  initialOrgLabel?:   string | null;
}

export function AuditFilters({ initialActorLabel, initialOrgLabel }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const currentActions   = useMemo(
    () => (searchParams.get('actions') ?? '').split(',').filter(Boolean),
    [searchParams],
  );
  const currentActor     = searchParams.get('actorProfileId') ?? '';
  const currentTargetOrg = searchParams.get('targetOrgId') ?? '';
  const currentTargetTyp = searchParams.get('targetType') ?? '';
  const currentPeriod    = searchParams.get('period') ?? '';
  const currentFrom      = searchParams.get('from') ?? '';
  const currentTo        = searchParams.get('to') ?? '';

  function pushUpdate(updater: (p: URLSearchParams) => void) {
    const next = new URLSearchParams(searchParams.toString());
    updater(next);
    const qs = next.toString();
    startTransition(() => {
      router.push(qs ? `/admin/audit?${qs}` : '/admin/audit');
    });
  }

  function setSelectParam(key: string, value: string) {
    pushUpdate((p) => {
      if (value) p.set(key, value);
      else p.delete(key);
    });
  }

  function setPeriodPreset(value: string) {
    pushUpdate((p) => {
      if (!value) {
        p.delete('period'); p.delete('from'); p.delete('to');
      } else if (value === 'custom') {
        p.set('period', 'custom');
      } else {
        p.set('period', value);
        p.delete('from'); p.delete('to');
      }
    });
  }

  function setCustomDate(key: 'from' | 'to', value: string) {
    pushUpdate((p) => {
      if (value) p.set(key, new Date(value).toISOString());
      else p.delete(key);
    });
  }

  function applyActions(slugs: string[]) {
    pushUpdate((p) => {
      if (slugs.length === 0) p.delete('actions');
      else p.set('actions', slugs.join(','));
    });
  }

  const hasAnyFilter =
    currentActions.length > 0 ||
    currentActor !== '' ||
    currentTargetOrg !== '' ||
    currentTargetTyp !== '' ||
    currentPeriod !== '';

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface-raised p-4 shadow-sm">
      <div className="flex flex-wrap items-end gap-3">
        {/* Period */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="auditPeriod" className="text-xs font-medium text-text-secondary">
            Período
          </Label>
          <select
            id="auditPeriod"
            value={currentPeriod}
            onChange={(e) => setPeriodPreset(e.target.value)}
            className={selectClasses}
          >
            <option value="">Tudo</option>
            <option value="24h">Últimas 24h</option>
            <option value="7d">Últimos 7 dias</option>
            <option value="30d">Últimos 30 dias</option>
            <option value="custom">Customizado…</option>
          </select>
        </div>

        {currentPeriod === 'custom' && (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="auditFrom" className="text-xs font-medium text-text-secondary">De</Label>
              <input
                id="auditFrom"
                type="datetime-local"
                value={currentFrom ? toLocalInput(currentFrom) : ''}
                onChange={(e) => setCustomDate('from', e.target.value)}
                className={selectClasses}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="auditTo" className="text-xs font-medium text-text-secondary">Até</Label>
              <input
                id="auditTo"
                type="datetime-local"
                value={currentTo ? toLocalInput(currentTo) : ''}
                onChange={(e) => setCustomDate('to', e.target.value)}
                className={selectClasses}
              />
            </div>
          </>
        )}

        {/* Target type */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="auditTargetType" className="text-xs font-medium text-text-secondary">
            Tipo de alvo
          </Label>
          <select
            id="auditTargetType"
            value={currentTargetTyp}
            onChange={(e) => setSelectParam('targetType', e.target.value)}
            className={selectClasses}
          >
            <option value="">Todos</option>
            {TARGET_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        {/* Actions multi-select (Dialog) */}
        <ActionsFilterDialog selected={currentActions} onApply={applyActions} />

        {/* Actor picker (Dialog) */}
        <ActorFilterDialog
          selectedId={currentActor}
          selectedLabel={initialActorLabel ?? null}
          onSelect={(id) => setSelectParam('actorProfileId', id)}
        />

        {/* Org picker (Dialog) */}
        <OrgFilterDialog
          selectedId={currentTargetOrg}
          selectedLabel={initialOrgLabel ?? null}
          onSelect={(id) => setSelectParam('targetOrgId', id)}
        />

        {hasAnyFilter && (
          <div className="ml-auto self-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => startTransition(() => router.push('/admin/audit'))}
            >
              <X className="size-4" />
              Limpar filtros
            </Button>
          </div>
        )}
      </div>

      {currentActions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-text-secondary">Ações:</span>
          {currentActions.map((slug) => (
            <button
              key={slug}
              type="button"
              onClick={() => applyActions(currentActions.filter((s) => s !== slug))}
              className="inline-flex items-center gap-1 rounded-full border border-border-subtle bg-surface-sunken px-2 py-0.5 font-mono text-xs text-text-primary hover:border-action-primary focus-visible:outline-none focus-visible:shadow-focus"
              aria-label={`Remover filtro ${slug}`}
            >
              {slug}
              <X className="size-3" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * ActionsFilterDialog — multi-select staged em local state, aplica no click.
 * ────────────────────────────────────────────────────────────────────── */

function ActionsFilterDialog({
  selected,
  onApply,
}: {
  selected: string[];
  onApply:  (slugs: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(selected);

  useEffect(() => {
    if (open) setDraft(selected);
  }, [open, selected]);

  function toggle(slug: string) {
    setDraft((d) => (d.includes(slug) ? d.filter((s) => s !== slug) : [...d, slug]));
  }

  function apply() {
    onApply(draft);
    setOpen(false);
  }

  function clearDraft() {
    setDraft([]);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs font-medium text-text-secondary">Ações</Label>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <button type="button" className={`${triggerClasses} w-44`}>
            <span className="truncate">
              {selected.length === 0
                ? 'Todas'
                : `${selected.length} selecionada${selected.length === 1 ? '' : 's'}`}
            </span>
            <ChevronDown className="size-4 text-text-secondary" aria-hidden="true" />
          </button>
        </DialogTrigger>
        <DialogContent className="max-h-screen overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Filtrar por ações</DialogTitle>
            <DialogDescription>
              Selecione um ou mais slugs. Linhas com slugs fora da seleção ficam ocultas.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {Object.entries(AUDIT_ACTION_REGISTRY).map(([group, slugs]) => (
              <div key={group}>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
                  {prefixOf(group)}
                </p>
                <div className="flex flex-col gap-1">
                  {slugs.map((slug) => (
                    <label
                      key={slug}
                      className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-surface-sunken"
                    >
                      <input
                        type="checkbox"
                        checked={draft.includes(slug)}
                        onChange={() => toggle(slug)}
                        className="size-3.5 rounded border-border accent-action-primary"
                      />
                      <span className="font-mono text-text-primary">{slug}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={clearDraft}>
              Limpar seleção
            </Button>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={apply}>
              Aplicar {draft.length > 0 ? `(${draft.length})` : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * ActorFilterDialog — busca admins por email; clicar resultado seleciona.
 * ────────────────────────────────────────────────────────────────────── */

function ActorFilterDialog({
  selectedId,
  selectedLabel,
  onSelect,
}: {
  selectedId:    string;
  selectedLabel: string | null;
  onSelect:      (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<ActorOption[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setOptions([]);
      return;
    }
    if (query.trim().length < 2) {
      setOptions([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      const res = await searchAuditActorsAction(query.trim());
      setLoading(false);
      if (res.success && res.data) {
        setOptions(res.data.map((a) => ({
          profileId: a.actorProfileId,
          email:     a.actorEmailSnapshot,
        })));
      }
    }, 250);
  }, [query, open]);

  function pick(id: string) {
    onSelect(id);
    setOpen(false);
  }

  function clear() {
    onSelect('');
    setOpen(false);
  }

  const triggerLabel = selectedId
    ? (selectedLabel ?? 'Admin selecionado')
    : 'Filtrar admin…';

  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs font-medium text-text-secondary">Admin (ator)</Label>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <button type="button" className={`${triggerClasses} w-56`}>
            <span className="flex items-center gap-2 truncate">
              <Filter className="size-4 text-text-secondary" aria-hidden="true" />
              <span className="truncate">{triggerLabel}</span>
            </span>
            <ChevronDown className="size-4 text-text-secondary" aria-hidden="true" />
          </button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Filtrar por admin</DialogTitle>
            <DialogDescription>
              Busque pelo email do admin. Selecione uma linha para aplicar o filtro.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-secondary" aria-hidden="true" />
              <input
                type="search"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Digite ao menos 2 caracteres do email…"
                className={`${inputClasses} pl-9`}
                aria-label="Buscar admin por email"
              />
            </div>

            <div className="max-h-72 overflow-y-auto rounded-lg border border-border-subtle">
              {loading && (
                <p className="px-3 py-2 text-xs text-text-muted">Buscando…</p>
              )}
              {!loading && options.length === 0 && query.trim().length >= 2 && (
                <p className="px-3 py-2 text-xs text-text-muted">Nenhum resultado para esta busca.</p>
              )}
              {!loading && options.length === 0 && query.trim().length < 2 && (
                <p className="px-3 py-2 text-xs text-text-muted">Comece a digitar para ver sugestões.</p>
              )}
              {options.map((opt) => (
                <button
                  key={opt.profileId}
                  type="button"
                  onClick={() => pick(opt.profileId)}
                  className="flex w-full flex-col items-start gap-0.5 border-b border-border-subtle px-3 py-2 text-left last:border-b-0 hover:bg-surface-sunken focus-visible:bg-surface-sunken focus-visible:outline-none focus-visible:shadow-focus"
                >
                  <span className="text-xs font-medium text-text-primary">{opt.email ?? '(sem email)'}</span>
                  <span className="font-mono text-xs text-text-muted">{opt.profileId}</span>
                </button>
              ))}
            </div>
          </div>

          <DialogFooter>
            {selectedId && (
              <Button type="button" variant="ghost" onClick={clear}>
                Remover filtro
              </Button>
            )}
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * OrgFilterDialog — busca organizações por nome/slug.
 * ────────────────────────────────────────────────────────────────────── */

function OrgFilterDialog({
  selectedId,
  selectedLabel,
  onSelect,
}: {
  selectedId:    string;
  selectedLabel: string | null;
  onSelect:      (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<OrgOption[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setOptions([]);
      return;
    }
    if (query.trim().length < 2) {
      setOptions([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      const res = await getOrganizationsAction({ search: query.trim(), pageSize: 10, page: 1 });
      setLoading(false);
      if (res.success && res.data) {
        setOptions(res.data.map((o) => ({ id: o.id, name: o.name, slug: o.slug })));
      }
    }, 250);
  }, [query, open]);

  function pick(id: string) {
    onSelect(id);
    setOpen(false);
  }

  function clear() {
    onSelect('');
    setOpen(false);
  }

  const triggerLabel = selectedId
    ? (selectedLabel ?? 'Organização selecionada')
    : 'Filtrar organização…';

  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs font-medium text-text-secondary">Organização alvo</Label>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <button type="button" className={`${triggerClasses} w-56`}>
            <span className="flex items-center gap-2 truncate">
              <Filter className="size-4 text-text-secondary" aria-hidden="true" />
              <span className="truncate">{triggerLabel}</span>
            </span>
            <ChevronDown className="size-4 text-text-secondary" aria-hidden="true" />
          </button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Filtrar por organização</DialogTitle>
            <DialogDescription>
              Busque pelo nome ou slug da organização. Selecione uma linha para aplicar o filtro.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-secondary" aria-hidden="true" />
              <input
                type="search"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Digite ao menos 2 caracteres…"
                className={`${inputClasses} pl-9`}
                aria-label="Buscar organização"
              />
            </div>

            <div className="max-h-72 overflow-y-auto rounded-lg border border-border-subtle">
              {loading && (
                <p className="px-3 py-2 text-xs text-text-muted">Buscando…</p>
              )}
              {!loading && options.length === 0 && query.trim().length >= 2 && (
                <p className="px-3 py-2 text-xs text-text-muted">Nenhum resultado para esta busca.</p>
              )}
              {!loading && options.length === 0 && query.trim().length < 2 && (
                <p className="px-3 py-2 text-xs text-text-muted">Comece a digitar para ver sugestões.</p>
              )}
              {options.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => pick(opt.id)}
                  className="flex w-full flex-col items-start gap-0.5 border-b border-border-subtle px-3 py-2 text-left last:border-b-0 hover:bg-surface-sunken focus-visible:bg-surface-sunken focus-visible:outline-none focus-visible:shadow-focus"
                >
                  <span className="text-xs font-medium text-text-primary">{opt.name}</span>
                  <span className="font-mono text-xs text-text-muted">{opt.slug}</span>
                </button>
              ))}
            </div>
          </div>

          <DialogFooter>
            {selectedId && (
              <Button type="button" variant="ghost" onClick={clear}>
                Remover filtro
              </Button>
            )}
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
