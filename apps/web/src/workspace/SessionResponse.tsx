import { useState } from 'react';
import type { SessionRow } from '@coaching/contracts';
import { useLoad } from '../hooks';
import { Async } from '../components/Async';
import { fetchCoreSessions } from './core';
import { number, readSearch, today } from './ui';
import { prescribedReps } from './prescription';
const positions: Record<string, string> = {
  en_rango: 'Dentro del rango',
  bajo_rango: 'Bajo el rango',
  sobre_rango: 'Sobre el rango',
};
export function SessionResponse({ id, session }: { id: string; session: SessionRow }) {
  const [open, setOpen] = useState(false);
  const cutoff = readSearch().get('cutoff') ?? today();
  const dates = [
    session.date,
    ...session.sets.flatMap((x) => (x.actual?.performedOn ? [x.actual.performedOn] : [])),
  ].sort();
  const from = dates[0]!;
  const to = dates.at(-1)! < cutoff ? dates.at(-1)! : cutoff;
  const signature = JSON.stringify(session.sets.map((x) => x.actual));
  const state = useLoad(
    () => (open && from <= to ? fetchCoreSessions(id, from, to, cutoff) : Promise.resolve(null)),
    [id, session.sessionKey, from, to, cutoff, signature, open],
  );
  return (
    <details className="session-response" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Comparar series con lo previsto</summary>
      <p className="small muted">
        Datos guardados hasta {cutoff}. Los cambios del borrador se verán después de guardar. Comparaciones
        calculadas por el motor.
      </p>
      {from > to ? (
        <p className="empty">La sesión es posterior al corte de análisis seleccionado.</p>
      ) : (
        <Async state={state}>
          {(data) => {
            const blocks = data.sessions
              .filter((s) => s.sessionKey === session.sessionKey)
              .flatMap((s) => s.exercises.map((e) => ({ ...e, date: s.date })));
            return blocks.length ? (
              <>
                {blocks.map((e) => {
                  const f = e.fatigueBetweenSets;
                  return (
                    <section key={JSON.stringify([e.date, e.exerciseName, e.variantKey])}>
                      <h4>
                        {e.exerciseName} · {e.date}
                      </h4>
                      {!f ? (
                        <p>Comparación no disponible en esta respuesta.</p>
                      ) : (
                        <>
                          <p className="small">
                            {f.status === 'available'
                              ? 'Datos disponibles'
                              : f.status === 'partial'
                                ? 'Datos parciales'
                                : 'Cálculo no disponible'}{' '}
                            · {f.version}
                            {f.rpe && (
                              <>
                                {' '}
                                · RPE {number(f.rpe.first)} → {number(f.rpe.last)}
                              </>
                            )}
                            {f.reps && (
                              <>
                                {' '}
                                · Reps {number(f.reps.first, 0)} → {number(f.reps.last, 0)} ·{' '}
                                {f.reps.constantLoad ? 'carga constante' : 'carga variable'}
                              </>
                            )}
                          </p>
                          {f.reasons.map((r) => (
                            <p className="small" key={r}>
                              {r}
                            </p>
                          ))}
                          {!!f.sets.length && (
                            <div className="table-wrap">
                              <table>
                                <thead>
                                  <tr>
                                    <th>Serie</th>
                                    <th>Reps previstas</th>
                                    <th>Reps reales</th>
                                    <th>Respecto al rango</th>
                                    <th>Kg reales</th>
                                    <th>RPE objetivo</th>
                                    <th>RPE real</th>
                                    <th>Δ RPE / objetivo</th>
                                    <th>Δ RPE / anterior</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {f.sets.map((s, i) => (
                                    <tr key={i}>
                                      <td>{s.setNo}</td>
                                      <td>
                                        {s.target?.reps == null
                                          ? '—'
                                          : prescribedReps(s.target.reps, { repsMax: s.target.repsMax })}
                                      </td>
                                      <td>{number(s.reps, 0)}</td>
                                      <td>
                                        {s.repsVsTarget
                                          ? (positions[s.repsVsTarget.position] ?? s.repsVsTarget.position)
                                          : '—'}
                                      </td>
                                      <td>{number(s.kg)}</td>
                                      <td>{number(s.target?.rpe)}</td>
                                      <td>{number(s.rpe)}</td>
                                      <td>{number(s.rpeVsTarget)}</td>
                                      <td>{number(s.rpeVsPrevious)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                          <details>
                            <summary>Alcance de la comparación</summary>
                            {f.notes.map((n) => (
                              <p className="small" key={n}>
                                {n}
                              </p>
                            ))}
                            <p className="small muted">
                              Los cambios describen lo observado; no clasifican fatiga alta ni predicen
                              lesión.
                            </p>
                          </details>
                        </>
                      )}
                    </section>
                  );
                })}
              </>
            ) : (
              <p className="empty">No hay ejecución guardada de esta sesión hasta el corte.</p>
            );
          }}
        </Async>
      )}
    </details>
  );
}
