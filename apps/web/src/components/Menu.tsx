import { Fragment, useEffect, useRef, useState } from 'react';
import './menu.css';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  hint?: string;
}
export interface MenuGroup {
  title: string;
  items: MenuItem[];
}

/** Menú de acciones secundarias. Se cierra al elegir, al hacer clic afuera o con Escape. */
export function Menu({ label, groups }: { label: string; groups: MenuGroup[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const out = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      ref.current?.querySelector('button')?.focus();
    };
    document.addEventListener('pointerdown', out);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', out);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        {label}
        <span className="menu-caret" aria-hidden="true" />
      </button>
      {open && (
        <div className="menu-list">
          {groups
            .filter((g) => g.items.length)
            .map((g) => (
              <Fragment key={g.title}>
                <p>{g.title}</p>
                {g.items.map((i) => (
                  <button
                    key={i.label}
                    type="button"
                    className={i.danger ? 'danger' : ''}
                    disabled={i.disabled}
                    title={i.hint}
                    onClick={() => {
                      setOpen(false);
                      i.onSelect();
                    }}
                  >
                    {i.label}
                  </button>
                ))}
              </Fragment>
            ))}
        </div>
      )}
    </div>
  );
}
