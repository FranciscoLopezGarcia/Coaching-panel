import { useEffect, useMemo, useState } from 'react';
import type { Base1rm } from '@coaching/contracts';
import { workspaceApi as w, send } from './api';
import { Message, dateLabel } from './ui';
import type { QuickSegment } from './quickSession';

const fmt = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');
const SOURCE: Record<string, string> = {
  test: 'test',
  competencia: 'competencia',
  estimada_curva: 'calculado con la curva',
  estimada_formula: 'estimado con fórmula',
  decision_del_coach: 'decisión del coach',
};

/** Ejercicios del texto escritos con porcentaje (en el orden en que aparecen). */
export const pctExercises = (segs: QuickSegment[]): string[] => [
  ...new Set(segs.filter((s) => s.exerciseName && s.pct).map((s) => s.exerciseName)),
];
/** Los porcentajes necesitan un 1RM base por ejercicio: devuelve los que todavía no lo tienen. */
export const missingBase = (segs: QuickSegment[], chosen: Record<string, number>): string[] =>
  pctExercises(segs).filter((n) => !((chosen[n] ?? 0) > 0));
/** Copia el 1RM base elegido en los segmentos con porcentaje. */
export const withBase = (segs: QuickSegment[], chosen: Record<string, number>): QuickSegment[] =>
  segs.map((s) => {
    const kg = chosen[s.exerciseName] ?? 0;
    return s.pct && kg > 0 ? { ...s, ref: String(kg) } : s;
  });

/**
 * Base de los porcentajes: «80 %» es el 80 % del 1RM del ejercicio EXACTO. Se usa el 1RM declarado; si no hay, se ofrece el calculado
 * (se guarda como referencia con su fecha) o se declara uno a mano. Sin ninguno de los tres, el porcentaje no se puede usar.
 * Nunca se transfiere el 1RM de una variante a otra («Squat comp» y «Squat pausa» son distintos).
 */
export function BasePanel({
  id,
  date,
  segs,
  current,
  chosen,
  onChosen,
}: {
  id: string;
  date: string;
  segs: QuickSegment[];
  /** 1RM base con el que ya está programada la sesión (se conserva salvo que se cambie a propósito). */
  current: Record<string, number>;
  chosen: Record<string, number>;
  onChosen: (next: Record<string, number>) => void;
}) {
  const names = useMemo(() => pctExercises(segs), [segs]);
  const key = names.join('|');
  const [rows, setRows] = useState<Base1rm[]>([]);
  const [manual, setManual] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadedFor, setLoadedFor] = useState('');
  useEffect(() => {
    if (!names.length) return;
    let live = true;
    w.base1rm(id, names, date)
      .then((r) => {
        if (!live) return;
        setRows(r);
        setLoadedFor(key);
        // lo ya programado se conserva; si no, el declarado vigente se usa solo (el calculado hay que elegirlo)
        const next = { ...chosen };
        for (const row of r) {
          const n = names.find((x) => x === row.exerciseName) ?? row.exerciseName;
          if (!((next[n] ?? 0) > 0)) {
            if ((current[n] ?? 0) > 0) next[n] = current[n]!;
            else if (row.declared) next[n] = row.declared.kg;
          }
        }
        onChosen(next);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [id, date, key]);
  if (!names.length) return null;

  const save = async (
    name: string,
    kg: number,
    source: 'decision_del_coach' | 'estimada_curva',
    note: string,
  ) => {
    setBusy(true);
    setError('');
    try {
      await send(id, 'references', { exerciseName: name, kg, source, asOf: date, note }, 'POST');
      onChosen({ ...chosen, [name]: kg });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="preview base-panel">
      <h3>Base de los porcentajes</h3>
      <p className="small muted">
        El porcentaje se calcula sobre el 1RM de ese ejercicio exacto. No se usa el de otra variante.
      </p>
      {error && <Message error>{error}</Message>}
      {loadedFor !== key && !error && <p className="small muted">Buscando el 1RM del atleta…</p>}
      {names.map((n) => {
        const row = rows.find((r) => r.exerciseName === n);
        const kg = chosen[n] ?? 0;
        return (
          <div key={n} className="base-row">
            <strong>{n}</strong>{' '}
            {kg > 0 ? (
              <span className="base-ok">
                ✓ · base {fmt(kg)} kg
                {current[n] === kg ? ' (la de la sesión)' : ''}
              </span>
            ) : (
              <span className="base-bad">✕ sin 1RM: no se puede usar porcentaje</span>
            )}
            {row?.declared && (
              <p className="small muted">
                Declarado: {fmt(row.declared.kg)} kg ({SOURCE[row.declared.source] ?? row.declared.source},{' '}
                {dateLabel(row.declared.asOf)})
                {kg !== row.declared.kg && (
                  <>
                    {' '}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onChosen({ ...chosen, [n]: row.declared!.kg })}
                    >
                      Usar este
                    </button>
                  </>
                )}
              </p>
            )}
            {row?.calculated && (
              <p className="small muted">
                Calculado: {fmt(row.calculated.kg)} kg (mejor e1RM de {row.calculated.sets} series con RPE
                real, últimos {row.calculated.windowDays} días, al {dateLabel(row.calculated.asOf)}){' '}
                {kg !== row.calculated.kg && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void save(
                        n,
                        row.calculated!.kg,
                        'estimada_curva',
                        `Calculado de ${row.calculated!.sets} series observadas`,
                      )
                    }
                  >
                    Usar el calculado
                  </button>
                )}
              </p>
            )}
            {!row?.declared && !row?.calculated && (
              <p className="small muted">No hay 1RM declarado ni calculado para este ejercicio.</p>
            )}
            <label className="small">
              Declarar un 1RM (kg)
              <span className="row">
                <input
                  type="number"
                  min={1}
                  step={0.5}
                  value={manual[n] ?? ''}
                  onChange={(e) => setManual({ ...manual, [n]: e.target.value })}
                />
                <button
                  type="button"
                  disabled={busy || !(Number(manual[n]) > 0)}
                  onClick={() =>
                    void save(n, Number(manual[n]), 'decision_del_coach', 'Declarado al programar')
                  }
                >
                  Declarar
                </button>
              </span>
            </label>
          </div>
        );
      })}
    </div>
  );
}
