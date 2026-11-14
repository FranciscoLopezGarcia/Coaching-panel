import { useEffect, useState } from 'react';
import { readSearch, updateSearch } from './ui';

/** Prioridad que el coach le dio a cada ejercicio en su planilla (1° = principal). No siempre el movimiento de competición es el principal. */
export type Prio = 'ALL' | '1' | '2' | '3+' | 'NONE';
const OPTIONS: { k: Prio; n: string; hint: string }[] = [
  { k: 'ALL', n: 'Todos', hint: 'Todos los ejercicios' },
  { k: '1', n: '1° · principales', hint: 'Solo el ejercicio de prioridad 1' },
  { k: '2', n: '2°', hint: 'Prioridad 2' },
  { k: '3+', n: '3° o más', hint: 'Prioridad 3, 4 o 5' },
  { k: 'NONE', n: 'Sin prioridad', hint: 'Ejercicios sin prioridad (complementarios)' },
];
const read = (): Prio => {
  const v = readSearch().get('prio');
  return v === '1' || v === '2' || v === '3+' || v === 'NONE' ? v : 'ALL';
};
export function usePrio(): [Prio, (p: Prio) => void] {
  const [prio, setPrio] = useState<Prio>(read);
  useEffect(() => {
    const sync = () => setPrio(read());
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  return [prio, (p) => updateSearch({ prio: p === 'ALL' ? null : p }, true)];
}
export const matchesPrio = (priority: number | null | undefined, f: Prio) =>
  f === 'ALL' ||
  (f === '1' && priority === 1) ||
  (f === '2' && priority === 2) ||
  (f === '3+' && priority != null && priority >= 3) ||
  (f === 'NONE' && (priority === null || priority === undefined));

export function PriorityBadge({
  priority,
  role,
}: {
  priority: number | null | undefined;
  role?: string | null;
}) {
  if (priority == null) return null;
  return (
    <span
      className={`prio-badge prio-${Math.min(priority, 4)}`}
      title={role ? `Prioridad ${priority}° · ${role}` : `Prioridad ${priority}°`}
    >
      {priority}°
    </span>
  );
}

export function PriorityFilter({ value, onChange }: { value: Prio; onChange: (p: Prio) => void }) {
  return (
    <div className="mov-filter" role="group" aria-label="Filtro por prioridad">
      <span>Prioridad del coach</span>
      <div className="bd-seg">
        {OPTIONS.map((o) => (
          <button
            key={o.k}
            type="button"
            title={o.hint}
            aria-pressed={value === o.k}
            onClick={() => onChange(o.k)}
          >
            {o.n}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * ROL del movimiento (distinto del orden 1°/2°): qué papel juega el ejercicio en la programación.
 * Se guarda en `exposureRole` (primaria · secundaria · accesorio); «sin rol» = el coach no lo clasificó (no se infiere).
 */
export type Role = 'ALL' | 'primaria' | 'secundaria' | 'accesorio' | 'NONE';
export const ROLE_NAMES: Record<string, string> = {
  primaria: 'Básico',
  secundaria: 'Variante',
  accesorio: 'Accesorio',
};
export const roleName = (role: string | null | undefined) => (role ? (ROLE_NAMES[role] ?? role) : 'Sin rol');
const ROLE_OPTIONS: { k: Role; n: string; hint: string }[] = [
  { k: 'ALL', n: 'Todos', hint: 'Todos los ejercicios' },
  { k: 'primaria', n: 'Básicos', hint: 'Movimiento básico (el que se busca mejorar directamente)' },
  { k: 'secundaria', n: 'Variantes', hint: 'Variantes o complementarios cercanos al básico' },
  { k: 'accesorio', n: 'Accesorios', hint: 'Trabajo de asistencia / músculo' },
  { k: 'NONE', n: 'Sin rol', hint: 'Ejercicios que el coach no clasificó' },
];
const readRole = (): Role => {
  const v = readSearch().get('rol');
  return v === 'primaria' || v === 'secundaria' || v === 'accesorio' || v === 'NONE' ? v : 'ALL';
};
export function useRole(): [Role, (r: Role) => void] {
  const [role, setRole] = useState<Role>(readRole);
  useEffect(() => {
    const sync = () => setRole(readRole());
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  return [role, (r) => updateSearch({ rol: r === 'ALL' ? null : r }, true)];
}
export const matchesRole = (role: string | null | undefined, f: Role) =>
  f === 'ALL' || (f === 'NONE' ? !role : role === f);
export function RoleBadge({ role }: { role: string | null | undefined }) {
  if (!role) return null;
  return (
    <span className={`role-badge role-${role}`} title={`Rol del movimiento: ${roleName(role)}`}>
      {roleName(role)}
    </span>
  );
}
export function RoleFilter({ value, onChange }: { value: Role; onChange: (r: Role) => void }) {
  return (
    <div className="mov-filter" role="group" aria-label="Filtro por rol del movimiento">
      <span>Rol del movimiento</span>
      <div className="bd-seg">
        {ROLE_OPTIONS.map((o) => (
          <button
            key={o.k}
            type="button"
            title={o.hint}
            aria-pressed={value === o.k}
            onClick={() => onChange(o.k)}
          >
            {o.n}
          </button>
        ))}
      </div>
    </div>
  );
}
