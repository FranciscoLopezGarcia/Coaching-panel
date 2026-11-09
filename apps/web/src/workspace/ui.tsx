import { useEffect, useRef, type ReactNode } from 'react';
export const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Mendoza',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
export const shift = (date: string, days: number) => {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
export const number = (v: number | null | undefined, digits = 1) =>
  v == null ? '—' : new Intl.NumberFormat('es-AR', { maximumFractionDigits: digits }).format(v);
export const dateLabel = (d: string | null | undefined) =>
  d
    ? new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(
        new Date(d + 'T12:00:00Z'),
      )
    : 'Sin fecha';
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-mark">＋</span>
      <strong>{title}</strong>
      <p className="muted">{children}</p>
    </div>
  );
}
export function Message({ error, children }: { error?: boolean; children: ReactNode }) {
  return (
    <div className={error ? 'message error' : 'message'} role={error ? 'alert' : 'status'}>
      {children}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    const active = document.activeElement as HTMLElement | null;
    el?.showModal();
    return () => {
      el?.close();
      active?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-label={title}
    >
      <header className="row between">
        <h2>{title}</h2>
        <button aria-label="Cerrar" onClick={onClose}>
          ×
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function Detail({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="muted">Dato faltante</span>;
  if (typeof value === 'boolean') return <span>{value ? 'Sí' : 'No'}</span>;
  if (typeof value !== 'object') return <span>{String(value)}</span>;
  if (Array.isArray(value))
    return value.length ? (
      <ul className="detail-list">
        {value.map((v, i) => (
          <li key={i}>
            <Detail value={v} />
          </li>
        ))}
      </ul>
    ) : (
      <span className="muted">Sin elementos</span>
    );
  return (
    <dl className="detail-fields">
      {Object.entries(value).map(([k, v]) => (
        <div key={k}>
          <dt>{k.replace(/([A-Z])/g, ' $1').replaceAll('_', ' ')}</dt>
          <dd>
            <Detail value={v} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
export function usePending(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
}
export const readSearch = () => new URLSearchParams(window.location.hash.split('?')[1] ?? '');
export function updateSearch(values: Record<string, string | null>, replace = false) {
  const p = readSearch();
  Object.entries(values).forEach(([k, v]) => (v ? p.set(k, v) : p.delete(k)));
  const hash = window.location.hash.split('?')[0] + (p.size ? '?' + p.toString() : '');
  if (replace) {
    window.history.replaceState(null, '', hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else window.location.hash = hash;
}
