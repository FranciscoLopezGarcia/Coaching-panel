import { useEffect, useState } from 'react';
import { readSearch, updateSearch } from './ui';

export type Mov = 'ALL' | 'SQ' | 'BP' | 'DL';
export const MOVS: { k: Mov; n: string }[] = [
  { k: 'ALL', n: 'Todos' },
  { k: 'SQ', n: 'Sentadilla' },
  { k: 'BP', n: 'Banca' },
  { k: 'DL', n: 'Peso muerto' },
];
const read = (): Mov => {
  const v = readSearch().get('mov');
  return v === 'SQ' || v === 'BP' || v === 'DL' ? v : 'ALL';
};
/** Filtro de movimiento compartido por todo el análisis: vive en la URL (?mov=SQ) para que cualquier sección lo lea y se pueda compartir. */
export function useMov(): [Mov, (m: Mov) => void] {
  const [mov, setMov] = useState<Mov>(read);
  useEffect(() => {
    const sync = () => setMov(read());
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  return [mov, (m) => updateSearch({ mov: m === 'ALL' ? null : m }, true)];
}

export function MovementFilter({ value, onChange }: { value: Mov; onChange: (m: Mov) => void }) {
  return (
    <div className="mov-filter" role="group" aria-label="Filtro por movimiento">
      <span>Movimiento</span>
      <div className="bd-seg bd-lifts">
        {MOVS.map((m) => (
          <button
            key={m.k}
            type="button"
            aria-pressed={value === m.k}
            data-mov={m.k}
            onClick={() => onChange(m.k)}
          >
            {m.k !== 'ALL' && <i />}
            {m.n}
          </button>
        ))}
      </div>
      {value !== 'ALL' && <small>El filtro aplica a todo el análisis de este atleta.</small>}
    </div>
  );
}
