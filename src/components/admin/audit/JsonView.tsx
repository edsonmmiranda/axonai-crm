type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

interface Props {
  value: unknown;
  emptyLabel?: string;
}

function renderValue(value: JsonValue, depth: number): React.ReactNode {
  if (value === null) return <span className="text-text-muted">null</span>;
  if (typeof value === 'string') return <span className="text-feedback-success-fg">&quot;{value}&quot;</span>;
  if (typeof value === 'number') return <span className="text-feedback-info-fg">{value}</span>;
  if (typeof value === 'boolean') return <span className="text-feedback-info-fg">{String(value)}</span>;

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-text-muted">[]</span>;
    return (
      <>
        <span>[</span>
        <div className="ml-4 flex flex-col gap-0.5">
          {value.map((item, i) => (
            <div key={i}>
              {renderValue(item, depth + 1)}
              {i < value.length - 1 && <span>,</span>}
            </div>
          ))}
        </div>
        <span>]</span>
      </>
    );
  }

  const entries = Object.entries(value);
  if (entries.length === 0) return <span className="text-text-muted">{'{}'}</span>;
  return (
    <>
      <span>{'{'}</span>
      <div className="ml-4 flex flex-col gap-0.5">
        {entries.map(([k, v], i) => (
          <div key={k}>
            <span className="font-bold text-text-primary">&quot;{k}&quot;</span>
            <span className="text-text-secondary">: </span>
            {renderValue(v, depth + 1)}
            {i < entries.length - 1 && <span>,</span>}
          </div>
        ))}
      </div>
      <span>{'}'}</span>
    </>
  );
}

export function JsonView({ value, emptyLabel = 'Sem dados' }: Props) {
  if (value === null || value === undefined) {
    return <p className="text-sm italic text-text-muted">{emptyLabel}</p>;
  }
  if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === 0) {
    return <p className="text-sm italic text-text-muted">{emptyLabel}</p>;
  }
  return (
    <pre className="overflow-x-auto rounded-lg border border-border-subtle bg-surface-sunken p-3 font-mono text-xs leading-relaxed text-text-secondary">
      {renderValue(value as JsonValue, 0)}
    </pre>
  );
}
