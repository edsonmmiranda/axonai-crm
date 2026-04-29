interface Props {
  before: Record<string, unknown> | null;
  after:  Record<string, unknown> | null;
}

function formatValue(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

export function DiffTable({ before, after }: Props) {
  const beforeObj = before ?? {};
  const afterObj  = after  ?? {};
  const keys = Array.from(new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)])).sort();

  if (keys.length === 0) {
    return <p className="text-sm italic text-text-muted">Sem campos no diff.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border-subtle">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-border-subtle bg-surface-sunken text-xs uppercase text-text-secondary">
          <tr>
            <th scope="col" className="px-3 py-2 font-semibold tracking-wide">Campo</th>
            <th scope="col" className="px-3 py-2 font-semibold tracking-wide">Antes</th>
            <th scope="col" className="px-3 py-2 font-semibold tracking-wide">Depois</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {keys.map((key) => {
            const b = (beforeObj as Record<string, unknown>)[key];
            const a = (afterObj  as Record<string, unknown>)[key];
            const changed = JSON.stringify(b) !== JSON.stringify(a);
            return (
              <tr key={key} className={changed ? 'bg-feedback-warning-bg/30' : undefined}>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs font-semibold text-text-primary">
                  {key}
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  <span
                    className={
                      changed
                        ? 'rounded border border-feedback-danger-border bg-feedback-danger-bg px-1.5 py-0.5 text-feedback-danger-fg'
                        : 'text-text-secondary'
                    }
                  >
                    {formatValue(b)}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  <span
                    className={
                      changed
                        ? 'rounded border border-feedback-success-border bg-feedback-success-bg px-1.5 py-0.5 text-feedback-success-fg'
                        : 'text-text-secondary'
                    }
                  >
                    {formatValue(a)}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
