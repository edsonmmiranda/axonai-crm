'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, User } from 'lucide-react';

import { searchGlobalAction, type GlobalSearchLead } from '@/lib/actions/leads';
import { STATUS_LABELS } from '@/components/leads/LeadStatusBadge';
import { cn } from '@/lib/utils';

export function GlobalSearch() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GlobalSearchLead[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced search
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsLoading(true);
      const res = await searchGlobalAction(query);
      setIsLoading(false);
      if (res.success && res.data) {
        setResults(res.data);
        setIsOpen(true);
        setActiveIndex(-1);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function navigateToLead(id: string) {
    setIsOpen(false);
    setQuery('');
    router.push(`/leads/${id}`);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!isOpen) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && results[activeIndex]) {
        navigateToLead(results[activeIndex].id);
      } else if (query.trim().length >= 2) {
        setIsOpen(false);
        router.push(`/leads?search=${encodeURIComponent(query.trim())}`);
        setQuery('');
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      inputRef.current?.blur();
    }
  }

  return (
    <div ref={containerRef} className="group relative w-full">
      <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
        <Search
          className="size-5 text-text-secondary transition-colors group-focus-within:text-action-primary"
          aria-hidden="true"
        />
      </div>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => results.length > 0 && setIsOpen(true)}
        placeholder="Buscar leads, empresas ou contratos..."
        aria-label="Busca global"
        aria-expanded={isOpen}
        aria-autocomplete="list"
        autoComplete="off"
        className="block w-full rounded-lg border border-field-border bg-field py-2 pl-10 pr-3 text-sm leading-5 text-field-fg shadow-sm transition-all placeholder:text-field-placeholder hover:border-field-border-hover focus-visible:border-field-border-focus focus-visible:bg-surface-raised focus-visible:outline-none focus-visible:shadow-focus"
      />

      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface-raised shadow-lg">
          {isLoading ? (
            <div className="px-4 py-3 text-sm text-text-secondary">Buscando...</div>
          ) : results.length === 0 ? (
            <div className="px-4 py-3 text-sm text-text-secondary">Nenhum resultado encontrado.</div>
          ) : (
            <ul role="listbox">
              {results.map((lead, i) => (
                <li
                  key={lead.id}
                  role="option"
                  aria-selected={i === activeIndex}
                  onMouseEnter={() => setActiveIndex(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    navigateToLead(lead.id);
                  }}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm transition-colors',
                    i === activeIndex ? 'bg-surface-sunken' : 'hover:bg-surface-sunken'
                  )}
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-action-primary/10 text-action-primary">
                    <User className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-text-primary">{lead.name}</p>
                    <p className="truncate text-xs text-text-secondary">
                      {[lead.company, lead.email].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-text-secondary">
                    {STATUS_LABELS[lead.status] ?? lead.status}
                  </span>
                </li>
              ))}
              {results.length >= 8 && (
                <li
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setIsOpen(false);
                    router.push(`/leads?search=${encodeURIComponent(query.trim())}`);
                    setQuery('');
                  }}
                  className="cursor-pointer border-t border-border px-4 py-2 text-center text-xs text-action-primary hover:bg-surface-sunken"
                >
                  Ver todos os resultados para &ldquo;{query}&rdquo;
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
